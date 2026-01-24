/**
 * Generate Blog Post from Subject Only
 *
 * This script takes just a subject/idea and Claude generates everything:
 * - Title
 * - Category
 * - Slug
 * - Description
 * - Keywords
 * - Full article content
 * - Backdated publish date
 */

const Anthropic = require('@anthropic-ai/sdk');
const { Client } = require('@notionhq/client');

// Initialize clients
const anthropic = new Anthropic();
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const DATABASE_ID = '2df435a853a58014b9e9dc6ac1cbba09';

// Categories available for the blog
const CATEGORIES = [
  'Co-Parenting Basics',
  'Communication',
  'Your Children',
  'Schedules & Custody',
  'Money & Expenses',
  'High-Conflict Situations',
  'Blended Families',
  'Self-Care & Support',
  'Legal Basics'
];

// Parse GitHub Issue body to extract topic
function parseIssueBody(body) {
  // Try "Topic" first, then "Subject" as fallback
  const patterns = [
    /### Topic\s*\n\s*([\s\S]*?)(?=\n###|$)/i,
    /### Subject\s*\n\s*([\s\S]*?)(?=\n###|$)/i
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }
  // Fallback: use the entire body as the topic
  return body.trim();
}

// Generate random backdate (last 3 months)
function generateBackdate() {
  const now = new Date();
  const minDays = 7;
  const maxDays = 90;
  const daysAgo = Math.floor(Math.random() * (maxDays - minDays + 1)) + minDays;
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

// Get existing posts to avoid duplicates
async function getExistingPosts() {
  const posts = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
    });

    for (const page of response.results) {
      const title = page.properties.Title?.title?.[0]?.plain_text || '';
      posts.push(title);
    }

    hasMore = response.has_more;
    cursor = response.next_cursor;
  }

  return posts;
}

