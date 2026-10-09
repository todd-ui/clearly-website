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

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
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
    text: 'Clearly checks the tone before you post and keeps every message on the record exactly as written, preserved and timestamped. The conversation stays about the kids.'
  },
  'Communication': {
    kicker: 'Say it once, calmly',
    text: 'Clearly checks the tone of your message before you post and suggests calmer wording. You choose what to send.'
  },
  'Schedules & Custody': {
    kicker: 'One calendar you both trust',
    text: 'Clearly keeps your custody schedule, holidays and swap requests in one shared calendar, with every change documented.'
  },
  'Money & Expenses': {
    kicker: 'Money, settled',
    text: 'Log a shared expense once and Clearly works out each parent’s share from the split you agreed. No spreadsheets, no back-and-forth.'
  },
  'Legal Basics': {
    kicker: 'A record you can rely on',
    text: 'Clearly keeps your messages, agreements and schedule changes preserved and timestamped, and your records stay exportable.'
  },
  default: {
    kicker: 'Co-parenting, resolved',
    text: 'Clearly is a co-parenting app that checks the tone before you post, helps you both reach an answer, and keeps the schedule, expenses and plan in one place.'
  }
};
CTA_COPY['Expenses'] = CTA_COPY['Money & Expenses'];
const ctaFor = category => CTA_COPY[category] || CTA_COPY.default;
const CTA_FINE_PRINT = '14-day free trial · Your co-parent joins free';

const appStoreIcon = `<svg width="18" height="21" viewBox="0 0 22 26" fill="none" aria-hidden="true"><path d="M18.05 13.77C18.03 11.09 19.77 9.79 19.86 9.73C18.85 8.27 17.29 8.07 16.74 8.05C15.4 7.91 14.1 8.84 13.42 8.84C12.72 8.84 11.67 8.07 10.55 8.09C9.09 8.11 7.72 8.94 6.97 10.23C5.42 12.85 6.57 16.72 8.06 18.85C8.81 19.89 9.69 21.06 10.85 21.01C11.99 20.96 12.41 20.29 13.77 20.29C15.11 20.29 15.51 21.01 16.69 20.98C17.91 20.96 18.68 19.93 19.41 18.88C20.27 17.69 20.62 16.52 20.63 16.46C20.6 16.45 18.07 15.47 18.05 13.77Z" fill="currentColor"/><path d="M15.87 6.54C16.47 5.81 16.87 4.81 16.76 3.8C15.89 3.83 14.8 4.38 14.17 5.09C13.61 5.72 13.12 6.74 13.25 7.72C14.22 7.79 15.25 7.26 15.87 6.54Z" fill="currentColor"/></svg>`;

function midArticleCta(category) {
  const c = ctaFor(category);
  return `<aside class="inline-cta" aria-label="About Clearly">
  <p class="inline-cta-kicker">${c.kicker}</p>
  <p>${c.text}</p>
  <a href="${APP_STORE_URL}" data-cta="mid-article">${appStoreIcon} Try Clearly free</a>
</aside>`;
}

// Put the inline CTA before the third section (or the second, for short
// posts) so mobile readers see it long before the end of the article.
function insertMidArticleCta(content, category) {
  const h2s = [...content.matchAll(/<h2>/g)].map(m => m.index);
  if (h2s.length < 2) return content;
  const at = h2s[h2s.length >= 4 ? 2 : 1];
  return content.slice(0, at) + midArticleCta(category) + '\n' + content.slice(at);
}

