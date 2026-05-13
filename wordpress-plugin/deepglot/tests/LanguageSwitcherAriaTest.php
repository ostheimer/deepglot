<?php

/**
 * Brings the Deepglot language switcher up to Weglot-parity on the
 * dimensions that matter most for accessibility, mobile UX, and
 * positioning. Pinned 2026-05-12 after reading the actual Weglot 5.2
 * Button_Service source.
 *
 * What this test requires the renderer to do:
 *
 *   1. Wrap output in <aside data-deepglot-no-translate ...> so the
 *      element is semantic, ignored by HtmlTranslator, and signals the
 *      "outside main content" intent to screen readers.
 *
 *   2. Add full ARIA: tabindex="0", aria-expanded="false",
 *      aria-label="Sprache: <native>" on the <aside>; role="none" on
 *      <ul>; role="option" on every <li> and <a>.
 *
 *   3. Emit a JS-free dropdown trigger via <input type="checkbox"> +
 *      <label for="..."> with a unique id per render, so multiple
 *      switchers on one page don't share state and Touch users can
 *      tap to toggle.
 *
 *   4. Tag every <li> with data-l, data-code-language, data-name-language
 *      so external JS / analytics can hook in.
 *
 *   5. Honour a new `switcher_position` option:
 *      inline | fixed-bottom-right | fixed-bottom-left
 *           | fixed-top-right    | fixed-top-left
 *      → adds a `deepglot-switcher--<position>` modifier class.
 *
 *   6. Emit a `<!--Deepglot <version>-->` comment marker so we can
 *      identify the build on a live page without view-source-spelunking.
 *
 *   7. Auto-inject must fall back to `</footer>` if the page omits
 *      `</body>` (matches Weglot's render_default_button behaviour).
 *
 * Run standalone: php tests/LanguageSwitcherAriaTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}

if (!function_exists('esc_attr')) {
    function esc_attr($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
    function esc_attr__($text, $domain = null) { return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8'); }
    function esc_html($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
}

if (!function_exists('add_shortcode')) {
    $GLOBALS['_deepglot_shortcodes'] = [];
    function add_shortcode($tag, $callback) { $GLOBALS['_deepglot_shortcodes'][$tag] = $callback; }
}

if (!function_exists('add_action')) {
    $GLOBALS['_deepglot_actions'] = [];
    function add_action($hook, $callback, $priority = 10, $accepted_args = 1) {
        $GLOBALS['_deepglot_actions'][$hook][] = $callback;
    }
}

if (!function_exists('wp_register_style')) {
    function wp_register_style(...$args) { return true; }
    function wp_enqueue_style(...$args) { return true; }
    function wp_add_inline_style(...$args) { return true; }
}

if (!defined('DEEPGLOT_PLUGIN_URL')) {
    define('DEEPGLOT_PLUGIN_URL', 'https://example.com/wp-content/plugins/deepglot/');
}
if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
    define('DEEPGLOT_PLUGIN_VERSION', '0.3.0');
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function get_transient($key) { return false; }
    function set_transient($key, $value, $ttl = 0) { return true; }
    function is_wp_error($value) { return false; }
    function wp_parse_args($args, $defaults = []) { return array_merge($defaults, is_array($args) ? $args : []); }
    function sanitize_text_field($value) { return trim((string) $value); }
    function sanitize_textarea_field($value) { return trim((string) $value); }
    function esc_url_raw($value) { return (string) $value; }
    function untrailingslashit($value) { return rtrim((string) $value, '/'); }

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/LanguageSwitcher.php';

use Deepglot\Config\Options;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function ariaAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

/**
 * Stand-in that mimics what RequestRouter exposes: a getter on the
 * detected language for the current request, surviving RequestRouter's
 * own REQUEST_URI mangling.
 */
class FakeRequestRouter {
    public ?string $lang = null;
    public function getCurrentLanguage(): ?string { return $this->lang; }
}

function makeAriaSwitcher(array $overrides = [], ?FakeRequestRouter $router = null): LanguageSwitcher
{
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), array_merge([
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en', 'fr'],
    ], $overrides)));

    $options  = new Options();
    $resolver = new UrlLanguageResolver(
        $options->getSourceLanguage(),
        $options->getTargetLanguages()
    );
    $routing = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', []);

    $_SERVER['REQUEST_URI'] = '/';
    $_SERVER['HTTP_HOST']   = 'example.com';

    return new LanguageSwitcher($options, $routing, $router);
}

// 1. <aside> with data-deepglot-no-translate wraps the entire switcher
// so HtmlTranslator never tries to re-translate the labels.
$switcher = makeAriaSwitcher();
$html     = $switcher->renderShortcode([]);
ariaAssert(str_contains($html, '<aside '), 'Switcher must use <aside> wrapper: ' . substr($html, 0, 300));
ariaAssert(!str_contains($html, '<nav '), 'Switcher must NOT use <nav> any more (semantic conflict with site nav)');
ariaAssert(
    preg_match('/<aside\b[^>]*\bdata-deepglot-no-translate(=""|=|\b)/', $html) === 1,
    'Switcher <aside> must carry data-deepglot-no-translate'
);

