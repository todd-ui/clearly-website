#!/usr/bin/env node
// Build-time guard against llms.txt / sitemap drift.
// 1. Every getclearly.app URL in llms.txt must resolve to a built file (no 404s).
// 2. Every getclearly.app page URL in llms.txt must be listed in sitemap.xml.
// Exits non-zero on any violation so the Netlify build fails loudly.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://getclearly.app';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

// Map a site path (e.g. "/plan-builder/" or "/faq.html") to a local file.
function pathToFile(urlPath) {
  let p = urlPath.replace(/[#?].*$/, '');
  if (p === '/' || p === '') return 'index.html';
  p = p.replace(/^\//, '');
  if (p.endsWith('/')) return p + 'index.html';
  return p;
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
    errors.push(`llms.txt references ${url} but ${file} does not exist (would 404)`);
    continue;
  }

  // Page URLs (not asset files like feed.xml) should be in the sitemap.
  const isPage = urlPath === '/' || urlPath.endsWith('/') || urlPath.endsWith('.html');
  if (isPage && !sitemapUrls.has(url)) {
    errors.push(`llms.txt references ${url} but it is missing from sitemap.xml`);
  }
}

if (errors.length) {
  console.error('\nLink check FAILED:');
  for (const e of errors) console.error('  - ' + e);
  console.error(`\n${errors.length} problem(s). Fix llms.txt or the sitemap generator in build-blog.js.\n`);
  process.exit(1);
}

console.log(`Link check passed: ${llmsUrls.length} llms.txt URLs resolve and all pages are in the sitemap.`);
