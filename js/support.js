// Support center search and the "Did this answer your question?" buttons.
// The index is support/search.json, written by build-support.js.
(function () {
  var index = null, loading = null;
  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) loading = fetch('/support/search.json').then(function (r) { return r.json(); }).then(function (d) { index = d; return d; });
    return loading;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Every word has to appear somewhere; the title counts most, then the summary and keywords
  function search(q) {
    var words = q.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 1; });
    if (!words.length || !index) return [];
    return index.map(function (a) {
      var t = a.t.toLowerCase(), s = (a.s + ' ' + a.k).toLowerCase(), x = a.x.toLowerCase(), score = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (t.indexOf(w) >= 0) score += 10; else if (s.indexOf(w) >= 0) score += 4; else if (x.indexOf(w) >= 0) score += 1; else return null;
      }
      return { a: a, score: score };
    }).filter(Boolean).sort(function (p, q2) { return q2.score - p.score; }).map(function (r) { return r.a; });
  }

  function track(name, params) { try { if (typeof gtag === 'function') gtag('event', name, params); } catch (e) {} }

  document.querySelectorAll('[data-sp-search]').forEach(function (input) {
    var box = input.parentNode.querySelector('.sp-results'), sel = -1, timer = null;
    function render() {
      var q = input.value.trim();
      if (q.length < 2) { box.hidden = true; return; }
      load().then(function () {
        var hits = search(q).slice(0, 7); sel = -1;
        box.innerHTML = hits.length ? hits.map(function (a) { return '<a href="' + a.u + '"><b>' + esc(a.t) + '</b><span>' + esc(a.c) + '</span></a>'; }).join('')
          : '<div class="none">No articles match. Try fewer words, or email hello@getclearly.app.</div>';
        box.hidden = false;
        clearTimeout(timer); timer = setTimeout(function () { track('support_search', { search_term: q.slice(0, 80), results: hits.length }); }, 1200);
      });
    }
    input.addEventListener('focus', load);
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      var links = box.querySelectorAll('a'); if (box.hidden || !links.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach(function (l, i) { l.classList.toggle('on', i === sel); });
      } else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); location.href = links[sel].href; }
      else if (e.key === 'Escape') box.hidden = true;
    });
    document.addEventListener('click', function (e) { if (!input.parentNode.contains(e.target)) box.hidden = true; });
  });

  // The search page: /support/search/?q=...
  var pageOut = document.getElementById('sp-search-page');
  if (pageOut) {
    var q = new URLSearchParams(location.search).get('q') || '';
    var input = document.querySelector('[data-sp-search]'); if (input) input.value = q;
    load().then(function () {
      var hits = search(q);
      pageOut.innerHTML = !q ? '' : hits.length
        ? '<p>' + hits.length + ' article' + (hits.length === 1 ? '' : 's') + ' for "' + esc(q) + '"</p><ul class="sp-list">' + hits.map(function (a) { return '<li><a href="' + a.u + '">' + esc(a.t) + '</a><span>' + esc(a.s) + '</span></li>'; }).join('') + '</ul>'
        : '<p>No articles match "' + esc(q) + '". Try fewer or different words, <a href="/support/">browse all topics</a>, or email <a href="mailto:hello@getclearly.app">hello@getclearly.app</a>.</p>';
      if (q) track('support_search', { search_term: q.slice(0, 80), results: hits.length });
    });
  }

  document.querySelectorAll('[data-sp-helpful]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      track('support_helpful', { article: el.dataset.spHelpful, helpful: b.dataset.v });
      el.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
      el.querySelector('.thanks').hidden = false;
    });
  });
})();
