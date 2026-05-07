<?php

/**
 * Reproduces the schema.org/JSON-LD gap observed on
 * https://www.meinhaushalt.at/en/tag/familie/ on 2026-05-07 where Yoast SEO
 * emitted a <script type="application/ld+json"> block that kept German
 * `name`, `description`, `headline`, `caption` and `inLanguage: "de"`
 * values on translated pages because the entire <script> tag was excluded
 * from translation.
 *
 * The translator must:
 *   - Walk every JSON-LD <script> in the head/body.
 *   - Extract human-readable string values (name, description, headline,
 *     caption, articleBody, alternativeHeadline, disambiguatingDescription,
 *     about) and feed them into the same translate batch the rest of the
 *     page uses.
 *   - Switch every `inLanguage` value to the target locale.
 *   - Leave URLs (`@id`, `url`, `image`, `logo`, `sameAs`, `target`,
 *     `mainEntityOfPage`), control attributes (`@context`, `@type`),
 *     timestamps and keyword strings untouched.
 *   - Recurse through arrays and the @graph nodes Yoast uses.
 *   - Keep the document intact when the JSON is malformed instead of
 *     erasing the script body or crashing.
 *
 * Run standalone: php tests/JsonLdTranslationTest.php
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
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
    }

    function is_wp_error($value) {
        return false;
    }

    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function wp_json_encode($data, $options = 0, $depth = 512) {
        return json_encode($data, $options, $depth);
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
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\TranslationCache;

class DeepglotJsonLdFakeClient extends Client
{
    public array $sentTexts = [];

    public function __construct() {}

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '')
    {
        foreach ($texts as $text) {
            $this->sentTexts[] = $text;
        }

        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn(string $text) => '[en] ' . $text, $texts),
        ];
    }

    public function translateBatches(array $batches, string $langFrom, string $langTo, string $requestUrl = ''): array
    {
        $results = [];

        foreach ($batches as $key => $batch) {
            $results[$key] = $this->translate($batch, $langFrom, $langTo, $requestUrl);
        }

        return $results;
    }
}

class DeepglotJsonLdNullCache extends TranslationCache
{
    public function getMany(array $texts, string $from, string $to): array
    {
        return [];
    }

    public function setMany(array $translations, string $from, string $to): void {}
}

function jsonLdAssert(bool $condition, string $message): void
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

$client = new DeepglotJsonLdFakeClient();
$translator = new HtmlTranslator($client, $options, new DeepglotJsonLdNullCache());

$jsonLd = json_encode([
    '@context' => 'https://schema.org',
    '@graph' => [
        [
            '@type' => 'CollectionPage',
            '@id' => 'https://www.meinhaushalt.at/tag/familie/',
            'url' => 'https://www.meinhaushalt.at/tag/familie/',
            'name' => 'Beiträge zum Schlagwort Familie',
            'description' => 'Entdecken Sie alle Beiträge zum Schlagwort Familie.',
            'inLanguage' => 'de',
        ],
        [
            '@type' => 'BreadcrumbList',
            '@id' => 'https://www.meinhaushalt.at/tag/familie/#breadcrumb',
            'itemListElement' => [
                ['@type' => 'ListItem', 'position' => 1, 'name' => 'Startseite', 'item' => 'https://www.meinhaushalt.at/'],
                ['@type' => 'ListItem', 'position' => 2, 'name' => 'Familie'],
            ],
        ],
        [
            '@type' => 'WebSite',
            '@id' => 'https://www.meinhaushalt.at/#website',
            'url' => 'https://www.meinhaushalt.at/',
            'name' => 'Mein Haushalt',
            'description' => 'Onlinemagazin rund um Haushalt, Gesundheit und Familie',
            'inLanguage' => 'de',
        ],
    ],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

$html = '<!DOCTYPE html><html><head>'
    . '<title>Familie</title>'
    . '<script type="application/ld+json" class="yoast-schema-graph">' . $jsonLd . '</script>'
    . '<script type="application/ld+json">{"@context":"https:\/\/schema.org","@type":"Article","headline":"Wie Sie Stress im Alltag reduzieren","articleBody":"Probieren Sie diese Tipps.","inLanguage":"de"}</script>'
    . '<script>console.log("ignore me");</script>'
    . '<script type="application/ld+json">not-valid-json{{</script>'
    . '</head><body><h1>Hallo Welt</h1></body></html>';

$translated = $translator->translate($html, 'en');

// 1. Translatable JSON-LD strings reach the API.
jsonLdAssert(in_array('Beiträge zum Schlagwort Familie', $client->sentTexts, true), 'JSON-LD CollectionPage name must be sent for translation');
jsonLdAssert(in_array('Entdecken Sie alle Beiträge zum Schlagwort Familie.', $client->sentTexts, true), 'JSON-LD CollectionPage description must be sent for translation');
jsonLdAssert(in_array('Onlinemagazin rund um Haushalt, Gesundheit und Familie', $client->sentTexts, true), 'JSON-LD WebSite description must be sent for translation');
jsonLdAssert(in_array('Wie Sie Stress im Alltag reduzieren', $client->sentTexts, true), 'JSON-LD Article headline must be sent for translation');
jsonLdAssert(in_array('Probieren Sie diese Tipps.', $client->sentTexts, true), 'JSON-LD Article articleBody must be sent for translation');
jsonLdAssert(in_array('Familie', $client->sentTexts, true), 'JSON-LD breadcrumb itemListElement.name must be sent for translation');

// 2. Non-translatable JSON-LD fields stay out of the batch.
foreach (['https://schema.org', 'CollectionPage', 'BreadcrumbList', 'WebSite', 'https://www.meinhaushalt.at/tag/familie/', 'https://www.meinhaushalt.at/tag/familie/#breadcrumb', 'de'] as $forbidden) {
    jsonLdAssert(!in_array($forbidden, $client->sentTexts, true), '"' . $forbidden . '" must NOT be sent for translation');
}

// 3. Other script content is still skipped.
jsonLdAssert(!in_array('console.log("ignore me");', $client->sentTexts, true), 'Generic script content must not be translated');

// 4. The JSON-LD strings are replaced in the rendered output.
$decoded = html_entity_decode($translated, ENT_QUOTES | ENT_HTML5, 'UTF-8');
jsonLdAssert(str_contains($decoded, '[en] Beiträge zum Schlagwort Familie'), 'Translated JSON-LD CollectionPage name should appear in output');
jsonLdAssert(str_contains($decoded, '[en] Entdecken Sie alle Beiträge zum Schlagwort Familie.'), 'Translated JSON-LD CollectionPage description should appear in output');
jsonLdAssert(str_contains($decoded, '[en] Wie Sie Stress im Alltag reduzieren'), 'Translated JSON-LD Article headline should appear in output');

// 5. inLanguage is rewritten to the target locale.
jsonLdAssert(str_contains($decoded, '"inLanguage":"en"'), 'inLanguage should be switched to the target locale');
jsonLdAssert(!str_contains($decoded, '"inLanguage":"de"'), 'inLanguage must not retain the source locale, got: ' . substr($decoded, 0, 200));

// 6. URLs and IDs survive intact.
jsonLdAssert(str_contains($decoded, '"https://www.meinhaushalt.at/tag/familie/"') || str_contains($decoded, '"https:\/\/www.meinhaushalt.at\/tag\/familie\/"'), 'URLs in @id/url must be preserved');
jsonLdAssert(str_contains($decoded, '"@type":"CollectionPage"'), '@type fields must be preserved');

// 7. The malformed JSON-LD block stays intact rather than getting deleted.
jsonLdAssert(str_contains($translated, 'not-valid-json{{'), 'Malformed JSON-LD content must be preserved as-is, got: ' . substr($translated, 0, 400));

// 8. Body H1 still translates the normal way.
jsonLdAssert(str_contains($translated, '[en] Hallo Welt'), 'Body text must still translate alongside JSON-LD');

// 9. Script-terminator escaping: even if a translation result happens to
// contain "</script>" (a manual override or upstream injection scenario)
// the rewritten <script> block must NOT emit a literal closing tag —
// that would let the browser end the script block early and run anything
// that follows as HTML.
class DeepglotJsonLdInjectingClient extends Client
{
    public function __construct() {}

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '')
    {
        return [
            'from_words' => $texts,
            'to_words' => array_map(
                static fn(string $text) => 'Read </script><script>alert(1)</script> please',
                $texts
            ),
        ];
    }

    public function translateBatches(array $batches, string $langFrom, string $langTo, string $requestUrl = ''): array
    {
        $results = [];

        foreach ($batches as $key => $batch) {
            $results[$key] = $this->translate($batch, $langFrom, $langTo, $requestUrl);
        }

        return $results;
    }
}

$injectionTranslator = new HtmlTranslator(
    new DeepglotJsonLdInjectingClient(),
    $options,
    new DeepglotJsonLdNullCache()
);
$injectionPayload = json_encode([
    '@context' => 'https://schema.org',
    '@type' => 'Article',
    'headline' => 'Hallo Welt',
    'inLanguage' => 'de',
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
$injectionHtml = '<!DOCTYPE html><html><head><script type="application/ld+json">' . $injectionPayload . '</script></head><body><h1>x</h1></body></html>';
$injectionOut = $injectionTranslator->translate($injectionHtml, 'en');

// Exactly one </script> closing tag is expected: the JSON-LD block's own
// closer. If the translated headline leaked through unescaped there would
// be additional </script> tokens.
preg_match_all('#</script>#i', $injectionOut, $closes);
jsonLdAssert(
    count($closes[0]) === 1,
    'Translated JSON-LD must escape <, > as \\u003c / \\u003e so it cannot break out of <script>; got ' . count($closes[0]) . ' </script> tags in: ' . substr($injectionOut, 0, 400)
);
jsonLdAssert(
    !str_contains($injectionOut, '<script>alert(1)</script>'),
    'Injection payload from translation result must not appear unescaped'
);

// 10. Non-prose JSON-LD keys (keywords, genre, creativeWorkStatus) must NOT
// be batched for translation — they are typically controlled vocabularies
// or comma-separated tag lists where free-form translation distorts SEO.
$nonProseClient = new DeepglotJsonLdFakeClient();
$nonProseTranslator = new HtmlTranslator($nonProseClient, $options, new DeepglotJsonLdNullCache());
$nonProsePayload = json_encode([
    '@context' => 'https://schema.org',
    '@type' => 'Article',
    'name' => 'Kuchen backen',
    'keywords' => 'Familie, Kinder, Erziehung',
    'genre' => 'Comedy',
    'creativeWorkStatus' => 'Published',
    'inLanguage' => 'de',
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
$nonProseHtml = '<!DOCTYPE html><html><head><script type="application/ld+json">' . $nonProsePayload . '</script></head><body><h1>x</h1></body></html>';
$nonProseTranslator->translate($nonProseHtml, 'en');

jsonLdAssert(in_array('Kuchen backen', $nonProseClient->sentTexts, true), 'Prose name must still be translated');
foreach (['Familie, Kinder, Erziehung', 'Comedy', 'Published'] as $controlled) {
    jsonLdAssert(!in_array($controlled, $nonProseClient->sentTexts, true), 'Controlled-vocabulary value "' . $controlled . '" must NOT be translated');
}

fwrite(STDOUT, "JsonLdTranslationTest: OK\n");
