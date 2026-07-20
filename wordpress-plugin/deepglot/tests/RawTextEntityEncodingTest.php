<?php

/**
 * Regression contract for issue #223: raw-text elements (<style> / <script>)
 * must survive the translation pipeline byte-for-byte.
 *
 * Root cause (reproduced live on meinhaushalt.at /en/ during the v0.10.1
 * deploy): PHP's DOMDocument::saveHTML() only emits raw UTF-8 when libxml can
 * read the output encoding from the CLASSIC meta tag
 * `<meta http-equiv="Content-Type" content="text/html; charset=utf-8">`.
 * WordPress emits the HTML5 short form `<meta charset="UTF-8">`, which libxml
 * does not recognise, so saveHTML() falls back to ASCII and encodes every
 * non-ASCII character as an HTML entity. The `<?xml encoding="UTF-8">` prefix
 * in loadHtml() only fixes INPUT parsing; it has no effect on output.
 *
 * For text nodes that is harmless — browsers decode entities in HTML text.
 * Inside <style> and <script> it is corruption: CSS and JavaScript have no
 * HTML entities, so `content: "🇩🇪"` rendered as the literal text
 * `&#127465;&#127466;` (broken switcher flags), and any emoji/umlaut in
 * inline JS turned into garbage.
 *
 * The pipeline round-trips the document TWICE (HtmlTranslator::translate()
 * and then OutputBuffer's own load/save for links + hreflang), so both
 * serializers must protect raw-text content.
 *
 * Contract:
 *   - non-ASCII inside <style> / <script> survives verbatim (no entities)
 *   - a literal "&amp;" in JS source is NOT decoded (libxml serializes raw
 *     text without escaping `&`, so a naive entity decode would corrupt it)
 *   - ordinary text nodes are still translated and still work
 *   - the real LanguageSwitcher custom-flags CSS survives the full pipeline
 *
 * Run standalone: php tests/RawTextEntityEncodingTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}
if (!function_exists('add_action')) {
    $GLOBALS['_deepglot_rawtext_actions'] = [];
    function add_action($hook, $callback, $priority = 10, $accepted_args = 1) {
        $GLOBALS['_deepglot_rawtext_actions'][$hook][] = $callback;
    }
}
if (!function_exists('is_admin')) {
    function is_admin() { return false; }
}
if (!function_exists('wp_doing_ajax')) {
    function wp_doing_ajax() { return false; }
}
if (!function_exists('wp_is_json_request')) {
    function wp_is_json_request() { return false; }
}
if (!function_exists('is_amp_endpoint')) {
    function is_amp_endpoint() { return false; }
}
if (!function_exists('get_query_var')) {
    function get_query_var($key, $default = '') { return $default; }
}
if (!function_exists('home_url')) {
    function home_url($path = '/') { return 'https://example.com' . $path; }
}
if (!function_exists('add_query_arg')) {
    function add_query_arg() { $args = func_get_args(); return (string) end($args); }
}
if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];
    function get_option($key, $default = false) { return $GLOBALS['_deepglot_options'][$key] ?? $default; }
    function update_option($key, $value) { $GLOBALS['_deepglot_options'][$key] = $value; return true; }
    function get_transient($key) { return false; }
    function set_transient($key, $value, $ttl = 0) { return true; }
    function is_wp_error($value) { return false; }
    function wp_parse_args($args, $defaults = []) { return array_merge($defaults, is_array($args) ? $args : []); }
    function wp_json_encode($data, $options = 0, $depth = 512) { return json_encode($data, $options, $depth); }
    function sanitize_text_field($value) { return trim((string) $value); }
    function sanitize_textarea_field($value) { return trim((string) $value); }
    function esc_url_raw($value) { return (string) $value; }
    function untrailingslashit($value) { return rtrim((string) $value, '/'); }
    if (!defined('DAY_IN_SECONDS')) { define('DAY_IN_SECONDS', 86400); }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Support/HtmlDocument.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';
require_once __DIR__ . '/../includes/Frontend/LinkRewriter.php';
require_once __DIR__ . '/../includes/Frontend/HreflangInjector.php';
require_once __DIR__ . '/../includes/Frontend/RequestRouter.php';
require_once __DIR__ . '/../includes/Frontend/OutputBuffer.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HreflangInjector;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Frontend\LinkRewriter;
use Deepglot\Frontend\OutputBuffer;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\UrlLanguageResolver;

class RawTextFakeClient extends Client
{
    /** @var string[] */
    public array $sentTexts = [];

    public function __construct() {}

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0)
    {
        foreach ($texts as $text) {
            $this->sentTexts[] = $text;
        }

        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn(string $text) => '[en] ' . $text, $texts),
        ];
    }
}

