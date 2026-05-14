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
// the gate symbol. To check this structurally without a real JS
// parser:
//   a) anchor at an actual `if (isDropdownWrapper(...))` guard call
//      (NOT the helper definition or a JSDoc mention — those don't
//      gate anything),
//   b) find the FIRST real `setAttribute('aria-expanded'` after that
//      guard (NOT a mere comment containing the words),
//   c) walk the bytes between to verify the running brace depth stays
//      positive — meaning setAttribute is nested inside the gate's
//      `{ … }` block, not after its closing brace.
//
// Codex (PR #51) flagged the prior version of this test using
// `strpos($js, 'aria-expanded', $gatePos)`, which matched the first
// `aria-expanded` token after `isDropdownWrapper(`. That token lived
// inside a JSDoc comment ABOVE the real setAttribute, so $between
// stopped too early and the brace-balance assertion became a no-op —
// a future regression moving setAttribute outside the if-block would
// still have passed.
$gateCallPattern = '/\bif\s*\(\s*isDropdownWrapper\s*\(/';
preg_match_all($gateCallPattern, $js, $gateMatches, PREG_OFFSET_CAPTURE);
jsAssert(
    !empty($gateMatches[0]),
    'Must contain at least one `if (isDropdownWrapper(...))` guard expression so the gate is actually used in code, not only declared'
);
$gateCallPos = end($gateMatches[0])[1];

$setAttrPattern = '/setAttribute\s*\(\s*[\'"]aria-expanded[\'"]/';
preg_match($setAttrPattern, $js, $setAttrMatch, PREG_OFFSET_CAPTURE, $gateCallPos);
jsAssert(
    !empty($setAttrMatch[0]),
    'A real setAttribute("aria-expanded", ...) call must be reachable after the if (isDropdownWrapper(...)) guard'
);
$setAttrPos = $setAttrMatch[0][1];

$between = substr($js, $gateCallPos, $setAttrPos - $gateCallPos);
$depth   = 0;
$dropped = false;
for ($i = 0, $n = strlen($between); $i < $n; $i++) {
    $c = $between[$i];
    if ($c === '{') $depth++;
    elseif ($c === '}') {
        $depth--;
        if ($depth < 0) { $dropped = true; break; }
    }
}
jsAssert(
    !$dropped && $depth > 0,
    'aria-expanded setAttribute() must sit inside the if(isDropdownWrapper) block (brace depth between gate and call must stay strictly positive)'
);

fwrite(STDOUT, "SwitcherJsAriaTest: OK\n");
