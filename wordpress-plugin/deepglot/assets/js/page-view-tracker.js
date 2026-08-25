(function (window) {
  'use strict';

  var config = window.deepglotPageViews;
  if (!config || typeof window.fetch !== 'function' || !window.location) {
    return;
  }

  if (window.document && window.document.visibilityState === 'prerender') {
    return;
  }

  var endpoint = typeof config.endpoint === 'string' ? config.endpoint : '';
  var path = typeof window.location.pathname === 'string' ? window.location.pathname : '';
  var language = typeof config.langTo === 'string' ? config.langTo.toLowerCase() : '';
  var ticket = typeof config.ticket === 'string' ? config.ticket : '';

  if (
    !/^\/(?![\/\\])/.test(endpoint)
    || endpoint.indexOf('\\') !== -1
    || path !== config.urlPath
    || path.length > 2048
    || /[?#]/.test(path)
    || !/^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/.test(language)
    || ticket === ''
  ) {
    return;
  }

  function secureEventId() {
    var webCrypto = window.crypto;
    if (!webCrypto) {
      return '';
    }

    try {
      if (typeof webCrypto.randomUUID === 'function') {
        return webCrypto.randomUUID();
      }

      if (typeof webCrypto.getRandomValues !== 'function' || typeof Uint8Array !== 'function') {
        return '';
      }

      var bytes = new Uint8Array(16);
      webCrypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;

      var hex = [];
      for (var index = 0; index < bytes.length; index += 1) {
        hex.push((bytes[index] + 0x100).toString(16).slice(1));
      }

      return hex.slice(0, 4).join('') + '-'
        + hex.slice(4, 6).join('') + '-'
        + hex.slice(6, 8).join('') + '-'
        + hex.slice(8, 10).join('') + '-'
        + hex.slice(10, 16).join('');
    } catch {
      return '';
    }
  }

  var eventId = secureEventId();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    return;
  }

  var key = 'deepglot.page-view:' + language + ':' + path;
  var now = Date.now();
  var dedupeMilliseconds = Math.max(1, Math.min(300, Number(config.dedupeSeconds) || 30)) * 1000;
  var storage;

  try {
    storage = window.sessionStorage;
    var previous = Number(storage.getItem(key));
    if (previous > 0 && now >= previous && now - previous < dedupeMilliseconds) {
      return;
    }
    storage.setItem(key, String(now));
  } catch {
    storage = null;
  }

  function releaseFailedAttempt() {
    if (!storage) {
      return;
    }

    try {
      storage.removeItem(key);
    } catch {
      // Browser privacy modes may disable storage between page lifecycle events.
    }
  }

  try {
    window.fetch(endpoint, {
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
      referrerPolicy: 'origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Deepglot-Page-View-Ticket': ticket,
      },
      body: JSON.stringify({ eventId: eventId, urlPath: path, langTo: language }),
    }).then(function (response) {
      if (!response || !response.ok) {
        releaseFailedAttempt();
      }
    }).catch(releaseFailedAttempt);
  } catch {
    releaseFailedAttempt();
  }
}(window));
