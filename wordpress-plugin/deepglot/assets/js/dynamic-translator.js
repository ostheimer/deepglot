/**
 * Deepglot dynamic-content translator.
 *
 * The server-side output-buffer pass (HtmlTranslator) translates the initial,
 * crawlable HTML. This script is progressive enhancement: it watches the DOM
 * for content added or changed AFTER load — AJAX results, infinite scroll,
 * cart drawers, SPA widgets — and translates only those nodes through a
 * same-origin WordPress REST proxy, so the Deepglot API key never reaches the
 * browser.
 *
 * SEO is unaffected: search engines receive the fully server-translated page
 * and rarely run this script; it only enhances live human interaction.
 *
 * Config arrives via wp_localize_script as `window.deepglotDynamic`. The skip
 * rules and translatable-attribute whitelist come from PHP (TranslationRules)
 * so this file hard-codes no tag/attribute list. Source text is sent untrimmed
 * so cache keys match the server pass (which caches raw DOMText values).
 */
(function () {
  'use strict';

  var cfg = window.deepglotDynamic;
  if (!cfg || !cfg.endpoint || !cfg.langTo || cfg.langTo === cfg.langFrom) {
    return;
  }

  function toSet(list) {
    var set = Object.create(null);
    (list || []).forEach(function (item) { set[String(item).toLowerCase()] = true; });
    return set;
  }

  // Text content is skipped inside these tags; attribute copy uses a narrower
  // set (e.g. a <textarea> placeholder IS translated even though its text is not).
  var skipTags = toSet(cfg.skipTags);
  var attrSkipTags = toSet(cfg.attrSkipTags || ['script', 'style', 'noscript', 'template']);

  var noTranslateAttr = cfg.noTranslateAttr || 'data-deepglot-no-translate';
  var minLength = cfg.minLength || 2;
  var batchSize = cfg.batchSize || 200;
  var maxTextLength = cfg.maxTextLength || 5000;

  // Element/attribute copy (alt, aria-label, placeholder, option labels, …) so
  // SPA-injected elements that carry only such an attribute still get localized.
  var attrMap = cfg.attrMap || {};
  var inputValueTypes = toSet(cfg.inputValueTypes);
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

  var translated = Object.create(null); // raw source -> translation
  var inflight = Object.create(null);    // raw source -> awaiting response
  var processedNodes = new WeakMap();     // text node -> raw value last written
  var processedAttrs = new WeakMap();     // element -> { attrName: raw value last written }
  var pendingNodes = [];                  // {node, key}
  var pendingAttrs = [];                  // {el, attr, key}
  var flushTimer = null;
  var observer = null;

  var observedAttrs = Object.create(null);
  Object.keys(attrMap).forEach(function (tag) {
    (attrMap[tag] || []).forEach(function (attr) { observedAttrs[attr] = true; });
  });
  if (Object.keys(inputValueTypes).length > 0) observedAttrs.value = true;

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

  /**
   * True when the node or any ancestor opts out of translation. `skipSet` is
   * SKIP_TAGS for text nodes and the narrower ATTR_SKIP_ANCESTORS for
   * attributes. `translate="no"` on the document root is ignored: the server
   * pass stamps `<html translate="no">` to block browser auto-translation, and
   * honoring it here would suppress every dynamic node on translated pages.
   */
  function isExcluded(el, skipSet) {
    var contentEditableDecided = false;
    while (el && el.nodeType === 1) {
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (skipSet[tag]) return true;
      if (!contentEditableDecided && el.hasAttribute('contenteditable')) {
        var editable = (el.getAttribute('contenteditable') || '').toLowerCase();
        if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
        if (editable === 'false') contentEditableDecided = true;
      }
      if (el.hasAttribute(noTranslateAttr)) return true;
      var translate = el.getAttribute('translate');
      if (translate && translate.toLowerCase() === 'no' && tag !== 'html') return true;
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

  function excludedText(el) { return isExcluded(el, skipTags); }
  function excludedAttr(el) { return isExcluded(el, attrSkipTags); }

  function consider(node) {
    if (!node || node.nodeType !== 3 || node.data == null) return;
    var raw = node.data;
    if (processedNodes.get(node) === raw) return; // already showing our translation
    if (!translatable(raw.trim())) return;
    if (excludedText(node.parentNode)) return;
    pendingNodes.push({ node: node, key: raw });
  }

  function attrSeen(el, attr, raw) {
    var seen = processedAttrs.get(el);
    return !!(seen && seen[attr] === raw);
  }

  function markAttr(el, attr, raw) {
    var seen = processedAttrs.get(el);
    if (!seen) { seen = Object.create(null); processedAttrs.set(el, seen); }
    seen[attr] = raw;
  }

  function considerAttr(el, attr) {
    if (!el.hasAttribute(attr)) return;
    var raw = el.getAttribute(attr) || '';
    if (attrSeen(el, attr, raw)) return;
    if (!translatable(raw.trim())) return;
    pendingAttrs.push({ el: el, attr: attr, key: raw });
  }

  function considerInputValue(el) {
    var raw = el.value == null ? '' : String(el.value);
    if (attrSeen(el, 'value', raw)) return;
    if (!translatable(raw.trim())) return;
    pendingAttrs.push({ el: el, attr: 'value', key: raw, prop: true });
  }

  function considerElementAttrs(el) {
    if (!el || el.nodeType !== 1) return;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var attrs = attrMap[tag];
    if (!attrs && tag !== 'input') return;
    if (excludedAttr(el)) return;
    if (attrs) {
      for (var i = 0; i < attrs.length; i++) considerAttr(el, attrs[i]);
    }
    // <input value> is UI copy only for button-like types.
    if (tag === 'input') {
      var type = (el.getAttribute('type') || el.type || '').toLowerCase();
      if (inputValueTypes[type]) considerInputValue(el);
    }
  }

  /** Collect translatable text nodes + attributes inside a fresh subtree. */
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { consider(root); return; }
    if (root.nodeType !== 1) return;
    // Text and attribute exclusion differ (textarea), so gate them separately.
    if (!excludedText(root)) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) consider(node);
    }
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
      var value = translated[item.key];
      if (value == null) { remainingNodes.push(item); continue; }
      if (!item.node.parentNode) continue;
      // Skip if the node changed while its translation was in flight — its new
      // value already has its own pending entry, so we must not overwrite live
      // UI with a stale translation.
      if (item.node.data === item.key) {
        item.node.data = value;
        processedNodes.set(item.node, value);
      }
    }
    pendingNodes = remainingNodes;

    var remainingAttrs = [];
    for (var j = 0; j < pendingAttrs.length; j++) {
      var attrItem = pendingAttrs[j];
      var attrValue = translated[attrItem.key];
      if (attrValue == null) { remainingAttrs.push(attrItem); continue; }
      if (attrItem.prop) {
        if ((attrItem.el.value == null ? '' : String(attrItem.el.value)) === attrItem.key) {
          attrItem.el.value = attrValue;
          markAttr(attrItem.el, attrItem.attr, attrValue);
        }
        continue;
      }
      if (!attrItem.el.hasAttribute(attrItem.attr)) continue;
      if ((attrItem.el.getAttribute(attrItem.attr) || '') === attrItem.key) {
        attrItem.el.setAttribute(attrItem.attr, attrValue);
        markAttr(attrItem.el, attrItem.attr, attrValue);
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
    for (var i = 0; i < pendingNodes.length; i++) addNeed(pendingNodes[i].key);
    for (var j = 0; j < pendingAttrs.length; j++) addNeed(pendingAttrs[j].key);
    if (!need.length) return;

    for (var start = 0; start < need.length; start += batchSize) {
      var chunk = need.slice(start, start + batchSize);
      chunk.forEach(function (text) { inflight[text] = true; });
      request(chunk);
    }
  }

  /** Record real translations; map anything not returned to itself (no-op). */
  function ingest(texts, data) {
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
    texts.forEach(function (text) { if (!handled[text]) translated[text] = text; });
  }

  function finalize(texts) {
    texts.forEach(function (text) { delete inflight[text]; });
    applyPending();
  }

  function request(texts) { send(texts, false); }

  function send(texts, withoutNonce) {
    var headers = { 'Content-Type': 'application/json' };
    if (!withoutNonce && cfg.nonce) headers['X-WP-Nonce'] = cfg.nonce;

    fetch(cfg.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: JSON.stringify({ texts: texts, lang_to: cfg.langTo })
    }).then(function (response) {
      // A stale full-page-cache nonce is rejected by WP core (403) before our
      // cache-only fallback runs; retry once WITHOUT the nonce to reach it.
      if (response && response.status === 403 && !withoutNonce) {
        send(texts, true);
        return null;
      }
      if (!response || !response.ok) { ingest(texts, null); finalize(texts); return null; }
      return response.json().then(function (data) {
        ingest(texts, data || {});
        finalize(texts);
      }).catch(function () {
        ingest(texts, null);
        finalize(texts);
      });
    }).catch(function () {
      // Fail open: drop these strings (mark as no-op) so they are not resent.
      ingest(texts, null);
      finalize(texts);
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
    // The initial DOM is already server-translated — only watch for changes.
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
