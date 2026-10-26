// House style, whatever the Notion post says (automation/no-em-dash.js):
// no em dashes, and no claim that records are admissible in court
const { withoutEmDashes: noDashes, withoutLegalClaims } = require('./automation/no-em-dash');
const withoutEmDashes = (html) => withoutLegalClaims(noDashes(html));
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = '2df435a853a58014b9e9dc6ac1cbba09';

const SITE = 'https://getclearly.app';
const APP_STORE_URL = 'https://apps.apple.com/us/app/clearly-co-parenting-resolved/id6758027374';

// One URL per post: /blog/<slug>, no ".html". Netlify serves blog/<slug>.html
// at that path, and netlify/edge-functions/clean-urls.js 301s any .html
// request back to it, so every link, canonical, sitemap and feed entry
// must use this form.
const postPath = slug => `/blog/${slug}`;
const postUrl = slug => `${SITE}${postPath(slug)}`;
const BLOG_URL = `${SITE}/blog`;

// Posts folded into a stronger article on the same topic. They are left out of
// the build (no page, sitemap, feed or related link) and links to them point at
// the article they were merged into. Each one needs a matching 301 in
// netlify.toml, which ships in the same deploy.
const MERGED_POSTS = {
  // Oct 2026: Google crawled it and declined to index; same ground as the vs. article
  'co-parenting-spectrum-finding-balance': 'parallel-parenting-vs-co-parenting-what-s-the-difference',
  // Oct 2026: a near-duplicate of the same article (same title, ~60% the same wording)
  'co-parenting-vs-parallel-parenting': 'parallel-parenting-vs-co-parenting-what-s-the-difference',
};

// Rewrite internal links that still carry ".html" (e.g. links typed into
// Notion posts) to the clean form so they never point at a redirect.
function cleanInternalLinks(html) {
  return html.replace(
    /href="(https:\/\/(?:www\.)?getclearly\.app)?(\/[^"#?]*?)\.html([#?][^"]*)?"/g,
    (m, origin, p, rest) => {
      const clean = p.endsWith('/index') ? p.slice(0, -5) : p;
      return `href="${origin ? SITE : ''}${clean || '/'}${rest || ''}"`;
    }
  ).replace(
    // Pages that moved (links typed into Notion posts still use the old address)
    /href="(https:\/\/(?:www\.)?getclearly\.app)?\/best-co-parenting-apps-2026\/?([#?][^"]*)?"/g,
    (m, origin, rest) => `href="${origin ? SITE : ''}/best-co-parenting-apps/${rest || ''}"`
  ).replace(
    /href="(https:\/\/(?:www\.)?getclearly\.app)?\/blog\/([a-z0-9-]+)([#?][^"]*)?"/g,
    (m, origin, slug, rest) => MERGED_POSTS[slug]
      ? `href="${origin ? SITE : ''}${postPath(MERGED_POSTS[slug])}${rest || ''}"`
      : m
  );
}

// Load partials
const headerPartial = fs.readFileSync(path.join(__dirname, '_partials/header.html'), 'utf-8').trim();
const footerPartial = fs.readFileSync(path.join(__dirname, '_partials/footer.html'), 'utf-8').trim();

async function fetchPosts() {
  let allResults = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Published',
        checkbox: { equals: true }
      },
      sorts: [{ property: 'Date', direction: 'descending' }],
      start_cursor: startCursor
    });
    allResults = allResults.concat(response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  console.log(`Fetched ${allResults.length} published posts from Notion`);
  return allResults;
}