class RawTextNullCache extends TranslationCache
{
    public function getMany(array $texts, string $from, string $to): array { return []; }
    public function setMany(array $translations, string $from, string $to): void {}
}

class RawTextRouter extends RequestRouter
{
    public function __construct() {}
    public function getCurrentLanguage(): ?string { return 'en'; }
}

function rawAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
    'runtime_config_synced_at' => time(),
]));

$options = new Options();
$_SERVER['HTTP_HOST'] = 'example.com';
$_SERVER['REQUEST_URI'] = '/en/';

// The exact CSS LanguageSwitcher ships (assets/css/switcher.css) plus the
// per-instance custom-flag override it renders inline.
$switcherCss = '.deepglot-flag--de::before { content: "🇩🇪"; }' . "\n"
    . '.deepglot-flag--en::before { content: "🇬🇧"; }';
$customFlagCss = '.deepglot-switcher[data-deepglot-instance="default"] .deepglot-flag--en::before{content:"🇺🇸";}';

// -----------------------------------------------------------------------
// 1. HtmlTranslator round-trip (serializer #1)
// -----------------------------------------------------------------------
$client = new RawTextFakeClient();
$translator = new HtmlTranslator($client, $options, new RawTextNullCache());

$html = '<!DOCTYPE html><html lang="de"><head>'
    . '<meta charset="UTF-8">'
    . '<title>Käsekuchen</title>'
    . '<style>' . $switcherCss . '</style>'
    . '</head><body>'
    . '<style class="deepglot-switcher__custom-flags">' . $customFlagCss . '</style>'
    . '<p>Größere Käse — Übersicht</p>'
    . '<script>var flag = "🇬🇧"; var amp = "&amp;"; if (a < b && c) { go(); }</script>'
    . '</body></html>';

$out = $translator->translate($html, 'en', 'https://example.com/en/', 0);

rawAssert(
    strpos($out, 'content: "🇩🇪"') !== false,
    'HtmlTranslator keeps the raw 🇩🇪 emoji in <style>, got: ' . substr(strstr($out, '<style') ?: $out, 0, 160)
);
rawAssert(
    strpos($out, '&#127465;') === false && strpos($out, '&#127466;') === false,
    'HtmlTranslator emits no numeric entities for the flag emoji'
);
rawAssert(
    strpos($out, 'content:"🇺🇸"') !== false,
    'The inline custom-flags override keeps its raw 🇺🇸 emoji (the switcher bug on meinhaushalt.at)'
);
rawAssert(
    strpos($out, 'var flag = "🇬🇧"') !== false,
    'HtmlTranslator keeps raw emoji inside <script>'
);
rawAssert(
    strpos($out, 'var amp = "&amp;"') !== false,
    'A literal "&amp;" in JS source is preserved verbatim (must NOT be entity-decoded)'
);
rawAssert(
    strpos($out, 'if (a < b && c)') !== false,
    'JS operators inside <script> are not escaped'
);

// Text nodes must still be translated, and now come out as raw UTF-8 too:
// fixing the output encoding at the source means the whole document stops
// being entity-escaped, which is valid HTML and a few percent smaller.
rawAssert(
    strpos($out, '[en] Größere Käse — Übersicht') !== false,
    'Ordinary text nodes are translated and emitted as raw UTF-8, got: ' . substr($out, 0, 200)
);
rawAssert(
    strpos($out, '&auml;') === false && strpos($out, '&ouml;') === false,
    'Text nodes are no longer entity-escaped'
);
// The encoding meta is a serializer implementation detail — it must never
// reach the browser, or every translated page would grow a foreign tag.
rawAssert(
    strpos($out, 'http-equiv') === false && strpos($out, 'data-deepglot-charset') === false,
    'The injected encoding meta is stripped from the output, got: ' . substr($out, 0, 200)
);
// <style>/<script> content must never reach the translation API (quota!).
foreach ($client->sentTexts as $sent) {
    rawAssert(
        strpos($sent, 'deepglot-flag') === false && strpos($sent, 'var flag') === false,
        'Raw-text content is never sent to the translation API, but got: ' . $sent
    );
}

// -----------------------------------------------------------------------
// 2. Full OutputBuffer pipeline (serializer #1 + #2 back to back)
// -----------------------------------------------------------------------
$resolver = new UrlLanguageResolver('de', ['en']);
$routing = new SiteRouting($resolver, 'https://example.com', 'PATH_PREFIX', []);
$buffer = new OutputBuffer(
    $options,
    $resolver,
    new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()),
    new LinkRewriter($routing),
    new HreflangInjector($options, $routing),
    new RawTextRouter(),
    $routing
);

$piped = $buffer->process($html, 'en');