// Generate topic metadata from user's topic idea using Claude
async function generateTopicMetadata(topicIdea, existingTitles) {
  console.log('Generating article details from topic...');

  const prompt = `You are a content strategist for a co-parenting blog called "Common Ground" by Clearly.

The user wants a blog post about this topic:
"${topicIdea}"

EXISTING ARTICLES (do not duplicate these topics):
${existingTitles.slice(0, 20).map(t => `- ${t}`).join('\n')}

Generate the blog post metadata. Pick the most appropriate category from this list:
${CATEGORIES.map(c => `- ${c}`).join('\n')}

Respond with JSON only:
{
  "title": "The article title (compelling, specific, 8-12 words, SEO-friendly)",
  "slug": "url-friendly-slug-like-this",
  "category": "One of the categories listed above",
  "description": "A 1-2 sentence description for SEO meta tags (150-160 characters)",
  "keywords": ["keyword 1", "keyword 2", "keyword 3", "keyword 4"]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const content = response.content[0].text;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse topic JSON');
  }

  return JSON.parse(jsonMatch[0]);
}

// Generate full article content using Claude
async function generateArticle(topic) {
  console.log(`Generating article: ${topic.title}`);

  const prompt = `Write a comprehensive, helpful blog article for co-parents.

TOPIC: ${topic.title}
DESCRIPTION: ${topic.description}
CATEGORY: ${topic.category}
KEYWORDS TO NATURALLY INCLUDE: ${topic.keywords.join(', ')}

REQUIREMENTS:
- Write 1500-2000 words
- Use a warm, practical, non-judgmental tone
- Focus on actionable advice, not fluff
- Do NOT mention or promote any apps, products, or services
- Do NOT include dates, "last updated", or time-sensitive references
- Write for parents going through divorce/separation who want to do right by their kids
- Be empathetic but not preachy

STRUCTURE:
1. Opening hook (2-3 paragraphs) - connect with the reader's real experience, introduce the topic naturally
2. 4-6 main sections with H2 headings - each section should be substantive (200-400 words each)
3. Use bullet points or numbered lists where they genuinely help (not just for formatting)
4. Include specific examples, scenarios, or sample language where helpful
5. End with "Key Takeaways" section - 4-5 bullet points summarizing actionable advice

TONE EXAMPLES:
- Good: "You've probably felt that knot in your stomach when..."
- Bad: "Co-parenting can be challenging for many families."
- Good: "Here's what that might look like in practice..."
- Bad: "It is important to consider the following factors..."

FORMAT YOUR RESPONSE AS JSON with this structure:
{
  "sections": [
    {"type": "paragraph", "content": "Opening paragraph..."},
    {"type": "paragraph", "content": "Second paragraph..."},
    {"type": "heading2", "content": "First Section Title"},
    {"type": "paragraph", "content": "Section content..."},
    {"type": "bullet_list", "items": ["Point one with **bold** for emphasis", "Point two", "Point three"]},
    {"type": "heading2", "content": "Another Section"},
    {"type": "paragraph", "content": "More content..."},
    {"type": "heading2", "content": "Key Takeaways"},
    {"type": "bullet_list", "items": ["**Takeaway one.** Explanation...", "**Takeaway two.** Explanation..."]}
  ]
}

Valid types: paragraph, heading2, heading3, bullet_list, numbered_list, quote

Write the complete article now as JSON:`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });

  const content = response.content[0].text;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse article JSON');
  }

  return JSON.parse(jsonMatch[0]);
}

// Parse text with **bold** and *italic* markers into Notion rich_text
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

// Create Notion page with content
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

// Trigger Netlify rebuild
async function triggerNetlifyBuild() {
  const webhookUrl = process.env.NETLIFY_BUILD_HOOK;
  if (!webhookUrl) {
    console.log('No NETLIFY_BUILD_HOOK set, skipping rebuild trigger');
    return;
  }

  try {
    const response = await fetch(webhookUrl, { method: 'POST' });
    if (response.ok) {
      console.log('Triggered Netlify rebuild');
    } else {
      console.error('Failed to trigger Netlify rebuild');
    }
  } catch (error) {
    console.error('Error triggering Netlify rebuild:', error.message);
  }
}

// Main function
async function main() {
  console.log('Starting quick blog post generation...\n');

  // Get issue data from environment
  const issueTitle = process.env.ISSUE_TITLE || '';
  const issueBody = process.env.ISSUE_BODY || '';

  // Extract topic from issue
  let topic = parseIssueBody(issueBody);

  // Fallback to issue title if no topic in body
  if (!topic || topic === '_No response_') {
    topic = issueTitle.replace(/^\[Blog\]\s*/i, '').trim();
  }

  if (!topic) {
    console.error('No topic found in issue');
    process.exit(1);
  }

  console.log(`Topic: ${topic}\n`);

  // Get existing posts to avoid duplicates
  const existingTitles = await getExistingPosts();
  console.log(`Found ${existingTitles.length} existing posts\n`);

  // Generate article metadata from topic
  const articleMeta = await generateTopicMetadata(topic, existingTitles);
  console.log(`Generated title: ${articleMeta.title}`);
  console.log(`Category: ${articleMeta.category}`);
  console.log(`Slug: ${articleMeta.slug}\n`);

  // Generate backdated date
  const publishDate = generateBackdate();
  console.log(`Publish date: ${publishDate}\n`);

  // Generate full article
  console.log('Generating article...');
  const article = await generateArticle(articleMeta);
  console.log(`Generated ${article.sections.length} sections\n`);

  // Create in Notion
  console.log('Publishing to Notion...');
  const page = await createNotionPage(articleMeta, article, publishDate);

  // Trigger Netlify rebuild
  await triggerNetlifyBuild();

  console.log('\nBlog post generated and published!');
  console.log(`   Topic: ${topic}`);
  console.log(`   Title: ${articleMeta.title}`);
  console.log(`   Category: ${articleMeta.category}`);
  console.log(`   Date: ${publishDate}`);
  console.log(`   URL: https://getclearly.app/blog/${articleMeta.slug}.html`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
