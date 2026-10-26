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
const CSS_V = '20261026';

const header = fs.readFileSync(path.join(ROOT, '_partials/header.html'), 'utf-8').trim();
const footer = fs.readFileSync(path.join(ROOT, '_partials/footer.html'), 'utf-8').trim();

// The home page's sections, in order; each category names its group in categories.json
const GROUPS = [
  { id: 'start', title: 'Get started', lede: 'New to Clearly, or setting up on a new device.' },
  { id: 'use', title: 'Using Clearly', lede: 'Messages, the calendar, expenses, your plan and your record.' },
  { id: 'account', title: 'Account and billing', lede: 'Your subscription, signing in, privacy, and fixes when something isn’t working.' },
  { id: 'pro', title: 'Lawyers, mediators and therapists', lede: 'Sharing your record with a professional, and the free professional portal.' },
];

// Shortcuts under the search box: what people most often come here for
const QUICK = [['invite-your-co-parent', 'Invite your co-parent'], ['cancel-your-subscription', 'Cancel'], ['export-your-record', 'Export records'],
  ['forgot-password', 'Reset password'], ['subscribe-to-your-calendar', 'Google or Apple Calendar'], ['use-clearly-on-android', 'Android']];

// Topic icons (24px line icons, drawn inline so the page needs no extra requests)
const ICONS = {
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  share: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.7 10.7l6.6-3.4M8.7 13.3l6.6 3.4"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
};
const icon = (name) => `<svg class="sp-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`;

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

// subject: what the email starts with, so we know where the question came from
const contactBlock = (subject = 'Help with Clearly') => `<section class="sp-contact">
  <div>
    <h2>Still need help?</h2>
    <p>A person reads every email and replies, usually within one business day. Say which app you use (iPhone, web or the professional portal) and what you were trying to do. Please don't send your password.</p>
  </div>
  <a class="sp-contact-btn" href="mailto:hello@getclearly.app?subject=${encodeURIComponent(subject)}">Email hello@getclearly.app</a>
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

// Home: search with shortcuts, the most asked questions, then every topic in
// four sections, each card listing its first articles so most answers are one click away
{
  for (const [q] of QUICK) if (!bySlug[q]) throw new Error(`QUICK links to ${q}, which does not exist`);
  const quick = QUICK.map(([q, label]) => `<a href="${bySlug[q].url}" title="${esc(bySlug[q].title)}">${esc(label)}</a>`).join('');
  const most = articles.filter((a) => a.popular).sort((x, y) => x.order - y.order).slice(0, 6);
  const card = (c) => {
    const list = inCat(c.slug);
    const shown = list.slice(0, 3);
    return `<div class="sp-cat">
      <a class="sp-cat-head" href="/support/${c.slug}/">${icon(c.icon)}<h3>${esc(c.title)}</h3></a>
      <p>${esc(c.description)}</p>
      <ul>${shown.map((a) => `<li><a href="${a.url}">${esc(a.title)}</a></li>`).join('')}</ul>
      ${list.length > shown.length ? `<a class="sp-all" href="/support/${c.slug}/">All ${list.length} articles</a>` : ''}
    </div>`;
  };
  const groups = GROUPS.map((g) => {
    const cats = categories.filter((c) => c.group === g.id && inCat(c.slug).length);
    if (!cats.length) return '';
    return `<section class="sp-wrap sp-group" id="${g.id}">
  <div class="sp-group-head"><h2 class="sp-h">${esc(g.title)}</h2><p>${esc(g.lede)}</p></div>
  <div class="sp-cats">${cats.map(card).join('\n')}</div>
</section>`;
  }).join('\n');
  const left = categories.filter((c) => !GROUPS.some((g) => g.id === c.group) && inCat(c.slug).length);
  if (left.length) throw new Error(`categories.json: ${left.map((c) => c.slug).join(', ')} need a group (${GROUPS.map((g) => g.id).join(', ')})`);
  const body = `<section class="sp-hero">
  <div class="sp-wrap">
    <p class="sp-eyebrow">Clearly support</p>
    <h1>How can we help?</h1>
    <p class="sp-lede">Step-by-step help for Clearly on iPhone, on the web, and in the professional portal.</p>
    ${searchBox(true)}
    <div class="sp-quick"><span>Popular:</span>${quick}</div>
  </div>
