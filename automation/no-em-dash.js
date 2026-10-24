// No em dashes in public copy (house style). Blog posts come from Notion, so
// build-blog.js runs every page it writes through withoutEmDashes; static
// pages were cleaned once with --fix, and `npm test` fails if one comes back.
//
//   node automation/no-em-dash.js            list public files that have one
//   node automation/no-em-dash.js --fix a b  rewrite those files
//
// The rewrite is mechanical, so read the diff: a dash between clauses becomes
// a comma, one in a page title a colon, a table's "no" cell the word "No",
// and an attribution dash ("— Name") is dropped.

const fs = require('fs');
const path = require('path');

const DASH = /&mdash;|&#8212;|&#x2014;|—/gi;
const HAS_DASH = /&mdash;|&#8212;|&#x2014;|—/i;

function withoutEmDashes(text) {
  if (!text || !HAS_DASH.test(text)) return text;
  let s = text.replace(DASH, '—');
  // Titles read "Topic: Subtitle", and "Page | Clearly" for the brand
  s = s.replace(/(<title>[^<]*<\/title>)/gi, (m) => m.replace(/\s*—\s*(Clearly(?: Blog)?<)/g, ' | $1').replace(/\s*—\s*/g, ': '));
  s = s.replace(/(<meta[^>]+(?:og:title|twitter:title|image:alt)[^>]*>)/gi, (m) => m.replace(/\s*—\s*/g, ': '));
  s = s.replace(/("(?:headline|name)"\s*:\s*"[^"]*")/g, (m) => m.replace(/\s*—\s*/g, ': '));
  // A comparison table's empty cell says No; a list marker becomes a cross
  s = s.replace(/(<td[^>]*>)\s*—\s*(<\/td>)/g, '$1No$2');
  s = s.replace(/(<span[^>]*>)\s*—\s*(<\/span>)/g, '$1&times;$2');
  // A label, then what it is: "**Calculators**: free..." / "<b>Tip</b>: ..."
  s = s.replace(/(\*\*[^*\n]+\*\*|<\/strong>|<\/b>)\s*—\s*/g, '$1: ');
  // A Markdown heading ("# Clearly: Full Reference")
  s = s.replace(/^(#{1,6} [^\n]*?)\s*—\s*/gm, '$1: ');
  // A list after a run of items: "Affairs, finances, blame: none of this..."
  s = s.replace(/\s*—\s*(none|all|each|every|both|that's|this is|these|those)\b/gi, ': $1');
  // An attribution ("— Name") or a dash that opens a line
  s = s.replace(/(^|>|\n)([ \t]*)—\s*/g, '$1$2');
  // After other punctuation, or at the end of a phrase: just drop it
  s = s.replace(/([.,;:!?])\s*—\s*/g, '$1 ');
  s = s.replace(/\s*—\s*(?=<|\n|$)/g, '');
  // Before a quotation: a colon ("ask yourself: "What do I need?"")
  s = s.replace(/\s*—\s*(?=\\?["“])/g, ': ');
  // Between clauses
  s = s.replace(/\s*—\s*/g, ', ');
  return s;
}

// Public files: pages, feeds and the AI-facing text files. Not internal
// docs, code comments in automation, or the archive.
const SKIP = new Set(['node_modules', '.git', '_archive', '.claude', 'docs', 'automation', 'supabase', 'styles', '.github', 'netlify']);
function publicFiles(dir = path.join(__dirname, '..')) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...publicFiles(full));
    else if (/\.(html|txt|xml|json)$/.test(entry.name) && entry.name !== 'package.json' && entry.name !== 'package-lock.json') out.push(full);
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--fix') {
    for (const f of args.slice(1)) {
      const before = fs.readFileSync(f, 'utf8');
      const after = withoutEmDashes(before);
      if (after !== before) { fs.writeFileSync(f, after); console.log(`fixed ${f}`); }
    }
  } else {
    const root = path.join(__dirname, '..');
    const bad = publicFiles().filter((f) => HAS_DASH.test(fs.readFileSync(f, 'utf8')));
    if (bad.length) {
      console.error(`Em dashes in public copy:\n${bad.map((f) => `  ${path.relative(root, f)}`).join('\n')}`);
      process.exit(1);
    }
    console.log('No em dashes in public copy.');
  }
}

// Claims Clearly doesn't make, wherever a Notion post's text has them: a
// court decides what it accepts. Applied by build-blog.js with the dashes.
function withoutLegalClaims(text) {
  return text ? text.replace(/\bcourt[- ]admissible\b/gi, (m) => (m[0] === 'C' ? 'Court-ready' : 'court-ready')) : text;
}

module.exports = { withoutEmDashes, withoutLegalClaims };
