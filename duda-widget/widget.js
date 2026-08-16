function initWidget(element, data, api) {
  'use strict';

  var root = element.querySelector('.aw-faq');
  if (!root) return;

  var list = root.querySelector('[data-aw-faq-list]');
  var singleOpen = String(root.getAttribute('data-single-open')) === 'true';

  function hasContent() {
    return list && list.querySelector('.faq-item');
  }

  // Wraps each question in a button and animates its panel. Runs once per list.
  function enhance() {
    if (!hasContent() || list.hasAttribute('data-aw-ready')) return;
    list.setAttribute('data-aw-ready', '');
    list.classList.add('is-enhanced');

    var items = list.querySelectorAll('.faq-item');

    Array.prototype.forEach.call(items, function (item, i) {
      var heading = item.querySelector('.faq-question');
      var answer = item.querySelector('.faq-answer');
      if (!heading || !answer) return;

      var uid = 'aw-faq-' + Date.now().toString(36) + '-' + i;

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'aw-faq__toggle';
      button.id = uid + '-label';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', uid);
      button.innerHTML = heading.innerHTML + '<span class="aw-faq__chevron" aria-hidden="true"></span>';

      heading.innerHTML = '';
      heading.appendChild(button);

      answer.id = uid;
      answer.setAttribute('role', 'region');
      answer.setAttribute('aria-labelledby', button.id);
      answer.style.maxHeight = '0px';

      button.addEventListener('click', function () {
        if (item.classList.contains('is-open')) {
          close(item);
        } else {
          if (singleOpen) {
            Array.prototype.forEach.call(items, function (other) {
              if (other !== item) close(other);
            });
          }
          open(item);
        }
      });

      // Let an open panel grow if its content reflows.
      answer.addEventListener('transitionend', function (e) {
        if (e.propertyName === 'max-height' && item.classList.contains('is-open')) {
          answer.style.maxHeight = 'none';
        }
      });
    });
  }

  function open(item) {
    var answer = item.querySelector('.faq-answer');
    var button = item.querySelector('.aw-faq__toggle');
    if (!answer) return;
    item.classList.add('is-open');
    if (button) button.setAttribute('aria-expanded', 'true');
    answer.style.maxHeight = answer.scrollHeight + 'px';
  }

  function close(item) {
    var answer = item.querySelector('.faq-answer');
    var button = item.querySelector('.aw-faq__toggle');
    if (!answer || !item.classList.contains('is-open')) return;
    // Pin the current height first so the transition has somewhere to animate from.
    answer.style.maxHeight = answer.scrollHeight + 'px';
    requestAnimationFrame(function () {
      item.classList.remove('is-open');
      if (button) button.setAttribute('aria-expanded', 'false');
      answer.style.maxHeight = '0px';
    });
  }

  // Fallback for static pages, where there is no collection to bind faqHtml to.
  function fetchFaq() {
    var id = root.getAttribute('data-bokun-id');
    var endpoint = root.getAttribute('data-endpoint') || 'https://bokun-api.vercel.app/api/collection';
    if (!id || !list) return;

    root.classList.add('is-loading');

    fetch(endpoint + (endpoint.indexOf('?') > -1 ? '&' : '?') + 'id=' + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (rows) {
        var match = (rows || []).filter(function (row) {
          return row && row.data && String(row.data.id) === String(id);
        })[0];

        root.classList.remove('is-loading');
        if (!match || !match.data.faq) { root.classList.add('is-empty'); return; }

        list.innerHTML = match.data.faq;
        enhance();

        if (match.data.faqSchema && !root.querySelector('script[type="application/ld+json"]')) {
          var tag = document.createElement('script');
          tag.type = 'application/ld+json';
          tag.textContent = match.data.faqSchema;
          root.appendChild(tag);
        }
      })
      .catch(function () {
        root.classList.remove('is-loading');
        root.classList.add('is-empty');
      });
  }

  if (hasContent()) {
    enhance();
  } else {
    fetchFaq();
  }
}
