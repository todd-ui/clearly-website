const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = '2df435a853a58014b9e9dc6ac1cbba09';

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

const blogPostTemplate = (post) => `<!DOCTYPE html>
<html lang="en">
<head>
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
  </style>
</head>
<body>

  <nav class="nav">
    <div class="container">
      <a href="/" class="nav-brand">
        <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly">
        Clearly
      </a>
      <ul class="nav-links">
        <li><a href="/#features">Features</a></li>
        <li><a href="/#pricing">Pricing</a></li>
        <li><a href="/help.html">Help</a></li>
        <li><a href="/blog.html">Blog</a></li>
        <li><a href="https://apps.apple.com/app/clearly" class="nav-cta" target="_blank">Download</a></li>
      </ul>
      <button class="nav-toggle">☰</button>
    </div>
  </nav>

  <article class="blog-post">
    <a href="/blog.html" class="back-link">&larr; Back to Blog</a>
    <header class="blog-post-header">
      <h1 class="blog-post-title">${escapeHtml(post.title)}</h1>
      <p class="blog-post-meta">${post.date}</p>
    </header>
    <div class="blog-post-content">
      ${post.content}
    </div>
  </article>

  <footer class="footer">
    <div class="container">
      <div class="footer-top">
        <div class="footer-brand-section">
          <div class="footer-brand">
            <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly">
            <span>Clearly</span>
          </div>
          <p class="footer-tagline">Co-parenting made clear.</p>
        </div>
        <div class="footer-nav">
          <div class="footer-col">
            <h4>Product</h4>
            <ul>
              <li><a href="/#features">Features</a></li>
              <li><a href="/#pricing">Pricing</a></li>
              <li><a href="https://apps.apple.com/app/clearly" target="_blank">Download</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Support</h4>
            <ul>
              <li><a href="/help.html">Help Center</a></li>
              <li><a href="mailto:care@getclearly.app">Contact Us</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Legal</h4>
            <ul>
              <li><a href="/privacy.html">Privacy Policy</a></li>
              <li><a href="/terms.html">Terms of Service</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <p>© 2025 Clearly LLC. All rights reserved.</p>
        <p>Proudly designed and developed in the USA.</p>
      </div>
    </div>
  </footer>

</body>
</html>`;

const blogListTemplate = (posts) => `<!DOCTYPE html>
<html lang="en">
<head>
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
  </style>
</head>
<body>

  <nav class="nav">
    <div class="container">
      <a href="/" class="nav-brand">
        <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly">
        Clearly
      </a>
      <ul class="nav-links">
        <li><a href="/#features">Features</a></li>
        <li><a href="/#pricing">Pricing</a></li>
        <li><a href="/help.html">Help</a></li>
        <li><a href="/blog.html">Blog</a></li>
        <li><a href="https://apps.apple.com/app/clearly" class="nav-cta" target="_blank">Download</a></li>
      </ul>
      <button class="nav-toggle">☰</button>
    </div>
  </nav>

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
      <div class="blog-grid">
        ${posts.map(post => `
        <article class="blog-card">
          <div class="blog-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </div>
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

  <footer class="footer">
    <div class="container">
      <div class="footer-top">
        <div class="footer-brand-section">
          <div class="footer-brand">
            <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly">
            <span>Clearly</span>
          </div>
          <p class="footer-tagline">Co-parenting made clear.</p>
        </div>
        <div class="footer-nav">
          <div class="footer-col">
            <h4>Product</h4>
            <ul>
              <li><a href="/#features">Features</a></li>
              <li><a href="/#pricing">Pricing</a></li>
              <li><a href="https://apps.apple.com/app/clearly" target="_blank">Download</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Support</h4>
            <ul>
              <li><a href="/help.html">Help Center</a></li>
              <li><a href="mailto:care@getclearly.app">Contact Us</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Legal</h4>
            <ul>
              <li><a href="/privacy.html">Privacy Policy</a></li>
              <li><a href="/terms.html">Terms of Service</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <p>© 2025 Clearly LLC. All rights reserved.</p>
        <p>Proudly designed and developed in the USA.</p>
      </div>
    </div>
  </footer>

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
    const date = formatDate(getProperty(page, 'Date'));

    console.log(`Processing: ${title}`);

    // Get page content
    const blocks = await getPageContent(page.id);
    let content = blocksToHtml(blocks);
    content = wrapListItems(content);

    const post = { title, slug, description, date, content };
    processedPosts.push(post);

    // Write individual post page
    const postHtml = blogPostTemplate(post);
    fs.writeFileSync(path.join(blogDir, `${slug}.html`), postHtml);
    console.log(`  -> blog/${slug}.html`);
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
    <loc>https://getclearly.app/blog.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
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
