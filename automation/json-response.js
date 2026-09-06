// Shared helpers for getting JSON back from Claude.
//
// The model reliably returns the object we asked for, but it sometimes wraps it
// in a ```json fence or follows it with a sentence of commentary. A greedy
// /\{[\s\S]*\}/ match runs from the first "{" to the LAST "}" in the response,
// so any stray brace in that trailing prose gets swallowed and JSON.parse dies
// with "Unexpected non-whitespace character after JSON at position N".
// Scanning for the first balanced object avoids that entirely.

function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null; // unterminated - usually means max_tokens cut the response off
}

function parseJsonObject(text, label) {
  const json = extractJsonObject(text);
  if (!json) {
    throw new Error(`No complete JSON object in ${label} response`);
  }
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error.message}\n${json}`);
  }
}

// Ask Claude for JSON, retrying if the response comes back unparseable.
// A retry is worth it here: the failure is a formatting slip, not a bad prompt,
// and these scripts run unattended on a weekly cron.
async function requestJson(anthropic, params, label, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await anthropic.messages.create(params);
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    try {
      return parseJsonObject(text, label);
    } catch (error) {
      lastError = error;
      console.log(`  ${label}: attempt ${attempt} of ${attempts} failed - ${error.message}`);
    }
  }

  throw lastError;
}

module.exports = { extractJsonObject, parseJsonObject, requestJson };
