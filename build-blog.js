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

// Rewrite internal links that still carry ".html" (e.g. links typed into
// Notion posts) to the clean form so they never point at a redirect.
function cleanInternalLinks(html) {
  return html.replace(
    /href="(https:\/\/(?:www\.)?getclearly\.app)?(\/[^"#?]*?)\.html([#?][^"]*)?"/g,
    (m, origin, p, rest) => {
      const clean = p.endsWith('/index') ? p.slice(0, -5) : p;
      return `href="${origin ? SITE : ''}${clean || '/'}${rest || ''}"`;
    }
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
// match the homepage (tone check, record kept as written, shared calendar,
// expense splits, 14-day trial, co-parent joins free).
const CTA_COPY = {
  'High-Conflict Situations': {
    kicker: 'When every message matters',
    text: 'Clearly is a co-parenting app that checks the tone before you post and keeps every message on the record exactly as written.'
  },
  'Communication': {
    kicker: 'Say it once, calmly',
    text: 'Clearly is a co-parenting app that checks the tone of your message before you post and suggests calmer wording. You choose what to send.'
  },
  'Schedules & Custody': {
    kicker: 'One calendar you both trust',
    text: 'Clearly is a co-parenting app that keeps your custody schedule, holidays and swap requests in one shared calendar.'
  },
  'Money & Expenses': {
    kicker: 'Money, settled',
    text: 'Clearly is a co-parenting app that works out each parent\u2019s share of every shared expense from the split you agreed.'
  },
  'Legal Basics': {
    kicker: 'A record you can rely on',
    text: 'Clearly is a co-parenting app that keeps your messages, agreements and schedule changes preserved, timestamped and exportable.'
  },
  default: {
    kicker: 'Co-parenting, resolved',
    text: 'Clearly is a co-parenting app that checks the tone before you post, helps you both reach an answer, and keeps the schedule, expenses and plan in one place.'
  }
};
CTA_COPY['Expenses'] = CTA_COPY['Money & Expenses'];
const ctaFor = category => CTA_COPY[category] || CTA_COPY.default;
const CTA_FINE_PRINT = '14-day free trial · Your co-parent joins free';

// The App Store badge, same markup and styles (.app-badge in styles.css) as
// the header badge.
const appStoreBadge = cta => `<a href="${APP_STORE_URL}" class="app-badge" data-cta="${cta}" aria-label="Download Clearly on the App Store">
    <svg width="22" height="26" viewBox="0 0 22 26" fill="none" aria-hidden="true"><path d="M18.05 13.77C18.03 11.09 19.77 9.79 19.86 9.73C18.85 8.27 17.29 8.07 16.74 8.05C15.4 7.91 14.1 8.84 13.42 8.84C12.72 8.84 11.67 8.07 10.55 8.09C9.09 8.11 7.72 8.94 6.97 10.23C5.42 12.85 6.57 16.72 8.06 18.85C8.81 19.89 9.69 21.06 10.85 21.01C11.99 20.96 12.41 20.29 13.77 20.29C15.11 20.29 15.51 21.01 16.69 20.98C17.91 20.96 18.68 19.93 19.41 18.88C20.27 17.69 20.62 16.52 20.63 16.46C20.6 16.45 18.07 15.47 18.05 13.77Z" fill="white"/><path d="M15.87 6.54C16.47 5.81 16.87 4.81 16.76 3.8C15.89 3.83 14.8 4.38 14.17 5.09C13.61 5.72 13.12 6.74 13.25 7.72C14.22 7.79 15.25 7.26 15.87 6.54Z" fill="white"/></svg>
    <div class="badge-text"><span class="badge-small">Download on the</span><span class="badge-large">App Store</span></div>
  </a>`;

// A quiet one-line mention partway through the post: what Clearly is, and
// the badge. No heading, so it reads as an aside rather than an ad.
function midArticleCta(category) {
  return `<aside class="inline-cta" aria-label="About Clearly">
  <p>${ctaFor(category).text}</p>
  ${appStoreBadge('mid-article')}
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

const STOPWORDS = new Set('a an and are as at be but by can co do does for from how if in into is it its kids child children your you when what with to the of on or not parent parents parenting co-parent co-parenting coparenting without who why their them they this that'.split(' '));
const keywords = text => new Set(text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w)));

// Related posts: shared title keywords count most, same category breaks ties.
function pickRelated(post, all, n = 3) {
  const mine = keywords(post.title);
  return all
    .filter(p => p.slug !== post.slug)
    .map(p => {
      let score = 0;
      for (const w of keywords(p.title)) if (mine.has(w)) score += 3;
      if (p.category && p.category === post.category) score += 2;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score || (a.p.dateISO < b.p.dateISO ? 1 : -1))
    .slice(0, n)
    .map(x => x.p);
}

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
    gtag('config', 'G-DYZ1XEXPMT');
  </script>
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
    :root { --paper: #F6F5F1; --ink: #1C1C1A; --ink-mid: #4A4A47; --ink-faint: #6B6B67; --moss: #0D8268; --moss-pale: #E4F4EF; --rule: rgba(28,28,26,0.10); }
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
    .blog-cta { margin: 64px 0 0; background: var(--moss); border-radius: 22px; padding: 48px 40px; text-align: center; color: #FFFFFF; }
    .blog-cta .blog-cta-kicker { font-family: 'EB Garamond', serif; font-size: 30px; line-height: 1.2; margin: 0 0 12px; color: #FFFFFF; }
    .blog-cta p { font-size: 16px; line-height: 1.6; color: rgba(255,255,255,0.85); margin: 0 auto 28px; max-width: 34em; }
    .blog-cta .blog-cta-fine { font-size: 13px; color: rgba(255,255,255,0.7); margin: 18px 0 0; }
    .blog-cta .blog-cta-secondary { color: #FFFFFF; font-weight: 500; }

    /* Related articles */
    .related-panel { margin: 0 16px 16px; background: #FFFFFF; border-radius: 28px; padding: 72px 40px; }
    .related-inner { max-width: 1080px; margin: 0 auto; }
    .related-panel .label { font-size: 12px; font-weight: 500; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 24px; }
    .related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
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
      <div class="blog-cta final-cta">
        <p class="blog-cta-kicker">${ctaFor(post.category).kicker}</p>
        <p>${ctaFor(post.category).text}</p>
        ${appStoreBadge('end-of-article')}
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
  return `<aside class="topics" aria-label="Topics">
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
    gtag('config', 'G-DYZ1XEXPMT');
  </script>
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
      "name": "Clearly LLC",
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
    :root { --paper: #F6F5F1; --ink: #1C1C1A; --ink-mid: #4A4A47; --ink-faint: #6B6B67; --moss: #0D8268; --moss-pale: #E4F4EF; --rule: rgba(28,28,26,0.10); }
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

    @media (max-width: 960px) {
      .list-body { display: block; padding-top: 24px; }
      .topics { position: static; margin: 0 0 28px; }
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
        ${posts.map((post, i) => `
        <article class="blog-card" data-category="${escapeHtml(post.category)}">
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
      function render() {
        var matching = cards.filter(function (c) { return cat === 'all' || c.dataset.category === cat; });
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
      // bring the top of the list back into view after a topic or page change
      function toList() {
        var list = document.querySelector('.list-body');
        if (list && list.getBoundingClientRect().top < 0) window.scrollTo({ top: list.getBoundingClientRect().top + window.scrollY - 96, behavior: 'smooth' });
      }
      document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          cat = btn.dataset.category;
          page = 1;
          render();
          toList();
        });
      });
      render();
    })();
  </script>

</body>
</html>`;

// Static pages for the sitemap, in clean-URL form. Every URL here must
// be the page's canonical (automation/seo-check.js enforces it).
const STATIC_PAGES = [
  ['/', 'index.html'],
  ['/plan-builder/', 'plan-builder/index.html'],
  ['/best-co-parenting-apps-2026/', 'best-co-parenting-apps-2026/index.html'],
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
  ['/help', 'help.html'],
  ['/contact', 'contact.html'],
  ['/professionals', 'professionals.html'],
  ['/privacy', 'privacy.html'],
  ['/terms', 'terms.html'],
];

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
    const modifiedISO = edited && edited > dateISO ? edited : dateISO;
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

    const post = { title, seoTitle: seoTitleText, slug, description, date, dateISO, modifiedISO, content, category, wordCount };
    processedPosts.push(post);
  }

  // Write individual post pages with related articles
  for (const post of processedPosts) {
    const relatedPosts = pickRelated(post, processedPosts);
    const postHtml = blogPostTemplate(post, relatedPosts);
    fs.writeFileSync(path.join(blogDir, `${post.slug}.html`), postHtml);
    console.log(`  -> ${postPath(post.slug)}`);
  }

  // Write blog listing page
  const listHtml = blogListTemplate(processedPosts);
  fs.writeFileSync(path.join(__dirname, 'blog.html'), listHtml);
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
  fs.writeFileSync(path.join(__dirname, 'feed.xml'), rssFeed);
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
