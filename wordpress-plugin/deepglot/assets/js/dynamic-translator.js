/**
 * Deepglot dynamic-content translator.
 *
 * The server-side output-buffer pass (HtmlTranslator) translates the initial,
 * crawlable HTML. This script is progressive enhancement: it watches the DOM
 * for content added AFTER load — AJAX results, infinite scroll, cart drawers,
 * SPA widgets — and translates only those new nodes through a same-origin
 * WordPress REST proxy, so the Deepglot API key never reaches the browser.
 *
 * SEO is unaffected: search engines receive the fully server-translated page
 * and rarely execute this script; it only enhances live human interaction.
 *
 * Config arrives via wp_localize_script as `window.deepglotDynamic`. The skip
 * rules come from PHP (TranslationRules) so this file hard-codes no tag list.
 */
(function () {
  'use strict';

  var cfg = window.deepglotDynamic;
  if (!cfg || !cfg.endpoint || !cfg.langTo || cfg.langTo === cfg.langFrom) {
    return;
  }

  var skipTags = Object.create(null);
  (cfg.skipTags || []).forEach(function (tag) {
    skipTags[String(tag).toLowerCase()] = true;
  });

  var noTranslateAttr = cfg.noTranslateAttr || 'data-deepglot-no-translate';
  var minLength = cfg.minLength || 2;
  var batchSize = cfg.batchSize || 200;
  var maxTextLength = cfg.maxTextLength || 5000;

  var classSelectors = [];
  var idSelectors = [];
  (cfg.excludeSelectors || []).forEach(function (selector) {
    selector = String(selector);
    if (selector.charAt(0) === '.' && selector.length > 1) {
      classSelectors.push(selector.slice(1));
    } else if (selector.charAt(0) === '#' && selector.length > 1) {
      idSelectors.push(selector.slice(1));
    }
  });

  // Mirrors TranslationRules::NUMERIC_PUNCT_PATTERN — purely numeric /
  // punctuation strings carry no translatable copy.
  var NUMERIC_PUNCT = /^[\d\s\p{P}\p{S}]+$/u;
  var WHITESPACE = /^(\s*)([\s\S]*?)(\s*)$/;

  var translated = Object.create(null); // trimmed source  -> translation
  var inflight = Object.create(null);    // trimmed source  -> awaiting response
  var processed = new WeakSet();          // text nodes already translated
  var pending = [];                       // {node, trimmed, prefix, suffix}
  var flushTimer = null;
  var observer = null;
  var OBSERVE = { childList: true, subtree: true, characterData: true };

  /** True when the node or any ancestor opts out of translation. */
  function excluded(el) {
    while (el && el.nodeType === 1) {
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (skipTags[tag]) return true;
      if (el.hasAttribute(noTranslateAttr)) return true;
      var translate = el.getAttribute('translate');
      if (translate && translate.toLowerCase() === 'no') return true;
      if (idSelectors.length && el.id && idSelectors.indexOf(el.id) !== -1) return true;
      if (classSelectors.length && el.classList) {
        for (var i = 0; i < classSelectors.length; i++) {
          if (el.classList.contains(classSelectors[i])) return true;
        }
      }
      el = el.parentNode;
    }
    return false;
  }

  function consider(node) {
    if (!node || node.nodeType !== 3 || processed.has(node) || !node.data) return;
    var parts = node.data.match(WHITESPACE);
    var trimmed = parts ? parts[2] : node.data.trim();
    if (trimmed.length < minLength || trimmed.length > maxTextLength) return;
    if (NUMERIC_PUNCT.test(trimmed)) return;
    if (excluded(node.parentNode)) return;
    pending.push({
      node: node,
      trimmed: trimmed,
      prefix: parts ? parts[1] : '',
      suffix: parts ? parts[3] : ''
    });
  }

  /** Collect translatable text nodes inside a freshly added subtree. */
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { consider(root); return; }
    if (root.nodeType !== 1 || excluded(root)) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      consider(node);
    }
  }

  function scheduleFlush() {
    if (flushTimer === null) {
      flushTimer = window.setTimeout(flush, 200);
    }
  }

  /** Write every pending node whose translation is already known. */
  function applyPending() {
    if (!pending.length) return;
    var remaining = [];
    if (observer) observer.disconnect();
    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      var value = translated[item.trimmed];
      if (value == null) {
        remaining.push(item);
        continue;
      }
      if (!processed.has(item.node) && item.node.parentNode) {
        item.node.data = item.prefix + value + item.suffix;
        processed.add(item.node);
      }
    }
    pending = remaining;
    if (observer && document.body) observer.observe(document.body, OBSERVE);
  }

  function flush() {
    flushTimer = null;
    applyPending();

    var need = [];
    var seen = Object.create(null);
    for (var i = 0; i < pending.length; i++) {
      var text = pending[i].trimmed;
      if (translated[text] != null || inflight[text] || seen[text]) continue;
      seen[text] = true;
      need.push(text);
    }
    if (!need.length) return;

    for (var start = 0; start < need.length; start += batchSize) {
      var chunk = need.slice(start, start + batchSize);
      chunk.forEach(function (text) { inflight[text] = true; });
      request(chunk);
    }
  }

  function request(texts) {
    fetch(cfg.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce || '' },
      body: JSON.stringify({ texts: texts, lang_to: cfg.langTo })
    }).then(function (response) {
      return response.ok ? response.json() : null;
    }).then(function (data) {
      if (data && Array.isArray(data.from_words) && Array.isArray(data.to_words)) {
        for (var i = 0; i < data.from_words.length; i++) {
          var from = data.from_words[i];
          var to = data.to_words[i];
          if (typeof from === 'string' && typeof to === 'string') {
            translated[from] = to;
          }
        }
      }
    }).catch(function () {
      // Fail open: leave the source text untouched.
    }).then(function () {
      texts.forEach(function (text) { delete inflight[text]; });
      applyPending();
    });
  }

  function onMutations(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type === 'characterData') {
        consider(mutation.target);
      } else if (mutation.addedNodes) {
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          walk(mutation.addedNodes[j]);
        }
      }
    }
    if (pending.length) scheduleFlush();
  }

  function start() {
    if (!document.body) return;
    // The initial DOM is already server-translated — only watch for additions.
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, OBSERVE);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