// Notion returns at most 100 blocks per call; long posts were being cut off.
async function getPageContent(pageId) {
  let blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    blocks = blocks.concat(res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

function blocksToHtml(blocks) {
  return blocks.map(block => {
    switch (block.type) {
      case 'paragraph':
        const text = richTextToHtml(block.paragraph.rich_text);
        return text ? `<p>${text}</p>` : '';

      // The post title is the page's only <h1>
      case 'heading_1':
        return `<h2>${richTextToHtml(block.heading_1.rich_text)}</h2>`;

      case 'heading_2':
        return `<h2>${richTextToHtml(block.heading_2.rich_text)}</h2>`;

      case 'heading_3':
        return `<h3>${richTextToHtml(block.heading_3.rich_text)}</h3>`;

      case 'bulleted_list_item':
        return `<li>${richTextToHtml(block.bulleted_list_item.rich_text)}</li>`;

      case 'numbered_list_item':
        return `<li data-ol>${richTextToHtml(block.numbered_list_item.rich_text)}</li>`;

      case 'quote':
        return `<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>`;

      case 'divider':
        return '<hr>';

      case 'image':
        const url = block.image.type === 'external'
          ? block.image.external.url
          : block.image.file.url;
        const caption = block.image.caption?.map(c => c.plain_text).join('') || '';
        return `<figure><img src="${url}" alt="${escapeHtml(caption)}" loading="lazy"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;

      default:
        return '';
    }
  }).join('\n');
}

function richTextToHtml(richText) {
  return richText.map(t => {
    let content = escapeHtml(t.plain_text);
    if (t.annotations.bold) content = `<strong>${content}</strong>`;
    if (t.annotations.italic) content = `<em>${content}</em>`;
    if (t.annotations.code) content = `<code>${content}</code>`;
    if (t.href) content = `<a href="${t.href}">${content}</a>`;
    return content;
  }).join('');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapListItems(html) {
  // Wrap consecutive numbered items in <ol>, then bulleted items in <ul>
  return html
    .replace(/(<li>.*?<\/li>\n?)+/g, match => `<ul>${match}</ul>`)
    .replace(/(<li data-ol>.*?<\/li>\n?)+/g, match => `<ol>${match.replace(/<li data-ol>/g, '<li>')}</ol>`);
}

function getProperty(page, name) {
  const prop = page.properties[name];
  if (!prop) return '';

  switch (prop.type) {
    case 'title':
      return prop.title.map(t => t.plain_text).join('');
    case 'rich_text':
      return prop.rich_text.map(t => t.plain_text).join('');
    case 'date':
      return prop.date?.start || '';
    case 'checkbox':
      return prop.checkbox;
    case 'select':
      return prop.select?.name || '';
    default:
      return '';
  }
}

// Notion dates are calendar days ("2026-04-05"). new Date() reads that as
// midnight UTC, which printed the day before in US time zones, so format
// the calendar day itself in UTC.
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function generateSlug(title, existingSlug) {
  if (existingSlug) return existingSlug;
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Call-to-action copy matched to what the reader came for. Claims here must
// match the homepage (help with hard conversations only when needed, record
// kept as written and court-ready, shared calendar, expense splits, 14-day
// trial, co-parent joins free).
const CTA_COPY = {
  'High-Conflict Situations': {
    kicker: 'When every message matters',
    text: 'Clearly is a co-parenting app for the web and iPhone that steps in like a mediator when a conversation needs it, and keeps every message on the record exactly as written.'
  },
  'Communication': {
    kicker: 'Get to an answer',
    text: 'Clearly is a co-parenting app for the web and iPhone that helps word the hard conversations so they reach an answer, stepping in only when it\u2019s needed. You choose what to send.'
  },
  'Schedules & Custody': {
    kicker: 'One calendar you both trust',
    text: 'Clearly is a co-parenting app for the web and iPhone that keeps your custody schedule, holidays and swap requests in one shared calendar.'
  },
  'Money & Expenses': {
    kicker: 'Money, settled',
    text: 'Clearly is a co-parenting app for the web and iPhone that works out each parent\u2019s share of every shared expense from the split you agreed.'
  },
  'Legal Basics': {
    kicker: 'For the record',
    text: 'Clearly is a co-parenting app for the web and iPhone that keeps every message, agreement and schedule change as written, and exports court-ready records with a document ID on every page.'
  },
  default: {
    kicker: 'Co-parenting, resolved',
    text: 'Clearly is a co-parenting app for the web and iPhone that helps each conversation reach an answer, and keeps the schedule, expenses and plan in one place.'
  }
};
CTA_COPY['Expenses'] = CTA_COPY['Money & Expenses'];
const ctaFor = category => CTA_COPY[category] || CTA_COPY.default;
const CTA_FINE_PRINT = '14-day free trial · Your co-parent joins free';

// Get started (Clearly on the web, any browser) first, the companion
// iPhone app as a quiet link beside it. Styles: .start-btn / .app-link in
// styles/site-chrome.css (light versions inside the dark end-of-post box).
const startCta = cta => `<div class="start-row">
    <a href="https://web.getclearly.app/signup" class="start-btn" data-cta="${cta}">Get started</a>
    <a href="${APP_STORE_URL}" class="app-link" data-cta="${cta}-iphone">Get the companion iPhone app</a>
  </div>`;

// A quiet one-line mention partway through the post: what Clearly is, and
// how to start. No heading, so it reads as an aside rather than an ad.
function midArticleCta(category) {
  return `<aside class="inline-cta" aria-label="About Clearly">
  <p>${ctaFor(category).text}</p>
  ${startCta('mid-article')}
</aside>`;
}

// Put the inline CTA before the third section (or the second, for short
// posts) so mobile readers see it long before the end of the article.
// "Key Takeaways" (a heading followed by a list) gets its own tinted box.
function wrapTakeaways(content) {
  return content.replace(/<h2>(Key Takeaways?)<\/h2>\s*(<(ul|ol)>[\s\S]*?<\/\3>)/i,
    (m, h, list) => `<section class="takeaways"><h2>${h}</h2>${list}</section>`);
}

function insertMidArticleCta(content, category) {
  const h2s = [...content.matchAll(/<h2>/g)].map(m => m.index);
  if (h2s.length < 2) return content;
  const at = h2s[h2s.length >= 4 ? 2 : 1];
  return content.slice(0, at) + midArticleCta(category) + '\n' + content.slice(at);
}

// "<title>" is what shows in Google; keep it under ~60 characters.
// Title for Google and social previews: the optional Notion "SEO Title" when
// it's filled in, otherwise the post title. " | Clearly" is added when it fits.
function seoTitle(post) {
  const base = post.seoTitle || post.title;
  const branded = `${base} | Clearly`;
  return branded.length <= 60 ? branded : base;
}

// Related articles and guide "Further reading": balanced so every article is
// linked from several pages (see automation/related.js)
const { buildLinkPlan, GUIDE_PAGES, writeFurtherReading } = require('./automation/related.js');

function articleJsonLd(post) {
  const url = postUrl(post.slug);
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: post.title,
        description: post.description,
        datePublished: post.dateISO,
        dateModified: post.modifiedISO || post.dateISO,
        inLanguage: 'en-US',
        articleSection: post.category || undefined,
        wordCount: post.wordCount,
        author: { '@type': 'Organization', name: 'Clearly', url: SITE },
        publisher: {
          '@type': 'Organization',
          name: 'Clearly',
          url: SITE,
          logo: { '@type': 'ImageObject', url: `${SITE}/images/app-icon.png` }
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        isPartOf: { '@type': 'Blog', '@id': `${BLOG_URL}#blog`, name: 'Common Ground', url: BLOG_URL },
        image: `${SITE}/images/blog-og.png`
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Common Ground', item: BLOG_URL },
          { '@type': 'ListItem', position: 3, name: post.title, item: url }
        ]
      }
    ]
  }, null, 2).replace(/</g, '\\u003c');
}

// State child support calculators, linked from every article about child
// support or shared expenses so Google finds them from more than /calculators/.
const SUPPORT_CALCULATORS = [
  ['california', 'California'], ['florida', 'Florida'], ['illinois', 'Illinois'],
  ['new-york', 'New York'], ['pennsylvania', 'Pennsylvania'], ['texas', 'Texas'],
];
const isSupportTopic = post => ['Money & Expenses', 'Expenses'].includes(post.category)
  || /child[- ]support/i.test(`${post.slug} ${post.title} ${post.description}`);
function supportCalculators(post) {
  if (!isSupportTopic(post)) return '';
  return `<aside class="support-calcs" aria-label="Child support calculators">
        <h2>Estimate child support in your state</h2>
        <p>Free calculators that follow each state's guidelines. A starting point for the conversation, not legal advice.</p>
        <ul>
          ${SUPPORT_CALCULATORS.map(([slug, name]) => `<li><a href="/calculators/support/${slug}">${name} child support calculator</a></li>`).join('\n          ')}
          <li><a href="/calculators/" class="all">All states &rarr;</a></li>
        </ul>
      </aside>`;
}

