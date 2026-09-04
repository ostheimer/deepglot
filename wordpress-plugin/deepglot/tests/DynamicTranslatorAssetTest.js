/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.resolve(__dirname, '../assets/js/dynamic-translator.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

function createHarness(fetchHandler, options = {}) {
  const timers = [];
  const fetchCalls = [];
  const fetchPayloads = [];
  let observerId = 0;
  let now = 0;
  let classContainsChecks = 0;

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
      classContainsChecks += 1;
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

    matches(selector) {
      if (selector === '*') return true;
      if (selector === '.cc-window[data-nosnippet="true"]') {
        return this.classList.contains('cc-window')
          && this.getAttribute('data-nosnippet') === 'true';
      }
      if (selector.charAt(0) === '.') return this.classList.contains(selector.slice(1));
      return false;
    }

    querySelectorAll(selector) {
      const elements = [];
      function visit(node) {
        if (!node || !node.childNodes) return;
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (child.matches(selector)) elements.push(child);
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
    querySelectorAll(selector) {
      const matches = [];
      if (this.body.matches(selector)) matches.push(this.body);
      return matches.concat(this.body.querySelectorAll(selector));
    },
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
      quotaTicket: 'test-quota-ticket',
      langFrom: 'de',
      langTo: 'en',
      skipTags: ['script', 'style', 'pre', 'code', 'textarea', 'noscript', 'svg', 'math'],
      excludeSelectors: options.excludeSelectors || [],
      noTranslateAttr: 'data-deepglot-no-translate',
      attrSkipTags: ['script', 'style', 'noscript', 'template'],
      attrMap: {
        '*': ['aria-label'],
        img: ['alt', 'title'],
        button: ['title'],
        input: ['placeholder'],
        textarea: ['placeholder'],
      },
      inputValueTypes: ['submit', 'button', 'reset'],
      minLength: 2,
      batchSize: options.batchSize || 200,
      maxTextLength: 5000,
      initialDynamicSelectors: options.initialDynamicSelectors || [],
    },
    setTimeout(callback, delay = 0) {
      timers.push({ callback, dueAt: now + Math.max(0, Number(delay) || 0) });
      return timers.length;
    },
  };

  const context = {
    window,
    document,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: FakeMutationObserver,
    Date: { now: () => now },
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      fetchCalls.push(payload.texts);
      fetchPayloads.push(payload);
      return fetchHandler(payload.texts, options, payload);
    },
  };

  let preexistingText = null;
  let preexistingLink = null;
  if (options.preexistingDynamicText || options.preexistingDynamicHref) {
    const modal = document.createElement('div');
    modal.setAttribute('class', 'cc-window');
    modal.setAttribute('data-nosnippet', 'true');
    if (options.preexistingDynamicText) {
      preexistingText = document.createTextNode(options.preexistingDynamicText);
      modal.appendChild(preexistingText);
    }
    if (options.preexistingDynamicHref) {
      preexistingLink = document.createElement('a');
      preexistingLink.setAttribute('href', options.preexistingDynamicHref);
      modal.appendChild(preexistingLink);
    }
    document.body.appendChild(modal);
  }

  let preexistingStaticText = null;
  if (options.preexistingStaticText) {
    const staticContent = document.createElement('p');
    preexistingStaticText = document.createTextNode(options.preexistingStaticText);
    staticContent.appendChild(preexistingStaticText);
    document.body.appendChild(staticContent);
  }

  vm.runInNewContext(scriptSource, context, { filename: scriptPath });

  async function runTimers(maxAdvance = 1000) {
    const deadline = now + maxAdvance;
    while (timers.length > 0) {
      timers.sort((a, b) => a.dueAt - b.dueAt);
      if (timers[0].dueAt > deadline) break;
      const timer = timers.shift();
      now = Math.max(now, timer.dueAt);
      timer.callback();
      for (let i = 0; i < 50; i++) {
        await Promise.resolve();
      }
    }
  }

  async function advanceTime(milliseconds) {
    now += milliseconds;
    await runTimers(1000);
  }

  return {
    document,
    fetchCalls,
    fetchPayloads,
    runTimers,
    advanceTime,
    preexistingText,
    preexistingLink,
    preexistingStaticText,
    get classContainsChecks() { return classContainsChecks; },
  };
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

async function testConfiguredPreexistingDynamicRootIsTranslated() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    'Wir verwenden Cookies': 'We use cookies',
  }), {
    initialDynamicSelectors: ['.cc-window[data-nosnippet="true"]'],
    preexistingDynamicText: 'Wir verwenden Cookies',
  });

  await harness.runTimers();

  assert.deepEqual(
    harness.fetchCalls,
    [['Wir verwenden Cookies']],
    'Dynamic widgets inserted before the footer observer starts must still be translated.'
  );
  assert.equal(harness.preexistingText.data, 'We use cookies');
}

