const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.resolve(__dirname, '../assets/js/dynamic-translator.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

function createHarness(fetchHandler) {
  const timers = [];
  const fetchCalls = [];
  let observerId = 0;

  class FakeText {
    constructor(data) {
      this.nodeType = 3;
      this.parentNode = null;
      this._data = data;
    }

    get data() {
      return this._data;
    }

    set data(value) {
      const next = String(value);
      if (next === this._data) return;
      this._data = next;
      notify({ type: 'characterData', target: this });
    }
  }

  class FakeClassList {
    constructor(element) {
      this.element = element;
    }

    contains(name) {
      return (this.element.getAttribute('class') || '')
        .split(/\s+/)
        .filter(Boolean)
        .includes(name);
    }
  }

  class FakeElement {
    constructor(tagName) {
      this.nodeType = 1;
      this.tagName = String(tagName).toUpperCase();
      this.parentNode = null;
      this.childNodes = [];
      this.attributes = Object.create(null);
      this.id = '';
      this.value = '';
      this.classList = new FakeClassList(this);
    }

    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      notify({ type: 'childList', target: this, addedNodes: [child] });
      return child;
    }

    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    }

    getAttribute(name) {
      return this.hasAttribute(name) ? this.attributes[name] : null;
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') this.id = String(value);
      notify({ type: 'attributes', target: this, attributeName: name });
    }

    querySelectorAll(selector) {
      assert.equal(selector, '*', 'test DOM only implements querySelectorAll("*")');
      const elements = [];
      function visit(node) {
        if (!node || !node.childNodes) return;
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            elements.push(child);
            visit(child);
          }
        }
      }
      visit(this);
      return elements;
    }
  }

  function contains(root, node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === root) return true;
    }
    return false;
  }

  const observers = [];

  function notify(mutation) {
    for (const observer of observers) {
      if (!observer.active || !observer.target || !observer.options) continue;
      if (mutation.type === 'childList' && !observer.options.childList) continue;
      if (mutation.type === 'characterData' && !observer.options.characterData) continue;
      if (mutation.type === 'attributes') {
        if (!observer.options.attributes) continue;
        if (observer.options.attributeFilter && !observer.options.attributeFilter.includes(mutation.attributeName)) {
          continue;
        }
      }
      if (mutation.target !== observer.target && !(observer.options.subtree && contains(observer.target, mutation.target))) {
        continue;
      }
      observer.callback([mutation]);
    }
  }

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      this.target = null;
      this.options = null;
      this.id = ++observerId;
    }

    observe(target, options) {
      this.target = target;
      this.options = { ...options };
      this.active = true;
      if (!observers.includes(this)) observers.push(this);
    }

    disconnect() {
      this.active = false;
    }
  }

  const document = {
    body: new FakeElement('body'),
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (data) => new FakeText(data),
    addEventListener: () => {},
    createTreeWalker(root) {
      const textNodes = [];
      function visit(node) {
        if (node.nodeType === 3) {
          textNodes.push(node);
          return;
        }
        if (!node.childNodes) return;
        for (const child of node.childNodes) visit(child);
      }
      visit(root);
      let index = 0;
      return {
        nextNode() {
          return textNodes[index++] || null;
        },
      };
    },
  };

  const window = {
    deepglotDynamic: {
      endpoint: '/wp-json/deepglot/v1/translate-dynamic',
      nonce: 'test-nonce',
      langFrom: 'de',
      langTo: 'en',
      skipTags: ['script', 'style', 'pre', 'code', 'textarea', 'noscript', 'svg', 'math'],
      excludeSelectors: [],
      noTranslateAttr: 'data-deepglot-no-translate',
      attrSkipTags: ['script', 'style', 'noscript', 'template'],
      attrMap: {
        img: ['alt'],
        button: ['title', 'aria-label'],
        input: ['placeholder', 'aria-label'],
        textarea: ['placeholder', 'aria-label'],
      },
      inputValueTypes: ['submit', 'button', 'reset'],
      minLength: 2,
      batchSize: 200,
      maxTextLength: 5000,
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
  };

  const context = {
    window,
    document,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: FakeMutationObserver,
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      fetchCalls.push(payload.texts);
      return fetchHandler(payload.texts, options);
    },
  };

  vm.runInNewContext(scriptSource, context, { filename: scriptPath });

  async function runTimers() {
    while (timers.length > 0) {
      const callback = timers.shift();
      callback();
      for (let i = 0; i < 50; i++) {
        await Promise.resolve();
      }
    }
  }

  return { document, fetchCalls, runTimers };
}

function jsonResponse(body) {
  return {
    ok: true,
    json: async () => body,
  };
}

function translationResponse(texts, translations) {
  return jsonResponse({
    from_words: texts.filter((text) => Object.prototype.hasOwnProperty.call(translations, text)),
    to_words: texts
      .filter((text) => Object.prototype.hasOwnProperty.call(translations, text))
      .map((text) => translations[text]),
  });
}

async function testProcessedTextNodeCanBeTranslatedAfterChanging() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    '1 item': '1 Artikel',
    '2 items': '2 Artikel',
  }));

  const text = harness.document.createTextNode('1 item');
  harness.document.body.appendChild(text);
  await harness.runTimers();
  assert.equal(text.data, '1 Artikel');

  text.data = '2 items';
  await harness.runTimers();

  assert.deepEqual(harness.fetchCalls, [['1 item'], ['2 items']]);
  assert.equal(text.data, '2 Artikel');
}

