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
    $mutations = $helper->collect($doc);
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
foreach ([4, 5, 6, 7, 8, 10] as $valueIndex) {
    $reviewCheck($valueNodes[$valueIndex] === $valueGraph['@graph'][$valueIndex], 'Non-translatable/foreign value object unchanged: ' . $valueIndex);
}
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

foreach ($reviewFailures as $failure) {
    fwrite(STDERR, 'FAIL: ' . $failure . PHP_EOL);
}
jsonLdAssert($reviewFailures === [], 'JSON-LD review regressions must all pass');
fwrite(STDOUT, "JsonLdTranslationTest: OK\n");
