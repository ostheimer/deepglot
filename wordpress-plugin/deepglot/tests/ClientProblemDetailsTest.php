<?php

/**
 * Regression coverage for the SaaS Problem Details error contract.
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }

    $GLOBALS['_deepglot_problem_body'] = '{}';

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
            'response' => ['code' => 400],
            'body' => $GLOBALS['_deepglot_problem_body'],
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

fwrite(STDOUT, "ClientProblemDetailsTest: OK\n");
