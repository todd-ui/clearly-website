// How someone first found Clearly, carried to the web app so a sign-up can be
// traced back to where it started: the campaign tags on the link they arrived
// by (utm_source, utm_medium, utm_campaign), the site that sent them (just its
// name, e.g. google.com or chatgpt.com) and the first page they saw here.
// Kept in this browser only, the first time only, and added to links into
// web.getclearly.app and pro.getclearly.app. No cookies, nothing personal.
(function () {
  var KEY = 'clearly_first_visit';
  var first = null;
  try { first = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* private window */ }
  if (!first) {
    var q = new URLSearchParams(location.search);
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) { /* none */ }
    if (/(^|\.)getclearly\.app$/.test(ref)) ref = '';
    first = {
      s: (q.get('utm_source') || '').slice(0, 40),
      m: (q.get('utm_medium') || '').slice(0, 40),
      c: (q.get('utm_campaign') || '').slice(0, 60),
      r: ref.slice(0, 60),
      l: location.pathname.slice(0, 80),
      d: new Date().toISOString().slice(0, 10)
    };
    try { localStorage.setItem(KEY, JSON.stringify(first)); } catch (e) { /* still carried this visit */ }
  }
  var PARAMS = { s: 'fv_s', m: 'fv_m', c: 'fv_c', r: 'fv_r', l: 'fv_l', d: 'fv_d' };
  // Before the page's own click handler adds from=site; capture runs first
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href*="web.getclearly.app"], a[href*="pro.getclearly.app"]');
    if (!link) return;
    try {
      var u = new URL(link.href);
      Object.keys(PARAMS).forEach(function (k) { if (first[k] && !u.searchParams.has(PARAMS[k])) u.searchParams.set(PARAMS[k], first[k]); });
      link.href = u.toString();
    } catch (err) { /* old browser: the link still works */ }
  }, true);
})();