const blogPostTemplate = (post, relatedPosts = []) => `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Preconnect hints for performance -->
  <link rel="preconnect" href="https://www.googletagmanager.com">
  <link rel="preconnect" href="https://dwncravjhkbclbuzijra.supabase.co">
  <link rel="dns-prefetch" href="https://www.googletagmanager.com">
  <link rel="dns-prefetch" href="https://dwncravjhkbclbuzijra.supabase.co">

  <!-- Google tag (gtag.js) -->
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
  <meta name="theme-color" content="#0D8268">
  <title>${escapeHtml(seoTitle(post))}</title>
  <meta name="description" content="${escapeHtml(post.description)}">
  <link rel="canonical" href="${postUrl(post.slug)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${postUrl(post.slug)}">
  <meta property="article:published_time" content="${post.dateISO}">
  <meta property="article:modified_time" content="${post.modifiedISO || post.dateISO}">${post.category ? `
  <meta property="article:section" content="${escapeHtml(post.category)}">` : ''}
  <meta property="og:title" content="${escapeHtml(post.seoTitle || post.title)}">
  <meta property="og:description" content="${escapeHtml(post.description)}">
  <meta property="og:image" content="https://getclearly.app/images/blog-og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Clearly.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(post.seoTitle || post.title)}">
  <meta name="twitter:description" content="${escapeHtml(post.description)}">
  <meta name="twitter:image" content="https://getclearly.app/images/blog-og.png">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="alternate" type="application/rss+xml" title="Clearly Blog RSS Feed" href="https://getclearly.app/feed.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Instrument+Sans:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../styles.css">
  <link rel="stylesheet" href="/styles/brand.css?v=20261010">
  <link rel="icon" href="/images/favicon-32.png">
  <link rel="manifest" href="/manifest.json">
  <style>
    /* Post page in the homepage's panel style: one white panel with a
       single reading column, related posts in a second panel. No left-edge
       accent lines. */
    :root { --paper: #F6F5F1; --ink: #1C1C1A; --ink-mid: #4A4A47; --ink-faint: #6B6B67; --moss: #0D8268; --moss-pale: #DBEFE8; --rule: rgba(28,28,26,0.10); }
    body { background: var(--paper); }
    .post-main { padding: 16px 0 0; }
    .post-panel { margin: 0 16px 16px; background: #FFFFFF; border-radius: 28px; padding: 88px 40px 96px; }
    .post-col { max-width: 680px; margin: 0 auto; }
    .post-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 40px; }
    .back-link { font-size: 13px; font-weight: 500; color: var(--ink-faint); text-decoration: none; }
    .back-link:hover { color: var(--moss); text-decoration: none; }
    .pill { display: inline-block; font-size: 11px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase; color: var(--moss); border: 1px solid currentColor; border-radius: 999px; padding: 4px 10px; text-decoration: none; }
    .blog-post-title { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 48px; line-height: 1.08; letter-spacing: -0.4px; color: var(--ink); margin: 0 0 20px; text-wrap: balance; }
    .post-dek { font-size: 19px; line-height: 1.6; color: var(--ink-mid); margin: 0 0 32px; }
    .post-meta { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 18px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin-bottom: 48px; }
    .post-meta p { font-size: 13px; color: var(--ink-faint); margin: 0; }
    .share-buttons { display: flex; gap: 6px; }
    .share-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: transparent; border: 1px solid var(--rule); color: var(--ink-faint); cursor: pointer; transition: background .2s, color .2s, border-color .2s; }
    .share-btn:hover, .share-btn.copied { background: var(--moss); border-color: var(--moss); color: #FFFFFF; }
    .share-btn svg { width: 14px; height: 14px; }

    .blog-post-content { color: var(--ink-mid); }
    .blog-post-content p { font-size: 18px; line-height: 1.75; margin: 0 0 24px; color: var(--ink-mid); }
    .blog-post-content strong { color: var(--ink); font-weight: 500; }
    .blog-post-content h2 { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 32px; line-height: 1.15; color: var(--ink); margin: 64px 0 18px; }
    .blog-post-content h3 { font-family: 'Instrument Sans', sans-serif; font-weight: 500; font-size: 19px; color: var(--ink); margin: 40px 0 12px; }
    .blog-post-content ul, .blog-post-content ol { list-style: none; margin: 0 0 28px; padding: 0; }
    .blog-post-content li { position: relative; font-size: 18px; line-height: 1.7; margin: 0 0 12px; padding-left: 28px; color: var(--ink-mid); }
    .blog-post-content ul > li::before { content: ''; position: absolute; left: 6px; top: 13px; width: 6px; height: 6px; border-radius: 50%; background: var(--moss); }
    .blog-post-content ol { counter-reset: n; }
    .blog-post-content ol > li { counter-increment: n; padding-left: 36px; }
    .blog-post-content ol > li::before { content: counter(n); position: absolute; left: 0; top: 3px; width: 24px; height: 24px; border-radius: 50%; background: var(--moss-pale); color: var(--moss); font-size: 12px; font-weight: 500; display: grid; place-items: center; }
    .blog-post-content blockquote { margin: 40px 0; padding: 0; font-family: 'EB Garamond', serif; font-size: 26px; line-height: 1.4; font-style: italic; color: var(--ink); }
    .blog-post-content figure { margin: 40px 0; }
    .blog-post-content img { max-width: 100%; border-radius: 16px; }
    .blog-post-content figcaption { text-align: center; font-size: 13px; color: var(--ink-faint); margin-top: 10px; }
    .blog-post-content a { color: var(--moss); text-underline-offset: 3px; }
    .blog-post-content .takeaways { background: var(--paper); border-radius: 20px; padding: 36px 36px 20px; margin: 64px 0 0; }
    .blog-post-content .takeaways h2 { font-size: 26px; margin: 0 0 20px; }
    .blog-post-content .takeaways li { font-size: 16px; line-height: 1.65; }

    /* Calls to action: no accent edges, whole-border or background only */
    .post-panel .app-badge, .post-panel .app-badge:hover { color: #FFFFFF; text-decoration: none; }
    .inline-cta { display: flex; align-items: center; gap: 20px; margin: 48px 0; padding: 20px 22px; border: 1px solid var(--rule); border-radius: 16px; }
    .blog-post-content .inline-cta p { flex: 1; font-size: 15px; line-height: 1.6; margin: 0; }
    .inline-cta .app-badge { flex-shrink: 0; }
    .support-calcs { margin: 56px 0 0; padding: 28px 28px 24px; border: 1px solid var(--rule); border-radius: 20px; }
    .support-calcs h2 { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 26px; line-height: 1.2; color: var(--ink); margin: 0 0 8px; }
    .support-calcs p { font-size: 15px; line-height: 1.6; color: var(--ink-mid); margin: 0 0 18px; }
    .support-calcs ul { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
    .support-calcs a { display: inline-block; padding: 9px 16px; border: 1px solid var(--rule); border-radius: 999px; font-size: 14px; color: var(--ink); text-decoration: none; transition: border-color .2s, color .2s; }
    .support-calcs a:hover, .support-calcs a:focus-visible { border-color: var(--moss); color: var(--moss); }
    .support-calcs .all { border-color: transparent; color: var(--moss); padding-left: 6px; }
    .blog-cta { margin: 64px 0 0; background: var(--moss); border-radius: 22px; padding: 48px 40px; text-align: center; color: #FFFFFF; }
    .blog-cta .blog-cta-kicker { font-family: 'EB Garamond', serif; font-size: 30px; line-height: 1.2; margin: 0 0 12px; color: #FFFFFF; }
    .blog-cta p { font-size: 16px; line-height: 1.6; color: rgba(255,255,255,0.85); margin: 0 auto 28px; max-width: 34em; }
    .blog-cta .blog-cta-fine { font-size: 13px; color: rgba(255,255,255,0.7); margin: 18px 0 0; }
    .blog-cta .blog-cta-secondary { color: #FFFFFF; font-weight: 500; }
    .blog-cta .start-row { justify-content: center; }
    .blog-cta .start-btn { background: #FFFFFF; color: #1C1C1A; }
    .blog-cta .app-link { color: #FFFFFF; }

    /* Related articles */
    .related-panel { margin: 0 16px 16px; background: #FFFFFF; border-radius: 28px; padding: 72px 40px; }
    .related-inner { max-width: 1200px; margin: 0 auto; }
    .related-panel .label { font-size: 12px; font-weight: 500; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 24px; }
    .related-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    @media (max-width: 1100px) { .related-grid { grid-template-columns: repeat(2, 1fr); } }
    .related-card { display: flex; flex-direction: column; background: var(--paper); border-radius: 20px; padding: 28px; text-decoration: none; transition: transform .25s, box-shadow .25s; }
    .related-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(28,28,26,0.08); text-decoration: none; }
    .related-card .pill { align-self: flex-start; margin-bottom: 20px; }
    .related-card h3 { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 22px; line-height: 1.25; color: var(--ink); margin: 0 0 10px; }
    .related-card p { font-size: 14px; line-height: 1.6; color: var(--ink-mid); margin: 0; }

    @media (max-width: 768px) {
      .post-panel { margin: 0 10px 10px; border-radius: 22px; padding: 56px 22px 64px; }
      .blog-post-title { font-size: 34px; }
      .post-dek { font-size: 17px; }
      .blog-post-content p, .blog-post-content li { font-size: 17px; }
      .blog-post-content h2 { font-size: 27px; margin-top: 48px; }
      .blog-post-content .takeaways { padding: 28px 22px 12px; }
      .inline-cta { flex-direction: column; align-items: flex-start; gap: 14px; }
      .blog-cta { padding: 36px 22px; }
      .related-panel { margin: 0 10px 10px; border-radius: 22px; padding: 48px 22px; }
      .related-grid { grid-template-columns: 1fr; }
      /* Phones: full-size tap targets for the back link and share buttons */
      .back-link { display: inline-block; padding: 12px 8px 12px 0; margin: -12px 0; }
      .share-btn { width: 40px; height: 40px; }
      .share-btn svg { width: 16px; height: 16px; }
    }
  </style>
</head>
<body>
  ${headerPartial}

  <main class="post-main" id="main-content">
  <article class="post-panel">
    <div class="post-col">
      <div class="post-top">
        <a href="/blog" class="back-link">&larr; Blog</a>
        ${post.category ? `<span class="pill">${escapeHtml(post.category)}</span>` : ''}
      </div>
      <header>
        <h1 class="blog-post-title">${escapeHtml(post.title)}</h1>
        <p class="post-dek">${escapeHtml(post.description)}</p>
        <div class="post-meta">
          <p>By the Clearly team &middot; <time datetime="${post.dateISO}">${post.date}</time> &middot; ${Math.max(1, Math.round((post.wordCount || 0) / 230))} min read</p>
          <div class="share-buttons" aria-label="Share">
            <button class="share-btn" onclick="copyLink()" title="Copy link" id="copy-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            </button>
            <a class="share-btn" href="https://twitter.com/intent/tweet?url=${postUrl(post.slug)}&text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener" title="Share on X">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            <a class="share-btn" href="https://www.facebook.com/sharer/sharer.php?u=${postUrl(post.slug)}" target="_blank" rel="noopener" title="Share on Facebook">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </a>
            <a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${postUrl(post.slug)}" target="_blank" rel="noopener" title="Share on LinkedIn">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            </a>
            <a class="share-btn" href="mailto:?subject=${encodeURIComponent(post.title)}&body=I thought you might find this helpful: ${postUrl(post.slug)}" title="Share via Email">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            </a>
          </div>
        </div>
      </header>
      <div class="blog-post-content">
        ${post.content}
      </div>
      ${supportCalculators(post)}
      <div class="blog-cta final-cta">
        <p class="blog-cta-kicker">${ctaFor(post.category).kicker}</p>
        <p>${ctaFor(post.category).text}</p>
        ${startCta('end-of-article')}
        <p class="blog-cta-fine">${CTA_FINE_PRINT} &middot; <a href="/plan-builder/" class="blog-cta-secondary">Or build a free parenting plan</a></p>
      </div>
    </div>
  </article>

  ${relatedPosts.length > 0 ? `
  <section class="related-panel" aria-label="Related articles">
    <div class="related-inner">
      <p class="label">Keep reading</p>
      <div class="related-grid">
        ${relatedPosts.map(p => `
        <a href="${postPath(p.slug)}" class="related-card">
          ${p.category ? `<span class="pill">${escapeHtml(p.category)}</span>` : ''}
          <h3>${escapeHtml(p.title)}</h3>
          <p>${escapeHtml(p.description.substring(0, 120))}${p.description.length > 120 ? '...' : ''}</p>
        </a>
        `).join('')}
      </div>
    </div>
  </section>
  ` : ''}
  </main>

  ${footerPartial}

  <!-- Article Structured Data -->
  <script type="application/ld+json">
${articleJsonLd(post)}
  </script>

  <script>
    function copyLink() {
      navigator.clipboard.writeText(window.location.href).then(function() {
        var btn = document.getElementById('copy-btn');
        btn.classList.add('copied');
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(function() {
          btn.classList.remove('copied');
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
        }, 2000);
      });
    }
    // Track App Store clicks, same as every other page. data-cta names the
    // placement (mid-article, end-of-article); the fallback labels the rest so
    // a post click is never recorded as "(not set)".
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href*="apps.apple.com"]');
      if (link && typeof gtag === 'function') {
        gtag('event', 'app_store_click', {
          link_url: link.href,
          link_location: link.dataset.cta || (link.closest('header') ? 'header' : link.closest('footer') ? 'footer' : link.closest('.final-cta,.hero') ? 'cta' : 'body'),
          page_type: location.pathname.indexOf('/blog/') === 0 ? 'blog_post' : 'page'
        });
      }
    });
  </script>

</body>
</html>`;