</section>
<nav class="sp-wrap sp-jump" aria-label="Help topics">${GROUPS.map((g) => `<a href="#${g.id}">${esc(g.title)}</a>`).join('')}</nav>
<section class="sp-wrap sp-most">
  <h2 class="sp-h">Most asked</h2>
  <ul class="sp-list two">${most.map((a) => `<li><a href="${a.url}">${esc(a.title)}</a><span>${esc(a.summary)}</span></li>`).join('')}</ul>
</section>
${groups}
<div class="sp-wrap">${contactBlock()}</div>`;
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
<div class="sp-wrap">${contactBlock('Help with Clearly: I couldn’t find an answer')}</div>`;
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
  <h1 class="sp-cat-title">${icon(c.icon)}${esc(c.title)}</h1>
  <p class="sp-lede">${esc(c.description)}</p>
  ${searchBox(false)}
  <ul class="sp-list">${list.map((a) => `<li><a href="${a.url}">${esc(a.title)}</a><span>${esc(a.summary)}</span>${appChips(a.apps)}</li>`).join('')}</ul>
  <p class="sp-back"><a href="/support/">All topics</a></p>
</section>
<div class="sp-wrap">${contactBlock(`Help with Clearly: ${c.title}`)}</div>`;
  write(`${c.slug}/index.html`, page({ url: `/support/${c.slug}/`, title: `${c.title} | Clearly Support`, description: c.meta || c.description, crumbs, body }));
  pages.push([`/support/${c.slug}/`, `support/${c.slug}/index.html`]);
}

// Articles
for (const a of articles) {
  const c = catOf[a.cat];
  const crumbs = [home, { name: c.title, url: `/support/${c.slug}/` }, { name: a.title, url: a.url }];
  const order = inCat(c.slug), at = order.findIndex((x) => x.slug === a.slug);
  const siblings = order.filter((x) => x.slug !== a.slug);
  // Previous and next in the topic, so a topic reads like a short guide
  const prev = order[at - 1], next = order[at + 1];
  const pager = prev || next ? `<nav class="sp-pager" aria-label="More in ${esc(c.title)}">${prev ? `<a class="prev" href="${prev.url}"><span>Previous</span>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${next.url}"><span>Next</span>${esc(next.title)}</a>` : ''}</nav>` : '';
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
    ${pager}
  </article>
  <aside class="sp-side">
    ${searchBox(false)}
    ${related.length ? `<h2>Related articles</h2><ul>${related.map((r) => `<li><a href="${r.url}">${esc(r.title)}</a></li>`).join('')}</ul>` : ''}
    <h2>In ${esc(c.title)}</h2>
    <ul>${inCat(c.slug).map((x) => x.slug === a.slug ? `<li class="here">${esc(x.title)}</li>` : `<li><a href="${x.url}">${esc(x.title)}</a></li>`).join('')}</ul>
  </aside>
</div>
<div class="sp-wrap">${contactBlock(`Help article: ${a.title}`)}</div>`;
  write(`${c.slug}/${a.slug}/index.html`, page({ url: a.url, title: `${a.title} | Clearly Support`, description: a.summary, crumbs, body }));
  pages.push([a.url, `support/${c.slug}/${a.slug}/index.html`]);
}

// Search index and the sitemap list
write('search.json', JSON.stringify(articles.map((a) => ({
  t: a.title, s: a.summary, u: a.url, c: catOf[a.cat].title, k: a.keywords.join(' '), x: a.text.slice(0, 4000),
}))));
write('pages.json', JSON.stringify(pages, null, 1));

console.log(`Support center: ${articles.length} articles in ${categories.filter((c) => inCat(c.slug).length).length} topics -> support/`);
