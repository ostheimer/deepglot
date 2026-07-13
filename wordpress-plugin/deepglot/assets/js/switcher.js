/**
 * Deepglot language switcher — accessibility-only progressive enhancement.
 *
 * The visual open/close interaction is CSS-driven (the hidden
 * <input type="checkbox" class="deepglot-choice"> drives `:checked ~ ul`).
 * This script's only job is to keep `aria-expanded` on the surrounding
 * <aside> in sync with that checkbox so assistive tech sees the truthful
 * open/closed state. No interaction is changed.
 *
 * Only the dropdown variant is a real popup — list-style switchers have
 * no collapsible region, so we MUST NOT add aria-expanded there. The PHP
 * renderer already emits aria-haspopup="listbox" + aria-expanded="false"
 * exclusively in dropdown mode (PR #46 codex P2 fix); this script must
 * mirror that gate or it ends up adding aria-expanded to list-style
 * switchers and claiming popup semantics that don't exist.
 *
 * Event delegation on document so the script works for late-injected
 * switchers too (e.g. fragment caching, ajax navigation, BFcache).
 */
(function () {
    if (typeof document === 'undefined') return;

    function isDropdownWrapper(node) {
        if (!node || node.nodeType !== 1) return false;
        // Either the dropdown modifier class OR an explicit aria-haspopup
        // signals "this wrapper has a real popup". List-style wrappers
        // have neither, so they fall through and aria-expanded stays off.
        if (node.classList && node.classList.contains('deepglot-switcher--dropdown')) return true;
        if (typeof node.hasAttribute === 'function' && node.hasAttribute('aria-haspopup')) return true;
        return false;
    }

    function sync(target) {
        if (!target || target.className === undefined) return;
        var classes = ' ' + target.className + ' ';
        if (classes.indexOf(' deepglot-choice ') === -1) return;
        var node = target.parentNode;
        while (node && node !== document) {
            if (node.classList && node.classList.contains('deepglot-switcher')) {
                if (isDropdownWrapper(node)) {
                    node.setAttribute('aria-expanded', target.checked ? 'true' : 'false');
                }
                // List-style wrapper: do nothing — no popup, no expanded state.
                return;
            }
            node = node.parentNode;
        }
    }

    document.addEventListener('change', function (event) { sync(event.target); }, true);

    /**
     * Move auto-injected instances to a selector chosen in the same-origin
     * visual editor. The server sanitizes selectors before output; try/catch is
     * retained as defense in depth for stale options or browser parser drift.
     * If the selector is missing, invalid, or points inside the switcher itself,
     * the element simply remains at its safe wp_footer fallback location.
     */
    function placeSwitchers() {
        var switchers = document.querySelectorAll('.deepglot-switcher[data-deepglot-target]');
        for (var i = 0; i < switchers.length; i++) {
            var switcher = switchers[i];
            var selector = switcher.getAttribute('data-deepglot-target');
            if (!selector) continue;

            try {
                var target = document.querySelector(selector);
                if (!target || target === switcher || switcher.contains(target)) continue;
                if (/^(SCRIPT|STYLE|HEAD|META|LINK|BASE|IFRAME|OBJECT|EMBED)$/.test(target.tagName || '')) continue;
                target.appendChild(switcher);
            } catch {
                // Safe fallback: leave the rendered switcher in wp_footer.
            }
        }
    }

    // Pre-sync any already-rendered switchers on first paint in case the
    // browser restored a checked state from BFcache.
    function initial() {
        placeSwitchers();
        var nodes = document.querySelectorAll('.deepglot-switcher .deepglot-choice');
        for (var i = 0; i < nodes.length; i++) { sync(nodes[i]); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initial);
    } else {
        initial();
    }
})();