// Blog topics, grouped for the index page filters. Any category not listed
// here still gets a filter, under "More".
// Three groups, so the filter columns sit exactly on the 3-column card grid.
const TOPIC_GROUPS = [
  ['Talking it through', ['Communication', 'High-Conflict Situations']],
  ['Kids, family & you', ['Your Children', 'Blended Families', 'Self-Care & Support']],
  ['The practical side', ['Co-Parenting Basics', 'Schedules & Custody', 'Money & Expenses', 'Legal Basics']],
];

// An article's section headings, so the blog search also finds words used in
// the article, not just its title and description.
function searchHeadings(html) {
  return [...String(html || '').matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, ' ').trim())
    .filter(t => t && !/^key takeaways$/i.test(t))
    .join(' · ');
}

function topicFilters(posts) {
  const counts = {};
  posts.forEach(p => { if (p.category) counts[p.category] = (counts[p.category] || 0) + 1; });
  const listed = new Set(TOPIC_GROUPS.flatMap(([, cats]) => cats));
  const extra = Object.keys(counts).filter(c => !listed.has(c));
  const groups = TOPIC_GROUPS.concat(extra.length ? [['More', extra]] : [])
    .map(([name, cats]) => [name, cats.filter(c => counts[c])])
    .filter(([, cats]) => cats.length);
  const btn = (cat, label, n, active) =>
    `<button class="filter-btn${active ? ' active' : ''}" data-category="${escapeHtml(cat)}">${escapeHtml(label)} <span>${n}</span></button>`;
  return `<aside class="topics" aria-label="Search and topics">
        <div class="blog-search" role="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="16.5" y1="16.5" x2="21" y2="21"></line></svg>
          <input id="blog-q" type="search" placeholder="Search articles" aria-label="Search articles" autocomplete="off" spellcheck="false" enterkeyhint="search">
          <button type="button" class="search-clear" aria-label="Clear search" hidden>&times;</button>
        </div>
        <nav class="filters" role="group" aria-label="Filter by topic">
          <div class="filter-all">${btn('all', 'All articles', posts.length, true)}</div>
          ${groups.map(([name, cats]) => `<div class="filter-group"><p>${escapeHtml(name)}</p>${cats.map(c => btn(c, c, counts[c])).join('')}</div>`).join('\n          ')}
        </nav>
      </aside>`;
}

