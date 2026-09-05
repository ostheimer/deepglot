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
 *   - Switch every `inLanguage` value to the target locale.
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
function jsonLdReviewRender(array $blocks, SiteRouting $routing): array
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
    $mutations = $helper->collect($doc);
    $translations = [];
    foreach ($mutations as $mutation) {
        foreach ($mutation['strings'] as $text) {
            $translations[$text] = '[en] ' . $text;
        }
    }
    $helper->apply($mutations, $translations, 'en');
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

foreach ($reviewFailures as $failure) {
    fwrite(STDERR, 'FAIL: ' . $failure . PHP_EOL);
}
jsonLdAssert($reviewFailures === [], 'JSON-LD review regressions must all pass');
fwrite(STDOUT, "JsonLdTranslationTest: OK\n");
