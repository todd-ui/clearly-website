const Anthropic = require('@anthropic-ai/sdk');
const { Client } = require('@notionhq/client');

// Initialize clients
const anthropic = new Anthropic();
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const DATABASE_ID = '2df435a853a58014b9e9dc6ac1cbba09';

// Categories to rotate through
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

// Get all existing post titles from Notion to avoid duplicates
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
      const slug = page.properties.Slug?.rich_text?.[0]?.plain_text || '';
      posts.push({ title, slug });
    }
    
    hasMore = response.has_more;
    cursor = response.next_cursor;
  }
  
  return posts;
}

// Generate a new topic using Claude
async function generateNewTopic(category, existingTitles) {
  console.log(`Generating new topic for category: ${category}`);
  
  const prompt = `You are a content strategist for a co-parenting blog called "Common Ground" by Clearly.

EXISTING ARTICLES (do not duplicate these topics):
${existingTitles.map(t => `- ${t}`).join('\n')}

Generate ONE new blog post topic for the category: "${category}"

Requirements:
- Must be unique and not overlap with existing articles
- Should be SEO-friendly (think about what co-parents search for)
- Should be practical and actionable
- Should be evergreen content (not tied to current events)

Respond with JSON only:
{
  "title": "The article title (compelling, specific, 8-12 words)",
  "slug": "url-friendly-slug-like-this",
  "description": "A 1-2 sentence description for SEO meta tags (150-160 characters)",
  "keywords": ["keyword 1", "keyword 2", "keyword 3"]
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
  
  const topic = JSON.parse(jsonMatch[0]);
  topic.category = category;
  return topic;
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
  
  // Match **bold** and *italic* patterns
  const regex = /(\*\*(.+?)\*\*|\*([^*]+?)\*)/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      richText.push({
        type: 'text',
        text: { content: text.slice(lastIndex, match.index) }
      });
    }
    
    if (match[2]) {
      // Bold text (**)
      richText.push({
        type: 'text',
        text: { content: match[2] },
        annotations: { bold: true }
      });
    } else if (match[3]) {
      // Italic text (*)
      richText.push({
        type: 'text',
        text: { content: match[3] },
        annotations: { italic: true }
      });
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    richText.push({
      type: 'text',
      text: { content: text.slice(lastIndex) }
    });
  }
  
  // If no formatting found, return plain text
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
  
  // Create the page with properties
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

// Randomly select a category
async function getNextCategory(existingPosts) {
  const randomIndex = Math.floor(Math.random() * CATEGORIES.length);
  return CATEGORIES[randomIndex];
}

// Main function: Generate and publish a new article
async function publishNewArticle(overrideDate = null) {
  console.log('Starting article generation...\n');
  
  // Get existing posts to avoid duplicates
  const existingPosts = await getExistingPosts();
  console.log(`Found ${existingPosts.length} existing posts\n`);
  
  // Determine category
  const category = await getNextCategory(existingPosts);
  console.log(`Selected category: ${category}\n`);
  
  // Generate new topic
  const existingTitles = existingPosts.map(p => p.title);
  const topic = await generateNewTopic(category, existingTitles);
  console.log(`Generated topic: ${topic.title}\n`);
  
  // Generate full article
  const article = await generateArticle(topic);
  console.log(`Generated article with ${article.sections.length} sections\n`);
  
  // Determine publish date
  const publishDate = overrideDate || new Date().toISOString().split('T')[0];
  
  // Create Notion page
  const page = await createNotionPage(topic, article, publishDate);
  
  console.log(`\n✅ Successfully published: ${topic.title}`);
  console.log(`   Date: ${publishDate}`);
  console.log(`   URL: ${page.url}\n`);
  
  return { topic, page };
}

// Backfill function for initial 12 articles with specific topics
async function backfillInitialArticles() {
  const initialTopics = [
    {
      id: 1,
      title: "Co-Parenting vs. Parallel Parenting: Which Approach Fits Your Situation?",
      slug: "co-parenting-vs-parallel-parenting",
      category: "Co-Parenting Basics",
      description: "Not all post-divorce parenting looks the same. Learn the key differences between cooperative co-parenting and low-contact parallel parenting.",
      keywords: ["parallel parenting vs co-parenting", "high conflict co-parenting", "parallel parenting plan"],
      date: "2025-08-01"
    },
    {
      id: 2,
      title: "The Spectrum of Co-Parenting: Finding Your Sweet Spot",
      slug: "co-parenting-spectrum-finding-balance",
      category: "Co-Parenting Basics",
      description: "Most families aren't fully cooperative or completely parallel. Discover how to find the right balance for your unique situation.",
      keywords: ["types of co-parenting", "co-parenting styles", "healthy co-parenting boundaries"],
      date: "2025-08-15"
    },
    {
      id: 3,
      title: "When 'Co-Parenting' Becomes 'Counter-Parenting': Recognizing the Difference",
      slug: "counter-parenting-signs-solutions",
      category: "Co-Parenting Basics",
      description: "Sometimes what looks like co-parenting is actually working against your child's best interests. Learn to recognize the warning signs.",
      keywords: ["counter parenting", "undermining co-parent", "toxic co-parenting signs"],
      date: "2025-09-01"
    },
    {
      id: 4,
      title: "From Married Co-Parents to Divorced Co-Parents: The Mindset Shift",
      slug: "mindset-shift-divorced-coparents",
      category: "Co-Parenting Basics",
      description: "The hardest part of co-parenting after divorce isn't logistics—it's changing how you think about your relationship.",
      keywords: ["co-parenting after divorce mindset", "co-parenting like a business", "detaching from ex"],
      date: "2025-09-15"
    },
    {
      id: 5,
      title: "The BIFF Method: Brief, Informative, Friendly, and Firm Communication",
      slug: "biff-method-co-parenting-communication",
      category: "Communication",
      description: "Master the gold standard for high-conflict co-parenting communication. BIFF responses keep conversations productive.",
      keywords: ["BIFF method co-parenting", "high conflict communication", "co-parenting message examples"],
      date: "2025-10-01"
    },
    {
      id: 6,
      title: "Why Tone Gets Lost in Text—And What to Do About It",
      slug: "tone-in-text-co-parenting",
      category: "Communication",
      description: "That message you thought was neutral? Your co-parent read it completely differently. Here's why and what to do.",
      keywords: ["co-parenting communication tone", "miscommunication co-parenting", "text message conflict"],
      date: "2025-10-15"
    },
    {
      id: 7,
      title: "Setting 'Office Hours' for Co-Parent Communication",
      slug: "co-parenting-communication-boundaries",
      category: "Communication",
      description: "You don't have to be available 24/7. Learn how communication boundaries reduce stress and improve your co-parenting.",
      keywords: ["co-parenting communication boundaries", "when to respond to co-parent", "limiting contact with ex"],
      date: "2025-11-01"
    },
    {
      id: 8,
      title: "The Gray Rock Method: When Minimal Response Is Best",
      slug: "gray-rock-method-coparenting",
      category: "Communication",
      description: "Sometimes the most powerful response is the most boring one. Learn how Gray Rock defuses high-conflict situations.",
      keywords: ["gray rock method co-parenting", "dealing with difficult co-parent", "minimal contact co-parenting"],
      date: "2025-11-15"
    },
    {
      id: 9,
      title: "Documentation That Protects: What to Record and Why",
      slug: "co-parenting-documentation-guide",
      category: "Communication",
      description: "Good documentation isn't about building a case—it's about creating clarity and accountability. Learn what to track.",
      keywords: ["co-parenting documentation", "co-parenting journal", "documenting custody exchanges"],
      date: "2025-12-01"
    },
    {
      id: 10,
      title: "Beyond Text: Choosing the Right Communication Channel",
      slug: "co-parenting-communication-channels",
      category: "Communication",
      description: "Email, text, apps, phone calls—each has its place. Learn when to use which channel for different conversations.",
      keywords: ["best way to communicate with co-parent", "co-parenting email vs text", "co-parenting app benefits"],
      date: "2025-12-15"
    },
    {
      id: 11,
      title: "The #1 Predictor of Children's Wellbeing After Divorce",
      slug: "children-wellbeing-divorce-research",
      category: "Your Children",
      description: "It's not the divorce itself that determines how children fare—research points to one factor that matters most.",
      keywords: ["children wellbeing after divorce", "divorce effects on children", "protecting children in divorce"],
      date: "2026-01-01"
    },
    {
      id: 12,
      title: "Fear of Abandonment: What Your Child Won't Say But Is Feeling",
      slug: "children-fear-abandonment-divorce",
      category: "Your Children",
      description: "Children of divorced parents often develop abandonment fears when exposed to parental conflict. Learn the signs.",
      keywords: ["children fear of abandonment divorce", "divorce anxiety children", "reassuring children after divorce"],
      date: "2026-01-15"
    }
  ];

  console.log('Starting backfill of 12 initial articles...\n');

  for (const topic of initialTopics) {
    // Check if already exists
    const existing = await getExistingPosts();
    if (existing.some(p => p.slug === topic.slug)) {
      console.log(`Skipping "${topic.title}" - already exists\n`);
      continue;
    }

    console.log(`\n--- Article ${topic.id}/12: ${topic.title} ---\n`);
    
    try {
      const article = await generateArticle(topic);
      await createNotionPage(topic, article, topic.date);
      console.log(`✅ Published: ${topic.title}\n`);
      
      // Delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.error(`❌ Failed: ${topic.title} - ${error.message}\n`);
    }
  }

  console.log('\n🎉 Backfill complete!\n');
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

// Export functions
module.exports = { 
  publishNewArticle, 
  backfillInitialArticles, 
  generateArticle,
  triggerNetlifyBuild 
};

// CLI support
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'new') {
    // Generate and publish one new article
    publishNewArticle()
      .then(() => triggerNetlifyBuild())
      .catch(console.error);
  } else if (command === 'backfill') {
    // Backfill initial 12 articles
    backfillInitialArticles()
      .then(() => triggerNetlifyBuild())
      .catch(console.error);
  } else {
    console.log('Clearly Blog Generator');
    console.log('----------------------');
    console.log('Usage:');
    console.log('  node generate-post.js backfill  - Generate initial 12 articles');
    console.log('  node generate-post.js new       - Generate one new article');
  }
}