const blogListTemplate = (posts) => `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Preconnect hints for performance -->
  <link rel="preconnect" href="https://www.googletagmanager.com">
  <link rel="preconnect" href="https://dwncravjhkbclbuzijra.supabase.co">
  <link rel="dns-prefetch" href="https://www.googletagmanager.com">
  <link rel="dns-prefetch" href="https://dwncravjhkbclbuzijra.supabase.co">

  <!-- Google tag (gtag.js) -->
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
  <meta name="theme-color" content="#0D8268">
  <title>Co-Parenting Blog: Custody &amp; Communication Advice | Clearly</title>
  <meta name="description" content="Co-parenting advice from Clearly: custody schedules, splitting costs, hard conversations, high-conflict exes and helping kids through divorce.">
  <link rel="canonical" href="${BLOG_URL}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${BLOG_URL}">
  <meta property="og:title" content="Co-Parenting Blog: Custody &amp; Communication Advice | Clearly">
  <meta property="og:description" content="Co-parenting advice from Clearly: custody schedules, splitting costs, hard conversations, high-conflict exes and helping kids through divorce.">
  <meta property="og:image" content="https://getclearly.app/images/blog-og.png">
  <meta property="og:site_name" content="Clearly.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Co-Parenting Blog: Custody &amp; Communication Advice | Clearly">
  <meta name="twitter:description" content="Co-parenting advice from Clearly: custody schedules, splitting costs, hard conversations, high-conflict exes and helping kids through divorce.">
  <meta name="twitter:image" content="https://getclearly.app/images/blog-og.png">
  <meta name="robots" content="index, follow">
  <meta name="keywords" content="co-parenting tips, custody advice, shared parenting, divorce resources, co-parent communication">
  <link rel="alternate" type="application/rss+xml" title="Clearly Blog RSS Feed" href="https://getclearly.app/feed.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Instrument+Sans:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="/styles/brand.css?v=20261010">
  <link rel="icon" href="/images/favicon-32.png">
  <link rel="manifest" href="/manifest.json">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": "Common Ground",
    "description": "Co-parenting advice from Clearly: custody schedules, splitting costs, hard conversations, high-conflict exes and helping kids through divorce.",
    "@id": "${BLOG_URL}#blog",
    "url": "${BLOG_URL}",
    "publisher": {
      "@type": "Organization",
      "name": "Clearly",
      "url": "https://getclearly.app"
    },
    "blogPost": [
${posts.map(post => `      {
        "@type": "BlogPosting",
        "headline": ${JSON.stringify(post.title)},
        "description": ${JSON.stringify(post.description)},
        "url": "${postUrl(post.slug)}",
        "datePublished": ${JSON.stringify(post.dateISO)}
      }`).join(',\n')}
    ]
  }
  </script>
  <style>
    /* Blog index in the homepage panel style. No left-edge accent lines. */
    :root { --paper: #F6F5F1; --ink: #1C1C1A; --ink-mid: #4A4A47; --ink-faint: #6B6B67; --moss: #0D8268; --moss-pale: #DBEFE8; --rule: rgba(28,28,26,0.10); }
    body { background: var(--paper); }
    .list-main { padding: 16px 0 0; }
    .panel { margin: 0 16px 16px; border-radius: 28px; background: #FFFFFF; padding: 72px 40px 88px; }
    .panel-pale { background: var(--moss-pale); }
    .inner { max-width: 1200px; margin: 0 auto; }
    .label { display: inline-flex; gap: 10px; font-size: 12px; font-weight: 500; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 24px; }
    .label b { font-weight: 500; color: var(--moss); }
    .pill { display: inline-block; font-size: 11px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase; color: var(--moss); border: 1px solid currentColor; border-radius: 999px; padding: 4px 10px; }

    .list-head { margin-bottom: 48px; }
    .list-head h1 { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 48px; line-height: 1.05; letter-spacing: -0.4px; color: var(--ink); margin: 0 0 10px; }
    .list-head h1 em { font-style: italic; color: var(--moss); }
    .list-head .intro { font-size: 16px; line-height: 1.6; color: var(--ink-mid); margin: 0; max-width: 40em; }

    /* Topics live in a sticky sidebar on the first column of the page's
       3-column grid; posts fill the other two. Phones: one scrolling row. */
    .list-body { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 16px; align-items: start; border-top: 1px solid var(--rule); padding-top: 40px; }
    .topics { position: sticky; top: 96px; }
    .filters { display: flex; flex-direction: column; gap: 22px; }
    /* Group headings read as headings: green, with a thin rule above;
       the topics under them stay plain grey text. */
    .filter-group { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding-top: 18px; border-top: 1px solid var(--rule); }
    .filter-group p { font-size: 11px; font-weight: 500; letter-spacing: 1.3px; text-transform: uppercase; color: var(--moss); margin: 0 0 8px; }
    .filter-btn { font: inherit; font-size: 15px; line-height: 1.4; color: var(--ink-mid); background: transparent; border: 0; border-radius: 999px; padding: 4px 12px; margin-left: -12px; cursor: pointer; text-align: left; transition: background .2s, color .2s; }
    .filter-btn span { color: var(--ink-faint); font-size: 12px; margin-left: 6px; }
    .filter-btn:hover { color: var(--moss); }
    .filter-btn.active { background: var(--paper); color: var(--ink); font-weight: 500; }
    .blog-grid { grid-column: 2 / span 2; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .blog-card { position: relative; display: flex; flex-direction: column; background: var(--paper); border-radius: 20px; padding: 28px; transition: transform .25s, box-shadow .25s; }
    .blog-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(28,28,26,0.08); }
    .blog-card .pill { align-self: flex-start; margin-bottom: 20px; }
    .blog-card h2 { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 23px; line-height: 1.22; margin: 0 0 12px; }
    .blog-card h2 a { color: var(--ink); text-decoration: none; }
    .blog-card h2 a::after { content: ''; position: absolute; inset: 0; border-radius: 20px; } /* whole card is the link */
    .blog-card p { font-size: 14px; line-height: 1.6; color: var(--ink-mid); margin: 0 0 24px; }
    .blog-card .meta { margin-top: auto; font-size: 12px; color: var(--ink-faint); }
    .blog-card.hidden, .blog-card.off-page { display: none; }
    /* Pages of 12. Every post stays in the page (search engines see all of them);
       the pager just shows one page at a time. */
    .pager { grid-column: 2 / span 2; display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 4px; margin: 40px 0 0; }
    .pager[hidden] { display: none; }
    .pager button { font: inherit; font-size: 14px; min-width: 40px; height: 40px; padding: 0 12px; border-radius: 999px; border: 1px solid transparent; background: transparent; color: var(--ink-mid); cursor: pointer; }
    .pager button:hover:not(:disabled) { color: var(--moss); border-color: var(--rule); }
    .pager button[aria-current="page"] { background: var(--ink); color: #FFFFFF; font-weight: 500; }
    .pager button:disabled { opacity: .35; cursor: default; }
    .pager .gap { min-width: 24px; text-align: center; color: var(--ink-faint); }
    .no-posts { text-align: center; color: var(--ink-faint); }

    /* Search: filters the cards as you type, within the chosen topic */
    .blog-search { position: relative; margin: 0 0 24px; }
    .blog-search svg { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--ink-faint); pointer-events: none; }
    .blog-search input { width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; color: var(--ink); background: #FFFFFF; border: 1px solid var(--rule); border-radius: 999px; padding: 11px 40px 11px 40px; -webkit-appearance: none; appearance: none; transition: border-color .2s, box-shadow .2s; }
    .blog-search input::placeholder { color: var(--ink-faint); }
    .blog-search input:focus { outline: none; border-color: var(--moss); box-shadow: 0 0 0 3px rgba(13,130,104,0.14); }
    .blog-search input::-webkit-search-cancel-button { display: none; }
    .search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: var(--ink-faint); font-size: 20px; line-height: 1; cursor: pointer; }
    .search-clear:hover, .search-clear:focus-visible { background: var(--paper); color: var(--ink); }
    .search-clear[hidden] { display: none; }
    .search-status { grid-column: 1 / -1; font-size: 14px; line-height: 1.6; color: var(--ink-mid); margin: 0 0 4px; }
    .search-status[hidden] { display: none; }
    .search-status button { font: inherit; color: var(--moss); background: none; border: 0; padding: 0; margin-left: 10px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }

    @media (max-width: 960px) {
      .list-body { display: block; padding-top: 24px; }
      .topics { position: static; margin: 0 0 28px; }
      .blog-search { margin: 0 0 14px; }
      .filters { flex-direction: row; gap: 4px; overflow-x: auto; scrollbar-width: none; margin: 0 -40px; padding: 0 40px 4px; }
      .filter-group, .filter-all { display: contents; border: 0; padding: 0; }
      .filter-group p { display: none; }
      .filter-btn { flex-shrink: 0; white-space: nowrap; margin-left: 0; background: var(--paper); font-size: 14px; padding: 10px 16px; }
      .filter-btn.active { background: var(--ink); color: #FFFFFF; }
      .filter-btn.active span { color: rgba(255,255,255,.7); }
      .blog-grid { grid-template-columns: 1fr 1fr; }
      /* The topic chips scroll sideways: fade the right edge so that reads */
      .filters { -webkit-mask-image: linear-gradient(to right, #000 82%, transparent); mask-image: linear-gradient(to right, #000 82%, transparent); }
    }
    @media (max-width: 640px) {
      .panel { margin: 0 10px 10px; border-radius: 22px; padding: 56px 22px; }
      .list-head h1 { font-size: 36px; }
      .filters { margin: 0 -22px; padding: 0 22px 4px; }
      .blog-grid { grid-template-columns: 1fr; gap: 10px; }
      .blog-card { padding: 22px; border-radius: 18px; }
      .blog-card .pill { margin-bottom: 14px; }
      .blog-card h2 { font-size: 21px; margin-bottom: 8px; }
      .blog-card p { margin-bottom: 14px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    }
  </style>
</head>
<body>
  ${headerPartial}

  <main class="list-main" id="main-content">
  <section class="panel">
    <div class="inner">
      <header class="list-head">
        <p class="label"><b>Clearly</b> The blog</p>
        <h1>Common Ground</h1>
        <p class="intro">Ideas for calmer co-parenting: schedules, money, hard messages and the kids.</p>
      </header>
      ${posts.length > 0 ? `
      <div class="list-body">
      ${topicFilters(posts)}
      <div class="blog-grid">
        <p class="search-status" aria-live="polite" hidden></p>
        ${posts.map((post, i) => `
        <article class="blog-card" data-category="${escapeHtml(post.category)}" data-headings="${escapeHtml(searchHeadings(post.content))}">
          ${post.category ? `<span class="pill">${escapeHtml(post.category)}</span>` : ''}
          <h2><a href="${postPath(post.slug)}">${escapeHtml(post.title)}</a></h2>
          <p>${escapeHtml(post.description)}</p>
          <p class="meta">${post.date} &middot; ${Math.max(1, Math.round((post.wordCount || 0) / 230))} min read</p>
        </article>
        `).join('')}
      </div>
      </div>
      ` : `
      <div class="no-posts"><p>New articles coming soon.</p></div>
      `}
    </div>
  </section>
  </main>

  ${footerPartial}

  <script>
    // Topic filter and pages. Every post is in the page; a topic shows all of
    // its posts, 12 to a page, with numbered pages when there are more.
    (function () {
      var cards = [].slice.call(document.querySelectorAll('.blog-card'));
      var grid = document.querySelector('.blog-grid');
      var PER = 12, page = 1, cat = 'all';
      var pager = document.createElement('nav');
      pager.className = 'pager';
      pager.setAttribute('aria-label', 'Pages');
      if (grid) grid.insertAdjacentElement('afterend', pager);

      function button(label, target, opts) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (opts && opts.aria) b.setAttribute('aria-label', opts.aria);
        if (opts && opts.current) b.setAttribute('aria-current', 'page');
        if (opts && opts.disabled) b.disabled = true;
        b.addEventListener('click', function () { page = target; render(); toList(); });
        return b;
      }
      // 1 … 4 5 6 … 12 : first, last, and the pages either side of the current one
      function pageList(n) {
        var out = [];
        for (var i = 1; i <= n; i++) {
          if (i === 1 || i === n || Math.abs(i - page) <= 1) out.push(i);
          else if (out[out.length - 1] !== '…') out.push('…');
        }
        return out;
      }
      // Search: every word must appear in the title, description, topic or a
      // section heading ("boundaries" also finds "boundary"). Best matches first.
      var input = document.getElementById('blog-q');
      var clearBtn = document.querySelector('.search-clear');
      var status = document.querySelector('.search-status');
      var q = '';
      function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' '); }
      function stem(w) { return w.length > 4 ? w.replace(/(ies|es|s)$/, '') : w; }
      cards.forEach(function (c, i) {
        c._order = i;
        c._title = norm(c.querySelector('h2').textContent);
        c._desc = norm((c.querySelector('p:not(.meta)') || {}).textContent) + ' ' + norm(c.dataset.category);
        c._head = norm(c.dataset.headings);
      });
      function score(c, words) {
        var total = 0;
        for (var i = 0; i < words.length; i++) {
          var w = words[i], s = 0;
          if (c._title.indexOf(w) !== -1) s = 3;
          else if (c._desc.indexOf(w) !== -1) s = 2;
          else if (c._head.indexOf(w) !== -1) s = 1;
          if (!s) return 0;
          total += s;
        }
        return total;
      }
      function render() {
        var words = norm(q).split(' ').filter(Boolean).map(stem);
        var matching = cards.filter(function (c) { return cat === 'all' || c.dataset.category === cat; });
        if (words.length) {
          matching = matching.map(function (c) { return { c: c, s: score(c, words) }; })
            .filter(function (x) { return x.s > 0; })
            .sort(function (a, b) { return b.s - a.s || a.c._order - b.c._order; })
            .map(function (x) { return x.c; });
        }
        // Results in ranked order; back to newest first when the search is cleared
        (words.length ? matching : cards).forEach(function (c) { grid.appendChild(c); });
        showStatus(words.length, matching.length);
        var pages = Math.max(1, Math.ceil(matching.length / PER));
        page = Math.min(Math.max(page, 1), pages);
        cards.forEach(function (c) { c.classList.toggle('hidden', matching.indexOf(c) === -1); c.classList.remove('off-page'); });
        matching.forEach(function (c, i) { if (i < (page - 1) * PER || i >= page * PER) c.classList.add('off-page'); });
        pager.innerHTML = '';
        pager.hidden = pages === 1;
        if (pages === 1) return;
        pager.appendChild(button('\u2039', page - 1, { aria: 'Previous page', disabled: page === 1 }));
        pageList(pages).forEach(function (p) {
          if (p === '…') { var g = document.createElement('span'); g.className = 'gap'; g.textContent = '…'; pager.appendChild(g); }
          else pager.appendChild(button(String(p), p, { current: p === page, aria: 'Page ' + p }));
        });
        pager.appendChild(button('\u203a', page + 1, { aria: 'Next page', disabled: page === pages }));
      }
      function showStatus(searching, n) {
        status.hidden = !searching;
        if (!searching) return;
        var where = cat === 'all' ? '' : ' in ' + cat;
        status.textContent = n
          ? n + (n === 1 ? ' article' : ' articles') + ' for \u201c' + q.trim() + '\u201d' + where
          : 'No articles for \u201c' + q.trim() + '\u201d' + where + '.';
        if (!n && cat !== 'all') status.appendChild(action('Search all topics', function () { cat = 'all'; markChip(); render(); remember(); }));
        status.appendChild(action('Clear search', clearSearch));
      }
      function action(label, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', fn);
        return b;
      }
      function clearSearch() { input.value = ''; onType(); input.focus(); }
      var typing, sent = '', sendTimer;
      function onType() {
        clearTimeout(typing);
        typing = setTimeout(function () {
          q = input.value;
          clearBtn.hidden = !q;
          page = 1;
          render();
          history.replaceState(null, '', address());
          // Tell GA what people look for once they stop typing (ideas for new articles)
          clearTimeout(sendTimer);
          sendTimer = setTimeout(function () {
            var term = q.trim().toLowerCase();
            if (term.length >= 3 && term !== sent && typeof gtag === 'function') {
              sent = term;
              gtag('event', 'search', { search_term: term, results: cards.filter(function (c) { return !c.classList.contains('hidden'); }).length });
            }
          }, 1500);
        }, 120);
      }
      if (input) {
        input.addEventListener('input', onType);
        input.addEventListener('keydown', function (e) { if (e.key === 'Escape' && input.value) { e.preventDefault(); clearSearch(); } });
        clearBtn.addEventListener('click', clearSearch);
        // "/" jumps to the search box, as on most sites with search
        document.addEventListener('keydown', function (e) {
          if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); input.focus(); }
        });
      }
      // bring the top of the list back into view after a topic or page change
      function toList() {
        var list = document.querySelector('.list-body');
        if (list && list.getBoundingClientRect().top < 0) window.scrollTo({ top: list.getBoundingClientRect().top + window.scrollY - 96, behavior: 'smooth' });
      }
      // The topic and page live in the address (#communication, #communication-p2,
      // #p2), so Back steps through them and a link opens the same view. The
      // part after # isn't sent to the server, so Google still sees one /blog.
      var btns = [].slice.call(document.querySelectorAll('.filter-btn'));
      function slug(c) { return c.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
      function hashFor() {
        var t = cat === 'all' ? '' : slug(cat);
        if (page > 1) t += (t ? '-' : '') + 'p' + page;
        return t ? '#' + t : '';
      }
      function readHash() {
        var h = decodeURIComponent(location.hash.slice(1));
        var m = h.match(/(?:^|-)p([0-9]+)$/);
        var t = m ? h.slice(0, m.index) : h;
        var found = btns.filter(function (b) { return b.dataset.category !== 'all' && slug(b.dataset.category) === t; })[0];
        cat = found ? found.dataset.category : 'all';
        page = m ? parseInt(m[1], 10) : 1;
      }
      function markChip() {
        btns.forEach(function (b) { b.classList.toggle('active', b.dataset.category === cat); });
      }
      // The search sits in ?q= (shareable; /blog stays the canonical page)
      function address() { return location.pathname + (q.trim() ? '?q=' + encodeURIComponent(q.trim()) : '') + hashFor(); }
      function remember() {
        var url = address();
        if (url !== location.pathname + location.search + location.hash) history.pushState(null, '', url);
      }
      btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          cat = btn.dataset.category;
          page = 1;
          markChip();
          render();
          remember();
          toList();
        });
      });
      // Page buttons call render() then toList(); record the new page in the address too
      pager.addEventListener('click', function (e) { if (e.target.closest('button')) remember(); });
      window.addEventListener('popstate', function () {
        readHash();
        if (input) { input.value = q = new URLSearchParams(location.search).get('q') || ''; clearBtn.hidden = !q; }
        markChip(); render(); toList();
      });

      readHash();
      var startQ = new URLSearchParams(location.search).get('q');
      if (startQ && input) { input.value = q = startQ; clearBtn.hidden = false; }
      markChip();
      render();
      // Opened with a topic or page in the address: start at the list
      if (location.hash) {
        var list = document.querySelector('.list-body');
        if (list) window.scrollTo(0, list.getBoundingClientRect().top + window.scrollY - 96);
      }
    })();
  </script>

</body>
</html>`;

