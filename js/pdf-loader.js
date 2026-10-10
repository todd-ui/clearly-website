// Loads the PDF library (about 360 KB) only for people about to download a PDF,
// from this site (the Content Security Policy only allows our own scripts).
// It starts fetching when the Download PDF button scrolls into view, so the
// download is usually instant; downloadPDF() also waits for it if needed.
(function () {
  var SRC = '/js/vendor/jspdf-2.5.1.umd.min.js';
  var pending = null;

  window.loadJsPDF = function () {
    if (window.jspdf) return Promise.resolve();
    if (pending) return pending;
    pending = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { pending = null; reject(new Error('PDF library failed to load')); };
      document.head.appendChild(s);
    });
    return pending;
  };

  function preload() { window.loadJsPDF().catch(function () {}); }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.btn-download');
    if (!btn) return;
    btn.addEventListener('pointerdown', preload, { once: true });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { preload(); io.disconnect(); }
      });
      io.observe(btn);
    }
  });
})();
