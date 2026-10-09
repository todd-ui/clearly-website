#!/usr/bin/env node
// Build-time guard against llms.txt / sitemap drift and duplicate URLs.
// 1. Every getclearly.app URL in llms.txt must resolve to a built file (no 404s).
// 2. Every getclearly.app page URL in llms.txt must be listed in sitemap.xml.
// 3. One URL per page: no ".html" URL in the sitemap, feed or llms files, and
//    every sitemap page has a canonical equal to its sitemap URL and no
//    internal links to ".html" URLs (those 301 via netlify/edge-functions).
// Exits non-zero on any violation so the Netlify build fails loudly.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://getclearly.app';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

// Map a site path (e.g. "/plan-builder/", "/faq" or "/blog/some-post") to the
// local file Netlify serves for it.
function pathToFile(urlPath) {
  let p = urlPath.replace(/[#?].*$/, '');
  if (p === '/' || p === '') return 'index.html';
  p = p.replace(/^\//, '');
  if (p.endsWith('/')) return p + 'index.html';
  if (/\.[a-z0-9]+$/i.test(p)) return p; // feed.xml, llms.txt, ...
  return p + '.html';
}

const llms = read('llms.txt');
const sitemap = read('sitemap.xml');

// Absolute getclearly.app URLs referenced in llms.txt.
const llmsUrls = [...new Set(
  (llms.match(/https:\/\/getclearly\.app[^\s)\],>"']*/g) || [])
    .map(u => u.replace(/[.,;]+$/, ''))
)];

// URLs listed in the sitemap.
const sitemapUrls = new Set(
  (sitemap.match(/<loc>([^<]+)<\/loc>/g) || [])
    .map(m => m.replace(/<\/?loc>/g, '').trim())
);

const errors = [];

for (const url of llmsUrls) {
  const urlPath = url.slice(ORIGIN.length) || '/';
  const file = pathToFile(urlPath);

  if (!fs.existsSync(path.join(ROOT, file))) {
    // Blog posts are generated from Notion at deploy time; a local checkout
    // without NOTION_API_KEY only has an older copy of blog/.
    if (!process.env.NETLIFY && file.startsWith('blog/')) {
      console.warn(`  (local) ${file} not built here; it is checked on Netlify`);
      continue;
    }
    errors.push(`llms.txt references ${url} but ${file} does not exist (would 404)`);
    continue;
  }

  // Page URLs (not asset files like feed.xml) should be in the sitemap.
  const isPage = !/\.[a-z0-9]+$/i.test(urlPath.replace(/[#?].*$/, ''));
  if (isPage && !sitemapUrls.has(url)) {
    errors.push(`llms.txt references ${url} but it is missing from sitemap.xml`);
  }
}

// ---- 3: one URL per page ----------------------------------------------------
const HTML_URL = /https:\/\/(?:www\.)?getclearly\.app\/[^\s"'<>)]*\.html\b/g;
for (const f of ['sitemap.xml', 'feed.xml', 'llms.txt', 'llms-full.txt']) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  for (const u of new Set(read(f).match(HTML_URL) || [])) {
    errors.push(`${f} lists ${u} — use the clean URL without ".html"`);
  }
}
for (const url of sitemapUrls) {
  const file = pathToFile(url.slice(ORIGIN.length) || '/');
  if (!fs.existsSync(path.join(ROOT, file))) {
    errors.push(`sitemap.xml lists ${url} but ${file} does not exist (would 404)`);
    continue;
  }
  const html = read(file);
  const canon = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1];
  if (canon !== url) errors.push(`${file}: canonical is "${canon}" but its sitemap URL is ${url}`);
  const bad = new Set(
    [...html.matchAll(/href=["']((?:https:\/\/(?:www\.)?getclearly\.app)?\/[^"'#?]*\.html)[#?"']/g)]
      .map(m => m[1])
      .filter(h => !/\/(404|join\/index)\.html$/.test(h))
  );
  for (const h of bad) errors.push(`${file}: links to ${h} — use the clean URL without ".html"`);
}

if (errors.length) {
  console.error('\nLink check FAILED:');
  for (const e of errors) console.error('  - ' + e);
  console.error(`\n${errors.length} problem(s). Fix llms.txt or the sitemap generator in build-blog.js.\n`);
  process.exit(1);
}

console.log(`Link check passed: ${llmsUrls.length} llms.txt URLs resolve, all pages are in the sitemap, and ${sitemapUrls.size} sitemap pages use one clean URL each.`);
