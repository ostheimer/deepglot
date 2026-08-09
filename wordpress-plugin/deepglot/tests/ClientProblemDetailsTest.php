<?php

/**
 * Regression coverage for the SaaS Problem Details error contract.
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }

    $GLOBALS['_deepglot_problem_body'] = '{}';
    $GLOBALS['_deepglot_problem_status'] = 400;
    $GLOBALS['_deepglot_problem_headers'] = [];
    $GLOBALS['_deepglot_problem_transients'] = [];

    function get_option($key, $default = false) {
        return $key === 'deepglot_settings'
            ? ['api_base_url' => 'https://deepglot.test/api']
            : $default;
    }

    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function untrailingslashit($value) {
        return rtrim((string) $value, '/');
    }

    function wp_remote_request($url, $args) {
        return [
            'response' => ['code' => $GLOBALS['_deepglot_problem_status']],
            'body' => $GLOBALS['_deepglot_problem_body'],
            'headers' => $GLOBALS['_deepglot_problem_headers'],
        ];
    }

    function wp_remote_retrieve_response_code($response) {
        return (int) ($response['response']['code'] ?? 0);
    }

    function wp_remote_retrieve_body($response) {
        return (string) ($response['body'] ?? '');
    }

    function wp_remote_retrieve_header($response, $name) {
        $headers = array_change_key_case((array) ($response['headers'] ?? []), CASE_LOWER);
        return (string) ($headers[strtolower((string) $name)] ?? '');
    }

    function set_transient($key, $value, $ttl = 0) {
        $GLOBALS['_deepglot_problem_transients'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return $GLOBALS['_deepglot_problem_transients'][$key] ?? false;
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

if (!function_exists('wp_json_encode')) {
    function wp_json_encode($value) {
        return json_encode($value);
    }
}

if (!class_exists('\\WpOrg\\Requests\\Requests')) {
    class ClientProblemParallelRequestsStub
    {
        public static function request_multiple(array $requests): array
        {
            $responses = [];

            foreach (array_keys($requests) as $key) {
                $responses[$key] = (object) [
                    'status_code' => 429,
                    'body' => json_encode(['detail' => 'Parallel rate limit.']),
                    'headers' => new ArrayObject([
                        'retry-after' => $GLOBALS['_deepglot_parallel_retry_after'],
                    ]),
                ];
            }

            return $responses;
        }
    }

    class_alias(ClientProblemParallelRequestsStub::class, 'WpOrg\\Requests\\Requests');
}

function clientProblemCheck($condition, string $message): void
{
    if ($condition !== true) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$client = new Client(new Options());

$GLOBALS['_deepglot_problem_body'] = json_encode([
    'type' => 'https://deepglot.ai/problems/validation-failed',
    'title' => 'Validation failed',
    'status' => 400,
    'detail' => 'Problem Details message.',
    'code' => 'validation_failed',
    'error' => 'Legacy message.',
]);
$problem = $client->listLanguages();

clientProblemCheck(is_wp_error($problem), 'An HTTP error must return WP_Error.');
clientProblemCheck(
    $problem->get_error_message() === 'Problem Details message.',
    'Client must prefer the standard detail field over the legacy error alias.'
);

$GLOBALS['_deepglot_problem_body'] = json_encode(['error' => 'Legacy-only message.']);
$legacy = $client->listLanguages();

clientProblemCheck(
    $legacy->get_error_message() === 'Legacy-only message.',
    'Client must retain compatibility with legacy error-only responses.'
);

$GLOBALS['_deepglot_problem_status'] = 429;
$GLOBALS['_deepglot_problem_headers'] = ['retry-after' => '120'];
$rateLimited = $client->listLanguages();
clientProblemCheck(is_wp_error($rateLimited), 'A 429 response must remain an API error.');
$retryAt = Client::rateLimitRetryAt();
clientProblemCheck(
    $retryAt >= time() + 110 && $retryAt <= time() + 130,
    'The client must persist a bounded Retry-After marker for background backpressure.'
);

$GLOBALS['_deepglot_parallel_retry_after'] = '1800';
$GLOBALS['_deepglot_problem_transients'] = [];
$parallelRateLimited = $client->translateBatches([
    ['first'],
    ['second'],
], 'de', 'en');
clientProblemCheck(
    count(array_filter($parallelRateLimited, 'is_wp_error')) === 2,
    'Parallel 429 responses must remain API errors.'
);
$parallelRetryAt = Client::rateLimitRetryAt();
clientProblemCheck(
    $parallelRetryAt >= time() + 1790 && $parallelRetryAt <= time() + 1810,
    'The parallel client must preserve a numeric Retry-After header instead of falling back to 15 minutes.'
);

fwrite(STDOUT, "ClientProblemDetailsTest: OK\n");
