const { EventEmitter } = require('events');
const { scrapeComments } = require('../scrapers/linkedinScraper');
const { enrichPerson } = require('../enrichment/apolloClient');
const { classifyComments } = require('../scoring/intentClassifier');
const { scoreICP, loadICP } = require('../scoring/icpScorer');
const { rankLeads } = require('../scoring/ranker');
const { generateDrafts } = require('../outreach/draftGenerator');
const queries = require('../db/queries');
const { getSuppressedUrls } = require('../db/suppressionQueries');
const { recordAppearance, getAppearanceCounts } = require('../db/signalQueries');

/**
 * Run the full lead scanning pipeline for a LinkedIn post URL.
 *
 * Emits progress events via an EventEmitter for SSE streaming to the frontend.
 *
 * Pipeline steps in order:
 * 1. Scrape comments from the post
 * 2. Pre-filter by ICP exclude keywords
 * 3. Enrich via Apollo (batches of 10)
 * 4. Score ICP
 * 5. Classify intent via Claude (single batch)
 * 6. Rank by combined score
 * 7. Generate outreach drafts for leads scoring 40+
 * 8. Save all leads to SQLite
 *
 * @param {Object} options
 * @param {string} options.postUrl - LinkedIn post URL to scan
 * @param {string} [options.outreachMode='direct'] - Outreach angle
 * @param {string} [options.icpProfileName='icp'] - ICP profile name from config/
 * @returns {{ emitter: EventEmitter, promise: Promise }}
 */
