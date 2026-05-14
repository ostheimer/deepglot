<?php

/**
 * Source-level regression net for the switcher.js a11y contract.
 *
 * Why a static-source check: switcher.js is a tiny browser-only file
 * (no node test infra in this plugin) but it must respect the gate we
 * pin on the renderer side — only the dropdown variant has a popup, so
 * only the dropdown variant gets aria-expanded. Without this guard the
 * sync() helper happily adds aria-expanded="false" to list-style
 * <aside>s on initial DOMContentLoaded, claiming popup semantics that
 * don't exist (visible on the live site after deploy 0.5.1).
 *
 * The renderer-side contract is already pinned by
 * LanguageSwitcherAriaTest blocks #2 / #2b: list mode emits no
 * aria-expanded, dropdown mode emits aria-haspopup="listbox" +
 * aria-expanded="false". This file makes sure the JS does not violate
 * the same contract at run time.
 *
 * Run standalone: php tests/SwitcherJsAriaTest.php
 */

function jsAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

$jsPath = __DIR__ . '/../assets/js/switcher.js';
jsAssert(file_exists($jsPath), 'switcher.js exists in assets/js/');

$js = (string) file_get_contents($jsPath);
jsAssert($js !== '', 'switcher.js is non-empty');

// 1. The sync logic gates aria-expanded behind a dropdown check —
// either via the --dropdown modifier class or via an aria-haspopup
// attribute on the wrapper. Without either of those markers the
// wrapper is list-style and must not be touched.
jsAssert(
    str_contains($js, 'deepglot-switcher--dropdown') || str_contains($js, "aria-haspopup"),
    'switcher.js must check the dropdown modifier class or aria-haspopup before syncing aria-expanded'
);

// 2. The actual setAttribute('aria-expanded', …) call still exists —
// regression: we did not accidentally rip out the sync entirely.
jsAssert(
    str_contains($js, "setAttribute('aria-expanded'") || str_contains($js, 'setAttribute("aria-expanded"'),
    'switcher.js must still call setAttribute("aria-expanded", ...) — the gate just narrows the scope'
);

// 3. The setAttribute call lives inside an if-block that references
// the gate symbol. Static structural check: between the gate symbol
// and the next setAttribute call there is no `}` (closing block) that
// would put setAttribute outside the gate.
$gatePos = strpos($js, 'isDropdownWrapper(');
jsAssert($gatePos !== false, 'A helper named isDropdownWrapper() should encapsulate the gate so reviewers can verify the contract in one place');

$setAttrPos = strpos($js, 'aria-expanded', $gatePos);
jsAssert(
    $setAttrPos !== false,
    'setAttribute("aria-expanded", …) is reachable after the gate is consulted'
);
$between = substr($js, $gatePos, $setAttrPos - $gatePos);
jsAssert(
    substr_count($between, '}') <= substr_count($between, '{'),
    'aria-expanded setAttribute() must sit inside the if(isDropdownWrapper) block, not after its closing brace'
);

fwrite(STDOUT, "SwitcherJsAriaTest: OK\n");
