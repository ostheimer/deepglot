<?php

/**
 * Background warming translates without a visitor attached, so it must be able
 * to ask for a longer budget than the render path's default — a fresh
 * 50-segment batch measured 40.5s against production on 2026-08-03, and a warm
 * run sends larger batches than that.
 *
 * Pinned here:
 *   - `Client::translate()` and `translateBatches()` honour an explicit
 *     per-call timeout,
 *   - `deepglot_api_timeout` lets an operator tune the default without a code
 *     change,
 *   - control-plane calls that run inside a frontend request (runtime config,
 *     settings sync, language list) keep their short timeout, so a slow SaaS
 *     can never stall an untranslated page load.
 *
 * Run via: npm run test:wp
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }

    $GLOBALS['_deepglot_requests'] = [];
    $GLOBALS['_deepglot_filters'] = [];
    $GLOBALS['_deepglot_request_delay_us'] = 0;

    function get_option($key, $default = false) {
        return $key === 'deepglot_settings'
            ? ['api_base_url' => 'https://deepglot.test/api', 'api_key' => 'dg_test_key']
            : $default;
    }

    function update_option($key, $value, $autoload = null) {
        return true;
    }

    function get_transient($key) {
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
    }

    function delete_transient($key) {
        return true;
    }

    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function untrailingslashit($value) {
        return rtrim((string) $value, '/');
    }

    function wp_json_encode($value, $flags = 0, $depth = 512) {
        return json_encode($value, $flags, $depth);
    }

    function add_filter($hook, $callback, $priority = 10, $args = 1) {
        $GLOBALS['_deepglot_filters'][$hook][] = $callback;
        return true;
    }

    function apply_filters($hook, $value, ...$args) {
        foreach ($GLOBALS['_deepglot_filters'][$hook] ?? [] as $callback) {
            $value = $callback($value, ...$args);
        }

        return $value;
    }

    function wp_remote_request($url, $args) {
        $GLOBALS['_deepglot_requests'][] = ['url' => $url, 'args' => $args];

        $delay = (int) ($GLOBALS['_deepglot_request_delay_us'] ?? 0);
        $GLOBALS['_deepglot_request_delay_us'] = 0;

        if ($delay > 0) {
            usleep($delay);
        }

        return [
            'response' => ['code' => 200],
            'body' => json_encode(['from_words' => [], 'to_words' => []]),
        ];
    }

    function wp_remote_retrieve_response_code($response) {
        return (int) ($response['response']['code'] ?? 0);
    }

    function wp_remote_retrieve_body($response) {
        return (string) ($response['body'] ?? '');
    }

    function is_wp_error($value) {
        return $value instanceof \WP_Error;
    }

    class WP_Error
    {
        public function __construct(
            private string $code = '',
            private string $message = '',
            private array $data = []
        ) {
        }

        public function get_error_message(): string
        {
            return $this->message;
        }

        public function get_error_data(): array
        {
            return $this->data;
        }
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;

function timeoutAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

function lastRequestTimeout(): int
{
    $requests = $GLOBALS['_deepglot_requests'];

    timeoutAssert(!empty($requests), 'Expected an HTTP request to have been dispatched.');

    return (int) ($requests[count($requests) - 1]['args']['timeout'] ?? 0);
}

$client = new Client(new Options());

// 1. The render path uses the plugin's own translate budget.
$client->translate(['Hallo Welt'], 'de', 'en');
$renderTimeout = lastRequestTimeout();

timeoutAssert(
    str_contains($GLOBALS['_deepglot_requests'][0]['url'], '/translate'),
    'Expected the translate endpoint to have been called.'
);
timeoutAssert(
    $renderTimeout > 15,
    sprintf('Translate requests must exceed the control-plane budget, got %ds.', $renderTimeout)
);

// 2. Background warming can ask for more than the render path gets.
$client->translate(['Hallo Welt'], 'de', 'en', '', 0, 120);
timeoutAssert(
    lastRequestTimeout() === 120,
    'An explicit timeout must win over the default.'
);

$client->translateBatches([['Hallo Welt']], 'de', 'en', '', 0, 120);
timeoutAssert(
    lastRequestTimeout() === 120,
    'translateBatches() must forward an explicit timeout to the single-batch path.'
);

// 3. The timeout is a budget for the whole sequential fallback, not a fresh
//    allowance for every batch. Otherwise six 120s batches can block cron for
//    twelve minutes on WordPress versions without Requests v2.
$beforeBudgetedRun = count($GLOBALS['_deepglot_requests']);
$GLOBALS['_deepglot_request_delay_us'] = 1_100_000;
$budgetedResults = $client->translateBatches(
    [['Erster Stapel'], ['Zweiter Stapel']],
    'de',
    'en',
    '',
    0,
    1
);

timeoutAssert(
    count($GLOBALS['_deepglot_requests']) - $beforeBudgetedRun === 1,
    'The sequential fallback must not start another request after its total deadline expired.'
);
timeoutAssert(
    is_wp_error($budgetedResults[1] ?? null),
    'A batch skipped after the total deadline must return a WP_Error.'
);

// 4. Operators can tune the default without editing plugin code.
add_filter('deepglot_api_timeout', static fn() => 45);
$client->translate(['Hallo Welt'], 'de', 'en');
timeoutAssert(
    lastRequestTimeout() === 45,
    'deepglot_api_timeout must override the default translate timeout.'
);
$GLOBALS['_deepglot_filters'] = [];

// 5. Control-plane calls stay short: they run inside frontend requests
//    (Plugin::refreshRuntimeRouting) where a slow SaaS must never add latency.
$client->fetchRuntimeConfig();
timeoutAssert(
    lastRequestTimeout() <= 15,
    'Runtime-config refresh must keep its short timeout.'
);

$client->listLanguages();
timeoutAssert(
    lastRequestTimeout() <= 15,
    'The language list must keep its short timeout.'
);

fwrite(STDOUT, "ClientTranslateTimeoutTest: OK\n");