function runScan({ postUrl, outreachMode = 'direct', icpProfileName = 'icp' }) {
  const emitter = new EventEmitter();

  const promise = (async () => {
    try {
      // Load ICP config from YAML
      const icp = loadICP(icpProfileName);

      // ─── Step 1: Scrape comments ──────────────────────────────────────
      emitter.emit('progress', {
        step: 'scraping',
        message: 'Extracting commenters from post...',
      });

      const commenters = await scrapeComments(postUrl);

      emitter.emit('progress', {
        step: 'scraped',
        count: commenters.length,
        message: `Found ${commenters.length} commenters`,
      });

      // ─── Step 2: Pre-filter by exclude keywords + suppression list ────
      const excludeKeywords = (icp.titles?.exclude_keywords || []).map((k) => k.toLowerCase());

      // Check suppression list — skip leads already in pipeline / contacted / excluded
      const allProfileUrls = commenters.map((c) => c.profileUrl).filter(Boolean);
      const suppressedUrls = getSuppressedUrls(allProfileUrls);

      const { filtered, dropped, suppressed } = commenters.reduce(
        (acc, commenter) => {
          // Check suppression list first
          if (commenter.profileUrl && suppressedUrls.has(commenter.profileUrl)) {
            acc.suppressed.push(commenter);
            return acc;
          }
          const name = (commenter.name || '').toLowerCase();
          acc.filtered.push(commenter);
          return acc;
        },
        { filtered: [], dropped: [], suppressed: [] }
      );

      if (suppressed.length > 0) {
        console.log(`[ScanJob] Suppressed ${suppressed.length} leads from blacklist`);
      }

      emitter.emit('progress', {
        step: 'prefiltered',
        remaining: filtered.length,
        dropped: dropped.length,
        suppressed: suppressed.length,
        message: `Pre-filtered: ${filtered.length} remaining, ${dropped.length} dropped, ${suppressed.length} suppressed`,
      });

      // ─── Step 3: Enrich via Apollo (batches of 10) ────────────────────
      const enrichedLeads = [];
      const batchSize = 10;

      for (let i = 0; i < filtered.length; i++) {
        const commenter = filtered[i];

        emitter.emit('progress', {
          step: 'enriching',
          current: i + 1,
          total: filtered.length,
          message: `Enriching ${i + 1} / ${filtered.length} leads...`,
        });

        const enriched = await enrichPerson({
          fullName: commenter.name,
          linkedinUrl: commenter.profileUrl,
          companyDomain: null,
        });

        enrichedLeads.push({
          ...commenter,
          linkedinUrl: commenter.profileUrl,
          firstName: enriched?.firstName || commenter.name?.split(' ')[0] || null,
          lastName: enriched?.lastName || null,
          title: enriched?.title || null,
          email: enriched?.email || null,
          company: enriched?.company || null,
          companyDomain: enriched?.companyDomain || null,
          headcountRange: enriched?.headcountRange || null,
          estimatedRevenue: enriched?.estimatedRevenue || null,
          industry: enriched?.industry || null,
          fundingStage: enriched?.fundingStage || null,
        });

        // Pause between batches to respect Apollo rate limits
        if ((i + 1) % batchSize === 0 && i + 1 < filtered.length) {
          console.log(`[ScanJob] Batch pause after ${i + 1} enrichments`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      // ─── Step 4: Score ICP ────────────────────────────────────────────
      const scoredLeads = enrichedLeads.map((lead) => {
        const icpResult = scoreICP(lead, icp);
        return {
          ...lead,
          icpScore: icpResult.icpScore,
          dataConfidence: icpResult.dataConfidence,
          icpExcluded: icpResult.excluded,
        };
      });

      // Remove excluded leads (title contains exclude keywords)
      const nonExcludedLeads = scoredLeads.filter((l) => !l.icpExcluded);

      // ─── Step 5: Classify intent via Claude (single batch) ────────────
      emitter.emit('progress', {
        step: 'classifying',
        message: 'Analysing comment intent via AI...',
      });

      // Map comments with IDs for Claude
      const commentsForClassification = nonExcludedLeads.map((lead, index) => ({
        id: index,
        text: lead.commentText || '',
      }));

      let intentResults = [];
      try {
        intentResults = await classifyComments(commentsForClassification);
      } catch (err) {
        console.error('[ScanJob] Intent classification failed:', err.message);
        // Continue without intent scores — ICP score alone can still rank
        emitter.emit('progress', {
          step: 'classifying_error',
          message: `Intent classification failed: ${err.message}. Continuing with ICP scores only.`,
        });
      }

      // Merge intent results back into leads
      const intentMap = new Map(intentResults.map((r) => [r.id, r]));
      const leadsWithIntent = nonExcludedLeads.map((lead, index) => {
        const intent = intentMap.get(index);
        return {
          ...lead,
          intentTier: intent?.tier || 'T4',
          intentScore: intent?.score || 10,
          intentReasoning: intent?.reasoning || '',
          intentSignals: JSON.stringify(intent?.signals || []),
        };
      });

      // ─── Step 6: Rank ────────────────────────────────────────────────
      // Look up appearance counts for signal stacking bonus
      const leadUrls = leadsWithIntent.map((l) => l.linkedinUrl).filter(Boolean);
      const appearanceCounts = getAppearanceCounts(leadUrls);

      const leadsWithAppearances = leadsWithIntent.map((lead) => {
        const count = appearanceCounts.get(lead.linkedinUrl) || 1;
        return { ...lead, appearanceCount: count };
      });

      const rankedLeads = rankLeads(leadsWithAppearances);

      // ─── Step 7: Generate outreach drafts for leads scoring 40+ ───────
      const eligibleLeads = rankedLeads.filter((l) => l.totalScore >= 40);

      emitter.emit('progress', {
        step: 'drafting',
        current: 0,
        total: eligibleLeads.length,
        message: `Generating outreach drafts for ${eligibleLeads.length} qualified leads...`,
      });

      // Extract post topic from URL for context
      const postTopic = 'a relevant industry discussion'; // Could be enriched later
      const competitorName = extractCompetitorFromUrl(postUrl);

      for (let i = 0; i < eligibleLeads.length; i++) {
        const lead = eligibleLeads[i];

        emitter.emit('progress', {
          step: 'drafting',
          current: i + 1,
          total: eligibleLeads.length,
          message: `Drafting outreach ${i + 1} / ${eligibleLeads.length}...`,
        });

        try {
          const drafts = await generateDrafts(
            lead,
            { postTopic, competitorName },
            outreachMode === 'campaign' ? 'example-campaign' : null
          );
          lead.outreachDraftDirect = drafts.direct;
          lead.outreachDraftTopic = drafts.topic;
          lead.outreachDraftPain = drafts.pain;
          lead.outreachDraftCampaign = drafts.campaign;
        } catch (err) {
          console.error(`[ScanJob] Draft generation failed for ${lead.name}:`, err.message);
          // Continue without drafts for this lead
        }
      }

      // ─── Step 8: Save to SQLite ───────────────────────────────────────
      const enrichedCount = enrichedLeads.filter((l) => l.email).length;

      // Save scanned post record
      queries.insertScannedPost({
        postUrl,
        commenterCount: commenters.length,
        enrichedCount,
      });

      // Save all leads (and record appearances for signal stacking)
      for (const lead of rankedLeads) {
        // Record appearance for signal stacking
        if (lead.linkedinUrl) {
          recordAppearance({
            linkedinUrl: lead.linkedinUrl,
            postUrl,
            commentText: lead.commentText || null,
          });
        }

        queries.upsertLead({
          postUrl,
          linkedinUrl: lead.linkedinUrl,
          name: lead.name,
          firstName: lead.firstName,
          lastName: lead.lastName,
          title: lead.title,
          company: lead.company,
          companyDomain: lead.companyDomain,
          email: lead.email,
          headcountRange: lead.headcountRange,
          estimatedRevenue: lead.estimatedRevenue,
          industry: lead.industry,
          fundingStage: lead.fundingStage,
          commentText: lead.commentText,
          commentDate: lead.commentDate,
          intentTier: lead.intentTier,
          intentScore: lead.intentScore,
          intentReasoning: lead.intentReasoning,
          intentSignals: lead.intentSignals,
          icpScore: lead.icpScore,
          totalScore: lead.totalScore,
          dataConfidence: lead.dataConfidence,
          outreachDraftDirect: lead.outreachDraftDirect || null,
          outreachDraftTopic: lead.outreachDraftTopic || null,
          outreachDraftPain: lead.outreachDraftPain || null,
          outreachDraftCampaign: lead.outreachDraftCampaign || null,
          appearanceCount: lead.appearanceCount || 1,
        });
      }

      // ─── Complete ─────────────────────────────────────────────────────
      emitter.emit('progress', {
        step: 'complete',
        message: `Scan complete. ${rankedLeads.length} leads scored and saved.`,
        leads: rankedLeads.map((l) => ({
          name: l.name,
          title: l.title,
          company: l.company,
          totalScore: l.totalScore,
          intentTier: l.intentTier,
          dataConfidence: l.dataConfidence,
        })),
        stats: {
          totalCommenters: commenters.length,
          enriched: enrichedCount,
          scored: rankedLeads.length,
          draftsGenerated: eligibleLeads.length,
          above60: rankedLeads.filter((l) => l.totalScore >= 60).length,
          above80: rankedLeads.filter((l) => l.totalScore >= 80).length,
        },
      });

      return rankedLeads;
    } catch (err) {
      emitter.emit('progress', {
        step: 'error',
        message: err.message,
        code: err.code || 'UNKNOWN_ERROR',
      });
      throw err;
    }
  })();

  return { emitter, promise };
}

/**
 * Extract the poster's name/company from a LinkedIn post URL.
 * LinkedIn post URLs look like: linkedin.com/posts/[poster-slug]_[content-id]
 */
function extractCompetitorFromUrl(postUrl) {
  try {
    const url = new URL(postUrl);
    const match = url.pathname.match(/\/posts\/([^_]+)/);
    if (match) {
      return match[1].replace(/-/g, ' ');
    }
  } catch {
    // not a valid URL
  }
  return 'a company';
}

module.exports = { runScan };
