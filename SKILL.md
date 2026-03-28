---
name: LinkedIn Lead Scanner
description: Scrape LinkedIn post commenters, enrich via Apollo, score by intent + ICP, draft outreach, push to HubSpot
---

# LinkedIn Lead Scanner Skill

## Purpose

Scrape commenters from a LinkedIn post URL, enrich them against an ICP definition,
score by comment intent (Claude AI) + profile fit (ICP yaml), draft personalised outreach
messages, and push qualified leads to HubSpot CRM.

## Trigger Phrases

- "scan this LinkedIn post: [URL]"
- "find leads from [URL]"
- "run lead scanner on [URL]"
- "who commented on [URL]"
- "scrape comments from [URL]"
- "enrich leads from [URL]"

## Pipeline Steps

The full scan pipeline runs in this order via `server/jobs/scanJob.js`:

1. **Parse & Validate URL** — confirm it's a valid `linkedin.com/posts/` URL
2. **Check Cache** — query SQLite (`scanned_posts` table) for previous scans of this URL
3. **Scrape Comments** — Playwright with stealth plugin extracts all commenters
   - Output: `[{ name, profileUrl, commentText, commentDate }]`
4. **Pre-filter** — apply `titles.exclude_keywords` from `config/icp.yaml` to drop non-fits
5. **Enrich via Apollo** — call Apollo People Match API for each remaining person
   - Batches of 10, 2s pause between batches
   - Cache results in SQLite to avoid duplicate API calls
6. **Score ICP** — run `server/scoring/icpScorer.js` against `config/icp.yaml`
   - Title match: 0–25 pts
   - Company fit: 0–20 pts
   - Profile completeness: 0–10 pts
7. **Classify Intent** — batch all comments into single Claude API call
   - Uses prompt from `prompts/intent-classification.md`
   - Returns tier (T1–T5) and score (0–45) per comment
8. **Rank** — combine ICP score + intent score → total (0–100), sort descending
9. **Generate Drafts** — for leads scoring 40+, call Claude with outreach prompt
   - Uses prompt from `prompts/outreach-drafts.md`
   - Generates 4 modes: direct, topic, pain, campaign
10. **Save** — write all leads to SQLite via `queries.upsertLead()`
11. **Return** — emit completion event with ranked lead array

## Config Files to Read Before Running

- `config/icp.yaml` — ICP definition, scoring weights, and filtering criteria
- `prompts/intent-classification.md` — Claude prompt for comment intent classification
- `prompts/outreach-drafts.md` — Claude prompt for outreach draft generation

## Output Contract

The pipeline returns a JSON object:

```json
{
  "postUrl": "string — the scanned LinkedIn post URL",
  "scannedAt": "string — ISO 8601 timestamp",
  "totalCommenters": "number — total comments scraped",
  "enriched": "number — successfully enriched via Apollo",
  "leads": [
    {
      "name": "string",
      "firstName": "string",
      "lastName": "string",
      "title": "string",
      "company": "string",
      "email": "string | null",
      "linkedinUrl": "string",
      "totalScore": "number (0–100)",
      "intentTier": "string (T1–T5)",
      "intentScore": "number (0–45)",
      "icpScore": "number (0–55)",
      "commentText": "string",
      "commentDate": "string",
      "outreachDraftDirect": "string | null",
      "outreachDraftTopic": "string | null",
      "outreachDraftPain": "string | null",
      "outreachDraftCampaign": "string | null",
      "dataConfidence": "string (full | partial | low)",
      "hubspotContactId": "string | null"
    }
  ]
}
```

## Error Handling

| Error Code | Meaning | What To Tell User |
|---|---|---|
| `LINKEDIN_LOGIN_REQUIRED` | Scraper hit a login wall | Log into LinkedIn via the browser profile at `./browser-profile/` and retry |
| `LINKEDIN_SELECTOR_FAILED` | LinkedIn changed its DOM structure | LinkedIn may have updated their page. Check for scraper updates. |
| `LINKEDIN_RATE_LIMITED` | Too many requests, challenge page shown | Wait 1–2 hours before running another scan |
| `APOLLO_RATE_LIMITED` | Apollo returned 429 after 3 retries | Apollo rate limit hit. Wait 30 minutes and retry. |
| `APOLLO_NO_MATCH` | Apollo found no match (not an error) | Person not found in Apollo's database — partial data only |
| `CLAUDE_API_ERROR` | Claude API call failed | Check your Anthropic API key and account status |
| `HUBSPOT_DUPLICATE` | Contact already exists in HubSpot | Handled automatically — existing contact is updated |
| `HUBSPOT_AUTH_FAILED` | 401 from HubSpot | Check your HubSpot access token |
| `INVALID_POST_URL` | URL doesn't match LinkedIn post format | Provide a valid linkedin.com/posts/ URL |

## Example Invocations

```
User: "scan this LinkedIn post: https://www.linkedin.com/posts/example_post-id-123"
User: "find leads from https://linkedin.com/posts/competitor_new-feature-announcement-456"
User: "run lead scanner on https://www.linkedin.com/posts/founder_ai-launch-789"
```
