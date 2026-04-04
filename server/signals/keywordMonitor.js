const signalDetectionQueries = require('../db/signalDetectionQueries');

/**
 * Keyword Monitor (A7)
 *
 * Monitors Google News for user-defined keywords relevant to the business.
 * When articles matching keywords are found, creates signals that can be
 * cross-referenced with leads' companies.
 */
async function detect() {
  const signals = [];

  const monitors = signalDetectionQueries.getActiveKeywordMonitors();
  if (monitors.length === 0) {
    console.log('[KeywordMonitor] No active keyword monitors');
    return signals;
  }

  console.log(`[KeywordMonitor] Checking ${monitors.length} keyword monitors`);

  for (const monitor of monitors) {
    try {
      const query = encodeURIComponent(monitor.keyword);
      const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

      const res = await fetch(rssUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) continue;

      const xml = await res.text();
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

      for (const item of items.slice(0, 5)) {
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);

        if (!titleMatch) continue;

        const title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
        const pubDate = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();
        const daysSincePublished = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24);

        // Only consider articles from last 3 days
        if (daysSincePublished > 3) continue;

        const signalData = {
          keyword: monitor.keyword,
          headline: title,
          publishedAt: pubDate.toISOString(),
          link: linkMatch ? linkMatch[1] : null,
          source: 'google_news',
        };

        signalDetectionQueries.insertSignal({
          type: 'keyword_match',
          data: signalData,
        });

        signals.push(signalData);
      }

      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(`[KeywordMonitor] Error for keyword "${monitor.keyword}":`, err.message);
      }
    }
  }

  console.log(`[KeywordMonitor] Found ${signals.length} keyword matches`);
  return signals;
}

module.exports = { detect };