rawAssert(
    strpos($piped, 'content: "🇩🇪"') !== false,
    'Flag emoji survives BOTH round-trips (translate + link/hreflang pass), got: '
        . substr(strstr($piped, '<style') ?: $piped, 0, 160)
);
rawAssert(
    strpos($piped, 'content:"🇺🇸"') !== false,
    'Custom-flags override survives the full pipeline'
);
rawAssert(
    strpos($piped, '&#127465;') === false,
    'No entity-mangled emoji anywhere in the final output'
);
rawAssert(
    strpos($piped, 'var amp = "&amp;"') !== false,
    'Literal "&amp;" in JS survives the full pipeline'
);
rawAssert(
    strpos($piped, '<html lang="en"') !== false,
    'Pipeline still switches <html lang> (no regression)'
);

// -----------------------------------------------------------------------
// 3. Fragments have no <head>, so an encoding-meta trick cannot work there.
//    The raw-text protection must be independent of document shape.
// -----------------------------------------------------------------------
$fragment = '<div><style>.a::before{content:"🇦🇹"}</style><p>Grüße</p></div>';
$fragOut = (new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()))
    ->translate($fragment, 'en', '', 0);
rawAssert(
    strpos($fragOut, 'content:"🇦🇹"') !== false,
    'Raw-text protection also works on a fragment without <head>, got: ' . $fragOut
);

// -----------------------------------------------------------------------
// 4. Pure-ASCII raw text is untouched (the fix must not rewrite what is fine).
// -----------------------------------------------------------------------
$ascii = '<html><head><meta charset="UTF-8"></head><body>'
    . '<script src="/x.js"></script>'
    . '<script>var plain = "ok"; a &&= b;</script>'
    . '<p>Hallo</p></body></html>';
$asciiOut = (new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()))
    ->translate($ascii, 'en', '', 0);
rawAssert(
    strpos($asciiOut, 'var plain = "ok"; a &&= b;') !== false,
    'Pure-ASCII script content passes through unchanged, got: ' . substr($asciiOut, 0, 200)
);
rawAssert(
    strpos($asciiOut, '<script src="/x.js"></script>') !== false,
    'Empty <script src> element is preserved'
);

// -----------------------------------------------------------------------
// 5. Literal charset-looking markup in comments or raw-text elements is not a
//    document charset declaration. It must not block the injected UTF-8 meta,
//    or raw-text emoji will regress to numeric entities.
// -----------------------------------------------------------------------
$nestedMetaLiteral = '<html><head>'
    . '<!-- <meta charset="ISO-8859-1"> -->'
    . '<script>var headLiteral = \'<meta charset="ISO-8859-1">\';</script>'
    . '<meta charset="UTF-8">'
    . '<style>.flag::before{content:"🇩🇪"}</style>'
    . '</head><body>'
    . '<script>var literal = \'<meta charset="ISO-8859-1">\'; var flag = "🇬🇧";</script>'
    . '<p>Käse</p></body></html>';
$nestedMetaLiteralOut = (new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()))
    ->translate($nestedMetaLiteral, 'en', '', 0);
rawAssert(
    strpos($nestedMetaLiteralOut, 'content:"🇩🇪"') !== false,
    'A fake Latin-1 meta inside comments must not re-enable style entity escaping, got: '
        . substr($nestedMetaLiteralOut, 0, 240)
);
rawAssert(
    strpos($nestedMetaLiteralOut, 'var flag = "🇬🇧"') !== false,
    'A fake Latin-1 meta inside script text must not re-enable script entity escaping, got: '
        . substr($nestedMetaLiteralOut, 0, 240)
);
rawAssert(
    strpos($nestedMetaLiteralOut, '&#127465;') === false && strpos($nestedMetaLiteralOut, '&#127466;') === false,
    'Literal nested meta text must not block raw UTF-8 serialization'
);

// -----------------------------------------------------------------------
// 6. The pipeline serializes the SAME document twice (translate, then the
//    link/hreflang pass). The injected meta must not accumulate, and a page
//    that already ships its own classic Content-Type meta must not get a
//    second one.
// -----------------------------------------------------------------------
$twice = $buffer->process($buffer->process($html, 'en'), 'en');
rawAssert(
    substr_count($twice, 'http-equiv') === 0,
    'Re-processing an already-processed page accumulates no encoding meta, got: ' . substr($twice, 0, 200)
);

$ownMeta = '<html lang="de"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
    . '<style>.a{content:"🇩🇪"}</style></head><body><p>Käse</p></body></html>';
$ownMetaOut = (new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()))
    ->translate($ownMeta, 'en', '', 0);