// Static pages for the sitemap, in clean-URL form. Every URL here must
// be the page's canonical (automation/seo-check.js enforces it).
const STATIC_PAGES = [
  ['/', 'index.html'],
  ['/plan-builder/', 'plan-builder/index.html'],
  ['/best-co-parenting-apps/', 'best-co-parenting-apps/index.html'],
  ['/switch-from-ourfamilywizard/', 'switch-from-ourfamilywizard/index.html'],
  ['/court-ready-records/', 'court-ready-records/index.html'],
  ['/pricing/', 'pricing/index.html'],
  ['/how-it-works/', 'how-it-works/index.html'],
  ['/android/', 'android/index.html'],
  ['/verify/', 'verify/index.html'],
  ['/high-conflict-coparenting/', 'high-conflict-coparenting/index.html'],
  ['/co-parent-communication/', 'co-parent-communication/index.html'],
  ['/custody-schedule-help/', 'custody-schedule-help/index.html'],
  ['/co-parenting-expenses/', 'co-parenting-expenses/index.html'],
  ['/kids-and-divorce/', 'kids-and-divorce/index.html'],
  ['/mediation-prep/', 'mediation-prep/index.html'],
  ['/coparenting-alignment-guide/', 'coparenting-alignment-guide/index.html'],
  ['/communication-styles/', 'communication-styles/index.html'],
  ['/calculators/', 'calculators/index.html'],
  ['/calculators/support/california', 'calculators/support/california.html'],
  ['/calculators/support/florida', 'calculators/support/florida.html'],
  ['/calculators/support/illinois', 'calculators/support/illinois.html'],
  ['/calculators/support/new-york', 'calculators/support/new-york.html'],
  ['/calculators/support/pennsylvania', 'calculators/support/pennsylvania.html'],
  ['/calculators/support/texas', 'calculators/support/texas.html'],
  ['/blog', 'blog.html'],
  ['/faq', 'faq.html'],
  ['/contact', 'contact.html'],
  ['/professionals', 'professionals.html'],
  ['/privacy', 'privacy.html'],
  ['/terms', 'terms.html'],
];
// The support center's pages, listed by build-support.js
try {
  STATIC_PAGES.push(...JSON.parse(fs.readFileSync(path.join(__dirname, 'support/pages.json'), 'utf-8')));
} catch (e) {}

