'use strict';

/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pluginRoot = path.resolve(__dirname, '..');
const adminAsset = path.join(pluginRoot, 'assets/js/switcher-editor.js');
const frontendAsset = path.join(pluginRoot, 'assets/js/switcher.js');
const settingsPage = path.join(pluginRoot, 'includes/Admin/SettingsPage.php');

assert.equal(fs.existsSync(adminAsset), true, 'Visual editor admin asset must exist');

const listeners = {};
const sandbox = {
  window: {
    location: { origin: 'https://example.com' },
  },
  document: {
    readyState: 'loading',
    addEventListener(name, callback) { listeners[name] = callback; },
    querySelectorAll() { return []; },
  },
  URL,
  console,
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;

vm.runInNewContext(fs.readFileSync(adminAsset, 'utf8'), sandbox, {
  filename: 'switcher-editor.js',
});

const editor = sandbox.window.DeepglotSwitcherEditor;
assert.equal(typeof editor, 'object', 'Admin asset exposes testable editor helpers');
assert.equal(editor.isSameOrigin('https://example.com/?preview=1'), true, 'Same-origin preview URL is accepted');
assert.equal(editor.isSameOrigin('https://attacker.example/?preview=1'), false, 'Cross-origin preview URL is rejected');

const parent = { parentElement: null, tagName: 'HEADER', id: 'site-header', classList: [] };
const child = { parentElement: parent, tagName: 'NAV', id: '', classList: ['primary-nav', 'is-open'] };
assert.equal(editor.buildSelector(child), '#site-header > nav.primary-nav.is-open', 'Element picker creates conservative deterministic selector');

const frontend = fs.readFileSync(frontendAsset, 'utf8');
assert.match(frontend, /data-deepglot-target/, 'Frontend enhancement reads visual placement targets');
assert.match(frontend, /querySelector\s*\(/, 'Frontend resolves targets with querySelector');
assert.match(frontend, /(appendChild|append)\s*\(/, 'Frontend moves a switcher only after a target resolves');
assert.match(frontend, /try\s*\{[\s\S]*querySelector/, 'Invalid selectors are guarded instead of breaking all switchers');

const settings = fs.readFileSync(settingsPage, 'utf8');
assert.match(settings, /switcher-editor\.js/, 'Settings page enqueues the visual editor asset');
assert.match(settings, /sandbox="allow-same-origin"/, 'Preview iframe disables preview scripts while keeping same-origin element inspection');
assert.match(settings, /deepglot-switcher-preview/, 'Settings page renders a dedicated visual preview iframe');
assert.match(settings, /switcher_instances/, 'Settings page renders editable instance settings');
assert.match(settings, /switcher-template/, 'Settings page exposes one-click template controls');

console.log('SwitcherVisualEditorTest: OK');