async function testUnconfiguredPreexistingServerDomIsNotTranslated() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    'Server rendered copy': 'Serverseitig gerenderter Text',
  }), {
    initialDynamicSelectors: ['.cc-window[data-nosnippet="true"]'],
    preexistingStaticText: 'Server rendered copy',
  });

  await harness.runTimers();

  assert.deepEqual(
    harness.fetchCalls,
    [],
    'Only configured pre-existing dynamic roots may be scanned before observing mutations.'
  );
  assert.equal(harness.preexistingStaticText.data, 'Server rendered copy');
}

async function testConfiguredPreexistingDynamicRootLocalizesInternalLinks() {
  const sourceHref = 'https://example.com/datenschutzerklaerung/';
  const targetHref = 'https://example.com/en/datenschutzerklaerung/';
  const harness = createHarness(async (texts, options, payload) => jsonResponse({
    from_words: [],
    to_words: [],
    from_urls: payload.urls,
    to_urls: [targetHref],
  }), {
    initialDynamicSelectors: ['.cc-window[data-nosnippet="true"]'],
    preexistingDynamicHref: sourceHref,
  });

  await harness.runTimers();

  assert.deepEqual(
    harness.fetchPayloads,
    [{ texts: [], urls: [sourceHref], lang_to: 'en' }],
    'Configured dynamic roots must localize their internal hrefs separately from provider text.'
  );
  assert.equal(harness.preexistingLink.getAttribute('href'), targetHref);
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

async function testGenericAriaLabelAndImageTitleAreTranslated() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    'Main navigation': 'Hauptnavigation',
    'Dental headset': 'Dental-Headset',
  }));

  const nav = harness.document.createElement('nav');
  nav.setAttribute('aria-label', 'Main navigation');
  harness.document.body.appendChild(nav);

  const image = harness.document.createElement('img');
  image.setAttribute('title', 'Dental headset');
  harness.document.body.appendChild(image);

  const excluded = harness.document.createElement('aside');
  excluded.setAttribute('data-deepglot-no-translate', '');
  const excludedNav = harness.document.createElement('nav');
  excludedNav.setAttribute('aria-label', 'Private navigation');
  excluded.appendChild(excludedNav);
  harness.document.body.appendChild(excluded);
  await harness.runTimers();

  assert.deepEqual(harness.fetchCalls, [['Main navigation', 'Dental headset']]);
  assert.equal(nav.getAttribute('aria-label'), 'Hauptnavigation');
  assert.equal(image.getAttribute('title'), 'Dental-Headset');
  assert.equal(excludedNav.getAttribute('aria-label'), 'Private navigation');
}

