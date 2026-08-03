#!/usr/bin/env node
/*
 * calculator-staleness.js — a nudge, never an edit.
 *
 * Reads calculators/calculator-config.js and reports any state whose
 * `nextReviewDate` has passed, i.e. whose child-support guideline figures are
 * due for a HUMAN review against official sources. It does NOT change any
 * numbers — updating legal/financial figures must be done by a person who has
 * verified them against the official state source (see MAINTENANCE.md and
 * docs/calculator-2026-verification.md).
 *
 * Exit code:
 *   0 = every state is within its review window
 *   1 = at least one state is overdue (used by the scheduled GitHub Action to
 *       surface a visible red check). Intentionally NOT wired into `npm run
 *       build` / `npm test`, so a passed review date never blocks a deploy.
 *
 * Usage:
 *   node automation/calculator-staleness.js
 *   node automation/calculator-staleness.js --warn-only   # always exit 0
 */

const path = require('path');
const { CALCULATOR_CONFIG } = require(path.join(__dirname, '..', 'calculators', 'calculator-config.js'));

const warnOnly = process.argv.includes('--warn-only');
const today = new Date();
today.setHours(0, 0, 0, 0);

const states = CALCULATOR_CONFIG.states || {};
const overdue = [];
const rows = [];

for (const [key, s] of Object.entries(states)) {
  const raw = s.nextReviewDate;
  const due = raw ? new Date(raw) : null;
  const isOverdue = due && !isNaN(due) && due <= today;
  if (isOverdue) overdue.push({ key, ...s });
  rows.push({
    state: s.name || key,
    effective: s.guidelinesEffective || '—',
    nextReview: raw || '—',
    status: !raw ? 'no date' : isOverdue ? 'OVERDUE' : 'ok',
    source: s.sourceUrl || '',
  });
}

console.log('\nChild-support calculator guideline freshness\n');
for (const r of rows) {
  const flag = r.status === 'OVERDUE' ? '⚠ ' : '  ';
  console.log(`${flag}${r.state.padEnd(16)} effective: ${String(r.effective).padEnd(28)} next review: ${r.nextReview}  [${r.status}]`);
}

if (overdue.length) {
  console.log(`\n${overdue.length} state(s) OVERDUE for guideline review — verify against the official source, then update calculators/calculator-config.js and the page copy:`);
  for (const s of overdue) {
    console.log(`  • ${s.name}: next review was ${s.nextReviewDate}. Source: ${s.sourceUrl || 'see MAINTENANCE.md'}`);
  }
  console.log('\nThis is a reminder to a human — no figures were changed. See docs/calculator-2026-verification.md.\n');
  process.exit(warnOnly ? 0 : 1);
}

console.log('\nAll states are within their review window.\n');
process.exit(0);
