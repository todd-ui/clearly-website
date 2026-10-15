// Related articles for every blog post, and "Further reading" for the guides,
// chosen so that every article gets linked from several other pages.
//
// The old picker ranked purely by shared title words and category, so the
// same handful of articles won every time (17-25 inbound links each) while
// most articles were linked only from the blog index. Google treats pages
// with almost no internal links as low priority, which is a large part of
// why many sat in "Discovered / Crawled, currently not indexed".
//
// Now: relevance still decides, but an article that has already been picked
// many times costs more, nothing is picked more than MAX_INBOUND times, and a
// final pass makes sure every article reaches MIN_INBOUND. Deterministic, so
// rebuilds without new articles produce the same lists.
//
// Used by build-blog.js (at deploy) and automation/check-related.js.

const STOPWORDS = new Set('a an and are as at be but by can co do does for from how if in into is it its kids child children your you when what with to the of on or not parent parents parenting co-parent co-parenting coparenting without who why their them they this that'.split(' '));
const keywords = text => new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w)));

const RELATED_PER_POST = 4;
const MIN_INBOUND = 3;
const MAX_INBOUND = 10;
const POPULARITY_PENALTY = 1.2;   // score lost per time an article has already been picked

// How well `p` matches a page about `words` in `category`
function relevance(words, category, p) {
  let score = 0;
  for (const w of p._kw) if (words.has(w)) score += 3;
  if (category && p.category === category) score += 2;
  return score;
}

const newestFirst = (a, b) => (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : a.slug.localeCompare(b.slug));

// Pick `n` articles for one page, given how often each article has been picked so far.
function pickBalanced({ words, category, exclude = new Set(), n }, posts, inbound) {
  const ranked = posts
    .filter(p => !exclude.has(p.slug) && (inbound.get(p.slug) || 0) < MAX_INBOUND)
    .map(p => ({ p, rel: relevance(words, category, p) }))
    .map(x => ({ ...x, score: x.rel - POPULARITY_PENALTY * (inbound.get(x.p.slug) || 0) }))
    .sort((a, b) => b.score - a.score || newestFirst(a.p, b.p));
  const picks = ranked.slice(0, n).map(x => x.p);
  // Keep at least one article from the same topic when the page has one
  if (category && !picks.some(p => p.category === category)) {
    const same = ranked.find(x => x.p.category === category && !picks.includes(x.p));
    if (same) picks[picks.length - 1] = same.p;
  }
  return picks;
}

// Related lists for all posts, plus "Further reading" for extra pages (the guides).
// pages: [{ id, text, category, n }]
// Returns { related: Map(slug -> [post]), pages: Map(id -> [post]), inbound: Map(slug -> count) }
function buildLinkPlan(posts, pages = [], { perPost = RELATED_PER_POST } = {}) {
  posts.forEach(p => { p._kw = keywords(p.title); });
  const inbound = new Map(posts.map(p => [p.slug, 0]));
  const related = new Map();
  const bump = p => inbound.set(p.slug, inbound.get(p.slug) + 1);

  // Oldest articles first: they have the fewest links today, so they choose first
  const order = [...posts].sort((a, b) => (a.dateISO > b.dateISO ? 1 : a.dateISO < b.dateISO ? -1 : a.slug.localeCompare(b.slug)));
  for (const post of order) {
    const picks = pickBalanced({ words: post._kw, category: post.category, exclude: new Set([post.slug]), n: perPost }, posts, inbound);
    picks.forEach(bump);
    related.set(post.slug, picks);
  }

  const pageLists = new Map();
  for (const page of pages) {
    const picks = pickBalanced({ words: keywords(page.text), category: page.category, n: page.n || 5 }, posts, inbound);
    picks.forEach(bump);
    pageLists.set(page.id, picks);
  }

  // Make sure every article reaches MIN_INBOUND: swap it into the related list of
  // its best-matching post, replacing the weakest pick that has links to spare.
  const needy = posts.filter(p => inbound.get(p.slug) < MIN_INBOUND).sort((a, b) => inbound.get(a.slug) - inbound.get(b.slug) || a.slug.localeCompare(b.slug));
  for (const target of needy) {
    const sources = posts
      .filter(s => s.slug !== target.slug && !related.get(s.slug).includes(target))
      .map(s => ({ s, rel: relevance(s._kw, s.category, target) }))
      .sort((a, b) => b.rel - a.rel || a.s.slug.localeCompare(b.s.slug));
    for (const { s } of sources) {
      if (inbound.get(target.slug) >= MIN_INBOUND) break;
      const list = related.get(s.slug);
      let weakest = -1, weakestRel = Infinity;
      list.forEach((p, i) => {
        if (inbound.get(p.slug) <= MIN_INBOUND) return;          // it needs its links
        const r = relevance(s._kw, s.category, p);
        if (r < weakestRel) { weakestRel = r; weakest = i; }
      });
      if (weakest < 0) continue;
      inbound.set(list[weakest].slug, inbound.get(list[weakest].slug) - 1);
      list[weakest] = target;
      bump(target);
    }
  }

  posts.forEach(p => { delete p._kw; });
  return { related, pages: pageLists, inbound };
}

