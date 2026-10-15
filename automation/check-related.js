#!/usr/bin/env node
// Counts internal links to every blog article from the built HTML, the way a
// crawler sees them: how many other pages on the site link to each article
// (the article itself and the blog index are not counted; the index links to
// everything). Run after build-blog.js. Articles come from sitemap.xml.
//
//   node automation/check-related.js            report
//   node automation/check-related.js --strict   also exit 1 if any article has
//                                                fewer than 3 or more than 12
//
// Target: every article 3+ (Google treats barely-linked pages as low priority),
// none above about 12 (a few articles hogging the related lists).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIN = 3, MAX = 12;
const strict = process.argv.includes('--strict');

const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const slugs = [...sitemap.matchAll(/<loc>https:\/\/getclearly\.app\/blog\/([^<]+)<\/loc>/g)].map(m => m[1]);
if (!slugs.length) { console.error('No blog articles in sitemap.xml: run build-blog.js first.'); process.exit(1); }

// Every built page except the archive, keyed by the URL path it is served at
function pages(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || ['node_modules', '_archive', '_partials', 'automation'].includes(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) pages(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}
const urlOf = file => '/' + path.relative(ROOT, file).replace(/\\/g, '/').replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');

const inbound = new Map(slugs.map(s => [s, new Set()]));
let htmlLinks = 0;
for (const file of pages(ROOT)) {
  const from = urlOf(file);
  if (from === '/blog') continue;                          // the index links to every article
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/href="(?:https:\/\/getclearly\.app)?\/blog\/([a-z0-9-]+)(\.html)?[#?"]/g)) {
    if (m[2]) htmlLinks++;
    const slug = m[1];
    if (inbound.has(slug) && from !== '/blog/' + slug) inbound.get(slug).add(from);
  }
}

const counts = slugs.map(s => [s, inbound.get(s).size]).sort((a, b) => a[1] - b[1]);
const hist = {};
counts.forEach(([, n]) => { hist[n] = (hist[n] || 0) + 1; });
const low = counts.filter(([, n]) => n < MIN), high = counts.filter(([, n]) => n > MAX);

console.log(`${slugs.length} articles. Pages linking to each (excluding itself and the blog index):`);
console.log('  ' + Object.entries(hist).map(([n, c]) => `${n} links: ${c}`).join(' · '));
if (low.length) console.log(`  Under ${MIN}: ${low.map(([s, n]) => `${s} (${n})`).join(', ')}`);
if (high.length) console.log(`  Over ${MAX}: ${high.map(([s, n]) => `${s} (${n})`).join(', ')}`);
if (htmlLinks) console.log(`  ! ${htmlLinks} internal links still point at .html addresses`);
if (!low.length && !high.length && !htmlLinks) console.log(`  OK: every article has ${MIN}-${MAX}.`);

if (strict && (low.length || high.length || htmlLinks)) process.exit(1);
