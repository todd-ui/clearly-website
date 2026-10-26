#!/usr/bin/env node
// Builds the support center at /support/ from the Markdown articles in
// _support/. Run it after changing an article: `node build-support.js`.
//
//   _support/categories.json      the categories, in the order shown
//   _support/<category>/<slug>.md one article each, with a small front matter
//
// Writes support/index.html, support/<category>/index.html,
// support/<category>/<slug>/index.html, support/search.json (the search box
// reads it) and support/pages.json (build-blog.js adds these URLs to the
// sitemap). The site header and footer come from _partials, like every page.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, '_support');
const OUT = path.join(ROOT, 'support');
const ORIGIN = 'https://getclearly.app';
const CSS_V = '20261025';

const header = fs.readFileSync(path.join(ROOT, '_partials/header.html'), 'utf-8').trim();
const footer = fs.readFileSync(path.join(ROOT, '_partials/footer.html'), 'utf-8').trim();

const APPS = {
  iphone: 'iPhone app',
  web: 'Web app',
  pro: 'Professional portal',
};

// ------------------------------------------------------------ reading
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseFront(text, file) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = {};
  m[1].split('\n').forEach((line) => {
    const i = line.indexOf(':');
    if (i < 0) return;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    meta[k] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean) : v;
  });
  for (const k of ['title', 'summary']) if (!meta[k]) throw new Error(`${file}: front matter needs ${k}`);
  return { meta, body: m[2] };
}