// "<title>" is what shows in Google; keep it under ~60 characters.
function seoTitle(title) {
  const branded = `${title} | Clearly`;
  return branded.length <= 60 ? branded : title;
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
  <title>${escapeHtml(seoTitle(post.title))}</title>
  <meta name="description" content="${escapeHtml(post.description)}">
  <link rel="canonical" href="${postUrl(post.slug)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${postUrl(post.slug)}">
  <meta property="article:published_time" content="${post.dateISO}">
  <meta property="article:modified_time" content="${post.modifiedISO || post.dateISO}">${post.category ? `
  <meta property="article:section" content="${escapeHtml(post.category)}">` : ''}
  <meta property="og:title" content="${escapeHtml(post.title)}">
  <meta property="og:description" content="${escapeHtml(post.description)}">
  <meta property="og:image" content="https://getclearly.app/images/blog-og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Clearly.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(post.title)}">
  <meta name="twitter:description" content="${escapeHtml(post.description)}">
  <meta name="twitter:image" content="https://getclearly.app/images/blog-og.png">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="alternate" type="application/rss+xml" title="Clearly Blog RSS Feed" href="https://getclearly.app/feed.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Instrument+Sans:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../styles.css">
  <link rel="stylesheet" href="/styles/brand.css">
  <link rel="icon" href="/images/favicon-32.png">
  <link rel="manifest" href="/manifest.json">
  <style>
    .blog-post { max-width: 720px; margin: 0 auto; padding: 120px 24px 80px; }
    .blog-post-header { margin-bottom: 48px; }
    .blog-post-title { font-size: 42px; font-weight: 400; line-height: 1.2; margin-bottom: 16px; }
    .blog-post-meta { color: var(--text-muted); font-size: 15px; }
    .blog-post-content h2 { font-size: 28px; margin: 48px 0 16px; }
    .blog-post-content h3 { font-size: 22px; margin: 32px 0 12px; }
    .blog-post-content p { font-size: 17px; line-height: 1.8; margin-bottom: 24px; color: var(--text-secondary); }
    .blog-post-content ul, .blog-post-content ol { margin: 0 0 24px 24px; }
    .blog-post-content li { font-size: 17px; line-height: 1.8; margin-bottom: 8px; color: var(--text-secondary); }
    .blog-post-content blockquote { border-left: 4px solid var(--primary); padding-left: 24px; margin: 32px 0; font-style: italic; color: var(--text-secondary); }
    .blog-post-content figure { margin: 32px 0; }
    .blog-post-content img { max-width: 100%; border-radius: 12px; }
    .blog-post-content figcaption { text-align: center; font-size: 14px; color: var(--text-muted); margin-top: 8px; }
    .blog-post-content a { color: var(--primary); }
    .back-link { display: inline-block; margin-bottom: 32px; color: var(--primary); font-weight: 500; }
    .back-link:hover { text-decoration: none; }

    /* Share Buttons */
    .share-buttons { display: flex; align-items: center; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
    .share-buttons span { font-size: 14px; color: var(--text-muted); font-weight: 500; }
    .share-btn { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: var(--bg-secondary); border: 1px solid var(--border); color: var(--text-secondary); transition: all 0.2s ease; cursor: pointer; }
    .share-btn:hover { background: var(--primary); color: white; border-color: var(--primary); }
    .share-btn svg { width: 16px; height: 16px; }
    .share-btn.copied { background: var(--primary); color: white; border-color: var(--primary); }

    /* Calls to action */
    .blog-cta { background: var(--primary-soft); border-radius: 16px; padding: 32px; margin: 48px 0; text-align: center; }
    .blog-cta p { font-size: 17px; line-height: 1.6; color: var(--text); margin: 0 0 20px; }
    .blog-cta .blog-cta-kicker, .inline-cta .inline-cta-kicker { font-family: 'EB Garamond', serif; font-size: 24px; line-height: 1.3; margin-bottom: 8px; color: var(--text); }
    .blog-cta > a, .inline-cta > a { display: inline-flex; align-items: center; gap: 10px; background: var(--primary); color: #fff; padding: 14px 24px; border-radius: 10px; font-size: 15px; font-weight: 600; transition: background 0.2s; }
    .blog-cta > a:hover, .inline-cta > a:hover { background: var(--primary-dark, #0a6b55); text-decoration: none; }
    .blog-cta .blog-cta-fine { font-size: 14px; color: var(--text-muted); margin: 16px 0 0; }
    .blog-cta .blog-cta-secondary { color: var(--primary); font-weight: 500; }
    .inline-cta { border: 1px solid var(--border); border-left: 4px solid var(--primary); border-radius: 12px; padding: 24px; margin: 40px 0; background: var(--surface, #fff); }
    .blog-post-content .inline-cta p { font-size: 16px; line-height: 1.6; margin: 0 0 16px; color: var(--text-secondary); }
    .blog-post-content .inline-cta .inline-cta-kicker { font-size: 22px; line-height: 1.3; color: var(--text); margin-bottom: 8px; }
    .blog-post-content .inline-cta > a { color: #fff; }
    @media (max-width: 768px) {
      .blog-post { padding-top: 96px; }
      .blog-post-title { font-size: 34px; }
      .blog-cta { padding: 24px 20px; }
      .blog-cta > a, .inline-cta > a { width: 100%; justify-content: center; }
    }

    /* Related Articles */
    .related-articles { background: var(--surface); padding: 80px 0; border-top: 1px solid var(--border); }
    .related-articles h2 { font-size: 28px; font-weight: 400; margin-bottom: 32px; text-align: center; }
    .related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; max-width: 960px; margin: 0 auto; }
    .related-card { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; text-decoration: none; transition: transform 0.2s, box-shadow 0.2s; }
    .related-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.08); text-decoration: none; }
    .related-card h3 { font-size: 18px; font-weight: 400; color: var(--text); margin-bottom: 8px; line-height: 1.4; }
    .related-card p { font-size: 14px; color: var(--text-secondary); line-height: 1.6; margin: 0; }
    .related-category { display: inline-block; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; margin-bottom: 12px; background: rgba(13, 130, 104, 0.1); color: #0d9373; }
    .related-category[data-cat="Communication"] { background: rgba(59, 130, 246, 0.1); color: #2563eb; }
    .related-category[data-cat="Co-Parenting Basics"] { background: rgba(13, 147, 115, 0.1); color: #0d9373; }
    .related-category[data-cat="Your Children"] { background: rgba(168, 85, 247, 0.1); color: #9333ea; }
    .related-category[data-cat="Schedules & Custody"] { background: rgba(245, 158, 11, 0.1); color: #d97706; }
    .related-category[data-cat="High-Conflict Situations"] { background: rgba(239, 68, 68, 0.1); color: #dc2626; }
    .related-category[data-cat="Money & Expenses"] { background: rgba(16, 185, 129, 0.1); color: #059669; }
    .related-category[data-cat="Blended Families"] { background: rgba(236, 72, 153, 0.1); color: #db2777; }
    .related-category[data-cat="Self-Care & Support"] { background: rgba(99, 102, 241, 0.1); color: #4f46e5; }
    .related-category[data-cat="Legal Basics"] { background: rgba(107, 114, 128, 0.1); color: #4b5563; }
    @media (max-width: 768px) {
      .related-grid { grid-template-columns: 1fr; }
      .related-articles { padding: 60px 24px; }
    }
  </style>
</head>
<body>
  ${headerPartial}

  <article class="blog-post" id="main-content">
    <a href="/blog" class="back-link">&larr; Back to Blog</a>
    <header class="blog-post-header">
      <h1 class="blog-post-title">${escapeHtml(post.title)}</h1>
      <p class="blog-post-meta">By The Clearly Team &middot; ${post.date}</p>
      <div class="share-buttons">
        <span>Share:</span>
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
    </header>
    <div class="blog-post-content">
      ${post.content}
    </div>
    <div class="blog-cta">
      <p class="blog-cta-kicker">${ctaFor(post.category).kicker}</p>
      <p>${ctaFor(post.category).text}</p>
      <a href="${APP_STORE_URL}" data-cta="end-of-article">${appStoreIcon} Download on the App Store</a>
      <p class="blog-cta-fine">${CTA_FINE_PRINT} &middot; <a href="/plan-builder/" class="blog-cta-secondary">Or build a free parenting plan</a></p>
    </div>
  </article>

  ${relatedPosts.length > 0 ? `
  <section class="related-articles">
    <div class="container">
      <h2>Related Articles</h2>
      <div class="related-grid">
        ${relatedPosts.map(p => `
        <a href="${postPath(p.slug)}" class="related-card">
          <span class="related-category" data-cat="${p.category}">${p.category || 'Article'}</span>
          <h3>${escapeHtml(p.title)}</h3>
          <p>${escapeHtml(p.description.substring(0, 120))}${p.description.length > 120 ? '...' : ''}</p>
        </a>
        `).join('')}
      </div>
    </div>
  </section>
  ` : ''}

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
  <title>Common Ground - Co-Parenting Tips & Advice | Clearly</title>
  <meta name="description" content="Real topics, practical advice, and perspectives for co-parents. Custody schedules, communication strategies, and tips for calmer co-parenting.">
  <link rel="canonical" href="${BLOG_URL}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${BLOG_URL}">
  <meta property="og:title" content="Common Ground - Co-Parenting Tips & Advice">
  <meta property="og:description" content="Real topics, practical advice, and perspectives for co-parents.">
  <meta property="og:image" content="https://getclearly.app/images/blog-og.png">
  <meta property="og:site_name" content="Clearly.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Common Ground - Co-Parenting Tips & Advice">
  <meta name="twitter:description" content="Real topics, practical advice, and perspectives for co-parents.">
  <meta name="twitter:image" content="https://getclearly.app/images/blog-og.png">
  <meta name="robots" content="index, follow">
  <meta name="keywords" content="co-parenting tips, custody advice, shared parenting, divorce resources, co-parent communication">
  <link rel="alternate" type="application/rss+xml" title="Clearly Blog RSS Feed" href="https://getclearly.app/feed.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Instrument+Sans:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="/styles/brand.css">
  <link rel="icon" href="/images/favicon-32.png">
  <link rel="manifest" href="/manifest.json">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": "Common Ground",
    "description": "Real topics, practical advice, and perspectives for co-parents. Custody schedules, communication strategies, and tips for calmer co-parenting.",
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
    .blog-hero {
      padding: 100px 0 80px;
      background: linear-gradient(135deg, #f0faf7 0%, #e8f5f1 50%, #f8fdfb 100%);
      position: relative;
      overflow: hidden;
    }
    .blog-hero::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -20%;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(13, 147, 115, 0.08) 0%, transparent 70%);
      border-radius: 50%;
    }
    .blog-hero::after {
      content: '';
      position: absolute;
      bottom: -30%;
      left: -10%;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(13, 147, 115, 0.05) 0%, transparent 70%);
      border-radius: 50%;
    }
    .blog-hero .container {
      position: relative;
      z-index: 1;
      text-align: center;
      max-width: 700px;
    }
    .blog-hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: white;
      border: 1px solid var(--border);
      border-radius: 100px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary);
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .blog-hero-badge svg {
      width: 16px;
      height: 16px;
    }
    .blog-hero h1 {
      font-size: 44px;
      font-weight: 400;
      color: var(--text);
      margin-bottom: 8px;
      line-height: 1.2;
    }
    .blog-hero-subtitle {
      font-size: 22px;
      font-weight: 500;
      color: var(--primary);
      margin-bottom: 20px;
    }
    .blog-hero p {
      font-size: 17px;
      color: var(--text-secondary);
      line-height: 1.7;
    }
    .blog-section {
      padding: 60px 0 100px;
    }
    @media (max-width: 768px) {
      .blog-hero { padding: 80px 0 50px; }
      .blog-hero h1 { font-size: 32px; }
    }
    .blog-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 28px;
    }
    .blog-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px;
      transition: box-shadow 0.3s, transform 0.3s;
    }
    .blog-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.08);
    }
    .blog-card-icon {
      width: 56px;
      height: 56px;
      background: var(--primary-soft);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }
    .blog-card-icon svg {
      width: 28px;
      height: 28px;
      color: var(--primary);
    }
    .blog-card-date {
      font-size: 13px;
      font-weight: 500;
      color: var(--primary);
      margin-bottom: 10px;
    }
    .blog-card h2 {
      font-size: 20px;
      font-weight: 400;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .blog-card h2 a {
      color: var(--text);
    }
    .blog-card h2 a:hover {
      color: var(--primary);
      text-decoration: none;
    }
    .blog-card p {
      font-size: 15px;
      color: var(--text-secondary);
      line-height: 1.7;
      margin-bottom: 20px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .blog-card-link {
      font-size: 14px;
      font-weight: 600;
      color: var(--primary);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .blog-card-link:hover {
      text-decoration: none;
    }
    .blog-card-link svg {
      width: 18px;
      height: 18px;
      transition: transform 0.2s;
    }
    .blog-card:hover .blog-card-link svg {
      transform: translateX(4px);
    }
    .no-posts {
      text-align: center;
      padding: 80px 0;
      color: var(--text-secondary);
    }
    @media (max-width: 768px) {
      .blog-grid { grid-template-columns: 1fr; }
    }
    /* Category Filter */
    .blog-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 32px;
      justify-content: center;
    }
    .filter-btn {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 100px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-btn:hover {
      border-color: var(--primary);
      color: var(--primary);
    }
    .filter-btn.active {
      background: var(--primary);
      border-color: var(--primary);
      color: white;
    }
    /* Category Chip */
    .blog-card-category {
      display: inline-block;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 100px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .blog-card-category[data-cat="Communication"] {
      background: rgba(59, 130, 246, 0.1);
      color: #2563eb;
    }
    .blog-card-category[data-cat="Co-Parenting Basics"] {
      background: rgba(13, 147, 115, 0.1);
      color: #0d9373;
    }
    .blog-card-category[data-cat="Your Children"] {
      background: rgba(168, 85, 247, 0.1);
      color: #9333ea;
    }
    .blog-card-category[data-cat="Schedules & Custody"] {
      background: rgba(245, 158, 11, 0.1);
      color: #d97706;
    }
    .blog-card-category[data-cat="High-Conflict Situations"] {
      background: rgba(239, 68, 68, 0.1);
      color: #dc2626;
    }
    .blog-card-category[data-cat="Money & Expenses"] {
      background: rgba(16, 185, 129, 0.1);
      color: #059669;
    }
    .blog-card-category[data-cat="Blended Families"] {
      background: rgba(236, 72, 153, 0.1);
      color: #db2777;
    }
    .blog-card-category[data-cat="Self-Care & Support"] {
      background: rgba(99, 102, 241, 0.1);
      color: #4f46e5;
    }
    .blog-card-category[data-cat="Legal Basics"] {
      background: rgba(107, 114, 128, 0.1);
      color: #4b5563;
    }
    .blog-card.hidden {
      display: none;
    }
  </style>
</head>
<body>
  ${headerPartial}

  <header class="blog-hero" id="main-content">
    <div class="container">
      <div class="blog-hero-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
        Clearly Blog
      </div>
      <h1>Common Ground</h1>
      <p class="blog-hero-subtitle">Ideas for calmer co-parenting.</p>
      <p>Co-parenting brings enough complexity on its own. Common Ground is here to make the communication part a little easier — with real topics, practical advice, and perspectives from people who get it. Whether you're figuring out schedules, navigating tricky conversations, or just looking for a calmer way forward, you're in the right place.</p>
    </div>
  </header>

  <section class="blog-section">
    <div class="container">
      ${posts.length > 0 ? `
      <div class="blog-filters">
        <button class="filter-btn active" data-category="all">All</button>
        ${[...new Set(posts.map(p => p.category).filter(c => c))].map(cat => `
        <button class="filter-btn" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
        `).join('')}
      </div>
      <div class="blog-grid">
        ${posts.map(post => `
        <article class="blog-card" data-category="${escapeHtml(post.category)}">
          ${post.category ? `<span class="blog-card-category" data-cat="${escapeHtml(post.category)}">${escapeHtml(post.category)}</span>` : ''}
          <div class="blog-card-date">${post.date}</div>
          <h2><a href="${postPath(post.slug)}">${escapeHtml(post.title)}</a></h2>
          <p>${escapeHtml(post.description)}</p>
          <a href="${postPath(post.slug)}" class="blog-card-link">
            Read article
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </a>
        </article>
        `).join('')}
      </div>
      ` : `
      <div class="no-posts">
        <p>New articles coming soon.</p>
      </div>
      `}
    </div>
  </section>

  ${footerPartial}

  <script>
    // Category filtering
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const category = btn.dataset.category;

        // Update active button
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Filter cards
        document.querySelectorAll('.blog-card').forEach(card => {
          if (category === 'all' || card.dataset.category === category) {
            card.classList.remove('hidden');
          } else {
            card.classList.add('hidden');
          }
        });
      });
    });
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
    const category = getProperty(page, 'Category') || '';

    console.log(`Processing: ${title} [${category || 'No category'}]`);

    // Get page content
    const blocks = await getPageContent(page.id);
    let content = blocksToHtml(blocks);
    content = wrapListItems(content);
    content = cleanInternalLinks(content);
    const wordCount = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    content = insertMidArticleCta(content, category);

    const post = { title, slug, description, date, dateISO, modifiedISO, content, category, wordCount };
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
