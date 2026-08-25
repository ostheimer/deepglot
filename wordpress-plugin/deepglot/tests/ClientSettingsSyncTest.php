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
    $GLOBALS['_deepglot_requests'] = [];
    $GLOBALS['_deepglot_runtime_response'] = null;
    $GLOBALS['_deepglot_transients'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return $GLOBALS['_deepglot_transients'][$key] ?? false;
    }

    function set_transient($key, $value, $ttl = 0) {
        $GLOBALS['_deepglot_transients'][$key] = $value;
        return true;
    }

    function delete_transient($key) {
        unset($GLOBALS['_deepglot_transients'][$key]);
        return true;
    }

    function wp_cache_delete($key, $group = '') {
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
        $GLOBALS['_deepglot_requests'][] = $GLOBALS['_deepglot_last_request'];

        if (
            str_contains((string) $url, '/plugin/runtime-config?')
            && is_array($GLOBALS['_deepglot_runtime_response'])
        ) {
            return [
                'response' => ['code' => 200],
                'body' => json_encode($GLOBALS['_deepglot_runtime_response']),
            ];
        }

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
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Sync\SettingsSync;

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

$mappingPayload = settingsSyncPayloadFor([
    'routing_mode' => 'SUBDOMAIN',
    'target_languages' => ['fr'],
    'domain_mappings' => [
        // Retained locally as a dormant WordPress-owned draft after SaaS
        // removes English; it must not make the authoritative sync invalid.
        'en' => 'en.example.test',
        'fr' => 'fr.example.test',
    ],
]);
settingsSyncCheck(
    $mappingPayload['domainMappings'] === [
        ['langCode' => 'fr', 'host' => 'fr.example.test'],
    ],
    'Settings sync must send domain mappings only for currently active target languages.'
);

// A saved SaaS snapshot makes the WordPress language fields read-only. Their
// submitted mirror values must still make a key switch valid before the new
// project's authenticated runtime snapshot replaces them.
$options = new Options();
$oldRuntimeSettings = array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_live_old_project',
    'api_base_url' => 'https://deepglot.test/api',
    'source_language' => 'de',
    'target_languages' => ['en'],
    'auto_redirect' => true,
    'saas_project_version' => '2026-08-25T12:00:00.000Z',
]);
update_option(Options::OPTION_KEY, $oldRuntimeSettings);

$newIdentitySubmission = $options->sanitize(array_merge($oldRuntimeSettings, [
    'api_key' => 'dg_live_new_project',
]));
update_option(Options::OPTION_KEY, $newIdentitySubmission);

$GLOBALS['_deepglot_requests'] = [];
$GLOBALS['_deepglot_runtime_response'] = [
    'project' => [
        'version' => '2026-08-25T13:00:00.000Z',
        'sourceLanguage' => 'fr',
        'targetLanguages' => ['it'],
        'autoRedirect' => false,
        'displayAiNotice' => true,
        'automaticTranslation' => false,
    ],
];

$settingsSync = new SettingsSync($options, new Client($options));
$keySwitchResult = $settingsSync->sync($newIdentitySubmission);
$settingsSyncRequest = $GLOBALS['_deepglot_requests'][0] ?? null;
$settingsSyncBody = is_array($settingsSyncRequest)
    ? json_decode((string) ($settingsSyncRequest['args']['body'] ?? ''), true)
    : null;
$newRuntimeSettings = $options->all();

settingsSyncCheck(!is_wp_error($keySwitchResult), 'A key switch with submitted runtime mirrors must pass settings sync.');
settingsSyncCheck(
    is_array($settingsSyncBody)
        && ($settingsSyncBody['sourceLanguage'] ?? null) === 'de'
        && ($settingsSyncBody['targetLanguages'] ?? null) === ['en']
        && ($settingsSyncBody['autoRedirect'] ?? null) === true,
    'The key-switch bootstrap request must carry the old runtime mirrors instead of empty/default languages.'
);
settingsSyncCheck(
    ($newRuntimeSettings['api_key'] ?? null) === 'dg_live_new_project'
        && ($newRuntimeSettings['source_language'] ?? null) === 'fr'
        && ($newRuntimeSettings['target_languages'] ?? null) === ['it']
        && ($newRuntimeSettings['auto_redirect'] ?? null) === false
        && ($newRuntimeSettings['saas_project_version'] ?? null) === '2026-08-25T13:00:00.000Z',
    'The new project runtime readback must replace bootstrap mirrors and establish the new SaaS version.'
);

fwrite(STDOUT, "ClientSettingsSyncTest: OK\n");
