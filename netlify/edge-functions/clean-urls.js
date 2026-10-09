// One URL per page: /faq, /blog/some-post, /calculators/support/texas.
//
// Netlify serves faq.html at /faq, but /faq.html answers too, so Google was
// indexing both copies of every blog post and splitting their ranking. This
// 301s any *.html request to its clean URL. The clean URL is then served
// straight from the .html file (Netlify Pretty URLs), so there is no loop:
// that lookup happens after this function and never re-runs it.
//
// Skipped: the 404 page and the /join/* rewrite target, which Netlify serves
// internally by their .html names.
export default async (request) => {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.endsWith('.html') || path === '/404.html' || path.startsWith('/join/')) return;

  url.pathname = path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path.slice(0, -'.html'.length);
  return new Response(null, {
    status: 301,
    headers: { Location: url.pathname + url.search, 'Cache-Control': 'public, max-age=86400' },
  });
};

export const config = { path: '/*.html' };
