/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../assets/js/page-view-tracker.js'), 'utf8');

function createHarness(overrides = {}) {
  const requests = [];
  const storage = overrides.storage || new Map();
  const config = Object.prototype.hasOwnProperty.call(overrides, 'config')
    ? overrides.config
    : {
      endpoint: '/wp-json/deepglot/v1/page-views',
      ticket: 'test-page-ticket',
      langTo: 'en',
      urlPath: '/en/article/',
      dedupeSeconds: 30,
    };

  const context = {
    Date: { now: () => overrides.now || 1_000_000 },
    JSON,
    Promise,
    Uint8Array,
    document: { visibilityState: overrides.visibilityState || 'visible' },
    location: {
      pathname: overrides.pathname || '/en/article/',
      search: '?email=private@example.test',
      hash: '#secret-fragment',
    },
    sessionStorage: overrides.storageThrows
      ? {
        getItem() { throw new Error('Storage unavailable'); },
        setItem() { throw new Error('Storage unavailable'); },
        removeItem() { throw new Error('Storage unavailable'); },
      }
      : {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; },
        setItem(key, value) { storage.set(key, String(value)); },
        removeItem(key) { storage.delete(key); },
      },
    crypto: Object.prototype.hasOwnProperty.call(overrides, 'crypto')
      ? overrides.crypto
      : { randomUUID: () => 'b15e2761-7879-461e-a23c-1c5ab1abc032' },
    fetch(url, options) {
      requests.push({ url, options, payload: JSON.parse(options.body) });
      return Promise.resolve({ ok: overrides.responseOk !== false, status: 201 });
    },
  };

  if (config !== null) {
    context.deepglotPageViews = config;
  }

  context.window = context;
  vm.runInNewContext(source, context, { filename: 'page-view-tracker.js' });

  return { requests, storage, context };
}

const first = createHarness();
assert.equal(first.requests.length, 1, 'An opted-in translated page should emit one genuine view');
assert.equal(first.requests[0].url, '/wp-json/deepglot/v1/page-views');
assert.equal(first.requests[0].options.method, 'POST');
assert.equal(first.requests[0].options.keepalive, true, 'Navigation must not silently discard an in-flight event');
assert.equal(first.requests[0].options.credentials, 'omit', 'Visitor cookies are not required for analytics');
assert.equal(first.requests[0].options.referrerPolicy, 'origin', 'A private query must never appear in the referrer');
assert.equal(first.requests[0].options.headers['X-Deepglot-Page-View-Ticket'], 'test-page-ticket');
assert.deepEqual(JSON.parse(JSON.stringify(first.requests[0].payload)), {
  eventId: 'b15e2761-7879-461e-a23c-1c5ab1abc032',
  urlPath: '/en/article/',
  langTo: 'en',
});
assert.doesNotMatch(first.requests[0].options.body, /private|email|fragment|cookie|referrer|userAgent/i);

const duplicate = createHarness({ storage: first.storage, now: 1_010_000 });
assert.equal(duplicate.requests.length, 0, 'The same session and URL must suppress obvious 30-second duplicates');

const nextVisit = createHarness({ storage: first.storage, now: 1_031_000 });
assert.equal(nextVisit.requests.length, 1, 'A later genuine visit must count independently');

assert.equal(createHarness({ config: null }).requests.length, 0, 'Without explicit opted-in configuration nothing may be tracked');
assert.equal(createHarness({ pathname: '/en/different/' }).requests.length, 0, 'A cached page capability must not be reused for another URL');
assert.equal(createHarness({ crypto: {} }).requests.length, 0, 'Without secure randomness tracking must fail closed');
assert.equal(createHarness({ visibilityState: 'prerender' }).requests.length, 0, 'Prerendered documents are not real page views');
assert.equal(createHarness({ storageThrows: true }).requests.length, 1, 'Blocked sessionStorage must not break an otherwise valid page view');

const fallback = createHarness({
  crypto: {
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
      return bytes;
    },
  },
});
assert.match(
  fallback.requests[0].payload.eventId,
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  'The secure getRandomValues fallback must generate a valid RFC 4122 v4 UUID',
);

const unsafeEndpoint = createHarness({
  config: { endpoint: 'https://evil.test/collect', ticket: 'ticket', langTo: 'en', urlPath: '/en/article/' },
});
assert.equal(unsafeEndpoint.requests.length, 0, 'The public tracker must never send analytics to another origin');

process.stdout.write('PageViewTrackerAssetTest: OK\n');
