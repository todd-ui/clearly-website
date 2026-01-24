/**
 * Generate Blog Post from GitHub Issue Topic
 *
 * This script is triggered by GitHub Actions when a blog topic issue is created.
 * It parses the issue, uses the existing Claude-based system to generate the article,
 * and publishes it to Notion with a backdated date.
 */

const { generateArticle, triggerNetlifyBuild } = require('./generate-post');
const { Client } = require('@notionhq/client');

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = '2df435a853a58014b9e9dc6ac1cbba09';

// Parse GitHub Issue body to extract form fields
function parseIssueBody(body) {
  const fields = {};

  const patterns = {
    title: /### Post Title\s*\n\s*(.+)/i,
    category: /### Category\s*\n\s*(.+)/i,
    description: /### Topic Description\s*\n\s*([\s\S]*?)(?=\n###|$)/i,
    keyPoints: /### Key Points to Cover\s*\n\s*([\s\S]*?)(?=\n###|$)/i,
    keywords: /### Target Keywords.*\s*\n\s*(.+)/i,
    dateRange: /### Publish Date Range\s*\n\s*(.+)/i,
    notes: /### Additional Notes\s*\n\s*([\s\S]*?)$/i,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = body.match(pattern);
    if (match) {
      let value = match[1].trim();
      // Skip "_No response_" or empty values
      if (value && value !== '_No response_') {
        fields[key] = value;
      }
    }
  }

  return fields;
}

// Generate a random backdated date based on range selection
function generateBackdate(range = 'Random (last 3 months)') {
  const now = new Date();
  let minDays, maxDays;

  if (range.includes('Recent') || range.includes('2 weeks')) {
    minDays = 1;
    maxDays = 14;
  } else if (range.includes('Backdate') || range.includes('3-6')) {
    minDays = 90;
    maxDays = 180;
  } else {
    // Default: last 3 months
    minDays = 7;
    maxDays = 90;
  }

  const daysAgo = Math.floor(Math.random() * (maxDays - minDays + 1)) + minDays;
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);

  return date.toISOString().split('T')[0];
}

// Generate URL-friendly slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Map form categories to Notion database categories
function mapCategory(formCategory) {
  const categoryMap = {
    'Communication': 'Communication',
    'Co-Parenting Basics': 'Co-Parenting Basics',
    'Your Children': 'Your Children',
    'Scheduling': 'Schedules & Custody',
    'Legal & Documentation': 'Legal Basics',
  };
  return categoryMap[formCategory] || 'Co-Parenting Basics';
}

// Parse rich text with **bold** and *italic* markers
function parseRichText(text) {
  if (!text) return [{ type: 'text', text: { content: '' } }];

  const richText = [];
  let lastIndex = 0;

  const regex = /(\*\*(.+?)\*\*|\*([^*]+?)\*)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      richText.push({
        type: 'text',
        text: { content: text.slice(lastIndex, match.index) }
      });
    }

    if (match[2]) {
      richText.push({
        type: 'text',
        text: { content: match[2] },
        annotations: { bold: true }
      });
    } else if (match[3]) {
      richText.push({
        type: 'text',
        text: { content: match[3] },
        annotations: { italic: true }
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    richText.push({
      type: 'text',
      text: { content: text.slice(lastIndex) }
    });
  }

  if (richText.length === 0) {
    richText.push({
      type: 'text',
      text: { content: text }
    });
  }

  return richText;
}

// Convert article sections to Notion blocks
function articleToNotionBlocks(article) {
  const blocks = [];

  for (const section of article.sections) {
    switch (section.type) {
      case 'paragraph':
        if (section.content && section.content.trim()) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: parseRichText(section.content)
            }
          });
        }
        break;

      case 'heading2':
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: section.content } }]
          }
        });
        break;

      case 'heading3':
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: section.content } }]
          }
        });
        break;

      case 'bullet_list':
        for (const item of section.items) {
          blocks.push({
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: parseRichText(item)
            }
          });
        }
        break;

      case 'numbered_list':
        for (const item of section.items) {
          blocks.push({
            object: 'block',
            type: 'numbered_list_item',
            numbered_list_item: {
              rich_text: parseRichText(item)
            }
          });
        }
        break;

      case 'quote':
        blocks.push({
          object: 'block',
          type: 'quote',
          quote: {
            rich_text: parseRichText(section.content)
          }
        });
        break;
    }
  }

  return blocks;
}

// Create Notion page with article content
async function createNotionPage(topic, article, publishDate) {
  console.log(`Creating Notion page: ${topic.title}`);

  const page = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      'Title': {
        title: [{ text: { content: topic.title } }]
      },
      'Slug': {
        rich_text: [{ text: { content: topic.slug } }]
      },
      'Description': {
        rich_text: [{ text: { content: topic.description } }]
      },
      'Published': {
        checkbox: true
      },
      'Date': {
        date: { start: publishDate }
      },
      'Category': {
        select: { name: topic.category }
      }
    }
  });

  // Add content blocks
  const blocks = articleToNotionBlocks(article);

  // Notion API limits to 100 blocks per request
  const chunkSize = 100;
  for (let i = 0; i < blocks.length; i += chunkSize) {
    const chunk = blocks.slice(i, i + chunkSize);
    await notion.blocks.children.append({
      block_id: page.id,
      children: chunk
    });
  }

  console.log(`Created page: ${page.url}`);
  return page;
}

// Main function
async function main() {
  console.log('Starting blog post generation from GitHub Issue...\n');

  // Get issue data from environment variables (set by GitHub Actions)
  const issueTitle = process.env.ISSUE_TITLE || '';
  const issueBody = process.env.ISSUE_BODY || '';

  if (!issueBody) {
    console.error('No issue body found');
    process.exit(1);
  }

  // Parse the issue form fields
  const fields = parseIssueBody(issueBody);

  // Get title - prefer form field, fallback to issue title (minus [Blog] prefix)
  const title = fields.title || issueTitle.replace(/^\[Blog\]\s*/i, '').trim();

  if (!title) {
    console.error('No title found in issue');
    process.exit(1);
  }

  // Build topic object for the generator
  const topic = {
    title: title,
    slug: generateSlug(title),
    category: mapCategory(fields.category || 'Co-Parenting Basics'),
    description: fields.description || `A helpful guide about ${title.toLowerCase()}.`,
    keywords: fields.keywords
      ? fields.keywords.split(',').map(k => k.trim())
      : ['co-parenting', 'co-parent communication']
  };

  // Add key points to description if provided
  if (fields.keyPoints) {
    topic.description += ' ' + fields.keyPoints.replace(/\n/g, ' ').substring(0, 200);
  }

  console.log(`Title: ${topic.title}`);
  console.log(`Slug: ${topic.slug}`);
  console.log(`Category: ${topic.category}`);
  console.log(`Keywords: ${topic.keywords.join(', ')}`);

  // Generate backdated date
  const publishDate = generateBackdate(fields.dateRange);
  console.log(`Publish date: ${publishDate}\n`);

  // Generate the article using Claude
  console.log('Generating article with Claude...');
  const article = await generateArticle(topic);
  console.log(`Generated ${article.sections.length} sections\n`);

  // Create in Notion
  console.log('Publishing to Notion...');
  const page = await createNotionPage(topic, article, publishDate);

  // Trigger Netlify rebuild
  await triggerNetlifyBuild();

  console.log('\n Blog post generated and published!');
  console.log(`   Title: ${topic.title}`);
  console.log(`   Date: ${publishDate}`);
  console.log(`   URL: https://getclearly.app/blog/${topic.slug}.html`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
