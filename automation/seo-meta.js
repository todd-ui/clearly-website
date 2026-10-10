// Search metadata for a new blog post, shared by all three generators.
//
// The Notion blog database has an optional "SEO Title": a shorter title the
// site uses for Google and social previews (the headline on the page always
// uses Title). This asks Claude for that, plus a meta description of the
// length Google shows, then checks both so a bad reply can't reach the site.

const Anthropic = require('@anthropic-ai/sdk');
const { requestJson } = require('./json-response');

const anthropic = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// Google shows roughly 60 characters of a title; build-blog.js adds
// " | Clearly" when the total stays within that.
const SEO_TITLE_MAX = 55;
const DESC_MIN = 110;
const DESC_MAX = 155;

const seoSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['seoTitle', 'metaDescription'],
  properties: {
    seoTitle: { type: 'string' },
    metaDescription: { type: 'string' },
  },
};

function trimToWord(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3).replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '') + '...';
}

// Returns { seoTitle, description }. seoTitle is '' when the post title is
// already short enough to use as is.
async function generateSeoMeta({ title, description = '', category = '' }) {
  const prompt = `You write search metadata for "Common Ground", the blog of Clearly, a co-parenting app.

ARTICLE TITLE: ${title}
CATEGORY: ${category}
ABOUT: ${description}

Write:
1. seoTitle: a shorter version of the title for Google results, ${SEO_TITLE_MAX} characters or fewer. Keep the main phrase a parent would search for (for example "custody schedule", "co-parent", "child support"). Plain and specific, no clickbait, no brand name, no quotation marks.
2. metaDescription: one or two sentences, ${DESC_MIN}-${DESC_MAX} characters, saying what the reader will learn or be able to do. Calm and practical. Don't start with "Learn", "Discover" or "In this article". No brand name.`;

  let out;
  try {
    out = await requestJson(anthropic, {
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }, seoSchema, 'seo');
  } catch (error) {
    // Metadata is a nice-to-have: never fail a post over it.
    console.log(`  seo: skipped (${error.message})`);
    return { seoTitle: '', description: trimToWord(description, DESC_MAX) };
  }

  let seoTitle = (out.seoTitle || '').trim().replace(/^["']|["']$/g, '');
  if (!seoTitle || seoTitle.length > SEO_TITLE_MAX || seoTitle.toLowerCase() === title.toLowerCase()) seoTitle = '';
  // A title that already fits doesn't need a separate SEO title
  if (`${title} | Clearly`.length <= 60) seoTitle = '';

  let metaDescription = (out.metaDescription || '').trim();
  if (metaDescription.length < DESC_MIN) metaDescription = description || metaDescription;
  metaDescription = trimToWord(metaDescription, DESC_MAX);

  console.log(`  SEO title: ${seoTitle || '(none; the post title is used)'}`);
  console.log(`  Meta description (${metaDescription.length}): ${metaDescription}`);
  return { seoTitle, description: metaDescription };
}

// Create the Notion page, including "SEO Title" when there is one. If the
// database doesn't have that property (e.g. it was renamed), retry without it
// rather than lose the post.
async function createPageWithSeoTitle(notion, params, seoTitle) {
  if (!seoTitle) return notion.pages.create(params);
  const withSeo = {
    ...params,
    properties: { ...params.properties, 'SEO Title': { rich_text: [{ text: { content: seoTitle } }] } },
  };
  try {
    return await notion.pages.create(withSeo);
  } catch (error) {
    if (!/SEO Title/i.test(error.message || '')) throw error;
    console.log('  Notion has no "SEO Title" property; saving the post without it.');
    return notion.pages.create(params);
  }
}

module.exports = { generateSeoMeta, createPageWithSeoTitle, trimToWord };