// Inline Markdown: **bold**, `label`, [text](url)
function inline(s) {
  let out = esc(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/`([^`]+)`/g, '<span class="ui">$1</span>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, t, href) => {
    const ext = /^https?:/.test(href) && !href.startsWith(ORIGIN);
    return `<a href="${href}"${ext ? ' rel="noopener"' : ''}>${t}</a>`;
  });
  return out;
}

// Block Markdown: ## and ### headings, paragraphs, - and 1. lists,
// and "> " callouts (a first word of Note:, Tip: or Important: sets the style).
function markdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const html = [], toc = [];
  let para = [], list = null, quote = [];
  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${list.tag}>`); list = null; } };
  const flushQuote = () => {
    if (!quote.length) return;
    const text = quote.join(' ');
    const kind = (text.match(/^(Note|Tip|Important):/) || [])[1];
    const cls = kind === 'Important' ? 'important' : kind === 'Tip' ? 'tip' : 'note';
    html.push(`<div class="callout ${cls}">${inline(text)}</div>`);
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushAll(); continue; }
    if ((m = line.match(/^(#{2,3}) (.+)$/))) {
      flushAll();
      const level = m[1].length, text = m[2];
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (level === 2) toc.push({ id, text });
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }
    if ((m = line.match(/^> ?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = line.match(/^(\d+)\. (.+)$/)) || (m = line.match(/^(-) (.+)$/))) {
      flushPara(); flushQuote();
      const tag = m[1] === '-' ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList(); flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return { html: html.join('\n'), toc };
}

function plainText(src) {
  return src.replace(/^#+ /gm, '').replace(/^> ?/gm, '').replace(/^(\d+\.|-) /gm, '')
    .replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
}

const categories = JSON.parse(fs.readFileSync(path.join(SRC, 'categories.json'), 'utf-8'));
const articles = [];
for (const cat of categories) {
  const dir = path.join(SRC, cat.slug);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const file = path.join(dir, f);
    const { meta, body } = parseFront(fs.readFileSync(file, 'utf-8'), path.relative(ROOT, file));
    const slug = f.replace(/\.md$/, '');
    const apps = (meta.apps || []).filter((a) => APPS[a]);
    articles.push({
      slug, cat: cat.slug, title: meta.title, summary: meta.summary, apps,
      order: Number(meta.order || 50), popular: meta.popular === 'yes',
      keywords: meta.keywords || [], related: meta.related || [],
      url: `/support/${cat.slug}/${slug}/`, ...markdown(body), text: plainText(body),
    });
  }
}
const bySlug = {};
for (const a of articles) {
  if (bySlug[a.slug]) throw new Error(`Two articles named ${a.slug}`);
  bySlug[a.slug] = a;
}
for (const a of articles) for (const r of a.related) if (!bySlug[r]) throw new Error(`${a.slug}: related article ${r} does not exist`);
const catOf = Object.fromEntries(categories.map((c) => [c.slug, c]));
const inCat = (slug) => articles.filter((a) => a.cat === slug).sort((x, y) => x.order - y.order || x.title.localeCompare(y.title));

// Links between articles are written as (/support/<slug>) in Markdown; turn
// them into full article URLs and fail on a link to an article that doesn't exist.
for (const a of articles) {
  a.html = a.html.replace(/href="\/support\/([a-z0-9-]+)\/?(#[a-z0-9-]+)?"/g, (all, s, hash) => {
    if (catOf[s]) return `href="/support/${s}/"`;
    if (!bySlug[s]) throw new Error(`${a.slug}: links to /support/${s}, which does not exist`);
    return `href="${bySlug[s].url}${hash || ''}"`;
  });
}

// ------------------------------------------------------------ page shell
function page({ url, title, description, body, crumbs, extraHead = '' }) {
  const canonical = ORIGIN + url;
  const crumbLd = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: ORIGIN + c.url })),
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-DYZ1XEXPMT"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-DYZ1XEXPMT', (function () { try { var q = location.search; if (/[?&]internal=1/.test(q)) localStorage.setItem('clearly_internal', '1'); if (/[?&]internal=0/.test(q)) localStorage.removeItem('clearly_internal'); return (localStorage.getItem('clearly_internal') || location.hostname.indexOf('getclearly.app') === -1) ? { traffic_type: 'internal' } : {}; } catch (e) { return {}; } })());
  </script>
  <script src="/js/first-visit.js" defer></script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <meta name="theme-color" content="#0D8268">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${canonical}">
  <meta name="robots" content="index, follow">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="https://getclearly.app/images/og-default.png">
  <meta property="og:site_name" content="Clearly">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/styles.css?v=20261010">
  <link rel="stylesheet" href="/styles/brand.css?v=20261010">
  <link rel="stylesheet" href="/styles/support.css?v=${CSS_V}">
  <link rel="icon" href="/images/favicon-32.png">
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/images/app-icon.png">
  <script type="application/ld+json">${JSON.stringify(crumbLd)}</script>${extraHead}
</head>
<body class="support">
${header}
<main id="main-content">
${body}
</main>
${footer}
<script src="/js/support.js?v=${CSS_V}" defer></script>
</body>
</html>
`;
}

function searchBox(big) {
  return `<form class="sp-search${big ? ' big' : ''}" action="/support/search/" role="search">
  <label class="sr-only" for="sp-q${big ? '' : '2'}">Search help articles</label>
  <input id="sp-q${big ? '' : '2'}" name="q" type="search" placeholder="Search help articles" autocomplete="off" data-sp-search>
  <button type="submit">Search</button>
  <div class="sp-results" hidden></div>
</form>`;
}

function appChips(apps) {
  if (!apps.length) return '';
  return `<div class="sp-apps">${apps.map((a) => `<span class="sp-chip ${a}">${APPS[a]}</span>`).join('')}</div>`;
}

function crumbsHtml(crumbs) {
  return `<nav class="sp-crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => i === crumbs.length - 1 ? `<span>${esc(c.name)}</span>` : `<a href="${c.url}">${esc(c.name)}</a>`).join('<span class="sep">/</span>')}</nav>`;
}

const contactBlock = `<section class="sp-contact">
  <h2>Still need help?</h2>
  <p>Email <a href="mailto:hello@getclearly.app">hello@getclearly.app</a> and a person will reply, usually within one business day. Tell us which app you use (iPhone, web or the professional portal) and what you were trying to do. Please don't include your password.</p>
</section>`;

function write(rel, html) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

// ------------------------------------------------------------ pages
fs.rmSync(OUT, { recursive: true, force: true });
const pages = [];
const home = { name: 'Support', url: '/support/' };

// Home
{
  const groups = categories.map((c) => {
    const list = inCat(c.slug);
    if (!list.length) return '';
    return `<a class="sp-cat" href="/support/${c.slug}/"><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p><span class="n">${list.length} article${list.length === 1 ? '' : 's'}</span></a>`;
  }).join('\n');
  const popular = articles.filter((a) => a.popular).sort((x, y) => x.order - y.order);
  const doors = [
    ['iphone-app', 'I use the iPhone app', 'Installing, the demo, the plans screen, notifications and settings on iPhone.'],
    ['web-app', 'I use Clearly in a browser', 'Signing in at web.getclearly.app on a computer, Android phone or tablet.'],
    ['for-professionals', 'I\'m a professional', 'The free portal for family lawyers, mediators, therapists and parenting coordinators.'],
  ].map(([s, t, d]) => `<a class="sp-door" href="/support/${s}/"><h2>${esc(t)}</h2><p>${esc(d)}</p></a>`).join('\n');
  const body = `<section class="sp-hero">
  <div class="sp-wrap">
    <p class="sp-eyebrow">Clearly support</p>
    <h1>How can we help?</h1>
    <p class="sp-lede">Step-by-step help for Clearly on iPhone, on the web, and in the professional portal.</p>
    ${searchBox(true)}
  </div>
</section>
<section class="sp-wrap sp-doors">${doors}</section>
<section class="sp-wrap">
  <h2 class="sp-h">Popular articles</h2>
  <ul class="sp-list two">${popular.map((a) => `<li><a href="${a.url}">${esc(a.title)}</a><span>${esc(a.summary)}</span></li>`).join('')}</ul>
</section>
<section class="sp-wrap">
  <h2 class="sp-h">Browse by topic</h2>
  <div class="sp-cats">${groups}</div>
</section>
<div class="sp-wrap">${contactBlock}</div>`;
  write('index.html', page({ url: '/support/', title: 'Clearly Support: Help for the Co-Parenting App on Web and iPhone', description: 'Help articles for Clearly, the co-parenting app for the web and iPhone: getting started, messages, the custody schedule, expenses, records, billing, and the free professional portal.', crumbs: [home], body }));
  pages.push(['/support/', 'support/index.html']);
}

// Search results page (the box filters as you type; this page handles Enter and no-JS)
{
  const body = `<section class="sp-wrap sp-page">
  ${crumbsHtml([home, { name: 'Search', url: '/support/search/' }])}
  <h1>Search help articles</h1>
  ${searchBox(false)}
  <div id="sp-search-page" class="sp-search-page"></div>
  <noscript><p>Search needs JavaScript. <a href="/support/">Browse all topics</a> instead.</p></noscript>
</section>
<div class="sp-wrap">${contactBlock}</div>`;
  const html = page({ url: '/support/search/', title: 'Search Clearly Support', description: 'Search the Clearly help articles.', crumbs: [home, { name: 'Search', url: '/support/search/' }], body })
    .replace('<meta name="robots" content="index, follow">', '<meta name="robots" content="noindex, follow">');
  write('search/index.html', html);
}

// Categories
for (const c of categories) {
  const list = inCat(c.slug);
  if (!list.length) continue;
  const crumbs = [home, { name: c.title, url: `/support/${c.slug}/` }];
  const body = `<section class="sp-wrap sp-page">
  ${crumbsHtml(crumbs)}
  <h1>${esc(c.title)}</h1>
  <p class="sp-lede">${esc(c.description)}</p>
  ${searchBox(false)}
  <ul class="sp-list">${list.map((a) => `<li><a href="${a.url}">${esc(a.title)}</a><span>${esc(a.summary)}</span>${appChips(a.apps)}</li>`).join('')}</ul>
  <p class="sp-back"><a href="/support/">All topics</a></p>
</section>
<div class="sp-wrap">${contactBlock}</div>`;
  write(`${c.slug}/index.html`, page({ url: `/support/${c.slug}/`, title: `${c.title} | Clearly Support`, description: c.meta || c.description, crumbs, body }));
  pages.push([`/support/${c.slug}/`, `support/${c.slug}/index.html`]);
}

// Articles
for (const a of articles) {
  const c = catOf[a.cat];
  const crumbs = [home, { name: c.title, url: `/support/${c.slug}/` }, { name: a.title, url: a.url }];
  const siblings = inCat(c.slug).filter((x) => x.slug !== a.slug);
  const related = a.related.length ? a.related.map((s) => bySlug[s]) : siblings.slice(0, 5);
  const toc = a.toc.length >= 3 ? `<nav class="sp-toc" aria-label="On this page"><p>On this page</p><ul>${a.toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ul></nav>` : '';
  const body = `<div class="sp-wrap sp-article-wrap">
  <article class="sp-article">
    ${crumbsHtml(crumbs)}
    <h1>${esc(a.title)}</h1>
    <p class="sp-lede">${esc(a.summary)}</p>
    ${appChips(a.apps)}
    ${toc}
    <div class="sp-body">
${a.html}
    </div>
    <div class="sp-helpful" data-sp-helpful="${a.slug}">
      <span>Did this answer your question?</span>
      <button type="button" data-v="yes">Yes</button><button type="button" data-v="no">No</button>
      <span class="thanks" hidden>Thanks. If something is missing, email <a href="mailto:hello@getclearly.app?subject=${encodeURIComponent('Help article: ' + a.title)}">hello@getclearly.app</a>.</span>
    </div>
  </article>
  <aside class="sp-side">
    ${searchBox(false)}
    ${related.length ? `<h2>Related articles</h2><ul>${related.map((r) => `<li><a href="${r.url}">${esc(r.title)}</a></li>`).join('')}</ul>` : ''}
    <h2>In ${esc(c.title)}</h2>
    <ul>${inCat(c.slug).map((x) => x.slug === a.slug ? `<li class="here">${esc(x.title)}</li>` : `<li><a href="${x.url}">${esc(x.title)}</a></li>`).join('')}</ul>
  </aside>
</div>
<div class="sp-wrap">${contactBlock}</div>`;
  write(`${c.slug}/${a.slug}/index.html`, page({ url: a.url, title: `${a.title} | Clearly Support`, description: a.summary, crumbs, body }));
  pages.push([a.url, `support/${c.slug}/${a.slug}/index.html`]);
}

// Search index and the sitemap list
write('search.json', JSON.stringify(articles.map((a) => ({
  t: a.title, s: a.summary, u: a.url, c: catOf[a.cat].title, k: a.keywords.join(' '), x: a.text.slice(0, 4000),
}))));
write('pages.json', JSON.stringify(pages, null, 1));

console.log(`Support center: ${articles.length} articles in ${categories.filter((c) => inCat(c.slug).length).length} topics -> support/`);
