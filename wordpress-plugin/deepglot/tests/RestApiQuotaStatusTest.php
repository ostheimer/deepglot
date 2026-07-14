<?php

/**
 * Regression test for quota-exhausted health checks.
 *
 * meinhaushalt.at (2026-06-10): the org had 2 words left, so the plugin's
 * 1-word status ping still returned 200 while real translations were already
 * failing with 402. The status/test-connection ping must use enough words to
 * trip a near-exhausted quota, must send quota_probe so cache hits cannot mask
 * exhaustion, and must classify the 402 distinctly.
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }

    $GLOBALS['_dgstatus_options'] = [];
    $GLOBALS['_dgstatus_last_post'] = null;
    $GLOBALS['_dgstatus_remote_mode'] = 'quota_after_two_words';

    function get_option($key, $default = false) {
        return $GLOBALS['_dgstatus_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_dgstatus_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
    }

    function get_current_user_id() {
        return 123;
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

    function wp_json_encode($value) {
        return json_encode($value);
    }

    function wp_remote_post($url, $args) {
        $payload = json_decode((string) ($args['body'] ?? ''), true);
        $GLOBALS['_dgstatus_last_post'] = [
            'url' => $url,
            'args' => $args,
            'payload' => is_array($payload) ? $payload : null,
        ];

        $wordCount = dgstatus_payload_word_count(is_array($payload) ? $payload : []);
        $quotaProbe = is_array($payload) && !empty($payload['quota_probe']);

        if ($GLOBALS['_dgstatus_remote_mode'] === 'quota_after_two_words' && $wordCount > 2) {
            return [
                'response' => ['code' => 402],
                'body' => '{"error":"Monthly word quota exhausted"}',
            ];
        }

        if ($GLOBALS['_dgstatus_remote_mode'] === 'quota_exhausted_probe' && $quotaProbe) {
            return [
                'response' => ['code' => 402],
                'body' => '{"error":"Monthly word quota exhausted"}',
            ];
        }

        if ($GLOBALS['_dgstatus_remote_mode'] === 'problem_details') {
            return [
                'response' => ['code' => 500],
                'body' => '{"detail":"Standard problem detail.","error":"Legacy problem alias."}',
            ];
        }

        return [
            'response' => ['code' => 200],
            'body' => '{"from_words":["Test"],"to_words":["Test"]}',
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

    if (!class_exists('WP_Error')) {
        class WP_Error
        {
            public function __construct(
                public string $code = '',
                public string $message = '',
                public array $data = []
            ) {
            }

            public function get_error_code(): string
            {
                return $this->code;
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

    if (!class_exists('WP_REST_Request')) {
        class WP_REST_Request
        {
            public function __construct(
                private array $params = []
            ) {
            }

            public function get_param($key) {
                return $this->params[$key] ?? null;
            }

            public function get_json_params() {
                return $this->params;
            }
        }
    }

    if (!class_exists('WP_REST_Response')) {
        class WP_REST_Response
        {
            public function __construct(
                private mixed $data = null,
                private int $status = 200
            ) {
            }

            public function get_data() {
                return $this->data;
            }

            public function get_status(): int {
                return $this->status;
            }
        }
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';
require_once __DIR__ . '/../includes/Api/RestApi.php';

use Deepglot\Api\RestApi;
use Deepglot\Config\Options;
use Deepglot\Sync\SettingsSync;

function dgstatusCheck($condition, string $message): void
{
    if ($condition !== true) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

function dgstatus_payload_word_count(array $payload): int
{
    $count = 0;

    foreach ((array) ($payload['words'] ?? []) as $entry) {
        if (!is_array($entry) || !isset($entry['w'])) {
            continue;
        }

        $words = preg_split('/\s+/', trim((string) $entry['w']));
        $count += count(array_filter($words, static fn(string $word) => $word !== ''));
    }

    return $count;
}

function dgstatusConfigureOptions(): void
{
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => 'dg_live_quota',
        'api_base_url' => 'https://deepglot.test/api',
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]));
}

class RestApiQuotaFakeSettingsSync extends SettingsSync
{
    public int $syncCalls = 0;

    public function __construct()
    {
    }

    public function sync(?array $settings = null, ?string $apiKeyOverride = null, ?string $baseUrlOverride = null)
    {
        $this->syncCalls++;

        return ['ok' => true];
    }
}

dgstatusConfigureOptions();
$sync = new RestApiQuotaFakeSettingsSync();
$api = new RestApi(new Options(), $sync);
$statusResponse = $api->getStatus(new WP_REST_Request());
$statusData = $statusResponse->get_data();

dgstatusCheck($statusData['connected'] === false, 'Quota-exhausted status must not report connected=true.');
dgstatusCheck($statusData['connection_code'] === 'quota_exhausted', 'Quota-exhausted status must expose a machine-readable code.');
dgstatusCheck($statusData['connection_error'] === 'Monatliches Wortlimit ausgeschöpft.', 'Quota-exhausted status must show a clear admin message.');
dgstatusCheck(
    dgstatus_payload_word_count($GLOBALS['_dgstatus_last_post']['payload']) >= 3,
    'Status ping must use enough words to trip a nearly exhausted quota.'
);
dgstatusCheck(
    ($GLOBALS['_dgstatus_last_post']['payload']['quota_probe'] ?? false) === true,
    'Status ping must send quota_probe so cached probe text cannot hide exhaustion.'
);

$GLOBALS['_dgstatus_remote_mode'] = 'quota_exhausted_probe';
$sync = new RestApiQuotaFakeSettingsSync();
$api = new RestApi(new Options(), $sync);
$cacheHitStatusResponse = $api->getStatus(new WP_REST_Request());
$cacheHitStatusData = $cacheHitStatusResponse->get_data();

dgstatusCheck($cacheHitStatusData['connected'] === false, 'Cache-hit quota exhaustion must not report connected=true.');
dgstatusCheck($cacheHitStatusData['connection_code'] === 'quota_exhausted', 'Cache-hit quota exhaustion must expose a machine-readable code.');

$GLOBALS['_dgstatus_remote_mode'] = 'quota_after_two_words';
$sync = new RestApiQuotaFakeSettingsSync();
$api = new RestApi(new Options(), $sync);
$testResponse = $api->testConnection(new WP_REST_Request([
    'api_key' => 'dg_live_quota',
    'api_base_url' => 'https://deepglot.test/api',
]));
$testData = $testResponse->get_data();

dgstatusCheck($testResponse->get_status() === 422, 'Quota-exhausted test-connection should fail validation.');
dgstatusCheck($testData['ok'] === false, 'Quota-exhausted test-connection must return ok=false.');
dgstatusCheck($testData['code'] === 'quota_exhausted', 'Quota-exhausted test-connection must expose a machine-readable code.');
dgstatusCheck($testData['error'] === 'Monatliches Wortlimit ausgeschöpft.', 'Quota-exhausted test-connection must show a clear admin message.');
dgstatusCheck($sync->syncCalls === 0, 'Failed quota checks must not sync candidate settings.');

$GLOBALS['_dgstatus_remote_mode'] = 'ok';
$sync = new RestApiQuotaFakeSettingsSync();
$api = new RestApi(new Options(), $sync);
$okResponse = $api->testConnection(new WP_REST_Request([
    'api_key' => 'dg_live_quota',
    'api_base_url' => 'https://deepglot.test/api',
]));

dgstatusCheck($okResponse->get_status() === 200, 'Healthy test-connection should still pass.');
dgstatusCheck($sync->syncCalls === 1, 'Healthy test-connection should still sync candidate settings.');

$GLOBALS['_dgstatus_remote_mode'] = 'problem_details';
$sync = new RestApiQuotaFakeSettingsSync();
$api = new RestApi(new Options(), $sync);
$problemResponse = $api->testConnection(new WP_REST_Request([
    'api_key' => 'dg_live_quota',
    'api_base_url' => 'https://deepglot.test/api',
]));
$problemData = $problemResponse->get_data();

dgstatusCheck($problemResponse->get_status() === 422, 'Problem Details connection failures should fail validation.');
dgstatusCheck(
    $problemData['error'] === 'Standard problem detail.',
    'Connection checks must prefer Problem Details detail over the legacy error alias.'
);

fwrite(STDOUT, "RestApiQuotaStatusTest: OK\n");
