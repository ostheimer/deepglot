/**
 * Deepglot language switcher — accessibility-only progressive enhancement.
 *
 * The visual open/close interaction is CSS-driven (the hidden
 * <input type="checkbox" class="deepglot-choice"> drives `:checked ~ ul`).
 * This script's only job is to keep `aria-expanded` on the surrounding
 * <aside> in sync with that checkbox so assistive tech sees the truthful
 * open/closed state. No interaction is changed.
 *
 * Event delegation on document so the script works for late-injected
 * switchers too (e.g. fragment caching, ajax navigation, BFcache).
 */
(function () {
    if (typeof document === 'undefined') return;

    function sync(target) {
        if (!target || target.className === undefined) return;
        var classes = ' ' + target.className + ' ';
        if (classes.indexOf(' deepglot-choice ') === -1) return;
        var node = target.parentNode;
        while (node && node !== document) {
            if (node.classList && node.classList.contains('deepglot-switcher')) {
                node.setAttribute('aria-expanded', target.checked ? 'true' : 'false');
                return;
            }
            node = node.parentNode;
        }
    }

    document.addEventListener('change', function (event) { sync(event.target); }, true);

    // Pre-sync any already-rendered switchers on first paint in case the
    // browser restored a checked state from BFcache.
    function initial() {
        var nodes = document.querySelectorAll('.deepglot-switcher .deepglot-choice');
        for (var i = 0; i < nodes.length; i++) { sync(nodes[i]); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initial);
    } else {
        initial();
    }
})();
