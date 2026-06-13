<?php

/**
 * Reproduces the cold-page slowness scenario observed on
 * https://www.meinhaushalt.at/en/tag/familie/ on 2026-05-07 where a single
 * 200-string batch exhausted the per-request 15s plugin timeout, leaving
 * a few segments untranslated even though every other batch succeeded.
 *
 * Drives HtmlTranslator with a fake Client that exposes both `translate()`
 * and `translateBatches()`, and verifies:
 *   - HtmlTranslator routes multi-batch work through `translateBatches()`
 *     so a parallel implementation can replace the sequential fallback.
 *   - Returned text replacements line up with the originating batch even
 *     when the API client returns batches in a different shape than the
 *     input order.
 *   - Per-batch failures (modeled as WP_Error returns) leave the affected
 *     source nodes intact while every other node still gets translated.
 *
 * Run standalone: php tests/ParallelBatchesTest.php
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
        return $value instanceof DeepglotFakeWpError;
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
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\TranslationCache;

class DeepglotFakeWpError
{
    public string $message;

    public function __construct(string $message)
    {
        $this->message = $message;
    }
}

class DeepglotParallelFakeClient extends Client
{
    /** @var array<int, string[]> */
    public array $batchCalls = [];

    public int $singleCalls = 0;

    /** @var int[] */
    public array $failingBatchIndexes = [];

    public function __construct() {}

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0)
    {
        $this->singleCalls++;

        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn(string $text) => '[en] ' . $text, $texts),
        ];
    }

    public function translateBatches(array $batches, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0): array
    {
        $results = [];

        foreach ($batches as $index => $batch) {
            $this->batchCalls[$index] = $batch;

            if (in_array($index, $this->failingBatchIndexes, true)) {
                $results[$index] = new DeepglotFakeWpError('boom-' . $index);
                continue;
            }

            $results[$index] = [
                'from_words' => $batch,
                'to_words' => array_map(static fn(string $text) => '[en] ' . $text, $batch),
            ];
        }

        return $results;
    }
}

class DeepglotParallelNullCache extends TranslationCache
{
    public function getMany(array $texts, string $from, string $to): array
    {
        return [];
    }

    public function setMany(array $translations, string $from, string $to): void
    {
    }
}

function parallelAssert(bool $condition, string $message): void
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

// 1. With many distinct strings the translator must dispatch via translateBatches
// so a parallel implementation can take over from the sequential fallback.
$client = new DeepglotParallelFakeClient();
$translator = new HtmlTranslator($client, $options, new DeepglotParallelNullCache());

$paragraphs = '';
$expectedStrings = [];
for ($i = 0; $i < 250; $i++) {
    $text = sprintf('Strophe %03d aus dem Kinderlied', $i);
    $paragraphs .= '<p>' . $text . '</p>';
    $expectedStrings[] = $text;
}

$html = '<!DOCTYPE html><html><head><title>Familie</title></head><body>' . $paragraphs . '</body></html>';

$translated = $translator->translate($html, 'en');

parallelAssert(
    !empty($client->batchCalls),
    'HtmlTranslator must call translateBatches() so the parallel path is exercised.'
);

$totalSent = 0;
foreach ($client->batchCalls as $batch) {
    $totalSent += count($batch);
}

parallelAssert(
    $totalSent >= count($expectedStrings),
    sprintf('Every unique string must be sent through translateBatches() (sent %d, expected at least %d)', $totalSent, count($expectedStrings))
);

parallelAssert(
    count($client->batchCalls) >= 2,
    sprintf('250 distinct strings must be split into at least two batches, got %d batch(es).', count($client->batchCalls))
);

foreach ($expectedStrings as $original) {
    parallelAssert(
        str_contains($translated, '[en] ' . $original),
        sprintf('Body must contain translated string for "%s"', $original)
    );
}

// 2. When one batch returns a WP_Error all other batches still apply, only
// the strings inside the failing batch fall back to their original form.
$failingClient = new DeepglotParallelFakeClient();
$failingClient->failingBatchIndexes = [1];
$translator2 = new HtmlTranslator($failingClient, $options, new DeepglotParallelNullCache());

$html2 = $html;
$translated2 = $translator2->translate($html2, 'en');

$failedBatchTexts = $failingClient->batchCalls[1] ?? [];

parallelAssert(
    !empty($failedBatchTexts),
    'Failing batch index must have been dispatched and recorded.'
);

foreach ($failedBatchTexts as $original) {
    parallelAssert(
        str_contains($translated2, '<p>' . $original . '</p>'),
        sprintf('Strings from a failing batch must remain untranslated (got missing original "%s")', $original)
    );
    parallelAssert(
        !str_contains($translated2, '[en] ' . $original),
        sprintf('Strings from a failing batch must NOT be translated (got translated "%s")', $original)
    );
}

$succeededFromFirstBatch = $failingClient->batchCalls[0][0] ?? null;

if ($succeededFromFirstBatch !== null) {
    parallelAssert(
        str_contains($translated2, '[en] ' . $succeededFromFirstBatch),
        'Successful batches must still apply translations even when a sibling batch fails.'
    );
}

// 3. The single-batch fast path may keep using translate() to avoid the
// extra plumbing for tiny pages. Sites with very few unique strings should
// not pay the parallel infrastructure cost.
$smallClient = new DeepglotParallelFakeClient();
$translator3 = new HtmlTranslator($smallClient, $options, new DeepglotParallelNullCache());
$translator3->translate('<!DOCTYPE html><html><head><title>Hi</title></head><body><p>Hallo Welt</p></body></html>', 'en');

parallelAssert(
    $smallClient->singleCalls + count($smallClient->batchCalls) >= 1,
    'Small pages must still trigger at least one translate request.'
);

fwrite(STDOUT, "ParallelBatchesTest: OK\n");