async function testAttributeMutationsAreTranslated() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    Search: 'Suchen',
  }));

  const input = harness.document.createElement('input');
  harness.document.body.appendChild(input);
  input.setAttribute('placeholder', 'Search');
  await harness.runTimers();

  assert.deepEqual(harness.fetchCalls, [['Search']]);
  assert.equal(input.getAttribute('placeholder'), 'Suchen');
}

async function testPropertyOnlyButtonInputValueIsTranslatedOnInsert() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    Checkout: 'Zur Kasse',
  }));

  const input = harness.document.createElement('input');
  input.setAttribute('type', 'submit');
  input.value = 'Checkout';
  harness.document.body.appendChild(input);
  await harness.runTimers();

  assert.deepEqual(harness.fetchCalls, [['Checkout']]);
  assert.equal(input.value, 'Zur Kasse');
  assert.equal(input.hasAttribute('value'), false);
}

async function testContentEditableTextIsSkipped() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    'Draft message': 'Entwurf',
  }));

  const editor = harness.document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  const text = harness.document.createTextNode('');
  editor.appendChild(text);
  harness.document.body.appendChild(editor);

  text.data = 'Draft message';
  await harness.runTimers();

  assert.deepEqual(harness.fetchCalls, []);
  assert.equal(text.data, 'Draft message');
}

async function testEmptyResponsesDropOldPendingItems() {
  const harness = createHarness(async (texts) => {
    if (texts.includes('Missing')) {
      return jsonResponse({ from_words: [], to_words: [] });
    }
    return translationResponse(texts, { Other: 'Andere' });
  });

  const missing = harness.document.createTextNode('Missing');
  harness.document.body.appendChild(missing);
  await harness.runTimers();
  assert.deepEqual(harness.fetchCalls, [['Missing']]);
  assert.equal(missing.data, 'Missing');

  const other = harness.document.createTextNode('Other');
  harness.document.body.appendChild(other);
  await harness.runTimers();

  assert.deepEqual(harness.fetchCalls, [['Missing'], ['Other']]);
  assert.equal(other.data, 'Andere');
}

async function testRootTranslateNoIsIgnored() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    Hello: 'Hallo',
  }));

  // The server pass stamps <html translate="no"> to block browser auto-
  // translation; the dynamic pass must NOT treat that root marker as an opt-out
  // or it would suppress every dynamic node on translated pages.
  const html = harness.document.createElement('html');
  html.setAttribute('translate', 'no');
  harness.document.body.parentNode = html;

  const text = harness.document.createTextNode('Hello');
  harness.document.body.appendChild(text);
  await harness.runTimers();

  assert.deepEqual(harness.fetchCalls, [['Hello']]);
  assert.equal(text.data, 'Hallo');
}

async function testTextareaPlaceholderIsTranslated() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    Search: 'Suchen',
  }));

  const textarea = harness.document.createElement('textarea');
  harness.document.body.appendChild(textarea);
  textarea.setAttribute('placeholder', 'Search');
  await harness.runTimers();

  // textarea text content stays untranslated, but its whitelisted placeholder
  // is translated (attribute exclusion uses the narrower ATTR_SKIP_ANCESTORS).
  assert.deepEqual(harness.fetchCalls, [['Search']]);
  assert.equal(textarea.getAttribute('placeholder'), 'Suchen');
}

async function testStaleNonceRetriesWithoutNonce() {
  const noncePresence = [];
  const harness = createHarness(async (texts, options) => {
    const hasNonce = !!(options.headers && options.headers['X-WP-Nonce']);
    noncePresence.push(hasNonce);
    if (hasNonce) {
      return { ok: false, status: 403, json: async () => ({}) };
    }
    return translationResponse(texts, { Cached: 'Zwischengespeichert' });
  });

  const text = harness.document.createTextNode('Cached');
  harness.document.body.appendChild(text);
  await harness.runTimers();

  // First attempt sends the (stale) nonce and is rejected 403 by WP core; the
  // retry omits it to reach the controller's cache-only fallback.
  assert.deepEqual(noncePresence, [true, false]);
  assert.deepEqual(harness.fetchCalls, [['Cached'], ['Cached']]);
  assert.equal(text.data, 'Zwischengespeichert');
}

async function testRawWhitespaceKeyIsSent() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    '  Hello  ': '  Hallo  ',
  }));

  const text = harness.document.createTextNode('  Hello  ');
  harness.document.body.appendChild(text);
  await harness.runTimers();

  // The untrimmed value is the cache key, matching the server pass (which keys
  // on the raw DOMText value) so existing cache entries are reused.
  assert.deepEqual(harness.fetchCalls, [['  Hello  ']]);
  assert.equal(text.data, '  Hallo  ');
}

async function main() {
  const tests = [
    testProcessedTextNodeCanBeTranslatedAfterChanging,
    testAttributeMutationsAreTranslated,
    testPropertyOnlyButtonInputValueIsTranslatedOnInsert,
    testContentEditableTextIsSkipped,
    testEmptyResponsesDropOldPendingItems,
    testRootTranslateNoIsIgnored,
    testTextareaPlaceholderIsTranslated,
    testStaleNonceRetriesWithoutNonce,
    testRawWhitespaceKeyIsSent,
  ];

  for (const test of tests) {
    await test();
  }

  console.log('DynamicTranslatorAssetTest: OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