// The eight guides, what they are about, and the blog topic closest to each
const GUIDE_PAGES = [
  { id: 'high-conflict-coparenting', file: 'high-conflict-coparenting/index.html', category: 'High-Conflict Situations', text: 'high conflict co-parent difficult ex hostile messages boundaries narcissist manipulation court documentation' },
  { id: 'kids-and-divorce', file: 'kids-and-divorce/index.html', category: 'Your Children', text: 'kids divorce children talk tell adjust feelings two homes teenager struggling' },
  { id: 'mediation-prep', file: 'mediation-prep/index.html', category: 'Legal Basics', text: 'mediation mediator prepare custody agreement court attorney lawyer legal negotiation' },
  { id: 'co-parenting-expenses', file: 'co-parenting-expenses/index.html', category: 'Money & Expenses', text: 'expenses money split child support costs medical extracurricular shared reimburse' },
  { id: 'co-parent-communication', file: 'co-parent-communication/index.html', category: 'Communication', text: 'communication messages text respond tone calm biff email boundaries conversations' },
  { id: 'custody-schedule-help', file: 'custody-schedule-help/index.html', category: 'Schedules & Custody', text: 'custody schedule 50-50 holidays summer exchanges swaps parenting time plan age' },
  { id: 'coparenting-alignment-guide', file: 'coparenting-alignment-guide/index.html', category: 'Co-Parenting Basics', text: 'co-parenting plan rules consistency agreement values two homes first steps working together' },
  { id: 'best-co-parenting-apps-2026', file: 'best-co-parenting-apps-2026/index.html', category: 'Communication', text: 'co-parenting app communication tools documentation record messages calendar expenses' },
];

module.exports = { buildLinkPlan, GUIDE_PAGES, keywords, RELATED_PER_POST, MIN_INBOUND, MAX_INBOUND };

// "Further reading" block for a guide page. build-blog.js writes it between
// the further-reading markers in each guide's HTML at deploy.
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function renderFurtherReading(list) {
  if (!list || !list.length) return '';
  return `<section class="lp-section further-reading" aria-label="Further reading">
    <div class="container">
      <h2>Further reading</h2>
      <ul class="fr-list">
${list.map(p => `        <li><a href="/blog/${esc(p.slug)}">${p.category ? `<span class="fr-topic">${esc(p.category)}</span>` : ''}<span class="fr-title">${esc(p.title)}</span><span class="fr-desc">${esc(String(p.description || '').slice(0, 140))}${String(p.description || '').length > 140 ? '…' : ''}</span></a></li>`).join('\n')}
      </ul>
    </div>
  </section>`;
}
const FR_START = '<!-- further-reading:start -->';
const FR_END = '<!-- further-reading:end -->';
function writeFurtherReading(html, list) {
  const i = html.indexOf(FR_START), j = html.indexOf(FR_END);
  if (i < 0 || j < i) return null;
  return html.slice(0, i + FR_START.length) + '\n  ' + renderFurtherReading(list) + '\n  ' + html.slice(j);
}

module.exports.renderFurtherReading = renderFurtherReading;
module.exports.writeFurtherReading = writeFurtherReading;
module.exports.FR_START = FR_START;
module.exports.FR_END = FR_END;
