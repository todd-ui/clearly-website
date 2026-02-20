/**
 * Generate Blog Post from GitHub Issue Topic
 *
 * This script is triggered by GitHub Actions when a blog topic issue is created.
 * It parses the issue, uses the existing Claude-based system to generate the article,
 * and publishes it to Notion with a backdated date.
 *
 * Includes duplicate detection to prevent creating posts that already exist.
 */

const { generateArticle, triggerNetlifyBuild } = require('./generate-post');
const { Client } = require('@notionhq/client');

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = '2df435a853a58014b9e9dc6ac1cbba09';

// ============================================================================
// DUPLICATE DETECTION UTILITIES
// ============================================================================

// Common words to ignore when comparing titles
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'your', 'my', 'our', 'their', 'his', 'her', 'its', 'who', 'whom', 'whose',
  'which', 'what', 'when', 'where', 'why', 'how', 'this', 'that', 'these', 'those'
]);

/**
 * Normalize a title for comparison by:
 * - Converting to lowercase
 * - Removing punctuation
 * - Removing stop words
 * - Returning array of significant words
 */
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 0 && !STOP_WORDS.has(word));
}

/**
 * Calculate the percentage of words shared between two normalized titles
 */
function calculateWordOverlap(words1, words2) {
  if (words1.length === 0 || words2.length === 0) return 0;

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  let sharedCount = 0;
  for (const word of set1) {
    if (set2.has(word)) sharedCount++;
  }

  // Calculate overlap as percentage of the smaller set
  const smallerSetSize = Math.min(set1.size, set2.size);
  return smallerSetSize > 0 ? sharedCount / smallerSetSize : 0;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;

  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate keyword overlap percentage
 */
function calculateKeywordOverlap(keywords1, keywords2) {
  if (!keywords1 || !keywords2 || keywords1.length === 0 || keywords2.length === 0) {
    return 0;
  }

  const normalize = kw => kw.toLowerCase().trim();
  const set1 = new Set(keywords1.map(normalize));
  const set2 = new Set(keywords2.map(normalize));

  let sharedCount = 0;
  for (const kw of set1) {
    if (set2.has(kw)) sharedCount++;
  }

  const smallerSetSize = Math.min(set1.size, set2.size);
  return smallerSetSize > 0 ? sharedCount / smallerSetSize : 0;
}

/**
 * Fetch all existing blog posts from Notion
 */
async function fetchExistingPosts() {
  console.log('Fetching existing posts from Notion...');

  const posts = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: startCursor,
      page_size: 100
    });

    for (const page of response.results) {
      const props = page.properties;

      const title = props.Title?.title?.[0]?.plain_text || '';
      const slug = props.Slug?.rich_text?.[0]?.plain_text || '';
      const keywords = props.Keywords?.rich_text?.[0]?.plain_text || '';

      posts.push({
        id: page.id,
        title,
        slug,
        keywords: keywords ? keywords.split(',').map(k => k.trim()) : [],
        normalizedTitle: normalizeTitle(title)
      });
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  console.log(`Found ${posts.length} existing posts`);
  return posts;
}

/**
 * Check if a new topic is a duplicate of an existing post
 * Returns { isDuplicate: boolean, reason?: string, matchedPost?: object }
 */
