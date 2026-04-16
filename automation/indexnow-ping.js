/**
 * IndexNow ping — notifies Bing, Yandex, and the IndexNow collective
 * (DuckDuckGo, Naver, Seznam, etc.) that content has changed, so they
 * re-crawl within minutes instead of days.
 *
 * Reads URLs from sitemap.xml and POSTs them to api.indexnow.org.
 *
 * SAFETY:
 *  - No-ops if INDEXNOW_KEY is not set (so local builds don't ping).
 *  - Never throws — ping failures log a warning but don't fail the build.
 *
 * The key file at /<KEY>.txt must already be deployed to the root of
 * getclearly.app and contain only the same key. See README / llms docs.
 *
 * Spec: https://www.indexnow.org/documentation
 */

const fs = require('fs');
const path = require('path');

const SITEMAP_PATH = path.join(__dirname, '..', 'sitemap.xml');
const HOST = 'getclearly.app';
const KEY_LOCATION = 'https://getclearly.app'; // where the <KEY>.txt is served

function extractUrls(sitemapXml) {
  const matches = sitemapXml.match(/<loc>([^<]+)<\/loc>/g) || [];
  return matches.map(m => m.replace(/<\/?loc>/g, '').trim());
}

async function pingIndexNow(urls, key) {
  const body = {
    host: HOST,
    key,
    keyLocation: `${KEY_LOCATION}/${key}.txt`,
    urlList: urls,
  };

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });

  return { status: res.status, ok: res.ok };
}

async function run() {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    console.log('[indexnow] Skipped — INDEXNOW_KEY not set (this is expected locally).');
    return;
  }

  if (!fs.existsSync(SITEMAP_PATH)) {
    console.warn('[indexnow] Skipped — sitemap.xml not found.');
    return;
  }

  const sitemap = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const urls = extractUrls(sitemap);

  if (urls.length === 0) {
    console.warn('[indexnow] Skipped — no URLs in sitemap.');
    return;
  }

  console.log(`[indexnow] Pinging ${urls.length} URLs...`);

  try {
    const { status, ok } = await pingIndexNow(urls, key);
    if (ok || status === 202) {
      console.log(`[indexnow] OK (${status}) — crawlers notified.`);
    } else if (status === 422) {
      console.warn(`[indexnow] 422 — key/keyLocation mismatch. Check that /${key}.txt is deployed and accessible.`);
    } else if (status === 403) {
      console.warn('[indexnow] 403 — key not valid for this host.');
    } else {
      console.warn(`[indexnow] Unexpected status ${status}.`);
    }
  } catch (err) {
    console.warn('[indexnow] Ping failed (non-fatal):', err.message);
  }
}

// Run if invoked directly
if (require.main === module) {
  run();
}

module.exports = { run };
