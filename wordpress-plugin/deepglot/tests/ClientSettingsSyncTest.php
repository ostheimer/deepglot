<?php

/**
 * Contract test for the plugin settings-sync payload.
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }

    $GLOBALS['_deepglot_options'] = [];
    $GLOBALS['_deepglot_last_request'] = null;

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
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

    function get_site_url() {
        return 'https://wp.example.test';
    }

    function wp_json_encode($value) {
        return json_encode($value);
    }

    function wp_remote_request($url, $args) {
        $GLOBALS['_deepglot_last_request'] = [
            'url'  => $url,
            'args' => $args,
        ];

        return [
            'response' => ['code' => 200],
            'body'     => '{"ok":true}',
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
            public string $code;
            public string $message;
            public array $data;

            public function __construct(string $code = '', string $message = '', array $data = [])
            {
                $this->code = $code;
                $this->message = $message;
                $this->data = $data;
            }
        }
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;

function settingsSyncCheck($condition, string $message): void
{
    if ($condition !== true) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

function settingsSyncPayloadFor(array $overrides): array
{
    $GLOBALS['_deepglot_last_request'] = null;

    $settings = array_merge(Options::defaults(), array_merge([
        'api_key' => 'dg_live_sync',
    ], $overrides));

    $client = new Client(new Options());
    $result = $client->syncSettings($settings);

    settingsSyncCheck(!is_wp_error($result), 'syncSettings should return the decoded API response.');
    settingsSyncCheck(is_array($GLOBALS['_deepglot_last_request']), 'syncSettings should send an HTTP request.');

    $body = $GLOBALS['_deepglot_last_request']['args']['body'] ?? '';
    $payload = json_decode((string) $body, true);

    settingsSyncCheck(is_array($payload), 'syncSettings should send a JSON object body.');

    return $payload;
}

$enabledPayload = settingsSyncPayloadFor(['enable_dynamic_translation' => true]);
settingsSyncCheck(
    array_key_exists('enableDynamicTranslation', $enabledPayload),
    'Settings sync payload must include the dynamic translation toggle.'
);
settingsSyncCheck(
    $enabledPayload['enableDynamicTranslation'] === true,
    'Enabled dynamic translation must sync as true.'
);

$disabledPayload = settingsSyncPayloadFor(['enable_dynamic_translation' => false]);
settingsSyncCheck(
    array_key_exists('enableDynamicTranslation', $disabledPayload),
    'Settings sync payload must include the disabled dynamic translation toggle.'
);
settingsSyncCheck(
    $disabledPayload['enableDynamicTranslation'] === false,
    'Disabled dynamic translation must sync as false.'
);

fwrite(STDOUT, "ClientSettingsSyncTest: OK\n");