function checkForDuplicate(newTopic, existingPosts) {
  const newSlug = newTopic.slug;
  const newNormalizedTitle = normalizeTitle(newTopic.title);
  const newKeywords = newTopic.keywords || [];

  for (const existing of existingPosts) {
    // Check 1: Exact slug match
    if (existing.slug === newSlug) {
      return {
        isDuplicate: true,
        reason: 'exact slug match',
        matchedPost: existing
      };
    }

    // Check 2: Title word overlap >= 70%
    const titleOverlap = calculateWordOverlap(newNormalizedTitle, existing.normalizedTitle);
    if (titleOverlap >= 0.70) {
      return {
        isDuplicate: true,
        reason: `title similarity ${Math.round(titleOverlap * 100)}%`,
        matchedPost: existing
      };
    }

    // Check 3: Keyword overlap >= 80%
    if (newKeywords.length > 0 && existing.keywords.length > 0) {
      const keywordOverlap = calculateKeywordOverlap(newKeywords, existing.keywords);
      if (keywordOverlap >= 0.80) {
        return {
          isDuplicate: true,
          reason: `keyword overlap ${Math.round(keywordOverlap * 100)}%`,
          matchedPost: existing
        };
      }
    }

    // Check 4: Levenshtein distance < 15 (catches minor variations)
    const distance = levenshteinDistance(
      newTopic.title.toLowerCase(),
      existing.title.toLowerCase()
    );
    if (distance < 15) {
      return {
        isDuplicate: true,
        reason: `title too similar (distance: ${distance})`,
        matchedPost: existing
      };
    }
  }

  return { isDuplicate: false };
}

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
  console.log('='.repeat(60));

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

  console.log(`\nNew Post Details:`);
  console.log(`  Title: ${topic.title}`);
  console.log(`  Slug: ${topic.slug}`);
  console.log(`  Category: ${topic.category}`);
  console.log(`  Keywords: ${topic.keywords.join(', ')}`);

  // ============================================================================
  // STEP 1: PRE-GENERATION DUPLICATE CHECK
  // ============================================================================
  console.log('\n' + '='.repeat(60));
  console.log('STEP 1: Pre-generation duplicate check');
  console.log('='.repeat(60));

  const existingPosts = await fetchExistingPosts();
  const duplicateCheck = checkForDuplicate(topic, existingPosts);

  if (duplicateCheck.isDuplicate) {
    console.log('\n⚠️  SKIP: Duplicate detected!');
    console.log(`   New title: "${topic.title}"`);
    console.log(`   Matches existing: "${duplicateCheck.matchedPost.title}"`);
    console.log(`   Existing slug: ${duplicateCheck.matchedPost.slug}`);
    console.log(`   Reason: ${duplicateCheck.reason}`);
    console.log('\nNo post created. Exiting.');

    // Write result file for GitHub Actions to read
    const fs = require('fs');
    fs.writeFileSync('generation-result.json', JSON.stringify({
      status: 'skipped',
      reason: duplicateCheck.reason,
      newTitle: topic.title,
      matchedTitle: duplicateCheck.matchedPost.title,
      matchedSlug: duplicateCheck.matchedPost.slug
    }));

    process.exit(0);
  }

  console.log('\n✅ CREATE: No duplicates found. Proceeding with generation.');

  // Generate backdated date
  const publishDate = generateBackdate(fields.dateRange);
  console.log(`\nPublish date: ${publishDate}`);

  // Generate the article using Claude
  console.log('\n' + '='.repeat(60));
  console.log('Generating article with Claude...');
  console.log('='.repeat(60));
  const article = await generateArticle(topic);
  console.log(`Generated ${article.sections.length} sections`);

  // ============================================================================
  // STEP 2: PRE-INSERTION SAFETY NET
  // ============================================================================
  console.log('\n' + '='.repeat(60));
  console.log('STEP 2: Pre-insertion safety check');
  console.log('='.repeat(60));

  // Re-fetch to catch any posts created since our first check
  const latestPosts = await fetchExistingPosts();
  const finalCheck = checkForDuplicate(topic, latestPosts);

  if (finalCheck.isDuplicate) {
    console.log('\n⚠️  SKIP: Duplicate detected in final safety check!');
    console.log(`   New title: "${topic.title}"`);
    console.log(`   Matches existing: "${finalCheck.matchedPost.title}"`);
    console.log(`   Existing slug: ${finalCheck.matchedPost.slug}`);
    console.log(`   Reason: ${finalCheck.reason}`);
    console.log('\nArticle was generated but NOT inserted. Exiting.');

    // Write result file for GitHub Actions to read
    const fs = require('fs');
    fs.writeFileSync('generation-result.json', JSON.stringify({
      status: 'skipped',
      reason: finalCheck.reason + ' (caught in safety check)',
      newTitle: topic.title,
      matchedTitle: finalCheck.matchedPost.title,
      matchedSlug: finalCheck.matchedPost.slug
    }));

    process.exit(0);
  }

  console.log('✅ Safety check passed. Inserting into Notion...');

  // Create in Notion
  console.log('\n' + '='.repeat(60));
  console.log('Publishing to Notion...');
  console.log('='.repeat(60));
  const page = await createNotionPage(topic, article, publishDate);

  // Trigger Netlify rebuild
  await triggerNetlifyBuild();

  console.log('\n' + '='.repeat(60));
  console.log('✅ SUCCESS: Blog post generated and published!');
  console.log('='.repeat(60));
  console.log(`   Title: ${topic.title}`);
  console.log(`   Date: ${publishDate}`);
  console.log(`   URL: https://getclearly.app/blog/${topic.slug}.html`);

  // Write result file for GitHub Actions to read
  const fs = require('fs');
  fs.writeFileSync('generation-result.json', JSON.stringify({
    status: 'created',
    title: topic.title,
    slug: topic.slug,
    date: publishDate,
    url: `https://getclearly.app/blog/${topic.slug}.html`
  }));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