async function testOrdinaryInsertedSubtreeSkipsAttributeExclusionWalks() {
  const harness = createHarness(async (texts) => translationResponse(texts, {}), {
    excludeSelectors: ['.skip'],
  });

  const root = harness.document.createElement('div');
  let parent = root;
  for (let index = 0; index < 50; index += 1) {
    const child = harness.document.createElement('div');
    parent.appendChild(child);
    parent = child;
  }
  harness.document.body.appendChild(root);
  await harness.runTimers();

  assert.ok(
    harness.classContainsChecks <= 2,
    'Elements without configured translatable attributes must avoid per-descendant ancestor exclusion walks.'
  );
  assert.deepEqual(harness.fetchCalls, []);
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

async function testPendingTextOptedOutBeforeFlushIsNotSent() {
  const harness = createHarness(async (texts) => translationResponse(texts, {
    'Queued text': 'Text in Warteschlange',
  }));

  const wrapper = harness.document.createElement('div');
  const text = harness.document.createTextNode('Queued text');
  wrapper.appendChild(text);
  harness.document.body.appendChild(wrapper);
  wrapper.setAttribute('translate', 'no');
  await harness.runTimers();

  assert.deepEqual(harness.fetchCalls, []);
  assert.equal(text.data, 'Queued text');
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
  const ticketPresence = [];
  const harness = createHarness(async (texts, options) => {
    const hasNonce = !!(options.headers && options.headers['X-WP-Nonce']);
    const hasTicket = !!(options.headers && options.headers['X-Deepglot-Quota-Ticket']);
    noncePresence.push(hasNonce);
    ticketPresence.push(hasTicket);
    if (hasNonce) {
      return { ok: false, status: 403, json: async () => ({}) };
    }
    return translationResponse(texts, { Cached: 'Zwischengespeichert' });
  });

  const text = harness.document.createTextNode('Cached');
  harness.document.body.appendChild(text);
  await harness.runTimers();

  // First attempt sends the (stale) nonce + quota ticket and is rejected 403 by WP core; the
  // retry omits both to reach the controller's cache-only fallback.
  assert.deepEqual(noncePresence, [true, false]);
  assert.deepEqual(ticketPresence, [true, false]);
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

async function testQuotaExhaustedStopsFurtherRequests() {
  // The proxy reports the monthly quota is exhausted; nothing comes back
  // translated, and the client must stop sending new strings for the session.
  const harness = createHarness(async () => jsonResponse({
    from_words: [],
    to_words: [],
    quota_exhausted: true,
  }));

  const first = harness.document.createTextNode('First string');
  harness.document.body.appendChild(first);
  await harness.runTimers();
  assert.deepEqual(harness.fetchCalls, [['First string']]);

  // New content after the 402 signal must NOT trigger another request; it
  // simply stays in the source language (fail-open).
  const second = harness.document.createTextNode('Second string');
  harness.document.body.appendChild(second);
  await harness.runTimers();
  assert.deepEqual(harness.fetchCalls, [['First string']]);
  assert.equal(second.data, 'Second string');
}

async function testRateLimitBackoffStopsImmediateDynamicRequests() {
  const harness = createHarness(async () => jsonResponse({
    from_words: [],
    to_words: [],
    retry_after: 3600,
  }));

  const first = harness.document.createTextNode('First rate-limited string');
  harness.document.body.appendChild(first);
  await harness.runTimers();
  assert.deepEqual(harness.fetchCalls, [['First rate-limited string']]);

  const second = harness.document.createTextNode('Second rate-limited string');
  harness.document.body.appendChild(second);
  await harness.runTimers();

  assert.deepEqual(
    harness.fetchCalls,
    [['First rate-limited string']],
    'Retry-After must suppress another immediate visitor-facing request.'
  );
  assert.equal(second.data, 'Second rate-limited string');

  await harness.advanceTime(300_000);
  assert.deepEqual(
    harness.fetchCalls,
    [['First rate-limited string']],
    'The old five-minute cap must not create another retry wave inside the known hourly window.'
  );

  await harness.advanceTime(3_300_000);
  assert.deepEqual(
    harness.fetchCalls,
    [['First rate-limited string'], ['Second rate-limited string']],
    'The queued new mutation may resume once after the bounded backoff.'
  );
}

async function testRateLimitedTextDoesNotBlockUrlLocalization() {
  const targetHref = '/en/impressum/';
  const harness = createHarness(async (texts, options, payload) => {
    if (payload.urls.length) {
      return jsonResponse({
        from_words: [],
        to_words: [],
        from_urls: payload.urls,
        to_urls: [targetHref],
      });
    }
    return jsonResponse({ from_words: [], to_words: [], retry_after: 3600 });
  });

  harness.document.body.appendChild(
    harness.document.createTextNode('Text rate limited first')
  );
  await harness.runTimers();

  const link = harness.document.createElement('a');
  link.setAttribute('href', '/impressum/');
  harness.document.body.appendChild(link);
  await harness.runTimers();

  assert.deepEqual(
    harness.fetchPayloads,
    [
      { texts: ['Text rate limited first'], urls: [], lang_to: 'en' },
      { texts: [], urls: ['/impressum/'], lang_to: 'en' },
    ],
    'A text Retry-After must not block independent local URL localization.'
  );
  assert.equal(link.getAttribute('href'), targetHref);
}

async function testParallelRateLimitsKeepTheLongestBackoff() {
  const pendingResponses = [];
  const harness = createHarness((texts) => new Promise((resolve) => {
    pendingResponses.push({ texts, resolve });
  }), { batchSize: 1 });

  harness.document.body.appendChild(
    harness.document.createTextNode('First parallel rate limit')
  );
  harness.document.body.appendChild(
    harness.document.createTextNode('Second parallel rate limit')
  );
  await harness.runTimers();
  assert.equal(pendingResponses.length, 2);

  pendingResponses[0].resolve(jsonResponse({ from_words: [], to_words: [], retry_after: 120 }));
  for (let i = 0; i < 50; i++) await Promise.resolve();
  pendingResponses[1].resolve(jsonResponse({ from_words: [], to_words: [], retry_after: 30 }));
  for (let i = 0; i < 50; i++) await Promise.resolve();

  await harness.advanceTime(31_000);
  harness.document.body.appendChild(
    harness.document.createTextNode('Mutation after shorter backoff')
  );
  await harness.runTimers();
  assert.equal(
    harness.fetchCalls.length,
    2,
    'A later shorter 429 must not shorten the longest parallel Retry-After.'
  );

  await harness.advanceTime(89_000);
  assert.deepEqual(
    harness.fetchCalls[2],
    ['Mutation after shorter backoff'],
    'New work may resume after the longest parallel Retry-After expires.'
  );
}

async function main() {
  const tests = [
    testConfiguredPreexistingDynamicRootIsTranslated,
    testUnconfiguredPreexistingServerDomIsNotTranslated,
    testConfiguredPreexistingDynamicRootLocalizesInternalLinks,
    testProcessedTextNodeCanBeTranslatedAfterChanging,
    testAttributeMutationsAreTranslated,
    testGenericAriaLabelAndImageTitleAreTranslated,
    testOrdinaryInsertedSubtreeSkipsAttributeExclusionWalks,
    testPropertyOnlyButtonInputValueIsTranslatedOnInsert,
    testPendingTextOptedOutBeforeFlushIsNotSent,
    testContentEditableTextIsSkipped,
    testEmptyResponsesDropOldPendingItems,
    testRootTranslateNoIsIgnored,
    testTextareaPlaceholderIsTranslated,
    testStaleNonceRetriesWithoutNonce,
    testRawWhitespaceKeyIsSent,
    testQuotaExhaustedStopsFurtherRequests,
    testRateLimitBackoffStopsImmediateDynamicRequests,
    testRateLimitedTextDoesNotBlockUrlLocalization,
    testParallelRateLimitsKeepTheLongestBackoff,
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
