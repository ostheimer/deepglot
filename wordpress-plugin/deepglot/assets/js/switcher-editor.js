/**
 * Same-origin visual placement editor for independent switcher instances.
 * Preview scripts are disabled by the iframe sandbox; this parent script only
 * reads the DOM and stores a conservative selector generated from a click.
 */
(function (window, document) {
    'use strict';

    function isSameOrigin(url) {
        try {
            return new URL(url, window.location.origin + '/').origin === window.location.origin;
        } catch {
            return false;
        }
    }

    function safeToken(value) {
        return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value || '');
    }

    function elementSegment(element) {
        var tag = String(element.tagName || '').toLowerCase();
        if (!/^[a-z][a-z0-9-]*$/.test(tag)) return '';

        var classes = Array.prototype.slice.call(element.classList || [])
            .filter(safeToken)
            .slice(0, 3);
        return tag + classes.map(function (name) { return '.' + name; }).join('');
    }

    function buildSelector(element) {
        var segments = [];
        var current = element;
        var depth = 0;

        while (current && current.tagName && depth < 6) {
            if (safeToken(current.id)) {
                segments.unshift('#' + current.id);
                break;
            }

            var segment = elementSegment(current);
            if (!segment) return '';
            segments.unshift(segment);
            current = current.parentElement;
            depth += 1;
        }

        return segments.join(' > ');
    }

    function setupEditor(editor) {
        var iframe = editor.querySelector('[data-deepglot-preview]');
        var pickButton = editor.querySelector('[data-deepglot-pick]');
        var selectorInput = editor.querySelector('[data-deepglot-selector]');
        var removeButton = editor.querySelector('[data-deepglot-remove]');
        var highlighted = null;
        var selecting = false;

        if (removeButton) {
            removeButton.addEventListener('click', function () { editor.remove(); });
        }

        if (!iframe || !pickButton || !selectorInput || !isSameOrigin(iframe.src)) return;

        iframe.addEventListener('load', function () {
            var previewDocument;
            try {
                previewDocument = iframe.contentDocument;
            } catch {
                return;
            }
            if (!previewDocument) return;

            pickButton.addEventListener('click', function () {
                selecting = !selecting;
                pickButton.setAttribute('aria-pressed', selecting ? 'true' : 'false');
                editor.classList.toggle('is-selecting', selecting);
            });

            previewDocument.addEventListener('click', function (event) {
                if (!selecting) return;
                event.preventDefault();
                event.stopPropagation();

                var selector = buildSelector(event.target);
                if (!selector) return;
                try {
                    if (previewDocument.querySelectorAll(selector).length !== 1) return;
                } catch {
                    return;
                }

                if (highlighted) highlighted.style.outline = '';
                highlighted = event.target;
                highlighted.style.outline = '3px solid #4f46e5';
                selectorInput.value = selector;
                selectorInput.dispatchEvent(new Event('change', { bubbles: true }));
                selecting = false;
                pickButton.setAttribute('aria-pressed', 'false');
                editor.classList.remove('is-selecting');
            }, true);
        });
    }

    function populateEditor(editor, config) {
        Object.keys(config || {}).forEach(function (field) {
            var input = editor.querySelector('[data-switcher-field="' + field + '"]');
            if (!input) return;
            if (input.type === 'checkbox') input.checked = Boolean(config[field]);
            else if (Array.isArray(config[field])) input.value = config[field].join(', ');
            else input.value = String(config[field]);
        });
    }

    function setupTemplates() {
        var container = document.querySelector('[data-deepglot-instances]');
        var blueprint = document.querySelector('#deepglot-switcher-instance-template');
        if (!container || !blueprint) return;

        document.querySelectorAll('[data-switcher-template]').forEach(function (button) {
            button.addEventListener('click', function () {
                var config;
                try {
                    config = JSON.parse(button.getAttribute('data-switcher-template') || '{}');
                } catch {
                    return;
                }

                var index = String(Date.now()) + String(Math.floor(Math.random() * 1000));
                config.id = String(config.template || 'switcher') + '-'
                    + Date.now().toString(36)
                    + Math.floor(Math.random() * 1296).toString(36);
                var fragment = blueprint.content.cloneNode(true);
                var editor = fragment.querySelector('[data-deepglot-instance-editor]');
                editor.innerHTML = editor.innerHTML.replace(/__INDEX__/g, index);
                populateEditor(editor, config);
                container.appendChild(fragment);
                setupEditor(container.lastElementChild);
            });
        });
    }

    function initialize() {
        document.querySelectorAll('[data-deepglot-instance-editor]').forEach(setupEditor);
        setupTemplates();
    }

    window.DeepglotSwitcherEditor = {
        buildSelector: buildSelector,
        isSameOrigin: isSameOrigin,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})(window, document);
