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
 *     about, recipeIngredient and HowToStep text) and feed them into the same
 *     translate batch the rest of the page uses.
 *   - Switch literal `inLanguage` codes to the target locale, preserving IRI coercion.
 *   - Localize internal page identities/references while leaving shared
 *     Person/Organization identifiers, media/external URLs, control
 *     attributes (`@context`, `@type`), timestamps and keywords untouched.
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
require_once __DIR__ . '/../includes/Support/WordPressInfrastructure.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Support/HtmlDocument.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Frontend\JsonLdTranslator;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\UrlLanguageResolver;

class DeepglotJsonLdFakeClient extends Client
{
    public array $sentTexts = [];

    public function __construct() {}

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

    public function translateBatches(array $batches, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null): array
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

    public function setMany(array $translations, string $from, string $to): array { return array_fill_keys(array_keys($translations), true); }
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
        [
            '@type' => 'WebPage',
            '@id' => 'https://www.meinhaushalt.at/tag/familie/#webpage',
            'url' => 'https://www.meinhaushalt.at/tag/familie/',
            'breadcrumb' => [
                '@id' => 'https://www.meinhaushalt.at/tag/familie/#breadcrumb',
            ],
        ],
        [
            '@type' => 'Article',
            '@id' => 'https://www.meinhaushalt.at/tag/familie/beitrag/#article',
            'url' => 'https://www.meinhaushalt.at/tag/familie/beitrag/',
            'isPartOf' => [
                '@id' => 'https://www.meinhaushalt.at/tag/familie/#webpage',
            ],
            'mainEntityOfPage' => [
                '@id' => 'https://www.meinhaushalt.at/standalone/#webpage',
                'url' => 'https://www.meinhaushalt.at/standalone/',
            ],
            'author' => [
                '@id' => 'https://www.meinhaushalt.at/#/schema/person/redaktion',
            ],
            'publisher' => [
                '@id' => 'https://www.meinhaushalt.at/#organization',
            ],
            'image' => [
                '@id' => 'https://www.meinhaushalt.at/wp-content/uploads/polenta.jpg',
            ],
            'citation' => [
                '@id' => 'https://example.com/reference',
            ],
        ],
        [
            '@type' => 'Recipe',
            '@id' => 'https://www.meinhaushalt.at/rezepte/rezept-polenta-grundrezept/#recipe',
            'url' => 'https://www.meinhaushalt.at/rezepte/rezept-polenta-grundrezept/',
            'name' => 'Rezept Polenta Grundrezept',
            'recipeIngredient' => [
                '800 ml Wasser',
                '250 g Maisgrieß',
            ],
            'recipeInstructions' => [
                ['@type' => 'HowToStep', 'text' => 'Das Wasser aufkochen lassen.'],
            ],
            'author' => [
                '@type' => 'Person',
                '@id' => 'https://www.meinhaushalt.at/#/schema/person/redaktion',
                'name' => 'Redaktion',
            ],
            'publisher' => [
                '@type' => 'Organization',
                '@id' => 'https://www.meinhaushalt.at/#organization',
                'name' => 'Mein Haushalt',
            ],
            'image' => [
                '@type' => 'ImageObject',
                '@id' => 'https://www.meinhaushalt.at/wp-content/uploads/polenta.jpg',
                'url' => 'https://www.meinhaushalt.at/wp-content/uploads/polenta.jpg',
            ],
            'sameAs' => 'https://example.com/polenta',
        ],
        [
            '@type' => 'Thing',
            'text' => 'Technischer Kontrollwert',
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
jsonLdAssert(in_array('800 ml Wasser', $client->sentTexts, true), 'Recipe ingredient text must be sent for translation');
jsonLdAssert(in_array('250 g Maisgrieß', $client->sentTexts, true), 'Every Recipe ingredient must be sent for translation');
jsonLdAssert(in_array('Das Wasser aufkochen lassen.', $client->sentTexts, true), 'HowToStep text must be sent for translation');

// 2. Non-translatable JSON-LD fields stay out of the batch.
foreach (['https://schema.org', 'CollectionPage', 'BreadcrumbList', 'WebSite', 'https://www.meinhaushalt.at/tag/familie/', 'https://www.meinhaushalt.at/tag/familie/#breadcrumb', 'de'] as $forbidden) {
    jsonLdAssert(!in_array($forbidden, $client->sentTexts, true), '"' . $forbidden . '" must NOT be sent for translation');
}
jsonLdAssert(
    !in_array('Technischer Kontrollwert', $client->sentTexts, true),
    'A generic schema text field outside HowToStep must not be translated'
);

// 3. Other script content is still skipped.
jsonLdAssert(!in_array('console.log("ignore me");', $client->sentTexts, true), 'Generic script content must not be translated');

// 4. The JSON-LD strings are replaced in the rendered output.
$decoded = html_entity_decode($translated, ENT_QUOTES | ENT_HTML5, 'UTF-8');
jsonLdAssert(str_contains($decoded, '[en] Beiträge zum Schlagwort Familie'), 'Translated JSON-LD CollectionPage name should appear in output');
jsonLdAssert(str_contains($decoded, '[en] Entdecken Sie alle Beiträge zum Schlagwort Familie.'), 'Translated JSON-LD CollectionPage description should appear in output');
jsonLdAssert(str_contains($decoded, '[en] Wie Sie Stress im Alltag reduzieren'), 'Translated JSON-LD Article headline should appear in output');
jsonLdAssert(str_contains($decoded, '"recipeIngredient":["[en] 800 ml Wasser","[en] 250 g Maisgrieß"]'), 'Recipe ingredients should be translated in output');
jsonLdAssert(str_contains($decoded, '"text":"[en] Das Wasser aufkochen lassen."'), 'HowToStep text should be translated in output');
jsonLdAssert(str_contains($decoded, '"text":"Technischer Kontrollwert"'), 'Generic schema text must remain unchanged');

// 5. inLanguage is rewritten to the target locale.
jsonLdAssert(str_contains($decoded, '"inLanguage":"en"'), 'inLanguage should be switched to the target locale');
jsonLdAssert(!str_contains($decoded, '"inLanguage":"de"'), 'inLanguage must not retain the source locale, got: ' . substr($decoded, 0, 200));

// 6. URLs and IDs survive intact.
jsonLdAssert(str_contains($decoded, '"https://www.meinhaushalt.at/tag/familie/"') || str_contains($decoded, '"https:\/\/www.meinhaushalt.at\/tag\/familie\/"'), 'URLs in @id/url must be preserved');
jsonLdAssert(str_contains($decoded, '"@type":"CollectionPage"'), '@type fields must be preserved');

// 6a. Page and breadcrumb URLs must follow the target route while shared
// publisher/person identifiers deliberately remain language-neutral.
$routing = new SiteRouting(
    new UrlLanguageResolver('de', ['en']),
    'https://www.meinhaushalt.at',
    'PATH_PREFIX',
    [],
    ['en' => ['rezepte' => 'recipes']]
);
$localizedClient = new DeepglotJsonLdFakeClient();
$localizedTranslator = new HtmlTranslator(
    $localizedClient,
    $options,
    new DeepglotJsonLdNullCache(),
    new JsonLdTranslator($routing)
);
$localized = html_entity_decode($localizedTranslator->translate($html, 'en'), ENT_QUOTES | ENT_HTML5, 'UTF-8');
jsonLdAssert(
    str_contains($localized, '"item":"https://www.meinhaushalt.at/en/"'),
    'Breadcrumb ListItem URLs must point to the target-language route'
);
jsonLdAssert(
    str_contains($localized, '"breadcrumb":{"@id":"https://www.meinhaushalt.at/en/tag/familie/#breadcrumb"}'),
    'WebPage breadcrumb references must match the localized BreadcrumbList identity'
);
jsonLdAssert(
    str_contains($localized, '"isPartOf":{"@id":"https://www.meinhaushalt.at/en/tag/familie/#webpage"}'),
    'Article isPartOf references must match the localized WebPage identity'
);
jsonLdAssert(
    str_contains($localized, '"mainEntityOfPage":{"@id":"https://www.meinhaushalt.at/en/standalone/#webpage","url":"https://www.meinhaushalt.at/en/standalone/"}'),
    'Explicit mainEntityOfPage objects must remain localized without a separate graph node'
);
jsonLdAssert(
    str_contains($localized, '"@id":"https://www.meinhaushalt.at/en/recipes/rezept-polenta-grundrezept/#recipe"')
    && str_contains($localized, '"url":"https://www.meinhaushalt.at/en/recipes/rezept-polenta-grundrezept/"'),
    'Recipe identity and URL must point to the target-language route and configured slug'
);
jsonLdAssert(
    str_contains($localized, '"@id":"https://www.meinhaushalt.at/#/schema/person/redaktion"')
    && str_contains($localized, '"@id":"https://www.meinhaushalt.at/#organization"'),
    'Shared Person and Organization identifiers must remain language-neutral'
);
jsonLdAssert(
    str_contains($localized, '"@id":"https://www.meinhaushalt.at/wp-content/uploads/polenta.jpg"')
    && str_contains($localized, '"url":"https://www.meinhaushalt.at/wp-content/uploads/polenta.jpg"')
    && str_contains($localized, '"sameAs":"https://example.com/polenta"'),
    'Media and external URLs must remain unchanged'
);
jsonLdAssert(
    str_contains($localized, '"author":{"@id":"https://www.meinhaushalt.at/#/schema/person/redaktion"}')
    && str_contains($localized, '"publisher":{"@id":"https://www.meinhaushalt.at/#organization"}')
    && str_contains($localized, '"image":{"@id":"https://www.meinhaushalt.at/wp-content/uploads/polenta.jpg"}')
    && str_contains($localized, '"citation":{"@id":"https://example.com/reference"}'),
    'Untyped Person, Organization, media and external reference objects must remain unchanged'
);

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

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null)
    {
        return [
            'from_words' => $texts,
            'to_words' => array_map(
                static fn(string $text) => 'Read </script><script>alert(1)</script> please',
                $texts
            ),
        ];
    }

