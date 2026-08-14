<?php

namespace WpOrg\Requests {
    class Requests
    {
        /** @var array<int|string, object> */
        public static array $responses = [];

        public static function request_multiple(array $requests): array
        {
            return self::$responses;
        }
    }
}

namespace {
    if (!function_exists('__')) {
        function __($text, $domain = null) {
            return $text;
        }
    }

    $GLOBALS['_deepglot_parallel_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_parallel_options'][$key] ?? $default;
    }

    function update_option($key, $value, $autoload = null) {
        $GLOBALS['_deepglot_parallel_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
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

    function wp_json_encode($value, $flags = 0) {
        return json_encode($value, $flags | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    function is_wp_error($value) {
        return $value instanceof \WP_Error;
    }

    if (!class_exists('WP_Error')) {
        class WP_Error
        {
            public function __construct(
                private string $code = '',
                private string $message = '',
                private $data = []
            ) {
            }

            public function get_error_code(): string
            {
                return $this->code;
            }

            public function get_error_data()
            {
                return $this->data;
            }
        }
    }

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }

    if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
        define('DEEPGLOT_PLUGIN_VERSION', 'test');
    }

    require_once __DIR__ . '/../includes/Config/Options.php';
    require_once __DIR__ . '/../includes/Api/Client.php';

    use Deepglot\Api\Client;
    use Deepglot\Config\Options;
    use WpOrg\Requests\Requests;

    function parallelRetryAssert(bool $condition, string $message): void
    {
        if (!$condition) {
            fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
            exit(1);
        }
    }

    function parallelRetryResponse(int $status, array $headers, array $body): object
    {
        return (object) [
            'status_code' => $status,
            'headers' => $headers,
            'body' => json_encode($body),
        ];
    }

    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => 'dg_parallel_test',
        'api_base_url' => 'https://deepglot.test/api',
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));

    Requests::$responses = [
        'seconds' => parallelRetryResponse(429, ['Retry-After' => '31'], [
            'detail' => 'Translation velocity limited',
        ]),
        'date' => parallelRetryResponse(429, [
            'retry-after' => gmdate('D, d M Y H:i:s \G\M\T', time() + 45),
        ], [
            'detail' => 'Translation velocity limited',
        ]),
        'success' => parallelRetryResponse(200, [], [
            'from_words' => ['Dritter Batch'],
            'to_words' => ['Third batch'],
        ]),
    ];

    $client = new Client(new Options());
    $results = $client->translateBatches([
        'seconds' => ['Erster Batch'],
        'date' => ['Zweiter Batch'],
        'success' => ['Dritter Batch'],
    ], 'de', 'en');

    $seconds = $results['seconds'] ?? null;
    $secondsData = $seconds instanceof WP_Error ? $seconds->get_error_data() : [];
    parallelRetryAssert($seconds instanceof WP_Error, 'A parallel 429 must remain a WP_Error.');
    parallelRetryAssert(($secondsData['retry_after'] ?? null) === 31, 'Parallel delta-seconds Retry-After must be preserved.');
    parallelRetryAssert(($secondsData['retry_after_source'] ?? null) === 'delta-seconds', 'Parallel delta-seconds must be classified.');

    $date = $results['date'] ?? null;
    $dateData = $date instanceof WP_Error ? $date->get_error_data() : [];
    parallelRetryAssert($date instanceof WP_Error, 'A parallel HTTP-date 429 must remain a WP_Error.');
    parallelRetryAssert(
        (int) ($dateData['retry_after'] ?? 0) >= 43 && (int) ($dateData['retry_after'] ?? 0) <= 45,
        'Parallel HTTP-date Retry-After must be converted to seconds.'
    );
    parallelRetryAssert(($dateData['retry_after_source'] ?? null) === 'http-date', 'Parallel HTTP-date must be classified.');

    parallelRetryAssert(
        is_array($results['success'] ?? null)
        && ($results['success']['to_words'][0] ?? null) === 'Third batch',
        'A sibling success must remain usable when parallel batches contain 429 responses.'
    );

    fwrite(STDOUT, "ClientParallelRetryAfterTest: OK\n");
}
