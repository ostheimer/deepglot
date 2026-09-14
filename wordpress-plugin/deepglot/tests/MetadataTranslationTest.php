<?php

/**
 * Reproduces three head-metadata translation gaps observed on
 * https://www.meinhaushalt.at/en/ on 2026-05-07:
 *   - <title> text remained in the source language
 *   - <meta name="description" content="..."> remained in the source language
 *   - <meta property="og:title" / og:description / twitter:*"> remained untranslated
 *   - <html lang="de"> was not switched to lang="en"
 *
 * Run standalone: php tests/MetadataTranslationTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
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

    function get_transient($key) {
        return $GLOBALS['_deepglot_transients'][$key] ?? false;
    }

    function set_transient($key, $value, $ttl = 0) {
        $GLOBALS['_deepglot_transients'][$key] = $value;
        return true;
    }

    function is_wp_error($value) {
        return false;
    }

    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function sanitize_text_field($value) {
        return trim((string) $value);
    }

    function sanitize_textarea_field($value) {
        return trim((string) $value);
    }

    function esc_url_raw($value) {
        return (string) $value;
    }

    function untrailingslashit($value) {
        return rtrim((string) $value, '/');
    }

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Support/HtmlDocument.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\TranslationCache;

class DeepglotMetadataFakeClient extends Client
{
    public array $sentTexts = [];

    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null)
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

class DeepglotMetadataNullCache extends TranslationCache
{
    public function getMany(array $texts, string $from, string $to): array
    {
        return [];
    }

    public function setMany(array $translations, string $from, string $to): array
    {
        return array_fill_keys(array_keys($translations), true);
    }
}

function dgAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

$options = new Options();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

$client = new DeepglotMetadataFakeClient();
$translator = new HtmlTranslator($client, $options, new DeepglotMetadataNullCache());

$html = '<!DOCTYPE html>'
    . '<html lang="de">'
    . '<head>'
    . '<meta charset="utf-8">'
    . '<title>Gesundheit ist wichtig</title>'
    . '<meta name="description" content="Tipps für ein gesundes Leben">'
    . '<meta name="keywords" content="Gesundheit, Tipps">'
    . '<meta property="og:title" content="Gesundheit – Mein Haushalt">'
    . '<meta property="og:description" content="Ratgeber für gesundes Leben">'
    . '<meta property="og:site_name" content="Mein Haushalt">'
    . '<meta property="og:image:alt" content="Frisches Gemüse">'
    . '<meta name="twitter:title" content="Gesundheit – Mein Haushalt">'
    . '<meta name="twitter:description" content="Ratgeber">'
    . '<meta name="robots" content="index, follow">'
    . '<link rel="alternate" type="application/rss+xml" title="Mein Haushalt – Feed" href="/feed/">'
    . '<link rel="alternate" type="application/atom+xml" title="Mein Haushalt – Kommentar-Feed" href="/comments/feed/">'
    . '<link rel="alternate" type="text/html" title="Machine alternate title" href="/en/">'
    . '<link rel="stylesheet" href="/style.css">'
    . '<script>console.log("Mein Haushalt");</script>'
    . '<style>body{color:red}</style>'
    . '</head>'
    . '<body>'
    . '<h1>Hallo Welt</h1>'
    . '</body></html>';

$translated = $translator->translate($html, 'en');

// PHP DOMDocument::saveHTML() encodes high-byte UTF-8 characters as entities;
// decode for assertion convenience so the markup matcher works for umlauts.
$decoded = html_entity_decode($translated, ENT_QUOTES | ENT_HTML5, 'UTF-8');

// 1. Title text is sent for translation and replaced.
dgAssert(in_array('Gesundheit ist wichtig', $client->sentTexts, true), 'Title text must be sent for translation');
dgAssert(str_contains($decoded, '<title>[en] Gesundheit ist wichtig</title>'), 'Title element should contain translated text, got: ' . $decoded);

// 2. Meta description content gets translated.
dgAssert(in_array('Tipps für ein gesundes Leben', $client->sentTexts, true), 'Meta description content must be sent for translation');
dgAssert(str_contains($decoded, '"[en] Tipps für ein gesundes Leben"'), 'Meta description should contain translated text');

// 3. og:title and og:description content get translated.
dgAssert(in_array('Gesundheit – Mein Haushalt', $client->sentTexts, true), 'og:title content must be sent for translation');
dgAssert(in_array('Ratgeber für gesundes Leben', $client->sentTexts, true), 'og:description content must be sent for translation');
dgAssert(str_contains($decoded, '"[en] Gesundheit – Mein Haushalt"'), 'og:title should contain translated text');
dgAssert(str_contains($decoded, '"[en] Ratgeber für gesundes Leben"'), 'og:description should contain translated text');

// 4. og:image:alt and og:site_name get translated.
dgAssert(in_array('Frisches Gemüse', $client->sentTexts, true), 'og:image:alt must be sent for translation');
dgAssert(in_array('Mein Haushalt', $client->sentTexts, true), 'og:site_name must be sent for translation');

// 5. twitter:title and twitter:description get translated.
dgAssert(str_contains($decoded, '"[en] Gesundheit – Mein Haushalt"'), 'twitter:title should be translated (deduped with og:title)');

// 5a. WordPress feed discovery titles are human-readable metadata. Translate
// only RSS/Atom alternates; ordinary <link> titles remain machine metadata.
dgAssert(in_array('Mein Haushalt – Feed', $client->sentTexts, true), 'RSS feed title must be sent for translation');
dgAssert(in_array('Mein Haushalt – Kommentar-Feed', $client->sentTexts, true), 'Atom feed title must be sent for translation');
dgAssert(str_contains($decoded, 'title="[en] Mein Haushalt – Feed"'), 'RSS feed title should contain translated text');
dgAssert(str_contains($decoded, 'title="[en] Mein Haushalt – Kommentar-Feed"'), 'Atom feed title should contain translated text');
dgAssert(!in_array('Machine alternate title', $client->sentTexts, true), 'Non-feed link title must not be translated');

// 6. robots/keywords meta content must NOT be translated.
dgAssert(!in_array('index, follow', $client->sentTexts, true), 'robots meta content must not be translated');
dgAssert(!in_array('Gesundheit, Tipps', $client->sentTexts, true), 'keywords meta content must not be translated');

// 7. Script and style content must NOT be translated even though head is now allowed.
foreach ($client->sentTexts as $sent) {
    dgAssert(!str_contains($sent, 'console.log'), 'Script content must not be translated, got: ' . $sent);
    dgAssert(!str_contains($sent, 'color:red'), 'Style content must not be translated, got: ' . $sent);
}

// 8. Body H1 still translates as before.
dgAssert(in_array('Hallo Welt', $client->sentTexts, true), 'Body text must still be translated');
dgAssert(str_contains($translated, '[en] Hallo Welt'), 'H1 text must be translated in body');

// 9. Editor mode: head text nodes (title) get translated but never wrapped in
// the editor span — wrapping inside <title> would produce invalid markup like
// <title><span>...</span></title> that breaks title rendering. Body text still
// gets the wrapping treatment so the visual editor can target it.
$editorClient = new DeepglotMetadataFakeClient();
$editorTranslator = new HtmlTranslator($editorClient, $options, new DeepglotMetadataNullCache());
$editorHtml = '<!DOCTYPE html><html><head>'
    . '<title>Hallo</title>'
    . '<meta name="description" content="Beschreibung">'
    . '</head><body><h1>Hallo Welt</h1></body></html>';
$editorResult = $editorTranslator->translateForEditor($editorHtml, 'en');
$editorDecoded = html_entity_decode($editorResult['html'], ENT_QUOTES | ENT_HTML5, 'UTF-8');

dgAssert(str_contains($editorDecoded, '<title>[en] Hallo</title>'), 'Editor mode must translate <title> text without span wrapping, got: ' . $editorDecoded);
dgAssert(!preg_match('/<title>[^<]*<span/u', $editorDecoded), 'Editor mode must NOT wrap <title> children in segment spans: ' . $editorDecoded);
dgAssert(str_contains($editorDecoded, '"[en] Beschreibung"'), 'Editor mode must still translate meta description content');
dgAssert(preg_match('/<h1>\s*<span[^>]*data-deepglot-segment-id/u', $editorDecoded) === 1, 'Editor mode must still wrap body text nodes in segment spans, got: ' . $editorDecoded);

// Editor segments list must not include the title text node.
foreach ($editorResult['segments'] as $segment) {
    dgAssert($segment['originalText'] !== 'Hallo', 'Title text node must not be exposed as an editor segment');
}

// meinhaushalt #157 baseline: raw ampersands in translated attribute values
// must not be parsed as entity references or erase OG/X titles and image alt.
$specialSource = 'Gurken-Sushi mit Avocado & Karotte – einfaches Rezept';
$specialHtml = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    . '<meta property="og:title" content="' . htmlspecialchars($specialSource, ENT_QUOTES) . '">'
    . '<meta name="twitter:title" content="' . htmlspecialchars($specialSource, ENT_QUOTES) . '">'
    . '<meta property="og:image:alt" content="' . htmlspecialchars($specialSource, ENT_QUOTES) . '">'
    . '</head><body><p>Rezept</p></body></html>';
$specialOutput = $translator->translate($specialHtml, 'en');
$specialDoc = new DOMDocument();
$specialDoc->loadHTML('<?xml encoding="UTF-8">' . $specialOutput);
foreach ($specialDoc->getElementsByTagName('meta') as $meta) {
    if (in_array($meta->getAttribute('property') ?: $meta->getAttribute('name'), ['og:title', 'twitter:title', 'og:image:alt'], true)) {
        dgAssert($meta->getAttribute('content') === '[en] ' . $specialSource, 'Raw ampersand must survive translated social attribute: ' . $specialDoc->saveHTML($meta));
    }
}

// Exercise actual serialization and the production translation cache, not a
// decoded markup substring: decoding the entire document can conceal extra
// entity interpretation or broken attribute boundaries. Every entrypoint must
// retain the exact provider text on the first render and on a cache-only rerun.
$attributeSources = [
    $specialSource,
    'Avocado "frisch" und Karotte \'knackig\'',
    'Wörtliche Entities: &amp; &quot; &copy; &#169; &#x1F363; &recipe;',
    'Wörtliches Markup: "><script>alert("Rezept")</script> <b>frisch</b>',
];
$attributeHtml = '<!DOCTYPE html><html><head><meta charset="utf-8">';
foreach ($attributeSources as $source) {
    $escaped = htmlspecialchars($source, ENT_QUOTES, 'UTF-8');
    $attributeHtml .= '<meta property="og:title" content="' . $escaped . '">'
        . '<meta name="twitter:title" content="' . $escaped . '">'
        . '<meta property="og:image:alt" content="' . $escaped . '">';
}
$attributeHtml .= '</head><body>';
foreach ($attributeSources as $source) {
    $escaped = htmlspecialchars($source, ENT_QUOTES, 'UTF-8');
    $attributeHtml .= '<img src="/recipe.jpg" alt="' . $escaped . '" title="' . $escaped . '">';
}
$attributeHtml .= '</body></html>';

foreach (['translate', 'translateInline', 'translateForEditor'] as $entrypoint) {
    $GLOBALS['_deepglot_transients'] = [];
    $attributeClient = new DeepglotMetadataFakeClient();
    $attributeCache = new TranslationCache();
    $attributeTranslator = new HtmlTranslator($attributeClient, $options, $attributeCache);

    foreach (['provider', 'cache'] as $origin) {
        $attributeClient->sentTexts = [];
        $attributeResult = $attributeTranslator->$entrypoint($attributeHtml, 'en');
        $attributeOutput = is_array($attributeResult) ? $attributeResult['html'] : $attributeResult;
        $attributeDoc = new DOMDocument();
        $attributeDoc->loadHTML('<?xml encoding="UTF-8">' . $attributeOutput);
        $label = $entrypoint . ' / ' . $origin;

        $socialNodes = (new DOMXPath($attributeDoc))->query('//meta[@content]');
        dgAssert($socialNodes->length === count($attributeSources) * 3, $label . ': all social attributes must survive');
        foreach ($socialNodes as $index => $meta) {
            dgAssert($meta->getAttribute('content') === '[en] ' . $attributeSources[intdiv($index, 3)], $label . ': social attribute must retain exact translated text');
        }

        $imageNodes = $attributeDoc->getElementsByTagName('img');
        dgAssert($imageNodes->length === count($attributeSources), $label . ': all images must survive');
        foreach ($imageNodes as $index => $img) {
            foreach (['alt', 'title'] as $attribute) {
                dgAssert($img->getAttribute($attribute) === '[en] ' . $attributeSources[$index], $label . ': image ' . $attribute . ' must retain exact translated text');
            }
        }
        dgAssert($attributeDoc->getElementsByTagName('script')->length === 0, $label . ': literal markup must stay inside attribute text');

        if ($origin === 'provider') {
            dgAssert($attributeClient->sentTexts === $attributeSources, $label . ': send decoded, deduplicated source text');
            foreach ($attributeSources as $source) {
                dgAssert($attributeCache->get($source, 'de', 'en') === '[en] ' . $source, $label . ': cache must retain exact provider text');
            }
        } else {
            dgAssert($attributeClient->sentTexts === [], $label . ': cached output must not call the provider');
        }
    }
}

fwrite(STDOUT, "MetadataTranslationTest: OK\n");