// 2. ARIA attributes on <aside>: every switcher gets tabindex and an
// aria-label so it's keyboard-focusable and announced. aria-expanded is
// only emitted in dropdown mode (where it's meaningful) and is kept in
// sync with the checkbox state by assets/js/switcher.js — emitting it
// in list mode would lie to assistive tech about a popup that doesn't
// exist (codex P2 from PR #46).
ariaAssert(preg_match('/<aside\b[^>]*\btabindex="0"/', $html) === 1, 'aside needs tabindex="0"');
ariaAssert(preg_match('/<aside\b[^>]*\baria-label="[^"]+"/', $html) === 1, 'aside needs aria-label');
ariaAssert(!preg_match('/<aside\b[^>]*\baria-expanded=/', $html), 'List-style switcher must NOT advertise aria-expanded (no popup): ' . substr($html, 0, 200));
ariaAssert(!preg_match('/<aside\b[^>]*\baria-haspopup=/', $html), 'List-style switcher must NOT advertise aria-haspopup');

// 2b. Dropdown style flips on aria-haspopup="listbox" and the initial
// aria-expanded="false" (which the JS keeps live).
$dropHtml = (makeAriaSwitcher(['switcher_default_style' => 'dropdown']))->renderShortcode([]);
ariaAssert(preg_match('/<aside\b[^>]*\baria-haspopup="listbox"/', $dropHtml) === 1, 'Dropdown variant needs aria-haspopup="listbox"');
ariaAssert(preg_match('/<aside\b[^>]*\baria-expanded="false"/', $dropHtml) === 1, 'Dropdown variant needs initial aria-expanded="false" (JS syncs to true on open)');

// 3. role attributes are present on UL and LI/A.
ariaAssert(preg_match('/<ul\b[^>]*\brole="none"/', $html) === 1, '<ul> needs role="none"');
ariaAssert(substr_count($html, 'role="option"') >= 6, 'Each <li> and <a> needs role="option" (3 langs × 2 = 6): ' . substr_count($html, 'role="option"'));

// 4. Checkbox + label trigger emitted with a unique id; markup matches the
// JS-free dropdown pattern (input.deepglot-choice + label[for=id]).
ariaAssert(preg_match('/<input\s+id="(dg[a-f0-9.]+)"\s+class="deepglot-choice"\s+type="checkbox"/', $html, $idMatch) === 1, 'Checkbox <input class="deepglot-choice"> must be emitted');
$ckId = $idMatch[1];
ariaAssert(preg_match('/<label\s+for="' . preg_quote($ckId, '/') . '"/', $html) === 1, 'Label must reference checkbox id via for=');

// 5. Two renders → two distinct unique IDs so multiple switchers on the
// same page don't share open/closed state.
$switcher2 = makeAriaSwitcher();
$html2     = $switcher2->renderShortcode([]);
preg_match('/<input\s+id="(dg[a-f0-9.]+)"/', $html2, $idMatch2);
ariaAssert(!empty($idMatch2[1]) && $idMatch2[1] !== $ckId, 'Each render must produce a fresh unique id (got ' . ($idMatch2[1] ?? 'none') . ' vs ' . $ckId . ')');

// 6. data-l, data-code-language, data-name-language attributes on every <li>.
foreach (['de', 'en', 'fr'] as $lang) {
    ariaAssert(preg_match('/<li\b[^>]*\bdata-l="' . $lang . '"/', $html) === 1, "li[data-l=$lang] must exist");
    ariaAssert(preg_match('/<li\b[^>]*\bdata-code-language="' . $lang . '"/', $html) === 1, "li[data-code-language=$lang] must exist");
    ariaAssert(preg_match('/<li\b[^>]*\bdata-name-language="[^"]+"/', $html) === 1, "li[data-name-language] must exist for at least one language");
}

// 7. Auto-redirect on appends `?deepglot-explicit=1` to every link so the
// router knows the user picked a language and skips browser-language match.
$redirectSwitcher = makeAriaSwitcher([
    'auto_redirect' => true,
]);
$redirectHtml = $redirectSwitcher->renderShortcode([]);
ariaAssert(
    substr_count($redirectHtml, 'deepglot-explicit=1') >= 2,
    'When auto_redirect is on, links must carry ?deepglot-explicit=1 marker: ' . substr($redirectHtml, 0, 500)
);

// 8. With auto_redirect off, the marker is absent.
$plainHtml = (makeAriaSwitcher(['auto_redirect' => false]))->renderShortcode([]);
ariaAssert(
    !str_contains($plainHtml, 'deepglot-explicit'),
    'Without auto_redirect, no explicit-marker query must leak'
);

// 9. <!--Deepglot <version>--> comment marker.
ariaAssert(
    preg_match('/<!--\s*Deepglot\s+[0-9.]+\s*-->/', $html) === 1,
    'Output must contain "<!--Deepglot <version>-->" marker for debugging'
);

// 10. switcher_position default = inline, no fixed modifier in HTML.
ariaAssert(!str_contains($html, 'deepglot-switcher--fixed-'), 'Default position should not add a fixed-* modifier');

