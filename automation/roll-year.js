#!/usr/bin/env node
// Keeps "Best Co-Parenting Apps <year>" current without ever changing the
// page's address. The comparison page lives at /best-co-parenting-apps/ (no
// year, so its rankings carry over from year to year); only the headline
// phrases below carry the year, and this script sets them to the current one.
//
// Runs first in `npm run build`, so every deploy uses the current year, and
// .github/workflows/new-year-rebuild.yml deploys just after midnight (Eastern)
// on January 1.
//
// Only these phrases change. Dated facts ("moved to a paid subscription on
// January 1, 2026", "Prices checked October 15, 2026") are history and stay as
// written: review them, and the prices, every December.
//
//   node automation/roll-year.js           update files in place
//   node automation/roll-year.js --check   report only
//   ROLL_YEAR=2027 node automation/roll-year.js --check   try a future year

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const check = process.argv.includes('--check');
// The year in New York, so the switch happens at midnight Eastern, not UTC
const YEAR = Number(process.env.ROLL_YEAR || new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' }).format(new Date()));

// {Y} marks the year. Phrases for the comparison page only, then site-wide ones.
const COMPARISON = 'best-co-parenting-apps/index.html';
const PAGE_PHRASES = [
  'Best Co-Parenting Apps {Y} | Honest Comparison',
  'Best Co-Parenting Apps {Y}: Honest Comparison',
  'An honest {Y} comparison of co-parenting apps',
  'A real comparison of co-parenting apps in {Y}',
  'best co-parenting app {Y},',
  'The {Y} co-parenting app comparison',
  'What is the best co-parenting app in {Y}?',
];
const SITE_PHRASES = [
  'Best Co-Parenting Apps {Y}',                         // footer link, llms.txt
  'A full comparison of co-parenting apps in {Y}',      // llms.txt
  '&copy; {Y} Clearly',                             // footer
];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = phrase => new RegExp(esc(phrase).replace(esc('{Y}'), '(20\\d\\d)'), 'g');

function files(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || ['node_modules', '_archive', 'docs', 'automation'].includes(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) files(full, out);
    else if (/\.(html|txt)$/.test(name)) out.push(full);
  }
  return out;
}

let changed = 0;
const missing = new Set(PAGE_PHRASES);
for (const file of files(ROOT)) {
  const rel = path.relative(ROOT, file);
  const phrases = rel === COMPARISON ? PAGE_PHRASES.concat(SITE_PHRASES) : SITE_PHRASES;
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  for (const phrase of phrases) {
    text = text.replace(pattern(phrase), m => {
      missing.delete(phrase);
      return m.replace(/20\d\d/, String(YEAR));
    });
  }
  if (text !== before) {
    changed++;
    if (!check) fs.writeFileSync(file, text);
  }
}

console.log(`Year phrases: ${YEAR}. ${changed ? `${changed} file(s) ${check ? 'need' : 'got'} the new year.` : 'All current.'}`);
// A phrase that no longer appears was reworded: add the new wording above
for (const phrase of missing) console.warn(`  ! Not found on the comparison page: "${phrase}"`);
