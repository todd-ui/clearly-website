// Shared helpers for getting JSON back from Claude.
//
// These scripts used to ask for JSON in the prompt and then dig the object out
// of the reply with /\{[\s\S]*\}/. That regex runs from the first "{" to the
// LAST "}", so when the model followed the object with a sentence containing a
// brace, the match swallowed both and JSON.parse failed with "Unexpected
// non-whitespace character after JSON" - which is exactly how the weekly
// publish job broke.
//
// Structured outputs remove the failure mode rather than tolerate it: the
// schema is passed to the API, the response is constrained to satisfy it, and
// the SDK hands back a parsed object on `parsed_output`. There is no text to
// scrape, so trailing commentary and code fences cannot happen.

// Block types the Notion converter knows how to render. Constraining this in
// the schema means an unknown type can't reach buildNotionBlocks().
const SECTION_TYPES = [
  'paragraph',
  'heading2',
  'heading3',
  'bullet_list',
  'numbered_list',
  'quote',
];

// `content` and `items` are both optional: text blocks carry `content`, list
// blocks carry `items`. The API supports optional properties, so neither has
// to be padded with an empty value.
const articleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sections'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
          type: { type: 'string', enum: SECTION_TYPES },
          content: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

// `categories` is optional - generate-post.js picks the category itself and
// only asks the model for the rest.
function topicSchema(categories) {
  const properties = {
    title: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
  };
  const required = ['title', 'slug', 'description', 'keywords'];

  if (categories) {
    properties.category = { type: 'string', enum: categories };
    required.push('category');
  }

  return { type: 'object', additionalProperties: false, required, properties };
}

// Ask Claude for JSON matching `schema`.
//
// The retry is a backstop for transient API trouble, not for malformed JSON -
// the schema rules that out. These scripts run unattended on a weekly cron, so
// a retry is cheaper than a failed run.
async function requestJson(anthropic, params, schema, label, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await anthropic.messages.parse({
        ...params,
        output_config: { format: { type: 'json_schema', schema } },
      });

      if (!response.parsed_output) {
        throw new Error(`no parsed_output (stop_reason: ${response.stop_reason})`);
      }

      return response.parsed_output;
    } catch (error) {
      lastError = error;
      console.log(`  ${label}: attempt ${attempt} of ${attempts} failed - ${error.message}`);
    }
  }

  throw new Error(`${label} generation failed after ${attempts} attempts: ${lastError.message}`);
}

module.exports = { requestJson, topicSchema, articleSchema, SECTION_TYPES };
