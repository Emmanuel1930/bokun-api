/* ---------------------------------------------------------------------------
   FAQ accordion behaviour — Arabian Wanderers

   Paste into: Duda > Site Settings > Custom Code > Body End (wrapped in <script>).
   Add it ONCE for the whole site, not per page.

   Progressive enhancement, deliberately:
   the server sends every question AND answer as plain HTML, so a crawler (and any
   visitor without JS) sees the full text. This script only adds the collapse
   behaviour on top. If it fails to load, the FAQ degrades to a readable Q&A list
   rather than disappearing.

   Pairs with faq-styles.css, which keeps answers visible until `faq-js` is set.
--------------------------------------------------------------------------- */
(function () {
  'use strict';

  var LIST = '.faq-list';
  var READY = 'data-faq-ready';

  function enhance(list) {
    if (list.hasAttribute(READY)) return;
    list.setAttribute(READY, '');
    list.classList.add('faq-js');

    var items = list.querySelectorAll('.faq-item');

    Array.prototype.forEach.call(items, function (item, i) {
      var heading = item.querySelector('.faq-question');
      var answer = item.querySelector('.faq-answer');
      if (!heading || !answer) return;

      var uid = 'faq-' + Date.now().toString(36) + '-' + i;

      // Wrap the heading text in a real button: keyboard, screen readers and
      // browser find-in-page all behave correctly, and the h3 stays an h3.
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'faq-toggle';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', uid);
      button.innerHTML = heading.innerHTML;

      heading.innerHTML = '';
      heading.appendChild(button);

      answer.id = uid;
      answer.setAttribute('role', 'region');
      answer.setAttribute('aria-labelledby', uid + '-label');
      button.id = uid + '-label';

      button.addEventListener('click', function () {
        var isOpen = item.classList.contains('is-open');

        // One open at a time, matching the client's reference design.
        Array.prototype.forEach.call(items, function (other) {
          if (other === item) return;
          other.classList.remove('is-open');
          var b = other.querySelector('.faq-toggle');
          if (b) b.setAttribute('aria-expanded', 'false');
        });

        item.classList.toggle('is-open', !isOpen);
        button.setAttribute('aria-expanded', String(!isOpen));
      });
    });
  }

  function init() {
    var lists = document.querySelectorAll(LIST);
    Array.prototype.forEach.call(lists, enhance);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Duda renders dynamic-page content asynchronously in some templates, so watch
  // for a .faq-list that arrives after first paint.
  if (window.MutationObserver) {
    var observer = new MutationObserver(function () { init(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Stop watching once the page has settled; the FAQ is server-rendered.
    setTimeout(function () { observer.disconnect(); }, 10000);
  }
})();