    public function translateBatches(array $batches, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0, ?int $timeout = null): array
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

// Review regressions: run every case before reporting failures so each boundary
// has independent red/green evidence. Decode JSON instead of matching output.
function jsonLdReviewRender(array $blocks, SiteRouting $routing, ?array &$collected = null, array $extraTranslations = []): array
{
    $doc = new DOMDocument();
    $html = '<html><head><meta charset="utf-8">';
    foreach ($blocks as $block) {
        $html .= '<script type="application/ld+json">'
            . json_encode($block, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            . '</script>';
    }
    $doc->loadHTML($html . '</head><body></body></html>');
    $helper = new JsonLdTranslator($routing);
    $mutations = $helper->collect($doc, 'en');
    $translations = [];
    foreach ($mutations as $mutation) {
        foreach ($mutation['strings'] as $text) {
            $translations[$text] = '[en] ' . $text;
        }
    }
    $collected = array_keys($translations);
    $helper->apply($mutations, array_merge($translations, $extraTranslations), 'en');
    $output = [];
    foreach ($doc->getElementsByTagName('script') as $script) {
        $output[] = json_decode($script->textContent, true, 512, JSON_THROW_ON_ERROR);
    }
    return $output;
}

$reviewFailures = [];
$reviewCheck = static function (bool $pass, string $label) use (&$reviewFailures): void {
    if (!$pass) {
        $reviewFailures[] = $label;
    }
};

$instructionOutput = jsonLdReviewRender([
    ['@type' => 'Recipe', 'recipeInstructions' => 'Wasser aufkochen.'],
    ['@type' => 'Recipe', 'recipeInstructions' => ['Grieß einrühren.', 'Fünf Minuten köcheln.']],
    ['@type' => 'Thing', 'text' => 'Unveränderter Kontrolltext'],
], $routing);
$reviewCheck(
    $instructionOutput[0]['recipeInstructions'] === '[en] Wasser aufkochen.'
    && $instructionOutput[1]['recipeInstructions'] === ['[en] Grieß einrühren.', '[en] Fünf Minuten köcheln.']
    && $instructionOutput[2]['text'] === 'Unveränderter Kontrolltext',
    'P2 3942085469: string and string-array recipeInstructions translate; generic text stays unchanged'
);

$sourcePageId = 'https://www.meinhaushalt.at/review/#webpage';
$sourceBreadcrumbId = 'https://www.meinhaushalt.at/review/#breadcrumb';
$references = [
    '@type' => 'Article',
    'isPartOf' => ['@id' => $sourcePageId],
    'breadcrumb' => ['@id' => $sourceBreadcrumbId],
    'author' => ['@id' => 'https://www.meinhaushalt.at/#person'],
    'publisher' => ['@id' => 'https://www.meinhaushalt.at/#organization'],
    'image' => ['@id' => 'https://www.meinhaushalt.at/wp-content/uploads/image.jpg'],
    'citation' => ['@id' => 'https://example.org/#webpage'],
];
$definitions = ['@graph' => [
    ['@type' => 'WebPage', '@id' => $sourcePageId],
    ['@type' => 'BreadcrumbList', '@id' => $sourceBreadcrumbId],
    ['@type' => 'Person', '@id' => $references['author']['@id']],
    ['@type' => 'Organization', '@id' => $references['publisher']['@id']],
    ['@type' => 'ImageObject', '@id' => $references['image']['@id']],
    ['@type' => 'WebPage', '@id' => $references['citation']['@id']],
]];
foreach ([false, true] as $reverse) {
    $blocks = $reverse ? [$definitions, $references] : [$references, $definitions];
    $result = jsonLdReviewRender($blocks, $routing);
    $referenceOutput = $result[$reverse ? 1 : 0];
    $definitionOutput = $result[$reverse ? 0 : 1]['@graph'];
    $reviewCheck(
        $referenceOutput['isPartOf']['@id'] === $definitionOutput[0]['@id']
        && $referenceOutput['isPartOf']['@id'] === 'https://www.meinhaushalt.at/en/review/#webpage'
        && $referenceOutput['breadcrumb']['@id'] === $definitionOutput[1]['@id'],
        'P2 3942085474: cross-script references match definitions in order ' . (int) $reverse
    );
    foreach (['author', 'publisher', 'image', 'citation'] as $key) {
        $reviewCheck($referenceOutput[$key] === $references[$key], 'Shared/external reference preserved: ' . $key);
    }
    $reviewCheck(array_slice($definitionOutput, 2) === array_slice($definitions['@graph'], 2), 'Shared/media/external definitions preserved');
}

$padded = jsonLdReviewRender([
    ['@type' => 'WebPage', '@id' => " \t" . $sourcePageId . "\n", 'url' => ' https://www.meinhaushalt.at/review/ '],
    ['@type' => 'Article', 'isPartOf' => ['@id' => $sourcePageId], 'mainEntityOfPage' => ' https://www.meinhaushalt.at/review/ '],
    ['@type' => 'WebPage', '@id' => ' https://example.org/external/ ', 'url' => ' https://example.org/external/ '],
    ['@type' => 'Person', '@id' => ' https://www.meinhaushalt.at/#person '],
], $routing);
$reviewCheck(
    $padded[0]['@id'] === 'https://www.meinhaushalt.at/en/review/#webpage'
    && $padded[0]['url'] === 'https://www.meinhaushalt.at/en/review/'
    && $padded[1]['isPartOf']['@id'] === $padded[0]['@id']
    && $padded[1]['mainEntityOfPage'] === 'https://www.meinhaushalt.at/en/review/'
    && $padded[2]['url'] === ' https://example.org/external/ '
    && $padded[2]['@id'] === ' https://example.org/external/ '
    && $padded[3]['@id'] === ' https://www.meinhaushalt.at/#person ',
    'P2 3942085476: padded page URLs normalize consistently; external URLs never become local paths'
);

foreach (['schema:', 'https://schema.org/', 'http://schema.org/'] as $prefix) {
    $typed = jsonLdReviewRender([
        ['@context' => ['schema' => 'https://schema.org/'], '@type' => $prefix . 'HowToStep', 'text' => 'Grieß einrühren.'],
        ['@context' => ['schema' => 'https://schema.org/'], '@type' => $prefix . 'WebPage', '@id' => $sourcePageId, 'url' => 'https://www.meinhaushalt.at/review/'],
        ['@type' => $prefix . 'Person', '@id' => 'https://www.meinhaushalt.at/#person', 'text' => 'Unverändert'],
    ], $routing);
    $reviewCheck(
        $typed[0]['text'] === '[en] Grieß einrühren.'
        && $typed[1]['@id'] === 'https://www.meinhaushalt.at/en/review/#webpage'
        && $typed[1]['url'] === 'https://www.meinhaushalt.at/en/review/'
        && $typed[2]['@id'] === 'https://www.meinhaushalt.at/#person'
        && $typed[2]['text'] === 'Unverändert',
        'P2 3942085479: compact/full IRI types recognized: ' . $prefix
    );
}

$enriched = $references;
$enriched['isPartOf']['name'] = 'Seite';
$enriched['breadcrumb']['position'] = 1;
$enriched['author']['name'] = 'Autor';
$enriched['reviewedBy'] = ['@type' => 'Person', '@id' => $sourcePageId];
$enrichedResult = jsonLdReviewRender([$enriched, $definitions], $routing);
$reviewCheck(
    $enrichedResult[0]['isPartOf']['@id'] === $enrichedResult[1]['@graph'][0]['@id']
    && $enrichedResult[0]['isPartOf']['name'] === '[en] Seite'
    && $enrichedResult[0]['breadcrumb']['@id'] === $enrichedResult[1]['@graph'][1]['@id']
    && $enrichedResult[0]['breadcrumb']['position'] === 1
    && $enrichedResult[0]['author']['@id'] === $references['author']['@id']
    && $enrichedResult[0]['reviewedBy']['@id'] === $sourcePageId,
    'P2 3942110975: enriched references match known page IDs and preserve other entities'
);

$aliasGraph = [
    '@context' => ['s' => 'https://schema.org/'],
    '@graph' => [
        ['@type' => 's:HowToStep', 'text' => 'Wasser aufkochen.'],
        ['@type' => 's:WebPage', '@id' => $sourcePageId],
        ['@context' => ['s' => 'https://example.org/'], '@type' => 's:WebPage', '@id' => 'https://www.meinhaushalt.at/foreign/'],
        ['@context' => ['s' => 'https://example.org/'], '@type' => 's:HowToStep', 'text' => 'Nicht übersetzen.'],
        ['@type' => 's:HowToStep', 'text' => 'Grieß einrühren.'],
        ['@context' => null, '@type' => 's:HowToStep', 'text' => 'Nach Reset unverändert.'],
    ],
];
$aliasBlocks = jsonLdReviewRender([
    $aliasGraph,
    ['@context' => ['schema' => 'https://example.org/'], '@type' => 'schema:WebPage', '@id' => 'https://www.meinhaushalt.at/foreign-schema/'],
    ['@type' => 's:HowToStep', 'text' => 'Anderer Block unverändert.'],
    ['@type' => 'https://schema.org/HowToStep', 'text' => 'Volle IRI übersetzen.'],
    ['@context' => ['https://schema.org', ['x' => ['@id' => 'http://schema.org/', '@prefix' => true]]], '@type' => 'x:HowToStep', 'text' => 'Objektpräfix übersetzen.'],
    ['@context' => ['@vocab' => 'https://schema.org/'], '@type' => 'HowToStep', 'text' => 'Vokabular übersetzen.'],
    ['@context' => ['@vocab' => 'https://example.org/'], '@type' => 'WebPage', '@id' => 'https://www.meinhaushalt.at/foreign-vocab/'],
    ['@type' => 'https://example.org/WebPage', '@id' => 'https://www.meinhaushalt.at/foreign-full/'],
], $routing);
$reviewCheck(
    $aliasBlocks[0]['@graph'][0]['text'] === '[en] Wasser aufkochen.'
    && $aliasBlocks[0]['@graph'][1]['@id'] === 'https://www.meinhaushalt.at/en/review/#webpage'
    && $aliasBlocks[0]['@graph'][4]['text'] === '[en] Grieß einrühren.'
    && $aliasBlocks[3]['text'] === '[en] Volle IRI übersetzen.'
    && $aliasBlocks[4]['text'] === '[en] Objektpräfix übersetzen.'
    && $aliasBlocks[5]['text'] === '[en] Vokabular übersetzen.',
    'P2 3942110982: active context aliases, object prefixes and full IRIs resolve'
);
$reviewCheck(
    $aliasBlocks[0]['@graph'][2]['@id'] === 'https://www.meinhaushalt.at/foreign/'
    && $aliasBlocks[0]['@graph'][3]['text'] === 'Nicht übersetzen.'
    && $aliasBlocks[0]['@graph'][5]['text'] === 'Nach Reset unverändert.'
    && $aliasBlocks[1]['@id'] === 'https://www.meinhaushalt.at/foreign-schema/'
    && $aliasBlocks[2]['text'] === 'Anderer Block unverändert.'
    && $aliasBlocks[6]['@id'] === 'https://www.meinhaushalt.at/foreign-vocab/'
    && $aliasBlocks[7]['@id'] === 'https://www.meinhaushalt.at/foreign-full/',
    'Context overrides, null resets, foreign prefixes and separate script scopes stay isolated'
);

$urlArrays = jsonLdReviewRender([
    ['@type' => 'WebPage', 'url' => ['https://www.meinhaushalt.at/review/', 'https://example.org/page/']],
    ['@type' => 'Article', 'mainEntityOfPage' => ['https://www.meinhaushalt.at/review/', ['@id' => $sourcePageId], 'https://example.org/page/']],
    ['@type' => 'Person', 'url' => ['https://www.meinhaushalt.at/author/']],
    ['@type' => 'ImageObject', 'url' => ['https://www.meinhaushalt.at/wp-content/uploads/image.jpg']],
    ['@type' => 'WebPage', 'url' => [], 'sameAs' => ['https://www.meinhaushalt.at/unchanged/']],
], $routing);
$reviewCheck(
    $urlArrays[0]['url'] === ['https://www.meinhaushalt.at/en/review/', 'https://example.org/page/']
    && $urlArrays[1]['mainEntityOfPage'] === ['https://www.meinhaushalt.at/en/review/', ['@id' => 'https://www.meinhaushalt.at/en/review/#webpage'], 'https://example.org/page/']
    && $urlArrays[2]['url'] === ['https://www.meinhaushalt.at/author/']
    && $urlArrays[3]['url'] === ['https://www.meinhaushalt.at/wp-content/uploads/image.jpg']
    && $urlArrays[4]['url'] === []
    && $urlArrays[4]['sameAs'] === ['https://www.meinhaushalt.at/unchanged/'],
    'P2 3942110987: URL/reference arrays retain semantics, shape and external/entity controls'
);

$vocabularyContext = [
    'recipeInstructions' => 'https://schema.org/recipeInstructions',
    'name' => 'https://schema.org/name',
    'mainEntityOfPage' => ['@id' => 'https://www.meinhaushalt.at/vocabulary/'],
    'scoped' => ['@id' => 'https://example.org/scoped', '@context' => ['description' => 'https://schema.org/description']],
];
$contextTexts = [];
$vocabularyOutput = jsonLdReviewRender([
    ['@context' => $vocabularyContext, '@type' => 'Recipe', 'recipeInstructions' => 'Wasser aufkochen.'],
], $routing, $contextTexts, ['https://schema.org/name' => 'Must never replace a context IRI']);
$reviewCheck(
    $contextTexts === ['Wasser aufkochen.']
    && $vocabularyOutput[0]['@context'] === $vocabularyContext
    && $vocabularyOutput[0]['recipeInstructions'] === '[en] Wasser aufkochen.',
    'P2 3942110991: contexts never enter collection, translation or URL rewriting'
);

$termContext = [
    'PageAlias' => 'https://schema.org/WebPage',
    'StepAlias' => ['@id' => 's:HowToStep'],
    's' => 'https://schema.org/',
];
$termAliases = jsonLdReviewRender([
    ['@context' => $termContext, '@graph' => [
        ['@type' => 'PageAlias', '@id' => $sourcePageId, 'url' => 'https://www.meinhaushalt.at/review/'],
        ['@type' => 'StepAlias', 'text' => 'Termalias übersetzen.'],
        ['@context' => ['PageAlias' => 'https://example.org/WebPage', 'StepAlias' => null], '@type' => 'PageAlias', '@id' => 'https://www.meinhaushalt.at/foreign-term/', 'child' => ['@type' => 'StepAlias', 'text' => 'Nullalias unverändert.']],
        ['@type' => 'StepAlias', 'text' => 'Geschwisteralias übersetzen.'],
        ['@type' => 'PageAlias:HowToStep', 'text' => 'Term ist kein Präfix.'],
        ['@context' => null, '@type' => 'StepAlias', 'text' => 'Reset unverändert.'],
    ]],
    ['@type' => 'StepAlias', 'text' => 'Separater Block unverändert.'],
    ['@context' => ['HowToStep' => null], '@type' => 'HowToStep', 'text' => 'Deaktivierter Term unverändert.'],
], $routing);
$reviewCheck(
    $termAliases[0]['@graph'][0]['@id'] === 'https://www.meinhaushalt.at/en/review/#webpage'
    && $termAliases[0]['@graph'][0]['url'] === 'https://www.meinhaushalt.at/en/review/'
    && $termAliases[0]['@graph'][1]['text'] === '[en] Termalias übersetzen.'
    && $termAliases[0]['@graph'][3]['text'] === '[en] Geschwisteralias übersetzen.',
    'P2 3942168225: ordinary class aliases resolve independently of prefix mappings'
);
$reviewCheck(
    $termAliases[0]['@context'] === $termContext
    && $termAliases[0]['@graph'][2]['@id'] === 'https://www.meinhaushalt.at/foreign-term/'
    && $termAliases[0]['@graph'][2]['child']['text'] === 'Nullalias unverändert.'
    && $termAliases[0]['@graph'][4]['text'] === 'Term ist kein Präfix.'
    && $termAliases[0]['@graph'][5]['text'] === 'Reset unverändert.'
    && $termAliases[1]['text'] === 'Separater Block unverändert.'
    && $termAliases[2]['text'] === 'Deaktivierter Term unverändert.',
    'Term aliases preserve context, foreign overrides, null definitions and script scopes'
);

foreach (['OpinionNewsArticle', 'AdvertiserContentArticle', 'SatiricalArticle', 'MedicalScholarlyArticle'] as $articleType) {
    $articleId = 'https://www.meinhaushalt.at/story/#' . $articleType;
    $articleOutput = jsonLdReviewRender([
        ['isPartOf' => ['@id' => $articleId, 'name' => 'Artikel']],
        ['@context' => ['s' => 'https://schema.org/'], '@type' => 's:' . $articleType, '@id' => $articleId, 'url' => 'https://www.meinhaushalt.at/story/'],
        ['@type' => 'https://example.org/' . $articleType, '@id' => 'https://www.meinhaushalt.at/foreign-story/'],
        ['@type' => 'Person', '@id' => 'https://www.meinhaushalt.at/#person'],
        ['@type' => 'ArticleSeries', '@id' => 'https://www.meinhaushalt.at/#series'],
    ], $routing);
    $reviewCheck(
        $articleOutput[0]['isPartOf']['@id'] === $articleOutput[1]['@id']
        && $articleOutput[1]['@id'] === 'https://www.meinhaushalt.at/en/story/#' . $articleType
        && $articleOutput[1]['url'] === 'https://www.meinhaushalt.at/en/story/'
        && $articleOutput[2]['@id'] === 'https://www.meinhaushalt.at/foreign-story/'
        && $articleOutput[3]['@id'] === 'https://www.meinhaushalt.at/#person'
        && $articleOutput[4]['@id'] === 'https://www.meinhaushalt.at/#series',
        'P2 3942168229: Schema.org Article subtype routes and references: ' . $articleType
    );
}

$genericItems = jsonLdReviewRender([
    ['@type' => 'ListItem', 'item' => ['@type' => 'Thing', '@id' => 'https://www.meinhaushalt.at/category/#item', 'url' => ['https://www.meinhaushalt.at/category/', 'https://example.org/category/']]],
    ['@type' => 'ListItem', 'item' => [['@type' => 'Thing', '@id' => 'https://www.meinhaushalt.at/category/'], ['@type' => 'Thing', '@id' => 'https://example.org/category/']]],
], $routing);
$reviewCheck(
    $genericItems[0]['item']['@id'] === 'https://www.meinhaushalt.at/en/category/#item'
    && $genericItems[0]['item']['url'] === ['https://www.meinhaushalt.at/en/category/', 'https://example.org/category/']
    && $genericItems[1]['item'][0]['@id'] === 'https://www.meinhaushalt.at/en/category/'
    && $genericItems[1]['item'][1]['@id'] === 'https://example.org/category/',
    'P2 3942168231: typed Thing breadcrumb references retain relationship and array semantics'
);
foreach (['Person', 'Organization', 'ImageObject', 'VideoObject', 'AudioObject'] as $sharedType) {
    $sharedItem = ['@type' => ['Thing', $sharedType], '@id' => 'https://www.meinhaushalt.at/#shared', 'url' => ['https://www.meinhaushalt.at/shared/', 'https://example.org/shared/']];
    $sharedOutput = jsonLdReviewRender([['@type' => 'ListItem', 'item' => $sharedItem]], $routing);
    $reviewCheck($sharedOutput[0]['item'] === $sharedItem, 'Typed breadcrumb shared/media exclusion: ' . $sharedType);
}

// Collected graph identities may supply page semantics only to untyped nodes
// or exclusively generic Schema.org Thing types, never other entity classes.
foreach ([false, true] as $reverse) {
    $genericReferences = [
        '@context' => ['s' => 'https://schema.org/', 'Generic' => 's:Thing'],
        'isPartOf' => ['@type' => 'Thing', '@id' => $sourcePageId, 'position' => 1],
        'breadcrumb' => [
            ['@type' => ['Generic', 's:Thing'], '@id' => $sourceBreadcrumbId],
            ['@type' => 'https://schema.org/Thing', '@id' => $sourcePageId],
            ['@type' => 'Thing', '@id' => 'https://example.org/#webpage'],
            ['@type' => 'Thing', '@id' => 'https://www.meinhaushalt.at/unknown/#webpage'],
        ],
    ];
    $blocks = $reverse ? [$definitions, $genericReferences] : [$genericReferences, $definitions];
    $genericResult = jsonLdReviewRender($blocks, $routing);
    $genericOutput = $genericResult[$reverse ? 1 : 0];
    $pageOutput = $genericResult[$reverse ? 0 : 1]['@graph'];
    $reviewCheck(
        $genericOutput['isPartOf']['@id'] === $pageOutput[0]['@id']
        && $genericOutput['isPartOf']['position'] === 1
        && $genericOutput['breadcrumb'][0]['@id'] === $pageOutput[1]['@id']
        && $genericOutput['breadcrumb'][1]['@id'] === $pageOutput[0]['@id']
        && $genericOutput['breadcrumb'][2] === $genericReferences['breadcrumb'][2]
        && $genericOutput['breadcrumb'][3] === $genericReferences['breadcrumb'][3],
        'P2 3942202262: exclusively generic typed references match collected IDs in order ' . (int) $reverse
    );
}

$specificReferenceTypes = [
    'LocalBusiness', ['Thing', 'LocalBusiness'], 'Corporation', 'NGO',
    'EducationalOrganization', 'Patient', 'NewsMediaOrganization',
    'MusicVideoObject', 'AudioObject', '3DModel', 'ImageObjectSnapshot',
    'Product', 'CreativeWork', 'https://example.org/Thing',
    ['Thing', 'https://example.org/LocalBusiness'],
    ['Thing', 'missing:Unresolved'], ['Thing', null], [], null,
];
foreach ($specificReferenceTypes as $specificType) {
    $specificItem = ['@type' => $specificType, '@id' => $sourcePageId, 'url' => [
        'https://www.meinhaushalt.at/shared/', 'https://example.org/shared/',
    ]];
    $specificOutput = jsonLdReviewRender([
        ['@type' => 'ListItem', 'item' => [$specificItem]],
        ['isPartOf' => $specificItem, 'breadcrumb' => $specificItem],
        $definitions,
    ], $routing);
    $reviewCheck(
        $specificOutput[0]['item'][0] === $specificItem
        && $specificOutput[1]['isPartOf'] === $specificItem
        && $specificOutput[1]['breadcrumb'] === $specificItem,
        'P2 3942202265: specific, mixed or unresolved reference types stay unchanged: ' . json_encode($specificType)
    );
}

// Explicit page types keep their existing behavior, including shared-type vetoes.
foreach ([['WebPage', 'Thing'], ['WebPage', 'Person'], ['Article', 'MediaObject']] as $pageTypes) {
    $pageTypeOutput = jsonLdReviewRender([['@type' => $pageTypes, '@id' => $sourcePageId]], $routing);
    $reviewCheck(
        $pageTypeOutput[0]['@id'] === ($pageTypes[1] === 'Thing' ? 'https://www.meinhaushalt.at/en/review/#webpage' : $sourcePageId),
        'Explicit page multi-types preserve existing routing: ' . json_encode($pageTypes)
    );
}

// Keyword aliases reuse the active local context for all traversal phases.
$keywordContext = ['type' => '@type', 'id' => ['@id' => '@id'], 's' => 'https://schema.org/', 'Page' => 's:WebPage'];
$keywordGraph = ['@context' => $keywordContext, '@graph' => [
    ['type' => 's:HowToStep', 'text' => ['Schlüsselwort übersetzen.', 'Danach abkühlen.']],
    ['type' => 'Page', 'id' => 'https://www.meinhaushalt.at/keyword/#page', 'url' => ['https://www.meinhaushalt.at/keyword/', 'https://example.org/keyword/']],
    ['type' => 's:ListItem', 'item' => ['type' => 's:Thing', 'id' => 'https://www.meinhaushalt.at/keyword-item/']],
    ['type' => 's:ListItem', 'item' => ['type' => ['s:Thing', 's:LocalBusiness'], 'id' => $sourcePageId, 'url' => 'https://www.meinhaushalt.at/shared/']],
    ['@context' => ['type' => null, 'id' => null], 'type' => 's:HowToStep', 'text' => 'Null-Schlüsselwort unverändert.', 'child' => ['type' => 's:WebPage', 'id' => 'https://www.meinhaushalt.at/null-keyword/']],
    ['@context' => ['type' => 'https://example.org/type', 'id' => 'https://example.org/id'], 'type' => 's:HowToStep', 'text' => 'Fremdes Schlüsselwort unverändert.', 'child' => ['type' => 's:WebPage', 'id' => 'https://www.meinhaushalt.at/foreign-keyword/']],
    ['@context' => null, 'type' => 's:HowToStep', 'text' => 'Zurückgesetztes Schlüsselwort unverändert.'],
    ['type' => 's:HowToStep', 'text' => 'Geschwister-Schlüsselwort übersetzen.'],
    ['@context' => [['type' => null], ['kind' => ['@id' => '@type']]], 'kind' => 's:HowToStep', 'type' => 's:WebPage', 'text' => 'Neuer Schlüsselwortalias übersetzen.'],
    ['@context' => ['s' => 'https://example.org/'], 'type' => 's:HowToStep', 'text' => 'Fremder Typ unverändert.'],
    ['@context' => 'https://example.org/remote-context', 'type' => 'https://schema.org/HowToStep', 'text' => 'Unbekannter Remote-Kontext unverändert.'],
    ['type' => 's:WebPage', 'id' => ' https://example.org/keyword/ ', 'url' => 'https://example.org/keyword/'],
]];
$keywordTexts = [];
$keywordOutput = jsonLdReviewRender([
    ['isPartOf' => ['@type' => 'Thing', '@id' => 'https://www.meinhaushalt.at/keyword/#page']],
    $keywordGraph,
    ['type' => 'https://schema.org/HowToStep', 'text' => 'Separates Schlüsselwort unverändert.'],
    ['type' => 'https://schema.org/WebPage', 'id' => 'https://www.meinhaushalt.at/separate-keyword/'],
    ['@context' => [null, ['kind' => '@type', 'identifier' => '@id', 's' => 'https://schema.org/']], 'kind' => ['s:Thing'], 'identifier' => $sourcePageId],
    $definitions,
], $routing, $keywordTexts);
$keywordNodes = $keywordOutput[1]['@graph'];
$reviewCheck(
    $keywordNodes[0]['text'] === ['[en] Schlüsselwort übersetzen.', '[en] Danach abkühlen.']
    && $keywordNodes[1]['id'] === 'https://www.meinhaushalt.at/en/keyword/#page'
    && $keywordNodes[1]['url'] === ['https://www.meinhaushalt.at/en/keyword/', 'https://example.org/keyword/']
    && $keywordNodes[2]['item']['id'] === 'https://www.meinhaushalt.at/en/keyword-item/'
    && $keywordNodes[7]['text'] === '[en] Geschwister-Schlüsselwort übersetzen.'
    && $keywordNodes[8]['text'] === '[en] Neuer Schlüsselwortalias übersetzen.'
    && $keywordOutput[0]['isPartOf']['@id'] === $keywordNodes[1]['id']
    && $keywordOutput[4]['identifier'] === $keywordOutput[5]['@graph'][0]['@id'],
    'P2 3942202268: local type/id keyword aliases translate, collect identities and route references'
);
$reviewCheck(
    $keywordOutput[1]['@context'] === $keywordContext
    && $keywordNodes[3] === $keywordGraph['@graph'][3]
    && $keywordNodes[4] === $keywordGraph['@graph'][4]
    && $keywordNodes[5] === $keywordGraph['@graph'][5]
    && $keywordNodes[6] === $keywordGraph['@graph'][6]
    && $keywordNodes[9] === $keywordGraph['@graph'][9]
    && $keywordNodes[10] === $keywordGraph['@graph'][10]
    && $keywordNodes[11] === $keywordGraph['@graph'][11]
    && $keywordOutput[2]['text'] === 'Separates Schlüsselwort unverändert.'
    && $keywordOutput[3]['id'] === 'https://www.meinhaushalt.at/separate-keyword/'
    && in_array('Schlüsselwort übersetzen.', $keywordTexts, true)
    && !in_array('@type', $keywordTexts, true)
    && !in_array('s:HowToStep', $keywordTexts, true),
    'Keyword alias contexts, shared types, null/foreign overrides and script scopes stay isolated'
);

// An overridden id alias must neither route that property nor seed graph IDs.
foreach ([null, 'https://example.org/id'] as $idOverride) {
    $overriddenId = 'https://www.meinhaushalt.at/overridden-id/';
    $idScope = jsonLdReviewRender([
        ['@context' => $keywordContext, 'child' => ['@context' => ['id' => $idOverride], 'type' => 's:WebPage', 'id' => $overriddenId]],
        ['isPartOf' => ['@id' => $overriddenId]],
    ], $routing);
    $reviewCheck(
        $idScope[0]['child']['id'] === $overriddenId && $idScope[1]['isPartOf']['@id'] === $overriddenId,
        'Keyword id alias overrides do not seed collected page IDs: ' . json_encode($idOverride)
    );
}

// Original keys are retained, but keyword meanings win over prose field names.
$keywordCollision = jsonLdReviewRender([
    ['@context' => ['name' => '@type', 'description' => '@id'], 'name' => 'HowToStep', 'description' => 'https://www.meinhaushalt.at/step/', 'text' => 'Alias-Kollision übersetzen.'],
    ['@context' => ['name' => '@type', 'description' => '@id'], 'name' => 'WebPage', 'description' => 'https://www.meinhaushalt.at/collision/'],
], $routing);
$reviewCheck(
    $keywordCollision[0]['name'] === 'HowToStep'
    && $keywordCollision[0]['description'] === 'https://www.meinhaushalt.at/step/'
    && $keywordCollision[0]['text'] === '[en] Alias-Kollision übersetzen.'
    && $keywordCollision[1]['name'] === 'WebPage'
    && $keywordCollision[1]['description'] === 'https://www.meinhaushalt.at/en/collision/',
    'Keyword aliases retain original keys and never become translated prose'
);

// A scalar is a page reference only under supported relationship semantics,
// never just because its string happens to equal a known graph identity.
$propertyContext = [
    's' => 'https://schema.org/',
    'instructions' => 's:recipeInstructions', 'pageUrl' => ['@id' => 's:url'],
    'stepText' => 's:text',
    'pageRelation' => ['@id' => 's:isPartOf', '@type' => '@id'],
    'trail' => ['@id' => 's:breadcrumb', '@type' => '@id'],
    'sameAs' => ['@id' => 's:sameAs', '@type' => '@id'],
    'citation' => ['@id' => 's:citation', '@type' => '@id'],
];
foreach ([false, true] as $reverse) {
    $scalarReferences = [
        '@context' => $propertyContext, '@type' => 's:Article',
        'isPartOf' => $sourcePageId, 'breadcrumb' => $sourceBreadcrumbId,
        's:isPartOf' => $sourcePageId,
        'pageRelation' => [$sourcePageId, 'https://example.org/#webpage', 'https://www.meinhaushalt.at/unknown/#webpage'],
        'trail' => $sourceBreadcrumbId,
        'sameAs' => $sourcePageId, 'citation' => $sourcePageId, 'unrelated' => $sourcePageId,
    ];
    $scalarBlocks = $reverse ? [$definitions, $scalarReferences] : [$scalarReferences, $definitions];
    $scalarResult = jsonLdReviewRender($scalarBlocks, $routing);
    $scalarOutput = $scalarResult[$reverse ? 1 : 0];
    $scalarDefinitions = $scalarResult[$reverse ? 0 : 1]['@graph'];
    $reviewCheck(
        $scalarOutput['isPartOf'] === $scalarDefinitions[0]['@id']
        && $scalarOutput['breadcrumb'] === $scalarDefinitions[1]['@id']
        && $scalarOutput['s:isPartOf'] === $scalarDefinitions[0]['@id']
        && $scalarOutput['pageRelation'][0] === $scalarDefinitions[0]['@id']
        && $scalarOutput['trail'] === $scalarDefinitions[1]['@id'],
        'P2 3942237560: scalar known page IDs route through literal, compact and coerced aliases in order ' . (int) $reverse
    );
    $reviewCheck(
        array_slice($scalarOutput['pageRelation'], 1) === array_slice($scalarReferences['pageRelation'], 1)
        && $scalarOutput['sameAs'] === $sourcePageId && $scalarOutput['citation'] === $sourcePageId
        && $scalarOutput['unrelated'] === $sourcePageId,
        'Scalar routing preserves unrelated, sameAs/citation, unknown and external values'
    );
}
foreach ([
    ['pageRelation' => ['@id' => 'https://example.org/isPartOf', '@type' => '@id']],
    ['pageRelation' => null],
    ['pageRelation' => ['@id' => 's:isPartOf', '@type' => 'https://www.w3.org/2001/XMLSchema#string']],
    ['isPartOf' => ['@id' => 'https://example.org/isPartOf', '@type' => '@id']],
] as $relationOverride) {
    $relationNode = ['@context' => [$propertyContext, $relationOverride], 'pageRelation' => $sourcePageId, 'isPartOf' => $sourcePageId];
    $relationOutput = jsonLdReviewRender([$relationNode, $definitions], $routing);
    $overriddenKey = array_key_first($relationOverride);
    $reviewCheck(
        $relationOutput[0][$overriddenKey] === $sourcePageId && $relationOutput[0]['@context'] === $relationNode['@context'],
        'Scalar reference context overrides fail closed: ' . json_encode($relationOverride)
    );
}

$implicitCoercion = jsonLdReviewRender([
    ['@context' => ['@vocab' => 'https://schema.org/', 'isPartOf' => ['@type' => '@id']], 'isPartOf' => $sourcePageId],
    $definitions,
], $routing);
$reviewCheck(
    $implicitCoercion[0]['isPartOf'] === $implicitCoercion[1]['@graph'][0]['@id'],
    'P2 3942237560: ID coercion with implicit Schema property mapping retains its semantics'
);

$scalarScopes = jsonLdReviewRender([
    ['@context' => $propertyContext, 'pageRelation' => $sourcePageId],
    ['pageRelation' => $sourcePageId],
    ['@context' => null, 'isPartOf' => $sourcePageId],
    ['@context' => ['@vocab' => 'https://example.org/'], 'isPartOf' => $sourcePageId],
    $definitions,
], $routing);
$reviewCheck(
    $scalarScopes[0]['pageRelation'] === $scalarScopes[4]['@graph'][0]['@id']
    && $scalarScopes[1]['pageRelation'] === $sourcePageId
    && $scalarScopes[2]['isPartOf'] === $sourcePageId
    && $scalarScopes[3]['isPartOf'] === $sourcePageId,
    'Scalar reference aliases and coercion preserve null/foreign vocabulary and script isolation'
);

$propertyGraph = ['@context' => $propertyContext, '@graph' => [
    ['@type' => 's:Recipe', 'instructions' => ['Wasser aufkochen.', 'Grieß einrühren.']],
    ['@type' => 's:HowToStep', 'stepText' => 'Kurz köcheln.'],
    ['@type' => 's:WebPage', '@id' => $sourcePageId, 'pageUrl' => ['https://www.meinhaushalt.at/review/', 'https://example.org/page/']],
    ['@context' => ['instructions' => 'https://example.org/recipeInstructions', 'pageUrl' => null, 'stepText' => null], '@type' => 's:HowToStep', 'instructions' => 'Fremde Anleitung unverändert.', 'stepText' => 'Nulltext unverändert.', 'pageUrl' => $sourcePageId],
    ['@context' => null, 'instructions' => 'Reset-Anleitung unverändert.', 'pageUrl' => $sourcePageId],
    ['@type' => 's:HowToStep', 'stepText' => 'Geschwistertext übersetzen.'],
    ['@context' => ['recipeInstructions' => 'https://example.org/recipeInstructions', 'url' => 'https://example.org/url'], '@type' => 's:WebPage', 'recipeInstructions' => 'Fremder Originalname unverändert.', 'url' => $sourcePageId],
    ['@type' => 's:Recipe', 'https://schema.org/recipeInstructions' => 'Volle Property-IRI übersetzen.'],
    ['@context' => ['instructions' => 's:sameAs'], 'instructions' => 'Unbekannte Semantik unverändert.'],
    ['@context' => ['instructions' => ['@id' => 's:recipeInstructions', '@type' => '@id']], 'instructions' => $sourcePageId],
]];
$propertyOutput = jsonLdReviewRender([
    $propertyGraph,
    ['instructions' => 'Separater Property-Alias unverändert.', 'pageUrl' => $sourcePageId],
], $routing);
$propertyNodes = $propertyOutput[0]['@graph'];
$reviewCheck(
    $propertyNodes[0]['instructions'] === ['[en] Wasser aufkochen.', '[en] Grieß einrühren.']
    && $propertyNodes[1]['stepText'] === '[en] Kurz köcheln.'
    && $propertyNodes[2]['pageUrl'] === ['https://www.meinhaushalt.at/en/review/', 'https://example.org/page/']
    && $propertyNodes[5]['stepText'] === '[en] Geschwistertext übersetzen.'
    && $propertyNodes[7]['https://schema.org/recipeInstructions'] === '[en] Volle Property-IRI übersetzen.',
    'P2 3942237563: supported Schema property aliases share translation and routing semantics'
);
$reviewCheck(
    $propertyOutput[0]['@context'] === $propertyContext
    && $propertyNodes[3] === $propertyGraph['@graph'][3]
    && $propertyNodes[4] === $propertyGraph['@graph'][4]
    && $propertyNodes[6] === $propertyGraph['@graph'][6]
    && $propertyNodes[8] === $propertyGraph['@graph'][8]
    && $propertyNodes[9] === $propertyGraph['@graph'][9]
    && $propertyOutput[1]['instructions'] === 'Separater Property-Alias unverändert.'
    && $propertyOutput[1]['pageUrl'] === $sourcePageId,
    'Property aliases preserve keys, contexts, foreign/null overrides and script scopes'
);

$valueContext = array_merge($propertyContext, ['literal' => '@value', 'lang' => ['@id' => '@language']]);
$valueGraph = ['@context' => $valueContext, '@graph' => [
    ['@type' => 's:HowToStep', 'text' => ['@value' => 'Wasser aufkochen.', '@language' => 'de']],
    ['@type' => 's:Recipe', 'recipeInstructions' => [
        ['@value' => 'Grieß einrühren.', '@language' => 'de'],
        ['@value' => 'Ohne Sprachmarke umrühren.'],
        ['literal' => 'Aliaswert abkühlen.', 'lang' => 'de'],
    ]],
    ['@type' => 's:HowToStep', 'stepText' => ['literal' => 'Property und Wert gemeinsam.', 'lang' => 'de']],
    ['@type' => 's:Recipe', 'instructions' => ['@context' => ['v' => '@value', 'l' => '@language'], 'v' => 'Lokaler Wertkontext.', 'l' => 'de']],
    ['@type' => 's:Thing', 'text' => ['@value' => 'Generischer Wert unverändert.', '@language' => 'de']],
    ['@type' => 's:Recipe', 'sameAs' => ['@value' => 'Nichttext-Wert unverändert.', '@language' => 'de']],
    ['@context' => ['instructions' => 'https://example.org/recipeInstructions'], 'instructions' => ['literal' => 'Fremder Property-Wert unverändert.', 'lang' => 'de']],
    ['@context' => ['literal' => null], 'instructions' => ['literal' => 'Nullwertalias unverändert.', 'lang' => 'de']],
    ['@context' => ['literal' => 'https://example.org/value'], 'instructions' => ['literal' => 'Fremder Wertalias unverändert.', 'lang' => 'de']],
    ['@type' => 's:HowToStep', 'stepText' => ['literal' => 'Geschwisterwert übersetzen.', 'lang' => 'de']],
    ['isPartOf' => ['@value' => $sourcePageId]],
]];
$valueTexts = [];
$valueOutput = jsonLdReviewRender([
    $valueGraph,
    ['recipeInstructions' => ['literal' => 'Separater Wertalias unverändert.', 'lang' => 'de']],
    $definitions,
], $routing, $valueTexts);
$valueNodes = $valueOutput[0]['@graph'];
$reviewCheck(
    $valueNodes[0]['text'] === ['@value' => '[en] Wasser aufkochen.', '@language' => 'en']
    && $valueNodes[1]['recipeInstructions'] === [
        ['@value' => '[en] Grieß einrühren.', '@language' => 'en'],
        ['@value' => '[en] Ohne Sprachmarke umrühren.'],
        ['literal' => '[en] Aliaswert abkühlen.', 'lang' => 'en'],
    ]
    && $valueNodes[2]['stepText'] === ['literal' => '[en] Property und Wert gemeinsam.', 'lang' => 'en']
    && $valueNodes[3]['instructions']['v'] === '[en] Lokaler Wertkontext.'
    && $valueNodes[3]['instructions']['l'] === 'en'
    && $valueNodes[9]['stepText'] === ['literal' => '[en] Geschwisterwert übersetzen.', 'lang' => 'en']
    && in_array('Property und Wert gemeinsam.', $valueTexts, true),
    'P2 3942237567: language-tagged value objects retain enclosing property semantics through arrays and aliases'
);
foreach ([4, 5, 6, 7, 8] as $valueIndex) {
    $reviewCheck($valueNodes[$valueIndex] === $valueGraph['@graph'][$valueIndex], 'Non-translatable/foreign value object unchanged: ' . $valueIndex);
}
$reviewCheck($valueNodes[10]['isPartOf'] === ['@value' => $routing->rewriteUrl($sourcePageId, 'en')],
    'Collected page references also localize the inner URL of an explicit value object');
$reviewCheck(
    $valueOutput[0]['@context'] === $valueContext
    && $valueNodes[3]['instructions']['@context'] === $valueGraph['@graph'][3]['instructions']['@context']
    && $valueOutput[1]['recipeInstructions'] === ['literal' => 'Separater Wertalias unverändert.', 'lang' => 'de']
    && !in_array('Generischer Wert unverändert.', $valueTexts, true)
    && !in_array('Fremder Property-Wert unverändert.', $valueTexts, true),
    'Value-object contexts and script scopes remain isolated and excluded from collection'
);

foreach ([
    ['@value' => 'Typisierter Wert unverändert.', '@type' => 's:HowToStep'],
    ['@value' => 'Identifizierter Wert unverändert.', '@id' => $sourcePageId],
    ['@value' => ['text' => 'Verschachtelter Wert unverändert.']],
    ['@value' => 'Zusatzfeld unverändert.', 'name' => 'Nicht sammeln.'],
    ['@value' => 'Falsche Sprachstruktur unverändert.', '@language' => ['de']],
    ['@value' => 42, '@language' => 'de'],
    ['@value' => null, '@language' => 'de'],
    ['@value' => 'Wert mit Richtung unverändert.', '@language' => 'de', '@direction' => 'ltr'],
    ['@value' => 'Wert mit Index unverändert.', '@index' => '0'],
    ['literal' => 'Aliasiert typisiert unverändert.', 'kind' => 's:HowToStep'],
] as $invalidValue) {
    $invalidTexts = [];
    $invalidOutput = jsonLdReviewRender([
        ['@context' => array_merge($valueContext, ['kind' => '@type']), '@type' => 's:Recipe', 'instructions' => $invalidValue],
    ], $routing, $invalidTexts);
    $reviewCheck(
        $invalidOutput[0]['instructions'] === $invalidValue && $invalidTexts === [],
        'Value objects with types, IDs or unsupported structure fail closed: ' . json_encode($invalidValue)
    );
}
foreach ([null, 'https://example.org/language'] as $languageOverride) {
    $languageValue = ['@context' => ['lang' => $languageOverride], 'literal' => 'Fremde Sprachmarke unverändert.', 'lang' => 'de'];
    $languageTexts = [];
    $languageOutput = jsonLdReviewRender([
        ['@context' => $valueContext, 'instructions' => $languageValue],
    ], $routing, $languageTexts);
    $reviewCheck(
        $languageOutput[0]['instructions'] === $languageValue && $languageTexts === [],
        'Value-object language alias overrides fail closed: ' . json_encode($languageOverride)
    );
}
// A cache miss must not claim the source-language literal has been translated.
$missingValueOutput = jsonLdReviewRender([
    ['recipeInstructions' => ['@value' => 'Ungecachter Wert.', '@language' => 'de']],
], $routing, $valueTexts, ['Ungecachter Wert.' => null]);
$reviewCheck(
    $missingValueOutput[0]['recipeInstructions'] === ['@value' => 'Ungecachter Wert.', '@language' => 'de'],
    'Value-object language stays at source when no translated value is available'
);

// Relationship-established page IDs must connect all safe definitions too.
$seedBase = 'https://www.meinhaushalt.at/seed/';
$seedRelations = ['@graph' => [
    ['@type' => 'Article', 'mainEntityOfPage' => ['@type' => 'Thing', '@id' => $seedBase . '#main']],
    ['@type' => 'Article', 'mainEntityOfPage' => $seedBase . '#scalar'],
    ['@type' => 'ListItem', 'item' => [['@id' => $seedBase . '#item'], $seedBase . '#scalar-item']],
    ['isPartOf' => $seedBase . '#main', 'breadcrumb' => ['@type' => 'Thing', '@id' => $seedBase . '#item']],
]];
$seedDefinitions = ['@graph' => [
    ['@type' => 'Thing', '@id' => $seedBase . '#main', 'url' => ['@id' => $seedBase . '#second']],
    ['@id' => $seedBase . '#scalar'], ['@type' => 'Thing', '@id' => $seedBase . '#item'],
    ['@id' => $seedBase . '#scalar-item'],
]];
// Deliberately put chained definitions before their source in some script orders.
$seedChain = ['@graph' => [
    ['@id' => $seedBase . '#third'],
    ['@type' => 'Thing', '@id' => $seedBase . '#second', 'url' => ['@id' => $seedBase . '#third']],
]];
foreach ([false, true] as $reverse) {
    $seedBlocks = $reverse ? [$seedChain, $seedDefinitions, $seedRelations] : [$seedRelations, $seedDefinitions, $seedChain];
    $seedResult = jsonLdReviewRender($seedBlocks, $routing);
    $seedRelationOutput = $seedResult[$reverse ? 2 : 0]['@graph'];
    $seedDefinitionOutput = $seedResult[1]['@graph'];
    $seedChainOutput = $seedResult[$reverse ? 0 : 2]['@graph'];
    $reviewCheck(
        $seedDefinitionOutput[0]['@id'] === 'https://www.meinhaushalt.at/en/seed/#main'
        && $seedDefinitionOutput[0]['@id'] === $seedRelationOutput[0]['mainEntityOfPage']['@id']
        && $seedDefinitionOutput[1]['@id'] === $seedRelationOutput[1]['mainEntityOfPage']
        && $seedDefinitionOutput[2]['@id'] === $seedRelationOutput[2]['item'][0]['@id']
        && $seedDefinitionOutput[3]['@id'] === $seedRelationOutput[2]['item'][1]
        && $seedRelationOutput[3]['isPartOf'] === $seedDefinitionOutput[0]['@id']
        && $seedRelationOutput[3]['breadcrumb']['@id'] === $seedDefinitionOutput[2]['@id']
        && $seedDefinitionOutput[0]['url']['@id'] === $seedChainOutput[1]['@id']
        && $seedChainOutput[1]['url']['@id'] === $seedChainOutput[0]['@id']
        && $seedChainOutput[0]['@id'] === 'https://www.meinhaushalt.at/en/seed/#third',
        'P2 3942273679: relationship seeds and chained safe definitions converge in script order ' . (int) $reverse
    );
}
foreach (['Person', 'LocalBusiness', 'ImageObject', ['Thing', 'LocalBusiness'], 'https://example.org/Thing'] as $unsafeSeedType) {
    $unsafeSeedId = $seedBase . '#unsafe';
    $unsafeSeedTarget = ['@type' => $unsafeSeedType, '@id' => $unsafeSeedId];
    $unsafeSeeds = jsonLdReviewRender([
        ['@type' => 'Article', 'mainEntityOfPage' => $unsafeSeedTarget],
        ['@type' => 'ListItem', 'item' => $unsafeSeedTarget],
        ['@type' => 'Thing', '@id' => $unsafeSeedId],
    ], $routing);
    $reviewCheck(
        $unsafeSeeds[0]['mainEntityOfPage'] === $unsafeSeedTarget
        && $unsafeSeeds[1]['item'] === $unsafeSeedTarget && $unsafeSeeds[2]['@id'] === $unsafeSeedId,
        'Specific/shared/foreign relationship targets never seed generic page definitions: ' . json_encode($unsafeSeedType)
    );
}
$unseededGraph = ['@graph' => [
    ['sameAs' => $seedBase . '#same', 'citation' => $seedBase . '#citation', 'isPartOf' => $seedBase . '#unknown', 'breadcrumb' => $seedBase . '#unknown'],
    ['@type' => 'Thing', '@id' => $seedBase . '#same'], ['@id' => $seedBase . '#citation'],
    ['@id' => $seedBase . '#unknown'],
    ['@type' => 'Thing', '@id' => $seedBase . '#cycle-a', 'url' => ['@id' => $seedBase . '#cycle-b']],
    ['@type' => 'Thing', '@id' => $seedBase . '#cycle-b', 'url' => ['@id' => $seedBase . '#cycle-a']],
    ['mainEntityOfPage' => 'https://example.org/#external'], ['@id' => 'https://example.org/#external'],
]];
$unseededOutput = jsonLdReviewRender([$unseededGraph], $routing);
$reviewCheck($unseededOutput[0] === $unseededGraph, 'Unknown, sameAs/citation, unseeded cycles and external IDs do not seed pages');

foreach (['https://schema.org/docs/jsonldcontext.jsonld', 'http://schema.org/docs/jsonldcontext.jsonld', 'https://schema.org/docs/jsonldcontext.json', 'http://schema.org/docs/jsonldcontext.json'] as $officialContext) {
    $officialOutput = jsonLdReviewRender([
        ['@context' => $officialContext, '@graph' => [
            ['@type' => 'Recipe', 'recipeInstructions' => 'Offiziellen Kontext übersetzen.'],
            ['@type' => 'WebPage', '@id' => $sourcePageId, 'url' => 'https://www.meinhaushalt.at/review/'],
        ]],
    ], $routing);
    $reviewCheck(
        $officialOutput[0]['@context'] === $officialContext
        && $officialOutput[0]['@graph'][0]['recipeInstructions'] === '[en] Offiziellen Kontext übersetzen.'
        && $officialOutput[0]['@graph'][1]['@id'] === 'https://www.meinhaushalt.at/en/review/#webpage'
        && $officialOutput[0]['@graph'][1]['url'] === 'https://www.meinhaushalt.at/en/review/',
        'P2 3942273681: official published Schema.org context is recognized locally: ' . $officialContext
    );
}
foreach ([
    'https://schema.org.evil.example/docs/jsonldcontext.jsonld',
    'https://example.org/docs/jsonldcontext.jsonld', 'https://schema.org/docs/other.jsonld',
    'https://schema.org/docs/jsonldcontext.jsonld?other=1',
    'https://schema.org/docs/jsonldcontext.jsonld#other',
] as $unknownContext) {
    $unknownContextNode = ['@context' => $unknownContext, '@type' => 'WebPage', '@id' => $sourcePageId, 'recipeInstructions' => 'Fremder Kontext unverändert.'];
    $unknownContextOutput = jsonLdReviewRender([$unknownContextNode], $routing);
    $reviewCheck($unknownContextOutput[0] === $unknownContextNode, 'Similar or foreign context URL stays unresolved: ' . $unknownContext);
}

$compactContext = ['site' => 'https://www.meinhaushalt.at/', 's' => 'https://schema.org/', 'identifier' => '@id', 'pageUrl' => 's:url', 'part' => ['@id' => 's:isPartOf', '@type' => '@id']];
$compactGraph = ['@context' => $compactContext, '@graph' => [
    ['@type' => 's:WebPage', 'identifier' => 'site:compact/#webpage', 'pageUrl' => ['site:compact/', 'https://example.org/compact/']],
    ['@type' => 's:Article', 'mainEntityOfPage' => 'site:compact/#webpage', 'part' => 'site:compact/#webpage'],
    ['@type' => 's:ListItem', 'item' => ['@type' => 's:Thing', '@id' => 'site:compact-item/']],
    ['@context' => ['site' => 'https://example.org/'], '@type' => 's:WebPage', '@id' => 'site:compact/#webpage', 'url' => 'site:compact/'],
    ['@context' => ['site' => null], '@type' => 's:WebPage', '@id' => 'site:compact/#webpage'],
    ['@type' => 's:WebPage', '@id' => 'site:compact-sibling/'],
    ['@type' => 's:Person', '@id' => 'site:person/'],
    ['@type' => 's:WebPage', '@id' => 'missing:compact/'],
    ['@context' => null, '@type' => 'https://schema.org/WebPage', '@id' => 'site:compact/'],
]];
foreach ([false, true] as $reverse) {
    $compactRefs = ['isPartOf' => ['@type' => 'Thing', '@id' => 'https://www.meinhaushalt.at/compact/#webpage'], 'breadcrumb' => ['@id' => 'https://www.meinhaushalt.at/compact-item/']];
    $compactBlocks = $reverse ? [$compactGraph, $compactRefs] : [$compactRefs, $compactGraph];
    $compactOutput = jsonLdReviewRender($compactBlocks, $routing);
    $compactNodes = $compactOutput[$reverse ? 0 : 1]['@graph'];
    $compactReferenceOutput = $compactOutput[$reverse ? 1 : 0];
    $reviewCheck(
        $compactNodes[0]['identifier'] === 'https://www.meinhaushalt.at/en/compact/#webpage'
        && $compactNodes[0]['pageUrl'] === ['https://www.meinhaushalt.at/en/compact/', 'https://example.org/compact/']
        && $compactNodes[1]['mainEntityOfPage'] === $compactNodes[0]['identifier']
        && $compactNodes[1]['part'] === $compactNodes[0]['identifier']
        && $compactNodes[2]['item']['@id'] === 'https://www.meinhaushalt.at/en/compact-item/'
        && $compactReferenceOutput['isPartOf']['@id'] === $compactNodes[0]['identifier']
        && $compactReferenceOutput['breadcrumb']['@id'] === $compactNodes[2]['item']['@id']
        && $compactNodes[5]['@id'] === 'https://www.meinhaushalt.at/en/compact-sibling/',
        'P2 3942273684: scoped compact IDs and safe page values expand before matching/routing in order ' . (int) $reverse
    );
    foreach ([3, 4, 6, 7, 8] as $compactIndex) {
        $reviewCheck($compactNodes[$compactIndex] === $compactGraph['@graph'][$compactIndex], 'Compact foreign/null/shared/unresolved value unchanged: ' . $compactIndex);
    }
    $reviewCheck($compactOutput[$reverse ? 0 : 1]['@context'] === $compactContext, 'Compact ID context and original keys remain unchanged');
}
$compactBoundaryNodes = [
    ['@type' => 'WebPage', '@id' => 'site:compact/'],
    ['@context' => ['@base' => 'https://www.meinhaushalt.at/'], '@type' => 'WebPage', '@id' => 'relative-page/'],
    ['@context' => ['site' => ['@id' => 'https://www.meinhaushalt.at/single', '@prefix' => false]], '@type' => 'WebPage', '@id' => 'site:compact/'],
    ['@context' => ['site' => 'https://example.org/'], '@type' => 'WebPage', '@id' => ' site:compact/ '],
];
$compactBoundaryOutput = jsonLdReviewRender(array_merge([$compactGraph], $compactBoundaryNodes), $routing);
$reviewCheck(array_slice($compactBoundaryOutput, 1) === $compactBoundaryNodes, 'Compact IRIs never leak scripts, infer term prefixes, expand external values or implement @base');

// Identity keys are canonical, but output shape remains SiteRouting's choice.
$identityPathRouting = new SiteRouting(new UrlLanguageResolver('de', ['en', 'fr']), 'https://www.meinhaushalt.at', 'PATH_PREFIX', [], [
    'en' => ['rezept' => 'recipe'], 'fr' => ['rezept' => 'recette'],
]);
$identityHostRouting = new SiteRouting(new UrlLanguageResolver('de', ['en', 'fr']), 'https://www.meinhaushalt.at', 'SUBDOMAIN', [
    'en' => 'en.meinhaushalt.at', 'fr' => 'fr.meinhaushalt.at',
], ['en' => ['rezept' => 'recipe'], 'fr' => ['rezept' => 'recette']]);
$identitySubdirRouting = new SiteRouting(new UrlLanguageResolver('de', ['en']), 'https://www.meinhaushalt.at/cms', 'PATH_PREFIX', []);
$identityCases = [
    [$routing, '/review/?q=a%20b#webpage', 'https://www.meinhaushalt.at/review/?q=a%20b#webpage'],
    [$identityPathRouting, '/rezept/?v=1#webpage', 'https://www.meinhaushalt.at/fr/recette/?v=1#webpage'],
    [$identityPathRouting, 'https://www.meinhaushalt.at/rezept/#webpage', '/en/recipe/#webpage'],
    [$identityHostRouting, '/rezept/?v=1#webpage', 'https://fr.meinhaushalt.at/recette/?v=1#webpage'],
    [$identitySubdirRouting, '/cms/review/#webpage', 'https://www.meinhaushalt.at/cms/en/review/#webpage'],
];
foreach ($identityCases as $identityCaseIndex => [$identityRouting, $leftIdentity, $rightIdentity]) {
    foreach ([false, true] as $swapIdentities) {
        $definitionIdentity = $swapIdentities ? $rightIdentity : $leftIdentity;
        $referenceIdentity = $swapIdentities ? $leftIdentity : $rightIdentity;
        foreach ([false, true] as $reverseScripts) {
            $identityDefinition = ['@type' => 'WebPage', '@id' => $definitionIdentity];
            $identityReferences = ['isPartOf' => ['@type' => 'Thing', '@id' => $referenceIdentity], 'breadcrumb' => $referenceIdentity];
            $identityBlocks = $reverseScripts ? [$identityDefinition, $identityReferences] : [$identityReferences, $identityDefinition];
            $identityOutput = jsonLdReviewRender($identityBlocks, $identityRouting);
            $identityDefinitionOutput = $identityOutput[$reverseScripts ? 0 : 1];
            $identityReferenceOutput = $identityOutput[$reverseScripts ? 1 : 0];
            $reviewCheck(
                $identityDefinitionOutput['@id'] === $identityRouting->rewriteUrl($definitionIdentity, 'en')
                && $identityReferenceOutput['isPartOf']['@id'] === $identityRouting->rewriteUrl($referenceIdentity, 'en')
                && $identityReferenceOutput['breadcrumb'] === $identityRouting->rewriteUrl($referenceIdentity, 'en'),
                'P2 3942310467: canonical identity with independent URL output forms: ' . $identityCaseIndex . '/' . (int) $swapIdentities . '/' . (int) $reverseScripts
            );
        }
    }
}
$identityEdges = jsonLdReviewRender([
    ['@graph' => [
        ['@type' => 'Thing', '@id' => 'https://www.meinhaushalt.at/mixed/#1'],
        ['@type' => 'Thing', '@id' => 'https://www.meinhaushalt.at/mixed/#0', 'url' => ['@id' => '/mixed/#1']],
    ]],
    ['mainEntityOfPage' => '/mixed/#0'],
], $routing);
$reviewCheck(
    $identityEdges[0]['@graph'][0]['@id'] === 'https://www.meinhaushalt.at/en/mixed/#1'
    && $identityEdges[0]['@graph'][1]['@id'] === 'https://www.meinhaushalt.at/en/mixed/#0'
    && $identityEdges[0]['@graph'][1]['url']['@id'] === '/en/mixed/#1'
    && $identityEdges[1]['mainEntityOfPage'] === '/en/mixed/#0',
    'P2 3942310467: canonical keys connect relative seeds and edges with absolute generic definitions'
);
$identityNegativeRefs = ['@graph' => []];
foreach (['/review/?q=other#webpage', '/review/?q=a%20b#other', 'https://example.org/review/?q=a%20b#webpage', '//example.org/review/?q=a%20b#webpage'] as $differentIdentity) {
    $identityNegativeRefs['@graph'][] = ['isPartOf' => ['@id' => $differentIdentity], 'breadcrumb' => $differentIdentity];
}
$identityNegativeOutput = jsonLdReviewRender([
    ['@type' => 'WebPage', '@id' => '/review/?q=a%20b#webpage'], $identityNegativeRefs,
], $routing);
$reviewCheck($identityNegativeOutput[1] === $identityNegativeRefs, 'Canonical identities preserve query/fragment differences and never merge external hosts');

// Count deterministic URL-resolution operations, not elapsed time. Full-graph
// fixed-point scans grow quadratically on this reverse chain; a graph build plus
// adjacency work queue stays within a constant budget per node/edge.
class DeepglotJsonLdCountingRouting extends SiteRouting
{
    public int $internalHostChecks = 0;

    public function isInternalHost(string $host): bool
    {
        $this->internalHostChecks++;
        return parent::isInternalHost($host);
    }
}
$queueRouting = new DeepglotJsonLdCountingRouting(new UrlLanguageResolver('de', ['en']), 'https://www.meinhaushalt.at', 'PATH_PREFIX', []);
$queueNodeCount = 200;
$queueGraph = ['@graph' => []];
for ($queueIndex = $queueNodeCount - 1; $queueIndex >= 0; $queueIndex--) {
    $queueNode = ['@type' => 'Thing', '@id' => 'https://www.meinhaushalt.at/queue/#' . $queueIndex];
    if ($queueIndex + 1 < $queueNodeCount) {
        $queueNode['url'] = ['@id' => 'https://www.meinhaushalt.at/queue/#' . ($queueIndex + 1)];
    }
    $queueGraph['@graph'][] = $queueNode;
}
$queueGraph['@graph'][] = ['@id' => 'https://www.meinhaushalt.at/queue/#cycle-a', 'url' => ['@id' => 'https://www.meinhaushalt.at/queue/#cycle-b']];
$queueGraph['@graph'][] = ['@id' => 'https://www.meinhaushalt.at/queue/#cycle-b', 'url' => ['@id' => 'https://www.meinhaushalt.at/queue/#cycle-a']];
$queueOutput = jsonLdReviewRender([$queueGraph, ['mainEntityOfPage' => ['@type' => 'Thing', '@id' => 'https://www.meinhaushalt.at/queue/#0']]], $queueRouting);
$queueAllLocalized = true;
for ($queueIndex = 0; $queueIndex < $queueNodeCount; $queueIndex++) {
    $queueAllLocalized = $queueAllLocalized && $queueOutput[0]['@graph'][$queueIndex]['@id'] === 'https://www.meinhaushalt.at/en/queue/#' . ($queueNodeCount - 1 - $queueIndex);
}
$reviewCheck(
    $queueAllLocalized && array_slice($queueOutput[0]['@graph'], $queueNodeCount) === array_slice($queueGraph['@graph'], $queueNodeCount),
    'Long reverse chain reaches all safe definitions while unseeded cycles remain inert'
);
$reviewCheck(
    $queueRouting->internalHostChecks <= 80 * $queueNodeCount,
    'P2 3942310468: graph discovery/propagation has a linear URL-resolution budget; host checks=' . $queueRouting->internalHostChecks
);
fwrite(STDOUT, 'JSON-LD queue regression: ' . $queueNodeCount . ' nodes, ' . $queueRouting->internalHostChecks . " host checks\n");

$languageIri = 'https://id.loc.gov/vocabulary/iso639-1/de';
foreach (['@id', '@vocab'] as $languageCoercion) {
    $languageCoercionContext = ['s' => 'https://schema.org/', 'language' => ['@id' => 's:inLanguage', '@type' => $languageCoercion], 'inLanguage' => ['@type' => $languageCoercion]];
    $languageCoercionNodes = ['@context' => $languageCoercionContext, '@graph' => [
        ['language' => $languageIri, 'inLanguage' => [$languageIri, 'iso:de']],
        ['@context' => ['language' => 's:inLanguage'], 'language' => 'de'],
        ['language' => $languageIri],
        ['language' => ['@value' => $languageIri]],
    ]];
    $languageCoercionOutput = jsonLdReviewRender([$languageCoercionNodes, ['inLanguage' => 'de']], $routing);
    $reviewCheck(
        $languageCoercionOutput[0]['@graph'][0] === $languageCoercionNodes['@graph'][0]
        && $languageCoercionOutput[0]['@graph'][1]['language'] === 'en'
        && $languageCoercionOutput[0]['@graph'][2] === $languageCoercionNodes['@graph'][2]
        && $languageCoercionOutput[0]['@graph'][3] === $languageCoercionNodes['@graph'][3]
        && $languageCoercionOutput[1]['inLanguage'] === 'en'
        && $languageCoercionOutput[0]['@context'] === $languageCoercionContext,
        'P2 3942310470: IRI-coerced language values stay intact with scoped literal overrides: ' . $languageCoercion
    );
}
$literalLanguageOutput = jsonLdReviewRender([
    ['@context' => ['language' => 'https://schema.org/inLanguage'], 'inLanguage' => 'de', 'language' => ['de', 'fr']],
    ['@context' => ['language' => 'https://schema.org/inLanguage', 'literal' => '@value'], 'language' => ['literal' => 'de']],
    ['inLanguage' => ['@value' => 'de']],
], $routing);
$reviewCheck(
    $literalLanguageOutput[0]['inLanguage'] === 'en' && $literalLanguageOutput[0]['language'] === ['en', 'en']
    && $literalLanguageOutput[1]['language'] === ['literal' => 'en']
    && $literalLanguageOutput[2]['inLanguage'] === ['@value' => 'en'],
    'P2 3942310470: non-coerced literal, aliased and simple value-object language codes use the target'
);
$foreignLanguageNodes = [
    ['@context' => ['inLanguage' => null], 'inLanguage' => 'de'],
    ['@context' => ['inLanguage' => 'https://example.org/inLanguage'], 'inLanguage' => ['@value' => 'de']],
    ['@context' => null, 'inLanguage' => 'de'],
];
$reviewCheck(jsonLdReviewRender($foreignLanguageNodes, $routing) === $foreignLanguageNodes, 'Foreign/null language properties retain their values and scopes');

// Property-scoped contexts affect the value, not the property's enclosing key
// or siblings. All four walker consumers must see the same scoped definitions.
$scopedPropertyContext = [
    '@vocab' => 'https://example.org/', 's' => 'https://schema.org/',
    'instructions' => ['@id' => 's:recipeInstructions', '@context' => ['@vocab' => 'https://schema.org/']],
    'page' => ['@id' => 's:mainEntityOfPage', '@context' => ['site' => 'https://www.meinhaushalt.at/', 'identifier' => '@id']],
];
$scopedPropertyInput = ['@context' => $scopedPropertyContext, 'instructions' => [
    ['@type' => 'HowToStep', 'text' => 'Scoped step'],
    ['@context' => ['@vocab' => 'https://example.org/'], '@type' => 'HowToStep', 'text' => 'Foreign step'],
], 'sibling' => ['@type' => 'HowToStep', 'text' => 'Sibling step'], 'page' => ['identifier' => 'site:property-scope/#page']];
$scopedPropertyOutput = jsonLdReviewRender([$scopedPropertyInput, ['isPartOf' => ['@id' => '/property-scope/#page']]], $routing, $scopedPropertyStrings);
$reviewCheck(
    $scopedPropertyOutput[0]['instructions'][0]['text'] === '[en] Scoped step'
    && $scopedPropertyOutput[0]['page']['identifier'] === 'https://www.meinhaushalt.at/en/property-scope/#page'
    && $scopedPropertyOutput[1]['isPartOf']['@id'] === '/en/property-scope/#page',
    'P2 3942374025: property-scoped context reaches collection, translation, identity discovery and routing'
);
$reviewCheck(
    $scopedPropertyStrings === ['Scoped step']
    && $scopedPropertyOutput[0]['instructions'][1] === $scopedPropertyInput['instructions'][1]
    && $scopedPropertyOutput[0]['sibling'] === $scopedPropertyInput['sibling']
    && $scopedPropertyOutput[0]['@context'] === $scopedPropertyContext,
    'Property scopes honor local overrides and never leak to siblings or mutate context definitions'
);
$scopeRemovalInput = ['@context' => $scopedPropertyContext, '@graph' => [
    ['@context' => ['instructions' => 's:recipeInstructions'], 'instructions' => ['@type' => 'HowToStep', 'text' => 'Removed scope']],
    ['@context' => ['instructions' => ['@id' => 's:recipeInstructions', '@context' => null]], 'instructions' => ['@type' => 'HowToStep', 'text' => 'Null scope']],
    ['@context' => ['instructions' => ['@id' => 's:recipeInstructions', '@context' => 'https://example.org/context']], 'instructions' => ['@type' => 'HowToStep', 'text' => 'Remote scope']],
]];
$reviewCheck(jsonLdReviewRender([$scopeRemovalInput], $routing) === [$scopeRemovalInput], 'Redefinition clears property scope; null and unknown remote scopes fail closed');
$scopedCoercionInput = ['@context' => [
    'heading' => ['@id' => 'https://schema.org/headline', '@context' => ['heading' => ['@id' => 'https://schema.org/headline', '@type' => '@id']]],
    'label' => ['@id' => 'https://schema.org/name', '@type' => '@id', '@context' => ['label' => 'https://schema.org/name']],
], 'heading' => ['https://example.org/scoped-name', ['@set' => ['https://example.org/scoped-heading']]], 'label' => 'Scoped literal override'];
$scopedCoercionOutput = jsonLdReviewRender([$scopedCoercionInput], $routing, $scopedCoercionStrings)[0];
$reviewCheck(
    $scopedCoercionOutput['heading'] === $scopedCoercionInput['heading']
    && $scopedCoercionOutput['label'] === '[en] Scoped literal override'
    && $scopedCoercionStrings === ['Scoped literal override'],
    'Property-scoped redefinitions update active-term coercion for scalars, arrays and wrappers'
);

$caseIriInput = ['@context' => ['s' => 'HTTPS://SCHEMA.ORG/', 'heading' => 'HTTP://Schema.Org/headline', 'pageUrl' => 's:url'], '@graph' => [
    ['@type' => 'HTTPS://SCHEMA.ORG/WebPage', '@id' => '/case/#page', 'heading' => 'Case heading', 'pageUrl' => '/case/'],
    ['@type' => 's:HowToStep', 's:text' => 'Case step'],
    ['@type' => 'HTTPS://SCHEMA.ORG/webpage', '@id' => '/case-lower/'],
    ['@type' => 'HTTPS://SCHEMA.ORG.EXAMPLE/WebPage', '@id' => '/case-foreign/'],
    ['s:Headline' => 'Wrong property case'],
]];
$caseIriOutput = jsonLdReviewRender([$caseIriInput], $routing, $caseIriStrings)[0];
$reviewCheck(
    $caseIriOutput['@graph'][0]['@id'] === '/en/case/#page'
    && $caseIriOutput['@graph'][0]['heading'] === '[en] Case heading'
    && $caseIriOutput['@graph'][0]['pageUrl'] === '/en/case/'
    && $caseIriOutput['@graph'][1]['s:text'] === '[en] Case step',
    'P2 3942374028: Schema.org type and property IRIs ignore scheme/host case for full IRIs and prefixes'
);
$reviewCheck(
    array_slice($caseIriOutput['@graph'], 2) === array_slice($caseIriInput['@graph'], 2)
    && $caseIriOutput['@context'] === $caseIriInput['@context']
    && $caseIriStrings === ['Case heading', 'Case step'],
    'Schema.org suffix case and host boundary remain exact'
);

// Preserve the original context and attach an explicit target tag only to
// literals actually changed. Rewriting a default would relabel cache misses.
$mappedLanguageContext = [
    '@vocab' => 'https://schema.org/', '@language' => 'de',
    'heading' => ['@id' => 'headline', '@language' => 'fr'],
    'untagged' => ['@id' => 'description', '@language' => null],
    'iriName' => ['@id' => 'name', '@type' => '@id'],
];
$mappedLanguageInput = ['@context' => $mappedLanguageContext,
    'name' => 'Default language', 'heading' => ['Term language', 'Cache miss'],
    'untagged' => 'Untagged language', 'identifier' => 'Untouched literal',
    'iriName' => 'https://example.org/name', 'description' => ['@value' => 'Explicit untagged'],
    '@graph' => [
        ['@context' => ['@language' => null], 'name' => 'Cleared default'],
        ['@context' => ['heading' => 'https://schema.org/headline'], 'heading' => 'Reset term mapping'],
        ['@context' => ['recipeInstructions' => ['@context' => ['@language' => 'it']]], 'recipeInstructions' => ['@type' => 'HowToStep', 'text' => 'Scoped language']],
    ],
];
$mappedLanguageOutput = jsonLdReviewRender([$mappedLanguageInput], $routing, $mappedLanguageStrings, ['Cache miss' => null])[0];
$reviewCheck(
    $mappedLanguageOutput['name'] === ['@value' => '[en] Default language', '@language' => 'en']
    && $mappedLanguageOutput['heading'][0] === ['@value' => '[en] Term language', '@language' => 'en']
    && $mappedLanguageOutput['@graph'][1]['heading'] === ['@value' => '[en] Reset term mapping', '@language' => 'en']
    && $mappedLanguageOutput['@graph'][2]['recipeInstructions']['text'] === ['@value' => '[en] Scoped language', '@language' => 'en'],
    'P2 3942374029: translated literals override default, term-specific and property-scoped language mappings'
);
$reviewCheck(
    $mappedLanguageOutput['@context'] === $mappedLanguageContext
    && $mappedLanguageOutput['heading'][1] === 'Cache miss'
    && $mappedLanguageOutput['identifier'] === 'Untouched literal'
    && $mappedLanguageOutput['iriName'] === $mappedLanguageInput['iriName']
    && $mappedLanguageOutput['untagged'] === '[en] Untagged language'
    && $mappedLanguageOutput['description'] === ['@value' => '[en] Explicit untagged']
    && $mappedLanguageOutput['@graph'][0]['name'] === '[en] Cleared default',
    'Language mappings never relabel untouched/cache-miss/IRI values or explicitly untagged literals'
);
$languageIsolationOutput = jsonLdReviewRender([
    ['@context' => ['@language' => 'de'], 'name' => 'First script'],
    ['name' => 'Second script'],
], $routing);
$reviewCheck($languageIsolationOutput[1]['name'] === '[en] Second script', 'Context language never leaks across scripts');
$languageEdgeInput = ['@context' => [
    '@vocab' => 'https://schema.org/',
    'instructions' => ['@id' => 'recipeInstructions', '@context' => ['@language' => 'it']],
    'heading' => ['@id' => 'headline', '@language' => 'fr'],
], 'instructions' => ['Scoped scalar', 'Scoped array item'], 'heading' => 'Term without default',
    'name' => ['@context' => ['@language' => 'de'], '@set' => ['Wrapper default']],
    '@graph' => [['@context' => ['@language' => 'de', 'typedName' => ['@id' => 'name', '@type' => 'https://www.w3.org/2001/XMLSchema#string']], 'typedName' => 'Typed literal']],
];
$languageEdgeOutput = jsonLdReviewRender([$languageEdgeInput], $routing)[0];
$reviewCheck(
    $languageEdgeOutput['instructions'] === [
        ['@value' => '[en] Scoped scalar', '@language' => 'en'],
        ['@value' => '[en] Scoped array item', '@language' => 'en'],
    ]
    && $languageEdgeOutput['heading'] === ['@value' => '[en] Term without default', '@language' => 'en']
    && $languageEdgeOutput['name']['@set'][0] === ['@value' => '[en] Wrapper default', '@language' => 'en']
    && $languageEdgeOutput['@graph'][0]['typedName'] === '[en] Typed literal',
    'Language mappings cover scoped scalars, arrays and wrapper-local defaults, but never replace datatype coercion'
);

$wrapperInput = ['@context' => ['@vocab' => 'https://schema.org/', 'list' => '@list', 'set' => '@set'], '@graph' => [
    ['@type' => 'Recipe', 'recipeInstructions' => ['@list' => ['List prose', ['@type' => 'HowToStep', 'text' => ['set' => ['Wrapped step']]], ['@value' => 'Wrapped literal', '@language' => 'de']], '@index' => 'steps']],
    ['@type' => 'WebPage', '@id' => '/wrapper/#page', 'url' => ['set' => ['/wrapper/', 'https://example.org/wrapper/']]],
    ['@type' => 'ListItem', 'item' => ['list' => [['@id' => '/wrapper-item/']]]],
    ['mainEntityOfPage' => ['@set' => '/wrapper-seed/']],
    ['@type' => 'HowToStep', 'text' => ['@set' => ['@context' => ['@language' => 'de'], '@value' => 'Explicit wrapper literal', '@language' => 'de']]],
]];
$wrapperOutput = jsonLdReviewRender([$wrapperInput, ['@graph' => [
    ['@id' => '/wrapper-item/'], ['@id' => '/wrapper-seed/'],
]]], $routing, $wrapperStrings);
$reviewCheck(
    $wrapperOutput[0]['@graph'][0]['recipeInstructions']['@list'][0] === '[en] List prose'
    && $wrapperOutput[0]['@graph'][0]['recipeInstructions']['@list'][1]['text']['set'][0] === '[en] Wrapped step'
    && $wrapperOutput[0]['@graph'][0]['recipeInstructions']['@list'][2] === ['@value' => '[en] Wrapped literal', '@language' => 'en']
    && $wrapperOutput[0]['@graph'][1]['url']['set'] === ['/en/wrapper/', 'https://example.org/wrapper/']
    && $wrapperOutput[0]['@graph'][2]['item']['list'][0]['@id'] === '/en/wrapper-item/'
    && $wrapperOutput[0]['@graph'][3]['mainEntityOfPage']['@set'] === '/en/wrapper-seed/'
    && $wrapperOutput[1]['@graph'] === [['@id' => '/en/wrapper-item/'], ['@id' => '/en/wrapper-seed/']]
    && $wrapperOutput[0]['@graph'][4]['text']['@set']['@language'] === 'en',
    'P2 3942374031: list/set wrappers preserve enclosing field, parent semantics, literals and cross-script page seeds'
);
$reviewCheck(
    $wrapperOutput[0]['@context'] === $wrapperInput['@context']
    && $wrapperOutput[0]['@graph'][0]['recipeInstructions']['@index'] === 'steps',
    'Wrapper metadata and context remain unchanged'
);
$wrapperBoundaryInput = ['@graph' => [
    ['@type' => 'WebPage', 'url' => ['@set' => '/malformed/', '@id' => '/not-a-wrapper/']],
    ['@type' => 'Recipe', 'recipeInstructions' => ['@list' => ['Malformed list'], '@set' => ['Malformed set']]],
    ['@context' => ['list' => 'https://example.org/list'], 'recipeInstructions' => ['list' => ['Foreign wrapper']]],
    ['@type' => 'Recipe', 'recipeInstructions' => ['@set' => ['Malformed index'], '@index' => []]],
    ['@context' => ['iriText' => ['@id' => 'https://schema.org/name', '@type' => '@id']], 'iriText' => ['@set' => ['https://example.org/name']]],
]];
$reviewCheck(jsonLdReviewRender([$wrapperBoundaryInput], $routing) === [$wrapperBoundaryInput], 'Malformed/foreign wrappers fail closed and IRI coercion survives wrappers');

$networkInput = ['@graph' => [
    ['@type' => 'WebPage', '@id' => '//www.meinhaushalt.at/network/#page', 'url' => ['//www.meinhaushalt.at/network/?q=1#part', '//example.org/network/']],
    ['@type' => 'Person', '@id' => '//www.meinhaushalt.at/person/'],
    ['@type' => 'WebPage', '@id' => '//example.org/network/#page'],
    ['@type' => 'WebPage', '@id' => '///network/'],
]];
foreach ([false, true] as $networkReverse) {
    $networkRefs = ['isPartOf' => '/network/#page', 'breadcrumb' => ['@id' => 'https://www.meinhaushalt.at/network/#page']];
    $networkOutput = jsonLdReviewRender($networkReverse ? [$networkInput, $networkRefs] : [$networkRefs, $networkInput], $routing);
    $networkGraph = $networkOutput[$networkReverse ? 0 : 1]['@graph'];
    $networkReferenceOutput = $networkOutput[$networkReverse ? 1 : 0];
    $reviewCheck(
        $networkGraph[0]['@id'] === 'https://www.meinhaushalt.at/en/network/#page'
        && $networkGraph[0]['url'] === ['https://www.meinhaushalt.at/en/network/?q=1#part', '//example.org/network/']
        && $networkReferenceOutput['isPartOf'] === '/en/network/#page'
        && $networkReferenceOutput['breadcrumb']['@id'] === 'https://www.meinhaushalt.at/en/network/#page',
        'P2 3942374033: same-site network-path references normalize after host validation and share canonical identity: ' . (int) $networkReverse
    );
    $reviewCheck(array_slice($networkGraph, 1) === array_slice($networkInput['@graph'], 1), 'Network-path shared, external and malformed values stay byte-identical');
}
$networkMappedOutput = jsonLdReviewRender([['@type' => 'WebPage', 'url' => '//fr.meinhaushalt.at/recette/']], $identityHostRouting);
$reviewCheck($networkMappedOutput[0]['url'] === 'https://en.meinhaushalt.at/recipe/', 'P2 3942374033: mapped internal language hosts also accept network paths');
$networkHttpRouting = new SiteRouting(new UrlLanguageResolver('de', ['en']), 'http://www.meinhaushalt.at', 'PATH_PREFIX', []);
$networkHttpOutput = jsonLdReviewRender([['@type' => 'WebPage', 'url' => '//www.meinhaushalt.at/network/']], $networkHttpRouting);
$reviewCheck($networkHttpOutput[0]['url'] === 'http://www.meinhaushalt.at/en/network/', 'Network-path normalization uses the configured source scheme');

// Type scopes apply to this node, in lexical term order, before its properties.
$typeScopeContext = [
    '@vocab' => 'https://example.org/', 's' => 'https://schema.org/', 'kind' => '@type',
    'Recipe' => ['@id' => 's:Recipe', '@context' => [
        'instructions' => 's:recipeInstructions', 'identifier' => '@id',
        'site' => 'https://www.meinhaushalt.at/', 'Recipe' => 'https://example.org/ShadowRecipe',
    ]],
    'A' => ['@id' => 's:Thing', '@context' => ['instructions' => 'https://example.org/instructions']],
    'Z' => ['@id' => 's:Recipe', '@context' => ['instructions' => 's:recipeInstructions']],
    'Foreign' => ['@id' => 'https://example.org/Foreign', '@context' => ['label' => 's:name']],
];
$typeScopeInput = ['@context' => $typeScopeContext, '@graph' => [
    ['kind' => 'Recipe', 'instructions' => ['Type-scoped instructions'], 'identifier' => 'site:type-scope/#page', 'child' => ['instructions' => 'Unscoped descendant']],
    ['@type' => ['Z', 'A'], 'instructions' => 'Lexical order one'],
    ['@type' => ['A', 'Z'], 'instructions' => 'Lexical order two'],
    ['@type' => 'Foreign', 'label' => 'Foreign class supported property', '@id' => '/foreign-class/'],
    ['instructions' => 'Untyped sibling'],
    ['@context' => ['Recipe' => 's:Recipe'], '@type' => 'Recipe', 'instructions' => 'Removed type scope'],
]];
$typeScopeOutput = jsonLdReviewRender([$typeScopeInput, ['isPartOf' => ['@id' => '/type-scope/#page']]], $routing, $typeScopeStrings);
$reviewCheck(
    $typeScopeOutput[0]['@graph'][0]['instructions'][0] === '[en] Type-scoped instructions'
    && $typeScopeOutput[0]['@graph'][0]['identifier'] === 'https://www.meinhaushalt.at/en/type-scope/#page'
    && $typeScopeOutput[1]['isPartOf']['@id'] === '/en/type-scope/#page'
    && $typeScopeOutput[0]['@graph'][1]['instructions'] === '[en] Lexical order one'
    && $typeScopeOutput[0]['@graph'][2]['instructions'] === '[en] Lexical order two'
    && $typeScopeOutput[0]['@graph'][3]['label'] === '[en] Foreign class supported property',
    'P2 3943632995: type-scoped contexts use pre-scope types and lexical ordering for text and graph routing'
);
$reviewCheck(
    $typeScopeOutput[0]['@graph'][0]['child'] === $typeScopeInput['@graph'][0]['child']
    && $typeScopeOutput[0]['@graph'][3]['@id'] === '/foreign-class/'
    && array_slice($typeScopeOutput[0]['@graph'], 4) === array_slice($typeScopeInput['@graph'], 4)
    && $typeScopeOutput[0]['@context'] === $typeScopeContext,
    'Type scope does not leak to child nodes/siblings, change class identity or survive term redefinition'
);

foreach (['https://www.w3.org/2001/XMLSchema#string', '@none'] as $directLiteralType) {
    $directLiteralInput = ['@context' => [
        'mainEntityOfPage' => ['@id' => 'https://schema.org/mainEntityOfPage', '@type' => $directLiteralType],
        'target' => ['@id' => 'https://schema.org/item', '@type' => $directLiteralType],
    ], '@graph' => [
        ['mainEntityOfPage' => ['/literal-direct/', ['@set' => '/literal-wrapped/']]],
        ['@type' => 'ListItem', 'target' => ['/literal-item/', ['@list' => ['/literal-item-wrapped/']]]],
        ['mainEntityOfPage' => ['@id' => '/explicit-node/']],
    ]];
    $directUnseededRefs = ['@graph' => [
        ['@id' => '/literal-direct/'], ['@id' => '/literal-wrapped/'], ['@id' => '/literal-item/'], ['@id' => '/literal-item-wrapped/'],
    ]];
    $directLiteralOutput = jsonLdReviewRender([$directLiteralInput, $directUnseededRefs], $routing);
    $reviewCheck(
        array_slice($directLiteralOutput[0]['@graph'], 0, 2) === array_slice($directLiteralInput['@graph'], 0, 2)
        && $directLiteralOutput[1] === $directUnseededRefs
        && $directLiteralOutput[0]['@graph'][2]['mainEntityOfPage']['@id'] === '/en/explicit-node/',
        'P2 3943632997: literal direct relationships neither route nor seed IDs; explicit node references still route: ' . $directLiteralType
    );
}
$directIriOutput = jsonLdReviewRender([['@context' => ['target' => ['@id' => 'https://schema.org/mainEntityOfPage', '@type' => '@id']], 'target' => '/direct-iri/', 'mainEntityOfPage' => '/legacy-direct/']], $routing);
$reviewCheck($directIriOutput[0]['target'] === '/en/direct-iri/' && $directIriOutput[0]['mainEntityOfPage'] === '/en/legacy-direct/', 'Explicit IRI and legacy uncoerced direct page relationships remain supported');

$opaqueContext = ['blob' => ['@id' => 'https://example.org/blob', '@type' => '@json'], 'name' => ['@type' => '@json']];
$opaquePayload = ['@context' => ['blob' => null], '@type' => 'WebPage', '@id' => '/opaque/#page', 'name' => 'Opaque name', 'description' => 'Opaque description', 'mainEntityOfPage' => '/opaque-seed/'];
$opaqueInput = ['@context' => $opaqueContext, 'blob' => [$opaquePayload, ['@list' => [$opaquePayload]]], 'name' => 'Opaque scalar', 'description' => 'Visible sibling', '@graph' => [
    ['@context' => ['blob' => 'https://example.org/blob', 'name' => 'https://schema.org/name'], 'blob' => ['name' => 'Restored node']],
    ['blob' => ['@value' => 'Opaque value object', '@language' => 'de']],
]];
$opaqueRefs = ['isPartOf' => ['@id' => '/opaque/#page'], 'breadcrumb' => ['@id' => '/opaque-seed/']];
$opaqueOutput = jsonLdReviewRender([$opaqueInput, $opaqueRefs], $routing, $opaqueStrings);
$reviewCheck(
    $opaqueOutput[0]['blob'] === $opaqueInput['blob'] && $opaqueOutput[0]['name'] === 'Opaque scalar'
    && $opaqueOutput[0]['@graph'][1] === $opaqueInput['@graph'][1]
    && $opaqueOutput[1] === $opaqueRefs
    && $opaqueStrings === ['Visible sibling', 'Restored node']
    && $opaqueOutput[0]['description'] === '[en] Visible sibling'
    && $opaqueOutput[0]['@graph'][0]['blob']['name'] === '[en] Restored node',
    'P2 3943632999: @json-coerced scalars/arrays/objects/wrappers are opaque to every walker consumer'
);

$nonPropagatingScope = ['@propagate' => false, '@vocab' => 'https://schema.org/', 'literal' => '@value', 'identifier' => '@id', 'site' => 'https://www.meinhaushalt.at/'];
$nonPropagatingInput = ['@context' => ['@vocab' => 'https://example.org/'], '@graph' => [[
    '@context' => $nonPropagatingScope, '@type' => 'WebPage', '@id' => '/nonprop/#page',
    'name' => ['Current node', ['literal' => 'Value retains scope']],
    'mainEntityOfPage' => ['identifier' => 'site:id-only/'],
    'children' => [
        ['@type' => 'WebPage', '@id' => '/nonprop-child/', 'name' => 'Foreign child', 'deep' => ['name' => 'Foreign grandchild']],
        ['@context' => ['@vocab' => 'https://schema.org/'], 'name' => 'Local override', 'deep' => ['name' => 'Local descendant']],
        ['@context' => null, 'name' => 'Reset child'],
    ],
    'recipeInstructions' => ['@list' => ['List scalar', ['name' => 'Foreign list node']]],
    'description' => ['@set' => ['Set scalar', ['name' => 'Foreign set node']]],
]]];
$nonPropagatingOutput = jsonLdReviewRender([$nonPropagatingInput], $routing, $nonPropagatingStrings)[0]['@graph'][0];
$reviewCheck(
    $nonPropagatingOutput['name'] === ['[en] Current node', ['literal' => '[en] Value retains scope']]
    && $nonPropagatingOutput['@id'] === '/en/nonprop/#page'
    && $nonPropagatingOutput['mainEntityOfPage']['identifier'] === 'https://www.meinhaushalt.at/en/id-only/'
    && $nonPropagatingOutput['children'][0] === $nonPropagatingInput['@graph'][0]['children'][0]
    && $nonPropagatingOutput['children'][1]['name'] === '[en] Local override'
    && $nonPropagatingOutput['children'][1]['deep']['name'] === '[en] Local descendant'
    && $nonPropagatingOutput['children'][2] === $nonPropagatingInput['@graph'][0]['children'][2]
    && $nonPropagatingOutput['recipeInstructions']['@list'] === ['[en] List scalar', ['name' => 'Foreign list node']]
    && $nonPropagatingOutput['description']['@set'] === ['[en] Set scalar', ['name' => 'Foreign set node']]
    && $nonPropagatingOutput['@context'] === $nonPropagatingScope,
    'P2 3943633000: non-propagating context stops at child nodes while scalar/value/id-only values and local overrides retain correct scopes'
);
$scopeCombinationInput = ['@context' => ['@vocab' => 'https://example.org/'], '@graph' => [[
    '@context' => [
        ['@propagate' => false, '@vocab' => 'https://schema.org/'],
        ['@propagate' => false, 'label' => 'https://schema.org/name', 'scopedChild' => ['@id' => 'https://example.org/child', '@context' => ['@vocab' => 'https://schema.org/']]],
    ],
    'label' => 'Context array label', 'child' => ['name' => 'Array scope must roll back completely'],
    'scopedChild' => ['name' => 'Property scope after rollback', 'child' => ['name' => 'Property scope descendant']],
]]];
$scopeCombinationOutput = jsonLdReviewRender([$scopeCombinationInput], $routing)[0]['@graph'][0];
$reviewCheck(
    $scopeCombinationOutput['label'] === '[en] Context array label'
    && $scopeCombinationOutput['child'] === $scopeCombinationInput['@graph'][0]['child']
    && $scopeCombinationOutput['scopedChild']['name'] === '[en] Property scope after rollback'
    && $scopeCombinationOutput['scopedChild']['child']['name'] === '[en] Property scope descendant',
    'Non-propagating context arrays roll back to their initial scope before applying a child property scope'
);
$scopeOrderInput = ['@context' => [
    '@vocab' => 'https://example.org/',
    'payload' => ['@id' => 'https://example.org/payload', '@context' => [
        'title' => 'https://schema.org/name',
        'Scoped' => ['@id' => 'https://schema.org/Recipe', '@context' => ['title' => 'https://schema.org/headline', '@language' => 'de', 'blob' => ['@id' => 'https://example.org/blob', '@type' => '@json']]],
    ]],
    'Persistent' => ['@id' => 'https://schema.org/Recipe', '@context' => ['@propagate' => true, 'instructions' => 'https://schema.org/recipeInstructions']],
], 'payload' => [
    '@context' => ['title' => 'https://example.org/title'], '@type' => 'Scoped',
    'title' => 'Type wins last', 'blob' => ['name' => 'Type-scoped opaque name'],
    'child' => ['title' => 'Local foreign term restored'],
], '@graph' => [['@type' => 'Persistent', 'instructions' => 'Persistent type parent', 'child' => ['instructions' => 'Persistent type child']]]];
$scopeOrderOutput = jsonLdReviewRender([$scopeOrderInput], $routing, $scopeOrderStrings)[0];
$reviewCheck(
    $scopeOrderOutput['payload']['title'] === ['@value' => '[en] Type wins last', '@language' => 'en']
    && $scopeOrderOutput['payload']['blob'] === $scopeOrderInput['payload']['blob']
    && $scopeOrderOutput['payload']['child'] === $scopeOrderInput['payload']['child']
    && $scopeOrderOutput['@graph'][0]['instructions'] === '[en] Persistent type parent'
    && $scopeOrderOutput['@graph'][0]['child']['instructions'] === '[en] Persistent type child'
    && $scopeOrderStrings === ['Type wins last', 'Persistent type parent', 'Persistent type child'],
    'Property/local/type scopes apply in order; type language and @json stay local unless propagation is explicitly true'
);

// Coercions are expanded once, in the context defining their term. A later
// alias redefinition must not retroactively change an inherited coercion.
foreach ([false, true] as $reverseCoercionDefinitions) {
    $coercionAliasContext = [
        '@vocab' => 'https://schema.org/', '@language' => 'de',
        'blob' => ['@id' => 'https://example.org/blob', '@type' => 'jsonKind'],
        'iriName' => ['@id' => 'name', '@type' => 'idKind'],
        'vocabName' => ['@id' => 'name', '@type' => 'vocabKind'],
        'target' => ['@id' => 'mainEntityOfPage', '@type' => 'idKind'],
        'plainName' => ['@id' => 'name', '@type' => 'noneKind'],
        'jsonKind' => '@json', 'idKind' => '@id', 'vocabKind' => '@vocab', 'noneKind' => '@none',
    ];
    if ($reverseCoercionDefinitions) {
        $coercionAliasContext = array_reverse($coercionAliasContext, true);
    }
    $coercionAliasPayload = ['@type' => 'WebPage', '@id' => '/aliased-json/#page', 'name' => 'Opaque alias name', 'recipeInstructions' => ['Opaque alias instructions']];
    $coercionAliasInput = ['@context' => $coercionAliasContext,
        'blob' => [$coercionAliasPayload, ['@list' => [$coercionAliasPayload]]],
        'iriName' => 'https://example.org/id-name', 'vocabName' => 'https://example.org/vocab-name',
        'target' => '/alias-iri/', 'plainName' => 'Aliased none prose',
        '@graph' => [
            ['@context' => ['jsonKind' => 'https://example.org/Datatype'], 'blob' => $coercionAliasPayload],
            ['@context' => ['blob' => 'https://example.org/blob'], 'blob' => ['name' => 'Restored alias blob']],
        ],
    ];
    $coercionAliasRefs = ['isPartOf' => ['@id' => '/aliased-json/#page']];
    $coercionAliasOutput = jsonLdReviewRender([$coercionAliasInput, $coercionAliasRefs], $routing, $coercionAliasStrings);
    $reviewCheck(
        $coercionAliasOutput[0]['blob'] === $coercionAliasInput['blob']
        && $coercionAliasOutput[0]['@graph'][0] === $coercionAliasInput['@graph'][0]
        && $coercionAliasOutput[0]['iriName'] === $coercionAliasInput['iriName']
        && $coercionAliasOutput[0]['vocabName'] === $coercionAliasInput['vocabName']
        && $coercionAliasOutput[0]['target'] === '/en/alias-iri/'
        && $coercionAliasOutput[0]['plainName'] === ['@value' => '[en] Aliased none prose', '@language' => 'en']
        && $coercionAliasOutput[0]['@graph'][1]['blob']['name'] === ['@value' => '[en] Restored alias blob', '@language' => 'en']
        && $coercionAliasOutput[1] === $coercionAliasRefs
        && $coercionAliasStrings === ['Aliased none prose', 'Restored alias blob']
        && $coercionAliasOutput[0]['@context'] === $coercionAliasContext,
        'P2 3943679619: coercion aliases resolve independent of definition order and retain defining scope: ' . (int) $reverseCoercionDefinitions
    );
}

$nestContext = ['@vocab' => 'https://schema.org/', 'bundle' => '@nest'];
$nestInput = ['@context' => $nestContext, '@graph' => [
    ['@type' => 'WebPage', '@id' => '/nest/#page', '@nest' => ['url' => ['/nest/', 'https://example.org/nest/']]],
    ['@type' => 'HowToStep', 'bundle' => [['text' => 'Nested step'], ['@nest' => ['text' => ['@value' => 'Deep nested step', '@language' => 'de']]]]],
    ['@type' => 'ListItem', 'bundle' => ['item' => ['@id' => '/nest-item/']]],
    ['url' => '/nested-type/', 'bundle' => ['@type' => 'WebPage', '@id' => '/nested-type/#page']],
    ['@type' => 'WebPage', '@id' => '/nested-shared/', 'bundle' => ['@type' => 'Person', 'url' => '/nested-shared/']],
    ['@type' => 'WebPage', '@nest' => ['@id' => '/nested-id/#page']],
]];
foreach ([false, true] as $reverseNestScripts) {
    $nestRefs = ['@graph' => [['isPartOf' => ['@id' => '/nested-id/#page']], ['@id' => '/nest-item/']]];
    $nestOutput = jsonLdReviewRender($reverseNestScripts ? [$nestInput, $nestRefs] : [$nestRefs, $nestInput], $routing, $nestStrings);
    $nestNodes = $nestOutput[$reverseNestScripts ? 0 : 1]['@graph'];
    $nestReferenceOutput = $nestOutput[$reverseNestScripts ? 1 : 0];
    $reviewCheck(
        $nestNodes[0]['@id'] === '/en/nest/#page'
        && $nestNodes[0]['@nest']['url'] === ['/en/nest/', 'https://example.org/nest/']
        && $nestNodes[1]['bundle'][0]['text'] === '[en] Nested step'
        && $nestNodes[1]['bundle'][1]['@nest']['text'] === ['@value' => '[en] Deep nested step', '@language' => 'en']
        && $nestNodes[2]['bundle']['item']['@id'] === '/en/nest-item/'
        && $nestNodes[3]['url'] === '/en/nested-type/'
        && $nestNodes[3]['bundle']['@id'] === '/en/nested-type/#page'
        && $nestNodes[4] === $nestInput['@graph'][4]
        && $nestNodes[5]['@nest']['@id'] === '/en/nested-id/#page'
        && $nestReferenceOutput['@graph'][0]['isPartOf']['@id'] === '/en/nested-id/#page'
        && $nestReferenceOutput['@graph'][1]['@id'] === '/en/nest-item/'
        && $nestStrings === ['Nested step', 'Deep nested step'],
        'P2 3943679621: @nest maps/arrays/aliases share one node type, identity and visitor state: ' . (int) $reverseNestScripts
    );
}
$nestScopeInput = ['@context' => ['@vocab' => 'https://example.org/'], '@graph' => [[
    '@context' => ['@vocab' => 'https://schema.org/', '@propagate' => false, 'group' => '@nest'],
    '@type' => 'HowToStep', 'group' => ['text' => 'Same node keeps scope', 'child' => ['name' => 'Real child rolls back']],
]]];
$nestScopeOutput = jsonLdReviewRender([$nestScopeInput], $routing)[0];
$reviewCheck(
    $nestScopeOutput['@graph'][0]['group']['text'] === '[en] Same node keeps scope'
    && $nestScopeOutput['@graph'][0]['group']['child'] === $nestScopeInput['@graph'][0]['group']['child'],
    'Nesting retains non-propagating current-node scope but real nested child nodes still roll back'
);
$nestBoundaryInput = ['@context' => $nestContext, '@graph' => [
    ['@type' => 'HowToStep', 'bundle' => ['@value' => 'Invalid nest value', 'text' => 'Not nested prose']],
    ['@type' => 'WebPage', 'bundle' => ['/invalid-nest/', ['url' => '/invalid-nest-url/']]],
    ['@context' => ['bundle' => 'https://example.org/bundle'], '@type' => 'HowToStep', 'bundle' => ['text' => 'Foreign grouping']],
    ['@context' => ['jsonKind' => '@json', 'blob' => ['@id' => 'https://example.org/blob', '@type' => 'jsonKind']], 'blob' => ['@type' => 'HowToStep', 'bundle' => ['text' => 'Opaque nested prose']]],
]];
$reviewCheck(jsonLdReviewRender([$nestBoundaryInput], $routing) === [$nestBoundaryInput], 'Malformed/foreign nesting and JSON-coerced nesting remain untouched');

// W3C expansion 14 repeats only steps 13/14 for @nest, not type-scope step 11.
// A nested type supplies identity without activating its scoped context.
$nestedTypeContext = ['@vocab' => 'https://example.org/', 'bundle' => '@nest', 'kind' => '@type',
    'RecipeAlias' => ['@id' => 'https://schema.org/Recipe', '@context' => ['instructions' => 'https://schema.org/recipeInstructions']],
];
$nestedTypeInput = ['@context' => $nestedTypeContext, '@graph' => [
    ['bundle' => ['kind' => 'RecipeAlias', 'instructions' => 'Nested type keeps foreign instructions'], '@id' => '/nested-type-scope/'],
    ['kind' => 'RecipeAlias', 'bundle' => ['instructions' => 'Direct type activates instructions']],
]];
$nestedTypeOutput = jsonLdReviewRender([$nestedTypeInput], $routing, $nestedTypeStrings)[0];
$reviewCheck(
    $nestedTypeOutput['@graph'][0]['bundle'] === $nestedTypeInput['@graph'][0]['bundle']
    && $nestedTypeOutput['@graph'][0]['@id'] === '/en/nested-type-scope/'
    && $nestedTypeOutput['@graph'][1]['bundle']['instructions'] === '[en] Direct type activates instructions'
    && $nestedTypeStrings === ['Direct type activates instructions'],
    'P2 3943730929 is invalid: nested types do not activate type scopes; direct types still do'
);

$languageMapContext = ['@vocab' => 'https://schema.org/', '@language' => 'de', 'noLanguage' => '@none',
    'ingredients' => ['@id' => 'recipeIngredient', '@container' => '@language'],
    'steps' => ['@id' => 'recipeInstructions', '@container' => ['@language', '@set']],
    'stepText' => ['@id' => 'text', '@container' => '@language'],
];
$languageMapInput = ['@context' => $languageMapContext, '@type' => 'Recipe',
    'ingredients' => ['de' => ['Wasser', 'Salz', null], 'en' => ['Existing salt'], 'fr' => 'Farine', '@none' => 'Untagged ingredient'],
    'steps' => ['de' => 'Alles mischen', 'noLanguage' => ['Untagged step']],
    'recipeInstructions' => [['@type' => 'HowToStep', 'stepText' => ['de' => ['Gut rühren']]], ['@type' => 'Thing', 'stepText' => ['de' => 'Not step prose']]],
];
$languageMapOutput = jsonLdReviewRender([$languageMapInput], $routing, $languageMapStrings, ['Salz' => null])[0];
$reviewCheck(
    $languageMapOutput['ingredients'] === ['de' => ['Salz', null], 'en' => ['Existing salt', '[en] Wasser', '[en] Farine'], '@none' => '[en] Untagged ingredient']
    && $languageMapOutput['steps'] === ['noLanguage' => ['[en] Untagged step'], 'en' => '[en] Alles mischen']
    && $languageMapOutput['recipeInstructions'][0]['stepText'] === ['en' => ['[en] Gut rühren']]
    && $languageMapOutput['recipeInstructions'][1] === $languageMapInput['recipeInstructions'][1]
    && $languageMapOutput['@context'] === $languageMapContext
    && in_array('Wasser', $languageMapStrings, true) && in_array('Salz', $languageMapStrings, true)
    && in_array('Alles mischen', $languageMapStrings, true) && in_array('Gut rühren', $languageMapStrings, true)
    && !in_array('Not step prose', $languageMapStrings, true),
    'P2 3943730931: language maps translate enclosing prose, merge target values, preserve cache misses/nulls and explicit untagged buckets'
);
$languageMapScopeInput = ['@context' => ['@vocab' => 'https://example.org/',
    'Scoped' => ['@id' => 'https://schema.org/Recipe', '@context' => ['words' => ['@id' => 'https://schema.org/name', '@container' => '@language']]],
    'child' => ['@id' => 'https://example.org/child', '@context' => ['words' => ['@id' => 'https://schema.org/description', '@container' => '@language']]],
], '@graph' => [
    ['@type' => 'Scoped', '@nest' => ['words' => ['de' => 'Type map prose']], 'other' => ['words' => ['de' => 'Scope rolled back']]],
    ['child' => ['words' => ['de' => 'Property map prose']]],
    ['@context' => [$languageMapContext, ['ingredients' => 'https://schema.org/recipeIngredient']], 'ingredients' => 'Redefined plain prose'],
]];
$languageMapScopeOutput = jsonLdReviewRender([$languageMapScopeInput], $routing, $languageMapScopeStrings)[0]['@graph'];
$reviewCheck(
    $languageMapScopeOutput[0]['@nest']['words'] === ['en' => '[en] Type map prose']
    && $languageMapScopeOutput[0]['other'] === $languageMapScopeInput['@graph'][0]['other']
    && $languageMapScopeOutput[1]['child']['words'] === ['en' => '[en] Property map prose']
    && $languageMapScopeOutput[2]['ingredients'] === ['@value' => '[en] Redefined plain prose', '@language' => 'en'],
    'Language-map metadata follows type/property/nest scopes, rollback and term redefinition'
);
$mapOpaqueNode = ['@type' => 'WebPage', '@id' => '/map-must-not-seed/', 'name' => 'Invalid map node'];
$languageMapBoundaryInput = ['@context' => array_merge($languageMapContext, [
    'foreignMap' => ['@id' => 'https://example.org/foreign', '@container' => '@language'],
    'urlMap' => ['@id' => 'mainEntityOfPage', '@container' => '@language'],
    'jsonMap' => ['@id' => 'name', '@container' => '@language', '@type' => '@json'],
]), '@type' => 'WebPage',
    'ingredients' => ['de' => ['Valid but whole map invalid', $mapOpaqueNode]],
    'foreignMap' => ['name' => 'Foreign map value', 'url' => '/map-must-not-seed/'],
    'urlMap' => ['de' => '/map-must-not-seed/'], 'jsonMap' => ['de' => $mapOpaqueNode],
];
$languageMapBoundaryRefs = ['isPartOf' => ['@id' => '/map-must-not-seed/']];
$languageMapBoundaryOutput = jsonLdReviewRender([$languageMapBoundaryInput, $languageMapBoundaryRefs], $routing, $languageMapBoundaryStrings);
$reviewCheck($languageMapBoundaryOutput === [$languageMapBoundaryInput, $languageMapBoundaryRefs] && $languageMapBoundaryStrings === [],
    'Language maps are terminal literals, never nodes/URLs; malformed maps and @json stay entirely opaque');
$languageMapCollisionInput = ['@context' => $languageMapContext, 'ingredients' => ['EN' => 'Already English', 'de' => ['Neu', 'x', null], 'fr' => [], 'it' => null]];
$languageMapCollisionOutput = jsonLdReviewRender([$languageMapCollisionInput], $routing)[0];
$reviewCheck($languageMapCollisionOutput['ingredients'] === ['EN' => ['Already English', '[en] Neu'], 'de' => ['x', null], 'fr' => [], 'it' => null],
    'Target language matching is case-insensitive, merging loses no values and empty/short/null originals stay exact');
foreach ([false, true] as $hasUntaggedTargetKey) {
    $reservedLanguageMapInput = ['@context' => array_merge($languageMapContext, ['en' => '@none']),
        'ingredients' => $hasUntaggedTargetKey ? ['de' => 'Tagged original', 'en' => 'Explicit untagged target key'] : ['de' => 'Tagged original'],
    ];
    $reviewCheck(jsonLdReviewRender([$reservedLanguageMapInput], $routing) === [$reservedLanguageMapInput],
        'A target code aliased to @none cannot represent the requested language; preserve the whole map: ' . (int) $hasUntaggedTargetKey);
}
$languageMapFallbackInput = ['@context' => $languageMapContext, 'ingredients' => ['Array literal', ['name' => 'Array child name']],
    'recipeInstructions' => ['@list' => [['@type' => 'HowToStep', 'stepText' => ['de' => 'Wrapped map step']]]],
];
$languageMapFallbackOutput = jsonLdReviewRender([$languageMapFallbackInput], $routing)[0];
$reviewCheck($languageMapFallbackOutput['ingredients'] === [
        ['@value' => '[en] Array literal', '@language' => 'en'], ['name' => ['@value' => '[en] Array child name', '@language' => 'en']],
    ] && $languageMapFallbackOutput['recipeInstructions']['@list'][0]['stepText'] === ['en' => '[en] Wrapped map step'],
    'Language-container array fallback expands ordinary scalars/nodes; nested list nodes still support direct language maps');

$portRouting = new SiteRouting(new UrlLanguageResolver('de', ['en']), 'https://www.meinhaushalt.at:8443', 'PATH_PREFIX', []);
$portForeign = ['@type' => 'WebPage', '@id' => 'https://www.meinhaushalt.at:9443/foreign/#page',
    'url' => '//www.meinhaushalt.at:9443/foreign/', 'mainEntityOfPage' => 'https://www.meinhaushalt.at/foreign-default/'];
foreach ([false, true] as $reversePortScripts) {
    $portSource = ['@graph' => [$portForeign,
        ['@type' => 'WebPage', '@id' => 'https://www.meinhaushalt.at:8443/local/#page', 'url' => '//www.meinhaushalt.at:8443/local/'],
        ['@context' => ['site' => 'https://www.meinhaushalt.at:9443/'], '@type' => 'WebPage', '@id' => 'site:compact-foreign/'],
    ]];
    $portRefs = ['@graph' => [['@id' => '/foreign/#page'], ['@id' => '/foreign-default/'], ['@id' => '/compact-foreign/'], ['isPartOf' => ['@id' => '/local/#page']]]];
    $portOutput = jsonLdReviewRender($reversePortScripts ? [$portRefs, $portSource] : [$portSource, $portRefs], $portRouting);
    $portNodes = $portOutput[$reversePortScripts ? 1 : 0]['@graph'];
    $portRefOutput = $portOutput[$reversePortScripts ? 0 : 1]['@graph'];
    $reviewCheck($portNodes[0] === $portForeign && $portNodes[2] === $portSource['@graph'][2]
        && $portNodes[1]['@id'] === 'https://www.meinhaushalt.at:8443/en/local/#page'
        && $portNodes[1]['url'] === 'https://www.meinhaushalt.at:8443/en/local/'
        && array_slice($portRefOutput, 0, 3) === array_slice($portRefs['@graph'], 0, 3)
        && $portRefOutput[3]['isPartOf']['@id'] === '/en/local/#page',
        'P2 3943730934: foreign effective ports neither route nor seed canonical graph identities: ' . (int) $reversePortScripts);
}
foreach ([['https', 443], ['http', 80]] as [$portScheme, $defaultPort]) {
    foreach ([false, true] as $explicitConfiguredPort) {
        $defaultPortRouting = new SiteRouting(new UrlLanguageResolver('de', ['en']), $portScheme . '://www.meinhaushalt.at' . ($explicitConfiguredPort ? ':' . $defaultPort : ''), 'PATH_PREFIX', []);
        $defaultPortOutput = jsonLdReviewRender([['@type' => 'WebPage', 'url' => [$portScheme . '://www.meinhaushalt.at/default/', $portScheme . '://www.meinhaushalt.at:' . $defaultPort . '/explicit/']]], $defaultPortRouting)[0]['url'];
        $reviewCheck($defaultPortOutput === [$defaultPortRouting->buildUrlForLanguage('/default/', 'en'), $defaultPortRouting->buildUrlForLanguage('/explicit/', 'en')],
            'Explicit and implicit default ports are equivalent: ' . $portScheme . ' ' . (int) $explicitConfiguredPort);
    }
}
$mappedPortRouting = new SiteRouting(new UrlLanguageResolver('de', ['en', 'fr']), 'https://www.meinhaushalt.at:8443', 'SUBDOMAIN', ['en' => 'en.meinhaushalt.at', 'fr' => 'fr.meinhaushalt.at']);
$mappedPortOutput = jsonLdReviewRender([['@type' => 'WebPage', 'url' => ['https://fr.meinhaushalt.at:443/mapped/', '//fr.meinhaushalt.at/mapped-network/', 'https://fr.meinhaushalt.at:8443/not-mapped/']]], $mappedPortRouting)[0]['url'];
$reviewCheck($mappedPortOutput === ['https://en.meinhaushalt.at/mapped/', 'https://en.meinhaushalt.at/mapped-network/', 'https://fr.meinhaushalt.at:8443/not-mapped/'],
    'Language hosts use their actual configured routing origin port, not the source host custom port');

$sectionInput = ['@context' => ['@vocab' => 'https://schema.org/', 'entries' => 'itemListElement', 'group' => '@nest'],
    '@type' => 'Recipe', 'recipeInstructions' => ['@type' => 'HowToSection', 'entries' => [
        'Wasser im Abschnitt kochen', ['@value' => 'Abschnitt rühren', '@language' => 'de'],
        ['@type' => 'HowToSection', 'group' => ['entries' => ['@list' => ['Tief im Abschnitt salzen']]]],
        ['@type' => 'HowToStep', 'text' => 'Normaler Abschnittsschritt'],
    ]],
    'other' => ['@type' => 'ItemList', 'entries' => ['Unrelated list text']],
];
$sectionOutput = jsonLdReviewRender([$sectionInput], $routing, $sectionStrings)[0];
$reviewCheck($sectionOutput['recipeInstructions']['entries'] === [
    '[en] Wasser im Abschnitt kochen', ['@value' => '[en] Abschnitt rühren', '@language' => 'en'],
    ['@type' => 'HowToSection', 'group' => ['entries' => ['@list' => ['[en] Tief im Abschnitt salzen']]]],
    ['@type' => 'HowToStep', 'text' => '[en] Normaler Abschnittsschritt'],
] && $sectionOutput['other'] === $sectionInput['other'],
    'P2 3943790894: HowToSection itemListElement aliases/nests/lists retain recipeInstructions semantics without affecting other ItemLists');
$sectionBoundaryInput = ['@context' => ['@vocab' => 'https://schema.org/'], '@type' => 'Recipe', 'recipeInstructions' => [
    ['@context' => ['itemListElement' => 'https://example.org/items'], '@type' => 'HowToSection', 'itemListElement' => 'Foreign items'],
    ['@context' => ['HowToSection' => 'https://example.org/Section'], '@type' => 'HowToSection', 'itemListElement' => 'Foreign section'],
    ['@context' => ['itemListElement' => ['@type' => '@json']], '@type' => 'HowToSection', 'itemListElement' => ['name' => 'Opaque section']],
    ['@type' => 'Thing', 'itemListElement' => 'Not a section'],
]];
$reviewCheck(jsonLdReviewRender([$sectionBoundaryInput], $routing) === [$sectionBoundaryInput], 'Section prose requires resolved Schema.org type/property and respects @json');

$indexContext = ['@vocab' => 'https://schema.org/',
    'ingredients' => ['@id' => 'recipeIngredient', '@container' => '@index'],
    'steps' => ['@id' => 'recipeInstructions', '@container' => ['@index', '@set']],
    'target' => ['@id' => 'mainEntityOfPage', '@container' => '@index', '@type' => '@id'],
    'words' => ['@id' => 'name', '@container' => '@language'],
];
$indexInput = ['@context' => $indexContext, 'ingredients' => [
    'first' => 'Index Wasser', 'name' => 'Index Salz', '@context' => 'Index Mehl', '@none' => ['Index Reis', null],
], 'steps' => [
    'name' => ['@list' => ['Index kochen', ['@type' => 'HowToStep', 'text' => 'Index Schritt']]],
    'last' => ['@value' => 'Index Wert', '@language' => 'de'],
    'localized' => ['words' => ['de' => 'Index Name', 'en' => 'Existing index name']],
], 'target' => ['url' => '/index-target/']];
$indexOutput = jsonLdReviewRender([$indexInput, ['isPartOf' => ['@id' => '/index-target/']]], $routing, $indexStrings, ['Index Salz' => null]);
$reviewCheck($indexOutput[0]['ingredients'] === [
    'first' => '[en] Index Wasser', 'name' => 'Index Salz', '@context' => '[en] Index Mehl', '@none' => ['[en] Index Reis', null],
] && $indexOutput[0]['steps']['name']['@list'][0] === '[en] Index kochen'
    && $indexOutput[0]['steps']['name']['@list'][1]['text'] === '[en] Index Schritt'
    && $indexOutput[0]['steps']['last'] === ['@value' => '[en] Index Wert', '@language' => 'en']
    && $indexOutput[0]['steps']['localized']['words'] === ['en' => ['Existing index name', '[en] Index Name']]
    && $indexOutput[0]['target'] === ['url' => '/en/index-target/']
    && $indexOutput[1]['isPartOf']['@id'] === '/en/index-target/'
    && array_keys($indexOutput[0]['steps']) === array_keys($indexInput['steps']),
    'P2 3943790898: index maps preserve keys and enclosing semantics for literals/lists/nodes/language maps/cache misses/page relationships');
$indexScopeInput = ['@context' => ['@vocab' => 'https://example.org/',
    'Scoped' => ['@id' => 'https://schema.org/Recipe', '@context' => [
        'steps' => ['@id' => 'https://schema.org/recipeInstructions', '@container' => '@index'],
        'name' => 'https://schema.org/name',
    ]],
    'child' => ['@id' => 'https://example.org/child', '@context' => $indexContext],
], '@graph' => [
    ['@type' => 'Scoped', 'steps' => ['first' => ['name' => 'Map retains type scope', 'deeper' => ['name' => 'Child restores foreign scope']]]],
    ['child' => ['ingredients' => ['name' => 'Property scoped ingredient']]],
    ['@context' => [$indexContext, ['ingredients' => 'https://schema.org/recipeIngredient']], 'ingredients' => 'No longer index map'],
]];
$indexScopeOutput = jsonLdReviewRender([$indexScopeInput], $routing)[0]['@graph'];
$reviewCheck($indexScopeOutput[0]['steps']['first']['name'] === '[en] Map retains type scope'
    && $indexScopeOutput[0]['steps']['first']['deeper'] === $indexScopeInput['@graph'][0]['steps']['first']['deeper']
    && $indexScopeOutput[1]['child']['ingredients'] === ['name' => '[en] Property scoped ingredient']
    && $indexScopeOutput[2]['ingredients'] === '[en] No longer index map',
    'Index values use from-map scope retention, real child rollback, property scopes and term redefinition');
$indexBoundaryInput = ['@context' => array_merge($indexContext, [
    'foreign' => ['@id' => 'https://example.org/foreign', '@container' => '@index'],
    'opaque' => ['@id' => 'name', '@container' => '@index', '@type' => '@json'],
]), 'foreign' => ['name' => 'Foreign index literal', '@id' => '/index-not-an-id/'],
    'opaque' => ['name' => ['@type' => 'WebPage', '@id' => '/index-opaque/', 'name' => 'Opaque index']],
];
$reviewCheck(jsonLdReviewRender([$indexBoundaryInput, ['isPartOf' => ['@id' => '/index-not-an-id/']]], $routing) === [$indexBoundaryInput, ['isPartOf' => ['@id' => '/index-not-an-id/']]],
    'Index keys never act as node fields or identities; foreign literals and JSON payloads remain untouched');
$customIndexInput = ['@context' => ['@vocab' => 'https://schema.org/',
    'custom' => ['@id' => 'recipeInstructions', '@container' => '@index', '@index' => 'position'],
    'graphs' => ['@id' => 'recipeInstructions', '@container' => ['@index', '@graph']],
], 'custom' => ['first' => ['name' => 'Custom index name']], 'graphs' => ['first' => ['name' => 'Graph index name']]];
$reviewCheck(jsonLdReviewRender([$customIndexInput], $routing, $customIndexStrings) === [$customIndexInput] && $customIndexStrings === [],
    'Custom property-index and graph-index containers stay opaque outside plain index-map support');

$targetBucketInput = ['@context' => $languageMapContext, 'ingredients' => ['en' => 'English salt', 'EN' => ['English water'], 'de' => ['Quellsalz', 'Quellwasser'], '@none' => 'Ohne Sprache']];
$targetBucketOutput = jsonLdReviewRender([$targetBucketInput], $routing, $targetBucketStrings)[0];
$reviewCheck($targetBucketStrings === ['Quellsalz', 'Quellwasser', 'Ohne Sprache']
    && $targetBucketOutput['ingredients']['EN'] === ['English water']
    && $targetBucketOutput['ingredients']['en'] === ['English salt', '[en] Quellsalz', '[en] Quellwasser'],
    'P2 3943790902: target-language buckets are excluded before collection, case-insensitively; untagged sources remain eligible');
$targetBatchInput = ['@context' => $languageMapContext, 'ingredients' => [
    'en' => array_map(static fn ($n) => 'Already translated ingredient ' . $n, range(1, 120)),
    'de' => ['Real source ingredient'],
]];
$targetBatchClient = new DeepglotJsonLdFakeClient();
$targetBatchTranslator = new HtmlTranslator($targetBatchClient, $options, new DeepglotJsonLdNullCache());
$targetBatchHtml = '<html><head><script type="application/ld+json">' . json_encode($targetBatchInput) . '</script></head><body></body></html>';
$targetBatchTranslator->translate($targetBatchHtml, 'en');
$reviewCheck($targetBatchClient->sentTexts === ['Real source ingredient'],
    'HtmlTranslator supplies target language before cache/batch collection; 120 target alternatives consume no batch capacity');
$targetNoneInput = ['@context' => array_merge($languageMapContext, ['en' => '@none']), 'ingredients' => ['de' => 'Reserved target source']];
$reviewCheck(jsonLdReviewRender([$targetNoneInput], $routing, $targetNoneStrings) === [$targetNoneInput] && $targetNoneStrings === [],
    'A language map that cannot express the target is excluded from collection as well as application');

$valueUrlInput = ['@context' => ['@vocab' => 'https://schema.org/', 'literal' => '@value', 'pageUrl' => 'url', 'site' => 'https://www.meinhaushalt.at/'], '@graph' => [
    ['@type' => 'WebPage', '@id' => '/value-url/#id', 'pageUrl' => ['literal' => 'site:value-url/']],
    ['@type' => 'WebPage', 'url' => ['@set' => [['@value' => '/value-url-list/'], ['@value' => 'https://example.org/external/'], ['@value' => 'https://www.meinhaushalt.at:9443/foreign/']]]],
    ['@type' => 'Person', 'url' => ['@value' => '/shared-value-url/']],
    ['@type' => 'ListItem', 'item' => ['@value' => '/value-item/']],
    ['mainEntityOfPage' => ['literal' => '/value-target/']],
    ['@type' => 'WebPage', 'url' => ['@value' => '/typed-value/', '@type' => 'https://example.org/Datatype']],
]];
foreach ([false, true] as $reverseValueScripts) {
    $valueUrlRefs = ['@graph' => [['isPartOf' => ['@id' => '/value-url/']], ['breadcrumb' => ['@value' => '/value-target/']]]];
    $valueUrlOutputs = jsonLdReviewRender($reverseValueScripts ? [$valueUrlRefs, $valueUrlInput] : [$valueUrlInput, $valueUrlRefs], $routing, $valueUrlStrings);
    $valueUrlNodes = $valueUrlOutputs[$reverseValueScripts ? 1 : 0]['@graph'];
    $valueUrlRefOutput = $valueUrlOutputs[$reverseValueScripts ? 0 : 1]['@graph'];
    $reviewCheck($valueUrlNodes[0]['pageUrl'] === ['literal' => 'https://www.meinhaushalt.at/en/value-url/']
        && $valueUrlNodes[1]['url']['@set'][0] === ['@value' => '/en/value-url-list/']
        && array_slice($valueUrlNodes[1]['url']['@set'], 1) === array_slice($valueUrlInput['@graph'][1]['url']['@set'], 1)
        && $valueUrlNodes[2] === $valueUrlInput['@graph'][2]
        && $valueUrlNodes[3]['item'] === ['@value' => '/en/value-item/']
        && $valueUrlNodes[4]['mainEntityOfPage'] === ['literal' => '/en/value-target/']
        && $valueUrlNodes[5] === $valueUrlInput['@graph'][5]
        && $valueUrlRefOutput[0]['isPartOf']['@id'] === '/en/value-url/'
        && $valueUrlRefOutput[1]['breadcrumb'] === ['@value' => '/en/value-target/']
        && $valueUrlStrings === [],
        'P2 3943790903: URL value-object envelopes route and share graph IDs without translation batches; shared/external/port/datatype boundaries: ' . (int) $reverseValueScripts);
}

$invalidValueId = ['@context' => ['@vocab' => 'https://schema.org/', 'identifier' => '@id'], '@type' => 'WebPage', 'identifier' => ['@value' => '/invalid-value-id/']];
$invalidValueIdRefs = ['isPartOf' => ['@id' => '/invalid-value-id/']];
$reviewCheck(jsonLdReviewRender([$invalidValueId, $invalidValueIdRefs], $routing) === [$invalidValueId, $invalidValueIdRefs],
    'An invalid @id value-object envelope is not a URL field and cannot route or seed another graph reference');

foreach ($reviewFailures as $failure) {
    fwrite(STDERR, 'FAIL: ' . $failure . PHP_EOL);
}
jsonLdAssert($reviewFailures === [], 'JSON-LD review regressions must all pass');
fwrite(STDOUT, "JsonLdTranslationTest: OK\n");
