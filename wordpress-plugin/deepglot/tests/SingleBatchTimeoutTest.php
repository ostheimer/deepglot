<?php

/**
 * Reproduces the HD Dental cold-page failure where a large Avada document
 * contains fewer than HtmlTranslator::BATCH_SIZE distinct strings. Those
 * pages use Client::translate() (the single-batch path), which historically
 * retained the generic 15-second HTTP timeout while parallel batches were
 * allowed 30 seconds. A provider response arriving after that shorter window
 * becomes WP_Error and HtmlTranslator deliberately fails open, leaving the
 * entire page in the source language.
 *
 * Run standalone: php tests/SingleBatchTimeoutTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

if (!class_exists('WP_Error')) {
    class WP_Error
    {
        public string $code;
        public string $message;

        public function __construct(string $code, string $message)
        {
            $this->code = $code;
            $this->message = $message;
        }
    }
}

$GLOBALS['_deepglot_options'] = [];
$GLOBALS['_deepglot_timeout_requests'] = [];

if (!function_exists('get_option')) {
    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }
}

if (!function_exists('update_option')) {
    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }
}

if (!function_exists('get_transient')) {
    function get_transient($key) {
        return false;
    }
}

if (!function_exists('set_transient')) {
    function set_transient($key, $value, $ttl = 0) {
        return true;
    }
}

if (!function_exists('is_wp_error')) {
    function is_wp_error($value) {
        return $value instanceof WP_Error;
    }
}

if (!function_exists('wp_parse_args')) {
    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }
}

if (!function_exists('sanitize_text_field')) {
    function sanitize_text_field($value) {
        return trim((string) $value);
    }
}

if (!function_exists('sanitize_textarea_field')) {
    function sanitize_textarea_field($value) {
        return trim((string) $value);
    }
}

if (!function_exists('esc_url_raw')) {
    function esc_url_raw($value) {
        return (string) $value;
    }
}

if (!function_exists('untrailingslashit')) {
    function untrailingslashit($value) {
        return rtrim((string) $value, '/');
    }
}

if (!function_exists('wp_json_encode')) {
    function wp_json_encode($value) {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}

if (!function_exists('wp_remote_request')) {
    function wp_remote_request($url, $args) {
        $GLOBALS['_deepglot_timeout_requests'][] = [
            'url' => $url,
            'args' => $args,
        ];

        // Model a translation provider that needs more than 15 seconds for
        // the 85-string page but still completes within the established
        // 30-second parallel-batch budget.
        if ((int) ($args['timeout'] ?? 0) < 30) {
            return new WP_Error('http_request_failed', 'Operation timed out after 15000 milliseconds');
        }

        $payload = json_decode((string) ($args['body'] ?? ''), true);
        $fromWords = array_map(
            static fn(array $word): string => (string) ($word['w'] ?? ''),
            (array) ($payload['words'] ?? [])
        );

        return [
            'response' => ['code' => 200],
            'body' => json_encode([
                'from_words' => $fromWords,
                'to_words' => array_map(static fn(string $text): string => '[en] ' . $text, $fromWords),
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ];
    }
}

if (!function_exists('wp_remote_retrieve_response_code')) {
    function wp_remote_retrieve_response_code($response) {
        return (int) ($response['response']['code'] ?? 0);
    }
}

if (!function_exists('wp_remote_retrieve_body')) {
    function wp_remote_retrieve_body($response) {
        return (string) ($response['body'] ?? '');
    }
}

if (!defined('DAY_IN_SECONDS')) {
    define('DAY_IN_SECONDS', 86400);
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

function singleBatchTimeoutAssert(bool $condition, string $message): void
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

$paragraphs = '';
for ($index = 0; $index < 84; $index++) {
    $paragraphs .= sprintf('<p>Behandlungstext Nummer %02d</p>', $index);
}

$html = '<!DOCTYPE html><html><head><title>Ihr Zahnarzt in Ungarn</title></head><body>'
    . $paragraphs
    . '</body></html>';

$translator = new HtmlTranslator(new Client($options), $options, new TranslationCache());
$translated = $translator->translate($html, 'en', 'https://stage.example.test/en/');
$requests = $GLOBALS['_deepglot_timeout_requests'];

singleBatchTimeoutAssert(count($requests) === 1, 'An 85-string page must stay on the single-request path.');
singleBatchTimeoutAssert(
    (int) ($requests[0]['args']['timeout'] ?? 0) >= 30,
    'The single translation batch must receive the same 30-second timeout budget as parallel batches.'
);
singleBatchTimeoutAssert(
    str_contains($translated, '[en] Ihr Zahnarzt in Ungarn'),
    'The page title must be translated instead of silently failing open after 15 seconds.'
);
singleBatchTimeoutAssert(
    str_contains($translated, '[en] Behandlungstext Nummer 83'),
    'The last body segment must be translated when the provider completes inside 30 seconds.'
);

fwrite(STDOUT, "SingleBatchTimeoutTest: OK\n");
