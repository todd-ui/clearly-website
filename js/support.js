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

  // Words people search with that the articles say differently
  var SYNONYMS = {
    android: ['android', 'web', 'browser'], computer: ['computer', 'web', 'browser'], laptop: ['laptop', 'web', 'browser'],
    pay: ['pay', 'subscri', 'billing', 'price'], price: ['price', 'cost', 'plan'], cost: ['cost', 'price', 'expense'], money: ['money', 'expense', 'pay'],
    refund: ['refund'], cancel: ['cancel', 'end'], unsubscribe: ['cancel', 'unsubscri'], trial: ['trial', 'free'],
    password: ['password', 'sign in', 'reset'], login: ['sign in', 'login', 'log in'], logon: ['sign in'], signin: ['sign in'],
    ex: ['co-parent', 'coparent'], coparent: ['co-parent', 'coparent'], partner: ['co-parent'], spouse: ['co-parent'],
    lawyer: ['lawyer', 'attorney', 'professional'], attorney: ['attorney', 'lawyer', 'professional'], mediator: ['mediator', 'professional'], therapist: ['therapist', 'professional'],
    court: ['court', 'record', 'export', 'exhibit'], pdf: ['pdf', 'export'], print: ['print', 'export', 'pdf'], download: ['download', 'export'],
    calendar: ['calendar', 'schedule'], custody: ['custody', 'schedule'], visitation: ['custody', 'schedule', 'parenting time'], swap: ['swap', 'change'], google: ['google', 'calendar feed', 'subscribe'], outlook: ['outlook', 'calendar'],
    message: ['message', 'topic'], chat: ['message', 'topic'], text: ['message', 'topic'], delete: ['delete', 'remove'], remove: ['remove', 'delete'],
    medicine: ['medicine', 'medication'], meds: ['medication'], epipen: ['epipen', 'medication'], allergy: ['allerg'], doctor: ['doctor', 'contact'],
    notification: ['notification', 'alert'], alerts: ['notification'], email: ['email'], invite: ['invite', 'join', 'code'], join: ['join', 'invite', 'code'],
  };
  var STOP = {};
  'a an the to of for in on at by with and or but is are am be do does did can could how what why when where who which my me our we us you your it its this that there i im get got want need please help'.split(' ').forEach(function (w) { STOP[w] = 1; });
  // "notifications" finds "notification", "expenses" finds "expense"
  function stem(w) { return w.length > 4 && /s$/.test(w) && !/ss$/.test(w) ? w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '') : w; }
  function forms(w) {
    var base = stem(w), out = [w];
    if (base !== w) out.push(base);
    (SYNONYMS[w] || SYNONYMS[base] || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  // Every word (or a word that means the same) has to appear somewhere;
  // the title counts most, then the summary and keywords, then the article
  function search(q) {
    var all = q.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; });
    // "how do I invite my co-parent" searches for "invite co-parent"
    var words = all.filter(function (w) { return !STOP[w]; });
    if (!words.length) words = all;
    if (!words.length || !index) return [];
    var sets = words.map(forms);
    return index.map(function (a) {
      var t = a.t.toLowerCase(), s = (a.s + ' ' + a.k).toLowerCase(), x = a.x.toLowerCase(), score = 0;
      for (var i = 0; i < sets.length; i++) {
        var best = 0;
        for (var j = 0; j < sets[i].length; j++) {
          var w = sets[i][j], exact = j === 0 ? 1 : 0.8;
          var v = t.indexOf(w) >= 0 ? 10 : s.indexOf(w) >= 0 ? 4 : x.indexOf(w) >= 0 ? 1 : 0;
          if (v * exact > best) best = v * exact;
        }
        if (!best) return null;
        score += best;
      }
      if (t.indexOf(q.toLowerCase().trim()) >= 0) score += 15;     // the whole phrase in the title
      return { a: a, score: score };
    }).filter(Boolean).sort(function (p, q2) { return q2.score - p.score; }).map(function (r) { return r.a; });
  }
  function noneText(q) {
    return 'No articles match. Try fewer words, or <a href="mailto:hello@getclearly.app?subject=' + encodeURIComponent('Help with Clearly: ' + q.slice(0, 80)) + '">email us</a> and a person will answer.';
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
          : '<div class="none">' + noneText(q) + '</div>';
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

  // Press / anywhere to search (unless you're already typing)
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var first = document.querySelector('[data-sp-search]'); if (!first) return;
    e.preventDefault(); first.focus(); first.select();
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
        : '<p>No articles match "' + esc(q) + '". Try fewer or different words, <a href="/support/">browse all topics</a>, or <a href="mailto:hello@getclearly.app?subject=' + encodeURIComponent('Help with Clearly: ' + q.slice(0, 80)) + '">email us</a> and a person will answer.</p>';
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