// Last time a file really changed, from git (falls back to today). A
// sitemap that stamps every URL with today's date teaches Google to
// ignore lastmod entirely.
function lastCommitDate(file) {
  try {
    const out = require('child_process')
      .execSync(`git log -1 --format=%cs -- "${file}"`, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch (e) {}
  return new Date().toISOString().split('T')[0];
}

async function build() {
  console.log('Fetching posts from Notion...');

  const posts = await fetchPosts();
  console.log(`Found ${posts.length} published posts`);

  // Create blog directory
  const blogDir = path.join(__dirname, 'blog');
  if (!fs.existsSync(blogDir)) {
    fs.mkdirSync(blogDir);
  }

  // Process each post
  const processedPosts = [];
  const seenSlugs = new Set();

  for (const page of posts) {
    const title = getProperty(page, 'Title');
    const seoTitleText = (getProperty(page, 'SEO Title') || '').trim();
    // A slug is a bare path segment: never ".html", never a slash.
    const slug = generateSlug(title, getProperty(page, 'Slug').trim())
      .replace(/\.html?$/i, '')
      .replace(/^\/+|\/+$/g, '')
      .replace(/^blog\//, '');
    if (MERGED_POSTS[slug]) {
      console.log(`  → Skipping "${title}": merged into /blog/${MERGED_POSTS[slug]}`);
      continue;
    }
    if (!slug || seenSlugs.has(slug)) {
      console.warn(`  ! Skipping "${title}": ${slug ? 'duplicate' : 'empty'} slug "${slug}"`);
      continue;
    }
    seenSlugs.add(slug);
    const rawDescription = getProperty(page, 'Description') || '';

    // SEO description: auto-fix bad descriptions so they never reach production
    const badPrefixes = ['Cover ', 'This post should', 'Explore the ', 'Write about'];
    const isBadDesc = badPrefixes.some(p => rawDescription.startsWith(p));
    let description;
    if (!rawDescription || isBadDesc) {
      // Generate a clean description from the title
      description = `${title}. Practical guidance for co-parents navigating separation and divorce.`;
      if (description.length > 155) {
        description = description.substring(0, 152).replace(/\s+\S*$/, '') + '...';
      }
      console.log(`  → Auto-generated description for: ${title}`);
    } else if (rawDescription.length > 155) {
      // Truncate at word boundary
      description = rawDescription.substring(0, 152).replace(/\s+\S*$/, '') + '...';
    } else {
      description = rawDescription;
    }
    const rawDate = getProperty(page, 'Date');
    const date = formatDate(rawDate);
    const dateISO = rawDate || new Date().toISOString().split('T')[0];
    const edited = (page.last_edited_time || '').split('T')[0];
    const rawCategory = getProperty(page, 'Category') || '';
    const category = rawCategory === 'Expenses' ? 'Money & Expenses' : rawCategory;

    console.log(`Processing: ${title} [${category || 'No category'}]`);

    // Get page content
    const blocks = await getPageContent(page.id);
    let content = blocksToHtml(blocks);
    content = wrapListItems(content);
    content = cleanInternalLinks(content);
    const wordCount = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    content = insertMidArticleCta(wrapTakeaways(content), category);

    const post = { title, seoTitle: seoTitleText, slug, description, date, dateISO, edited, content, category, wordCount };
    processedPosts.push(post);
  }

  // Last-modified dates. Notion bumps last_edited_time on every property edit,
  // so a bulk metadata change (SEO titles, descriptions, an import) stamps the
  // same day on dozens of posts and tells Google nothing. A date shared by many
  // posts counts as a bulk edit: those posts keep their publish date instead.
  const BULK_EDIT_MIN = 8;
  const editedCounts = {};
  processedPosts.forEach(p => { if (p.edited) editedCounts[p.edited] = (editedCounts[p.edited] || 0) + 1; });
  const bulkDates = new Set(Object.keys(editedCounts).filter(d => editedCounts[d] >= BULK_EDIT_MIN));
  if (bulkDates.size) console.log(`Bulk edit dates ignored for lastmod: ${[...bulkDates].sort().join(', ')}`);
  for (const p of processedPosts) {
    p.modifiedISO = p.edited && p.edited > p.dateISO && !bulkDates.has(p.edited) ? p.edited : p.dateISO;
    delete p.edited;
  }

  // Related articles for every post and "Further reading" for the guides, in one
  // pass so links are spread across all articles
  const linkPlan = buildLinkPlan(processedPosts, GUIDE_PAGES);
  const inboundCounts = [...linkPlan.inbound.values()];
  console.log(`Internal links per article (related + guides): min ${Math.min(...inboundCounts)}, max ${Math.max(...inboundCounts)}`);

  // Write individual post pages with related articles
  for (const post of processedPosts) {
    const relatedPosts = linkPlan.related.get(post.slug) || [];
    const postHtml = blogPostTemplate(post, relatedPosts);
    fs.writeFileSync(path.join(blogDir, `${post.slug}.html`), withoutEmDashes(postHtml));
    console.log(`  -> ${postPath(post.slug)}`);
  }

  // Guides: refresh their "Further reading" lists
  for (const g of GUIDE_PAGES) {
    const file = path.join(__dirname, g.file);
    const html = fs.readFileSync(file, 'utf8');
    const read = writeFurtherReading(html, linkPlan.pages.get(g.id));
    const next = read === null ? null : withoutEmDashes(read);
    if (next === null) { console.warn(`  ! ${g.file} has no further-reading markers`); continue; }
    if (next !== html) fs.writeFileSync(file, next);
    console.log(`  -> /${g.id}/ further reading (${(linkPlan.pages.get(g.id) || []).length})`);
  }

  // Write blog listing page
  const listHtml = blogListTemplate(processedPosts);
  fs.writeFileSync(path.join(__dirname, 'blog.html'), withoutEmDashes(listHtml));
  console.log('-> blog.html');

  // Generate sitemap.xml
  const newestPost = processedPosts.reduce((m, p) => (p.modifiedISO > m ? p.modifiedISO : m), '');
  const urlEntry = (loc, lastmod) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${STATIC_PAGES.map(([p, file]) => {
    let lastmod = lastCommitDate(file);
    if (p === '/blog' && newestPost > lastmod) lastmod = newestPost;
    return urlEntry(SITE + p, lastmod);
  }).join('\n')}
${processedPosts.map(post => urlEntry(postUrl(post.slug), post.modifiedISO)).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);
  console.log('-> sitemap.xml');

  // Generate RSS feed
  const rssDate = new Date().toUTCString();
  const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Common Ground - Clearly Blog</title>
    <description>Real topics, practical advice, and perspectives for co-parents. Custody schedules, communication strategies, and tips for calmer co-parenting.</description>
    <link>${BLOG_URL}</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <language>en-us</language>
    <lastBuildDate>${rssDate}</lastBuildDate>
    <image>
      <url>${SITE}/images/blog-og.png</url>
      <title>Common Ground - Clearly Blog</title>
      <link>${BLOG_URL}</link>
    </image>
${processedPosts.map(post => `    <item>
      <title>${escapeHtml(post.title)}</title>
      <description>${escapeHtml(post.description)}</description>
      <link>${postUrl(post.slug)}</link>
      <guid isPermaLink="true">${postUrl(post.slug)}</guid>
      <pubDate>${new Date(post.dateISO).toUTCString()}</pubDate>
      ${post.category ? `<category>${escapeHtml(post.category)}</category>` : ''}
    </item>`).join('\n')}
  </channel>
</rss>`;
  fs.writeFileSync(path.join(__dirname, 'feed.xml'), withoutEmDashes(rssFeed));
  console.log('-> feed.xml');

  console.log('Blog build complete!');

  // Ping IndexNow (Bing/Yandex/DuckDuckGo/etc.) so new & updated content
  // gets re-crawled in minutes. No-ops when INDEXNOW_KEY is unset.
  try {
    const indexnow = require('./automation/indexnow-ping');
    await indexnow.run();
  } catch (err) {
    console.warn('[indexnow] Module load failed (non-fatal):', err.message);
  }
}

build().catch(err => {
  console.error('Blog build failed:', err);
  process.exit(1);
});