// 11. switcher_position=fixed-bottom-right adds the modifier class.
foreach (['fixed-bottom-right', 'fixed-bottom-left', 'fixed-top-right', 'fixed-top-left'] as $pos) {
    $posSwitcher = makeAriaSwitcher(['switcher_position' => $pos]);
    $posHtml     = $posSwitcher->renderShortcode([]);
    ariaAssert(
        str_contains($posHtml, 'deepglot-switcher--' . $pos),
        "Position $pos must add modifier class deepglot-switcher--$pos: " . substr($posHtml, 0, 300)
    );
}

// 12. Invalid switcher_position falls back to inline (sanitisation in Options).
$badPos = (new Options())->sanitize(['switcher_position' => 'middle-of-nowhere']);
ariaAssert(($badPos['switcher_position'] ?? null) === 'inline', 'Unknown switcher_position must fall back to inline');

// 13. Position default constant exposed.
$defaults = Options::defaults();
ariaAssert(array_key_exists('switcher_position', $defaults), 'switcher_position must be a documented default');
ariaAssert($defaults['switcher_position'] === 'inline', 'Default switcher_position must be inline (no surprise for existing sites)');

// 14. Accessor returns sanitised position.
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'switcher_position' => 'fixed-top-left',
]));
$opts = new Options();
ariaAssert($opts->getSwitcherPosition() === 'fixed-top-left', 'getSwitcherPosition accessor must return saved value');

// 15. Runtime config override for switcher.position works.
$opts->applyRuntimeConfig([
    'switcher' => ['position' => 'fixed-bottom-right'],
]);
ariaAssert($opts->getSwitcherPosition() === 'fixed-bottom-right', 'Runtime config must override switcher.position');

// 16. Active language gets deepglot-current class on its label (Weglot
// parity — current language is the always-visible trigger).
ariaAssert(
    preg_match('/class="[^"]*\bdeepglot-current\b[^"]*"/', $html) === 1,
    'Current language label must carry deepglot-current class for CSS targeting'
);

// 17. wp_footer fallback to </footer>: auto-inject hook is wp_footer so
// WP runs it before </body>. We verify the option flips the hook on as
// before — actual placement is WP's responsibility, no need to retest.
$GLOBALS['_deepglot_actions'] = [];
makeAriaSwitcher(['switcher_auto_inject' => true])->register();
$footerCallbacks = $GLOBALS['_deepglot_actions']['wp_footer'] ?? [];
ariaAssert(count($footerCallbacks) === 1, 'Auto-inject hook still wires up exactly once');

// 18. Regression (2026-05-13 live bug on meinhaushalt.at): RequestRouter
// strips the language prefix from $_SERVER['REQUEST_URI'] on plugins_loaded,
// so by the time the switcher renders at wp_footer the URI is already '/'
// and the previous detection logic incorrectly fell back to the source
// language. The fix is to read the active language from RequestRouter
// (which captures it BEFORE the strip), not from $_SERVER.
$_SERVER['REQUEST_URI'] = '/';   // simulate RequestRouter having stripped /en/
$_SERVER['HTTP_HOST']   = 'example.com';
$liveRouter = new FakeRequestRouter();
$liveRouter->lang = 'en';        // what RequestRouter detected before stripping
$liveSwitcher = makeAriaSwitcher([], $liveRouter);
$liveHtml = $liveSwitcher->renderShortcode([]);
ariaAssert(
    preg_match('/aria-label="Sprache: English"/', $liveHtml) === 1,
    'When RequestRouter says active=en, aria-label must say "Sprache: English" even if $_SERVER[REQUEST_URI] was stripped to "/"'
);
ariaAssert(
    preg_match('/<li[^>]*\bdata-l="en"[^>]*\bdeepglot-active\b/', $liveHtml) === 1
        || preg_match('/<li[^>]*\bdeepglot-active\b[^>]*\bdata-l="en"/', $liveHtml) === 1,
    'When RequestRouter says active=en, the <li data-l="en"> carries deepglot-active'
);
ariaAssert(
    preg_match('/<li[^>]*\bdata-l="de"[^>]*\bdeepglot-active\b/', $liveHtml) !== 1
        && preg_match('/\bdeepglot-active\b[^>]*\bdata-l="de"/', $liveHtml) !== 1,
    'When RequestRouter says active=en, the <li data-l="de"> must NOT be deepglot-active'
);

// 19. If RequestRouter says current language is null (source language
// request), fall back to source as before.
$_SERVER['REQUEST_URI'] = '/';
$sourceRouter = new FakeRequestRouter();
$sourceRouter->lang = null;
$sourceSwitcher = makeAriaSwitcher([], $sourceRouter);
$sourceHtml = $sourceSwitcher->renderShortcode([]);
ariaAssert(
    preg_match('/aria-label="Sprache: Deutsch"/', $sourceHtml) === 1,
    'RequestRouter null = source language request → aria-label "Sprache: Deutsch"'
);

fwrite(STDOUT, "LanguageSwitcherAriaTest: OK\n");
