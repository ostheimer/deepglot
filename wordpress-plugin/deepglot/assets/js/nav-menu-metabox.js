(function (window, document) {
    'use strict';

    var button = document.getElementById('deepglot-nav-submit');
    if (!button) return;

    button.addEventListener('click', function () {
        var mode = document.querySelector('input[name="deepglot-nav-mode"]:checked');
        var hideCurrent = document.getElementById('deepglot-nav-hide-current');
        var classes = ['deepglot-switcher'];

        if (mode && mode.value === 'dropdown') classes.push('deepglot-mode-dropdown');
        if (hideCurrent && hideCurrent.checked) classes.push('deepglot-hide-current');

        if (typeof window.wpNavMenu === 'undefined' || !window.wpNavMenu.addLinkToMenu) return;

        window.wpNavMenu.addLinkToMenu(
            '#deepglot-switcher',
            window.deepglotNavMenuMetabox.label,
            'deepglot-nav-menu',
            function () {
                var items = document.querySelectorAll('#menu-to-edit > li');
                if (!items.length) return;

                var last = items[items.length - 1];
                var classValue = classes.join(' ');
                var input = last.querySelector('input.edit-menu-item-classes');
                var hidden = last.querySelector('input.menu-item-classes');

                if (input) input.value = classValue;
                if (hidden) hidden.value = classValue;
            }
        );
    });
})(window, document);
