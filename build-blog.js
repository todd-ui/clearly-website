const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = '2df435a853a58014b9e9dc6ac1cbba09';

// Load partials
const headerPartial = fs.readFileSync(path.join(__dirname, '_partials/header.html'), 'utf-8').trim();
const footerPartial = fs.readFileSync(path.join(__dirname, '_partials/footer.html'), 'utf-8').trim();

async function fetchPosts() {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: 'Published',
      checkbox: { equals: true }
    },
    sorts: [{ property: 'Date', direction: 'descending' }]
  });
  return response.results;
}

async function getPageContent(pageId) {
  const blocks = await notion.blocks.children.list({ block_id: pageId });
  return blocks.results;
}

function blocksToHtml(blocks) {
  return blocks.map(block => {
    switch (block.type) {
      case 'paragraph':
        const text = block.paragraph.rich_text.map(t => {
          let content = escapeHtml(t.plain_text);
          if (t.annotations.bold) content = `<strong>${content}</strong>`;
          if (t.annotations.italic) content = `<em>${content}</em>`;
          if (t.href) content = `<a href="${t.href}">${content}</a>`;
          return content;
        }).join('');
        return text ? `<p>${text}</p>` : '';

      case 'heading_1':
        return `<h1>${richTextToHtml(block.heading_1.rich_text)}</h1>`;

      case 'heading_2':
        return `<h2>${richTextToHtml(block.heading_2.rich_text)}</h2>`;

      case 'heading_3':
        return `<h3>${richTextToHtml(block.heading_3.rich_text)}</h3>`;

      case 'bulleted_list_item':
        return `<li>${richTextToHtml(block.bulleted_list_item.rich_text)}</li>`;

      case 'numbered_list_item':
        return `<li>${richTextToHtml(block.numbered_list_item.rich_text)}</li>`;

      case 'quote':
        return `<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>`;

      case 'divider':
        return '<hr>';

      case 'image':
        const url = block.image.type === 'external'
          ? block.image.external.url
          : block.image.file.url;
        const caption = block.image.caption?.map(c => c.plain_text).join('') || '';
        return `<figure><img src="${url}" alt="${escapeHtml(caption)}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;

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
  // Wrap consecutive <li> items in <ul> tags
  return html.replace(/(<li>.*?<\/li>\n?)+/g, match => `<ul>${match}</ul>`);
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

const blogPostTemplate = (post, relatedPosts = []) => `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Preconnect hints for performance -->
  <link rel="preconnect" href="https://www.googletagmanager.com">
  <link rel="preconnect" href="https://dwncravjhkbclbuzijra.supabase.co">

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
  <title>${escapeHtml(post.title)} | Clearly Blog</title>
  <meta name="description" content="${escapeHtml(post.description)}">
  <link rel="canonical" href="https://getclearly.app/blog/${post.slug}.html">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://getclearly.app/blog/${post.slug}.html">
  <meta property="og:title" content="${escapeHtml(post.title)}">
  <meta property="og:description" content="${escapeHtml(post.description)}">
  <meta property="og:image" content="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png">
  <meta property="og:site_name" content="Clearly">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(post.title)}">
  <meta name="twitter:description" content="${escapeHtml(post.description)}">
  <meta name="twitter:image" content="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png">
  <meta name="robots" content="index, follow">
  <link rel="stylesheet" href="../styles.css">
  <link rel="icon" href="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/favicon.png">
  <style>
    .blog-post { max-width: 720px; margin: 0 auto; padding: 120px 24px 80px; }
    .blog-post-header { margin-bottom: 48px; }
    .blog-post-title { font-size: 42px; font-weight: 700; line-height: 1.2; margin-bottom: 16px; }
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

    /* Blog CTA Module */
    .blog-cta {
      background: var(--primary-soft);
      border-radius: 16px;
      padding: 32px;
      margin: 48px 0;
      text-align: center;
    }
    .blog-cta p {
      font-size: 17px;
      color: var(--text);
      margin: 0 0 16px 0;
      font-weight: 500;
    }
    .blog-cta a {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--primary);
      color: white;
      padding: 14px 24px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .blog-cta a:hover {
      background: var(--primary-dark, #0a6b55);
      text-decoration: none;
    }

    /* Related Articles */
    .related-articles { background: var(--surface); padding: 80px 0; border-top: 1px solid var(--border); }
    .related-articles h2 { font-size: 28px; font-weight: 700; margin-bottom: 32px; text-align: center; }
    .related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; max-width: 960px; margin: 0 auto; }
    .related-card { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; text-decoration: none; transition: transform 0.2s, box-shadow 0.2s; }
    .related-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.08); text-decoration: none; }
    .related-card h3 { font-size: 18px; font-weight: 600; color: var(--text); margin-bottom: 8px; line-height: 1.4; }
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

  <article class="blog-post">
    <a href="/blog.html" class="back-link">&larr; Back to Blog</a>
    <header class="blog-post-header">
      <h1 class="blog-post-title">${escapeHtml(post.title)}</h1>
      <p class="blog-post-meta">${post.date}</p>
      <div class="share-buttons">
        <span>Share:</span>
        <button class="share-btn" onclick="copyLink()" title="Copy link" id="copy-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
        </button>
        <a class="share-btn" href="https://twitter.com/intent/tweet?url=https://getclearly.app/blog/${post.slug}.html&text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener" title="Share on X">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <a class="share-btn" href="https://www.facebook.com/sharer/sharer.php?u=https://getclearly.app/blog/${post.slug}.html" target="_blank" rel="noopener" title="Share on Facebook">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
        </a>
        <a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=https://getclearly.app/blog/${post.slug}.html" target="_blank" rel="noopener" title="Share on LinkedIn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        </a>
        <a class="share-btn" href="mailto:?subject=${encodeURIComponent(post.title)}&body=I thought you might find this helpful: https://getclearly.app/blog/${post.slug}.html" title="Share via Email">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
        </a>
      </div>
    </header>
    <div class="blog-post-content">
      ${post.content}
    </div>
    <div class="blog-cta">
      <p>Ready to put this into practice?</p>
      <a href="/plan-builder/">
        Start building your parenting plan
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
      </a>
    </div>
  </article>

  ${relatedPosts.length > 0 ? `
  <section class="related-articles">
    <div class="container">
      <h2>Related Articles</h2>
      <div class="related-grid">
        ${relatedPosts.map(p => `
        <a href="/blog/${p.slug}.html" class="related-card">
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
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${escapeHtml(post.title)}",
    "description": "${escapeHtml(post.description)}",
    "datePublished": "${post.dateISO}",
    "dateModified": "${post.dateISO}",
    "author": {
      "@type": "Organization",
      "name": "Clearly",
      "url": "https://getclearly.app"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Clearly",
      "logo": {
        "@type": "ImageObject",
        "url": "https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png"
      }
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": "https://getclearly.app/blog/${post.slug}.html"
    },
    "image": "https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png"
  }
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
  <title>Common Ground - Co-Parenting Tips & Advice | Clearly</title>
  <meta name="description" content="Real topics, practical advice, and perspectives for co-parents. Custody schedules, communication strategies, and tips for calmer co-parenting.">
  <link rel="canonical" href="https://getclearly.app/blog.html">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://getclearly.app/blog.html">
  <meta property="og:title" content="Common Ground - Co-Parenting Tips & Advice">
  <meta property="og:description" content="Real topics, practical advice, and perspectives for co-parents.">
  <meta property="og:image" content="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png">
  <meta property="og:site_name" content="Clearly">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Common Ground - Co-Parenting Tips & Advice">
  <meta name="twitter:description" content="Real topics, practical advice, and perspectives for co-parents.">
  <meta name="twitter:image" content="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png">
  <meta name="robots" content="index, follow">
  <meta name="keywords" content="co-parenting tips, custody advice, shared parenting, divorce resources, co-parent communication">
  <link rel="stylesheet" href="styles.css">
  <link rel="icon" href="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/favicon.png">
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
      font-weight: 700;
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
    .blog-card h3 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .blog-card h3 a {
      color: var(--text);
    }
    .blog-card h3 a:hover {
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

  <header class="blog-hero">
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
          <h3><a href="/blog/${post.slug}.html">${escapeHtml(post.title)}</a></h3>
          <p>${escapeHtml(post.description)}</p>
          <a href="/blog/${post.slug}.html" class="blog-card-link">
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

  for (const page of posts) {
    const title = getProperty(page, 'Title');
    const slug = generateSlug(title, getProperty(page, 'Slug'));
    const description = getProperty(page, 'Description') || '';
    const rawDate = getProperty(page, 'Date');
    const date = formatDate(rawDate);
    const dateISO = rawDate || new Date().toISOString().split('T')[0];
    const category = getProperty(page, 'Category') || '';

    console.log(`Processing: ${title} [${category || 'No category'}]`);

    // Get page content
    const blocks = await getPageContent(page.id);
    let content = blocksToHtml(blocks);
    content = wrapListItems(content);

    const post = { title, slug, description, date, dateISO, content, category };
    processedPosts.push(post);
  }

  // Write individual post pages with related articles
  for (const post of processedPosts) {
    // Get 3 related posts (same category first, then others, excluding current)
    const sameCategory = processedPosts.filter(p => p.slug !== post.slug && p.category === post.category);
    const otherPosts = processedPosts.filter(p => p.slug !== post.slug && p.category !== post.category);
    const relatedPosts = [...sameCategory, ...otherPosts].slice(0, 3);

    const postHtml = blogPostTemplate(post, relatedPosts);
    fs.writeFileSync(path.join(blogDir, `${post.slug}.html`), postHtml);
    console.log(`  -> blog/${post.slug}.html`);
  }

  // Write blog listing page
  const listHtml = blogListTemplate(processedPosts);
  fs.writeFileSync(path.join(__dirname, 'blog.html'), listHtml);
  console.log('-> blog.html');

  // Generate sitemap.xml
  const today = new Date().toISOString().split('T')[0];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://getclearly.app/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://getclearly.app/plan-builder/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>
  <url>
    <loc>https://getclearly.app/communication-styles/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>
  <url>
    <loc>https://getclearly.app/calculators/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.85</priority>
  </url>
  <url>
    <loc>https://getclearly.app/co-parent-communication/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://getclearly.app/custody-schedule-help/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://getclearly.app/blog.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://getclearly.app/faq.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://getclearly.app/help.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://getclearly.app/privacy.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://getclearly.app/terms.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://getclearly.app/professionals.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
${processedPosts.map(post => `  <url>
    <loc>https://getclearly.app/blog/${post.slug}.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n')}
</urlset>`;
  fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);
  console.log('-> sitemap.xml');

  console.log('Blog build complete!');
}

build().catch(console.error);
