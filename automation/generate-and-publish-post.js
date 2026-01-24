/**
 * Generate Blog Post from Topic and Publish to Notion
 *
 * This script:
 * 1. Parses the topic from a GitHub Issue
 * 2. Uses OpenAI to generate blog content
 * 3. Creates the post in Notion with a backdated date
 */

const { Client } = require('@notionhq/client');
const OpenAI = require('openai');

// Initialize clients
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DATABASE_ID = process.env.NOTION_DATABASE_ID || '2df435a853a58014b9e9dc6ac1cbba09';

// Parse issue body to extract fields
function parseIssueBody(body) {
  const fields = {};

  // Extract form fields from GitHub Issue body
  const patterns = {
    title: /### Post Title\s*\n\s*(.+)/i,
    category: /### Category\s*\n\s*(.+)/i,
    description: /### Topic Description\s*\n\s*([\s\S]*?)(?=\n###|$)/i,
    keyPoints: /### Key Points to Cover\s*\n\s*([\s\S]*?)(?=\n###|$)/i,
    keywords: /### Target Keywords.*\s*\n\s*(.+)/i,
    dateRange: /### Publish Date Range\s*\n\s*(.+)/i,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = body.match(pattern);
    if (match) {
      fields[key] = match[1].trim();
    }
  }

  return fields;
}

// Generate a random past date
function generateBackdate(range = 'Random (last 3 months)') {
  const now = new Date();
  let minDays, maxDays;

  if (range.includes('Recent')) {
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

// Generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Generate blog post content using OpenAI
async function generateBlogContent(topic, description, keyPoints, keywords) {
  const prompt = `You are writing a blog post for Clearly, a co-parenting app. The blog is called "Common Ground" and focuses on practical advice for divorced or separated parents.

Write a comprehensive, helpful blog post about: "${topic}"

Context/Description: ${description || 'Write a helpful article on this topic.'}

${keyPoints ? `Key points to cover:\n${keyPoints}` : ''}

${keywords ? `Target keywords to naturally include: ${keywords}` : ''}

Guidelines:
- Write in a warm, supportive, non-judgmental tone
- Be practical and actionable
- Use "you" to address the reader directly
- Include specific examples when helpful
- Aim for 800-1200 words
- Use ## for main section headings
- Don't use "Introduction" or "Conclusion" as headings
- End with an encouraging thought, not a sales pitch

Format the response as just the blog content (no title, no meta info - just the article body starting with the first paragraph).`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 2000,
  });

  return response.choices[0].message.content;
}

// Generate a meta description
async function generateDescription(title, content) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{
      role: 'user',
      content: `Write a 150-160 character meta description for a blog post titled "${title}". Make it compelling and include the main benefit. Just return the description, nothing else.\n\nArticle preview: ${content.substring(0, 500)}...`
    }],
    temperature: 0.7,
    max_tokens: 100,
  });

  return response.choices[0].message.content.trim();
}

// Convert markdown content to Notion blocks
function markdownToNotionBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Heading 2
    if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.replace('## ', '') } }]
        }
      });
    }
    // Heading 3
    else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.replace('### ', '') } }]
        }
      });
    }
    // Bullet list
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.replace(/^[-*] /, '') } }]
        }
      });
    }
    // Numbered list
    else if (/^\d+\. /.test(line)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\. /, '') } }]
        }
      });
    }
    // Blockquote
    else if (line.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: [{ type: 'text', text: { content: line.replace('> ', '') } }]
        }
      });
    }
    // Regular paragraph
    else if (line.trim()) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line } }]
        }
      });
    }

    i++;
  }

  return blocks;
}

// Create post in Notion
async function createNotionPost(title, slug, content, description, category, date) {
  const blocks = markdownToNotionBlocks(content);

  // Map category to Notion select value
  const categoryMap = {
    'Communication': 'Communication',
    'Co-Parenting Basics': 'Co-Parenting Basics',
    'Your Children': 'Your Children',
    'Scheduling': 'Co-Parenting Basics',
    'Legal & Documentation': 'Co-Parenting Basics',
  };

  const response = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      Title: {
        title: [{ text: { content: title } }]
      },
      Slug: {
        rich_text: [{ text: { content: slug } }]
      },
      Description: {
        rich_text: [{ text: { content: description } }]
      },
      Category: {
        select: { name: categoryMap[category] || 'Co-Parenting Basics' }
      },
      Date: {
        date: { start: date }
      },
      Published: {
        checkbox: true
      }
    },
    children: blocks
  });

  return response;
}

// Main function
async function main() {
  console.log('🚀 Starting blog post generation...\n');

  // Get issue data from environment
  const issueTitle = process.env.ISSUE_TITLE || '';
  const issueBody = process.env.ISSUE_BODY || '';

  // Parse the issue
  const fields = parseIssueBody(issueBody);

  // Get title from issue title (remove [Blog] prefix) or from form
  const title = fields.title || issueTitle.replace(/^\[Blog\]\s*/i, '').trim();

  if (!title) {
    console.error('❌ No title found in issue');
    process.exit(1);
  }

  console.log(`📝 Topic: ${title}`);
  console.log(`📁 Category: ${fields.category || 'Co-Parenting Basics'}`);

  // Generate backdate
  const date = generateBackdate(fields.dateRange);
  console.log(`📅 Publish date: ${date}`);

  // Generate slug
  const slug = generateSlug(title);
  console.log(`🔗 Slug: ${slug}`);

  // Generate content
  console.log('\n⏳ Generating blog content with AI...');
  const content = await generateBlogContent(
    title,
    fields.description,
    fields.keyPoints,
    fields.keywords
  );
  console.log(`✅ Generated ${content.split(' ').length} words`);

  // Generate meta description
  console.log('⏳ Generating meta description...');
  const description = await generateDescription(title, content);
  console.log(`✅ Description: ${description.substring(0, 50)}...`);

  // Create in Notion
  console.log('\n⏳ Creating post in Notion...');
  const notionPage = await createNotionPost(
    title,
    slug,
    content,
    description,
    fields.category || 'Co-Parenting Basics',
    date
  );
  console.log(`✅ Created Notion page: ${notionPage.id}`);

  console.log('\n🎉 Blog post generated and published!');
  console.log(`   Title: ${title}`);
  console.log(`   Date: ${date}`);
  console.log(`   URL (after build): https://getclearly.app/blog/${slug}.html`);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