rawAssert(
    substr_count($ownMetaOut, 'http-equiv') === 1,
    'A page with its own Content-Type meta keeps exactly one, got: ' . substr($ownMetaOut, 0, 200)
);
rawAssert(
    strpos($ownMetaOut, 'content:"🇩🇪"') !== false,
    'A page with its own Content-Type meta still serializes raw UTF-8'
);

// -----------------------------------------------------------------------
// 7. A document that declares a NON-UTF-8 charset was parsed as that charset,
//    so its text only survives today because saveHTML() escapes it straight
//    back. Forcing UTF-8 output there would turn that into permanent mojibake,
//    so such documents must stay on the legacy (entity) path — never worse
//    than before the fix.
// -----------------------------------------------------------------------
$latin = '<html><head><meta charset="ISO-8859-1"></head><body><p>Test</p></body></html>';
$latinOut = (new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()))
    ->translate($latin, 'en', '', 0);
rawAssert(
    strpos($latinOut, 'http-equiv') === false,
    'A non-UTF-8 document is left on the legacy path and gets no injected meta, got: ' . substr($latinOut, 0, 200)
);

// The same opt-out must hold for the CLASSIC spelling, where the charset hides
// inside `content` — that is the form libxml itself reads, so missing it would
// leave a genuinely Latin-1 page being re-serialized as UTF-8 (mojibake).
$latinClassic = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">'
    . '</head><body><p>Test</p></body></html>';
$latinClassicOut = (new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()))
    ->translate($latinClassic, 'en', '', 0);
rawAssert(
    substr_count($latinClassicOut, 'http-equiv') === 1,
    'A non-UTF-8 http-equiv declaration keeps the legacy path and gets no injected meta, got: '
        . substr($latinClassicOut, 0, 200)
);

// -----------------------------------------------------------------------
// 8. Two paths the decoy case in 5. does not reach, because it always ships a
//    real <meta charset="UTF-8"> to fall back on: a page that declares NO
//    charset at all, and a FRAGMENT (no <head>, so the encoding meta goes
//    top-level). Both must still ignore charset-looking script text — the
//    dynamic translator round-trips fragments on every AJAX render.
// -----------------------------------------------------------------------
$decoyNoRealMeta = '<html><head><script>var t = \'<meta charset="ISO-8859-1">\';</script>'
    . '<style>.a{content:"🇩🇪"}</style></head><body><p>Käse</p></body></html>';
$decoyNoRealMetaOut = (new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()))
    ->translate($decoyNoRealMeta, 'en', '', 0);
rawAssert(
    strpos($decoyNoRealMetaOut, 'content:"🇩🇪"') !== false,
    'A page declaring no charset still serializes raw UTF-8 despite script decoy text, got: '
        . substr($decoyNoRealMetaOut, 0, 240)
);

$decoyFragment = '<div><script>var t = \'<meta charset="ISO-8859-1">\';</script>'
    . '<style>.a{content:"🇩🇪"}</style></div>';
$decoyFragmentOut = (new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()))
    ->translate($decoyFragment, 'en', '', 0);
rawAssert(
    strpos($decoyFragmentOut, 'content:"🇩🇪"') !== false,
    'A head-less fragment still serializes raw UTF-8 despite script decoy text, got: '
        . substr($decoyFragmentOut, 0, 240)
);
rawAssert(
    strpos($decoyFragmentOut, 'http-equiv') === false
        && strpos($decoyFragmentOut, 'data-deepglot-charset') === false,
    'The fragment keeps no injected encoding meta in its output, got: ' . substr($decoyFragmentOut, 0, 240)
);

// -----------------------------------------------------------------------
// 9. The charset lookup is deliberately scoped to the places libxml itself
//    reads (htmlGetMetaEncoding scans top-level children and direct children
//    of <head>). A stray <meta charset> in the BODY does not drive the parse
//    encoding, so treating it as a declaration would strand a genuinely UTF-8
//    page on the entity path. Widening the query to `//meta` reintroduces
//    exactly that, and nothing else in this file would notice.
// -----------------------------------------------------------------------
$bodyMetaOnly = '<html><head><style>.a{content:"🇩🇪"}</style></head>'
    . '<body><meta charset="ISO-8859-1"><p>Kaese</p></body></html>';
$bodyMetaOnlyOut = (new HtmlTranslator(new RawTextFakeClient(), $options, new RawTextNullCache()))
    ->translate($bodyMetaOnly, 'en', '', 0);
rawAssert(
    strpos($bodyMetaOnlyOut, 'content:"🇩🇪"') !== false,
    'A charset meta in <body> must not disable UTF-8 serialization, got: '
        . substr($bodyMetaOnlyOut, 0, 240)
);

fwrite(STDOUT, "RawTextEntityEncodingTest: OK\n");
