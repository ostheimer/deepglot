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
 * and rarely run this script; it only enhances live human interaction.
 *
 * Config arrives via wp_localize_script as `window.deepglotDynamic`. The skip
 * rules and translatable-attribute whitelist come from PHP (TranslationRules)
 * so this file hard-codes no tag/attribute list.
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

  // Element/attribute copy (alt, aria-label, placeholder, option labels, …) so
  // SPA-injected elements that carry only such an attribute still get localized.
  var attrMap = cfg.attrMap || {};
  var inputValueTypes = Object.create(null);
  (cfg.inputValueTypes || []).forEach(function (type) {
    inputValueTypes[String(type).toLowerCase()] = true;
  });
  var hasAttrTargets =
    Object.keys(attrMap).length > 0 || Object.keys(inputValueTypes).length > 0;

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

  // Mirrors TranslationRules::NUMERIC_PUNCT_PATTERN.
  var NUMERIC_PUNCT = /^[\d\s\p{P}\p{S}]+$/u;
  var WHITESPACE = /^(\s*)([\s\S]*?)(\s*)$/;

  var translated = Object.create(null); // trimmed source -> translation
  var inflight = Object.create(null);    // trimmed source -> awaiting response
  var processedNodes = new WeakMap();     // text node -> translated text last written
  var processedAttrs = new WeakMap();     // element -> { attrName: translated text last written }
  var pendingNodes = [];                  // {node, trimmed, prefix, suffix}
  var pendingAttrs = [];                  // {el, attr, trimmed}
  var flushTimer = null;
  var observer = null;
  var observedAttrs = Object.create(null);
  Object.keys(attrMap).forEach(function (tag) {
    (attrMap[tag] || []).forEach(function (attr) {
      observedAttrs[attr] = true;
    });
  });
  if (Object.keys(inputValueTypes).length > 0) {
    observedAttrs.value = true;
  }

  var OBSERVE = { childList: true, subtree: true, characterData: true };
  var attributeFilter = Object.keys(observedAttrs);
  if (attributeFilter.length > 0) {
    OBSERVE.attributes = true;
    OBSERVE.attributeFilter = attributeFilter;
  }

  function translatable(trimmed) {
    return trimmed.length >= minLength &&
      trimmed.length <= maxTextLength &&
      !NUMERIC_PUNCT.test(trimmed);
  }

  /** True when the node or any ancestor opts out of translation. */
  function excluded(el) {
    var contentEditableDecided = false;
    while (el && el.nodeType === 1) {
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (skipTags[tag]) return true;
      if (!contentEditableDecided && el.hasAttribute('contenteditable')) {
        var editable = (el.getAttribute('contenteditable') || '').toLowerCase();
        if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
        if (editable === 'false') contentEditableDecided = true;
      }
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

  function splitWhitespace(value) {
    var parts = String(value).match(WHITESPACE);
    return {
      prefix: parts ? parts[1] : '',
      trimmed: parts ? parts[2] : String(value).trim(),
      suffix: parts ? parts[3] : ''
    };
  }

  function consider(node) {
    if (!node || node.nodeType !== 3 || !node.data) return;
    var split = splitWhitespace(node.data);
    if (processedNodes.get(node) === split.trimmed) return;
    if (!translatable(split.trimmed)) return;
    if (excluded(node.parentNode)) return;
    pendingNodes.push({ node: node, trimmed: split.trimmed, prefix: split.prefix, suffix: split.suffix });
  }

  function attrSeen(el, attr, trimmed) {
    var seen = processedAttrs.get(el);
    return !!(seen && seen[attr] === trimmed);
  }

  function markAttr(el, attr, trimmed) {
    var seen = processedAttrs.get(el);
    if (!seen) { seen = Object.create(null); processedAttrs.set(el, seen); }
    seen[attr] = trimmed;
  }

  function considerAttr(el, attr) {
    var trimmed = (el.getAttribute(attr) || '').trim();
    if (attrSeen(el, attr, trimmed) || !el.hasAttribute(attr)) return;
    if (!translatable(trimmed)) return;
    pendingAttrs.push({ el: el, attr: attr, trimmed: trimmed });
  }

  function considerElementAttrs(el) {
    if (!el || el.nodeType !== 1) return;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var attrs = attrMap[tag];
    if (!attrs && tag !== 'input') return;
    if (excluded(el)) return;
    if (attrs) {
      for (var i = 0; i < attrs.length; i++) considerAttr(el, attrs[i]);
    }
    // <input value> is UI copy only for button-like types.
    if (tag === 'input') {
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (inputValueTypes[type]) considerAttr(el, 'value');
    }
  }

  /** Collect translatable text nodes + attributes inside a fresh subtree. */
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { consider(root); return; }
    if (root.nodeType !== 1 || excluded(root)) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) consider(node);
    if (hasAttrTargets) {
      considerElementAttrs(root);
      var elements = root.querySelectorAll('*');
      for (var i = 0; i < elements.length; i++) considerElementAttrs(elements[i]);
    }
  }

  function scheduleFlush() {
    if (flushTimer === null) {
      flushTimer = window.setTimeout(flush, 200);
    }
  }

  /** Write every pending node/attribute whose translation is already known. */
  function applyPending() {
    if (!pendingNodes.length && !pendingAttrs.length) return;
    if (observer) observer.disconnect();

    var remainingNodes = [];
    for (var i = 0; i < pendingNodes.length; i++) {
      var item = pendingNodes[i];
      var value = translated[item.trimmed];
      if (value == null) { remainingNodes.push(item); continue; }
      if (!item.node.parentNode) continue;
      // Skip if the node changed while its translation was in flight — its new
      // text already has its own pending entry (a characterData mutation), so
      // we must not overwrite live UI with a stale translation or mark it done.
      if (splitWhitespace(item.node.data).trimmed === item.trimmed) {
        item.node.data = item.prefix + value + item.suffix;
        processedNodes.set(item.node, splitWhitespace(item.node.data).trimmed);
      }
    }
    pendingNodes = remainingNodes;

    var remainingAttrs = [];
    for (var j = 0; j < pendingAttrs.length; j++) {
      var attrItem = pendingAttrs[j];
      var attrValue = translated[attrItem.trimmed];
      if (attrValue == null) { remainingAttrs.push(attrItem); continue; }
      if (!attrItem.el.hasAttribute(attrItem.attr)) continue;
      if ((attrItem.el.getAttribute(attrItem.attr) || '').trim() === attrItem.trimmed) {
        attrItem.el.setAttribute(attrItem.attr, attrValue);
        markAttr(attrItem.el, attrItem.attr, (attrItem.el.getAttribute(attrItem.attr) || '').trim());
      }
    }
    pendingAttrs = remainingAttrs;

    if (observer && document.body) observer.observe(document.body, OBSERVE);
  }

  function flush() {
    flushTimer = null;
    applyPending();

    var need = [];
    var seen = Object.create(null);
    function addNeed(text) {
      if (translated[text] != null || inflight[text] || seen[text]) return;
      seen[text] = true;
      need.push(text);
    }
    for (var i = 0; i < pendingNodes.length; i++) addNeed(pendingNodes[i].trimmed);
    for (var j = 0; j < pendingAttrs.length; j++) addNeed(pendingAttrs[j].trimmed);
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
      var handled = Object.create(null);
      if (data && Array.isArray(data.from_words) && Array.isArray(data.to_words)) {
        for (var i = 0; i < data.from_words.length; i++) {
          var from = data.from_words[i];
          var to = data.to_words[i];
          if (typeof from === 'string' && typeof to === 'string') {
            translated[from] = to;
            handled[from] = true;
          }
        }
      }
      if (data) {
        texts.forEach(function (text) {
          if (!handled[text]) translated[text] = text;
        });
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
      } else if (mutation.type === 'attributes') {
        considerElementAttrs(mutation.target);
      } else if (mutation.addedNodes) {
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          walk(mutation.addedNodes[j]);
        }
      }
    }
    if (pendingNodes.length || pendingAttrs.length) scheduleFlush();
  }

  function start() {
    if (!document.body) return;
    // The initial DOM is already server-translated — only watch for additions.
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, OBSERVE);
  }

  // This script loads in the footer, so document.body already exists: start
  // immediately to catch content injected before DOMContentLoaded. Only defer
  // when (unusually) the body is not yet present.
  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
