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

if (!defined('DAY_IN_SECONDS')) define('DAY_IN_SECONDS', 86400);
require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/TranslationWarmer.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Sync\SettingsSync;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\TranslationWarmer;

class LifecycleQueueSpy extends TranslationWarmer {
    public array $reconciliations = [];
    public function __construct() {}
    public function reconcileLanguageConfiguration(string $sourceLanguage, array $targetLanguages, array $invalidatedTargets = []): bool {
        $this->reconciliations[] = [$sourceLanguage, $targetLanguages, $invalidatedTargets];
        return true;
    }
}

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
settingsSyncCheck($disabledPayload['switcher']['owner'] === 'wordpress', 'Switcher report must name the WordPress owner.');
settingsSyncCheck($disabledPayload['switcher']['lastSeenRevision'] === 0, 'Switcher report must include the monotone owner revision.');
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
        'visibleTargetLanguages' => [],
        'automaticTargetLanguages' => [],
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
        && ($newRuntimeSettings['visible_target_languages'] ?? null) === []
        && ($newRuntimeSettings['automatic_target_languages'] ?? null) === []
        && ($newRuntimeSettings['auto_redirect'] ?? null) === false
        && ($newRuntimeSettings['saas_project_version'] ?? null) === '2026-08-25T13:00:00.000Z',
    'The new project runtime readback must replace bootstrap mirrors and establish the new SaaS version.'
);

// A target deleted and recreated between two bounded syncs has the same
// language array but a new SaaS row identity. Its old local cache must miss.
$sameListOptions = new Options();
$sameListSettings = array_merge(Options::defaults(), [
    'enabled' => true, 'api_key' => 'dg_live_same_list', 'api_base_url' => 'https://deepglot.test/api',
    'source_language' => 'de', 'target_languages' => ['en'],
    'saas_project_version' => '2026-08-25T14:00:00.000Z',
    'target_language_generations' => ['en' => 'old-target-row'],
]);
update_option(Options::OPTION_KEY, $sameListSettings);
$cache = new TranslationCache();
settingsSyncCheck($cache->set('Old source', 'de', 'en', 'Old cached translation'), 'Fixture cache must save.');
settingsSyncCheck($cache->get('Old source', 'de', 'en') === 'Old cached translation', 'Fixture cache must be warm.');
$GLOBALS['_deepglot_runtime_response'] = ['project' => [
    'version' => '2026-08-25T15:00:00.000Z', 'sourceLanguage' => 'de', 'targetLanguages' => ['en'],
    'visibleTargetLanguages' => ['en'], 'automaticTargetLanguages' => ['en'],
    'targetLanguageGenerations' => ['en' => 'new-target-row'],
    'autoRedirect' => false, 'displayAiNotice' => false, 'automaticTranslation' => true,
]];
$queueSpy = new LifecycleQueueSpy();
$sameListSync = new SettingsSync($sameListOptions, new Client($sameListOptions), $queueSpy);
settingsSyncCheck(!is_wp_error($sameListSync->sync($sameListSettings)), 'Same-list sync must succeed.');
settingsSyncCheck($cache->get('Old source', 'de', 'en') === null, 'A recreated target must invalidate its old local cache even if the active list is unchanged.');
settingsSyncCheck($queueSpy->reconciliations[0] === ['de', ['en'], ['en']], 'A recreated target must discard old queued texts and URL purge targets.');
$queueReconciliationsAfterChange = count($queueSpy->reconciliations);
$cache->set('Fresh source', 'de', 'en', 'Fresh cached translation');
$GLOBALS['_deepglot_runtime_response']['project']['version'] = '2026-08-25T16:00:00.000Z';
settingsSyncCheck(!is_wp_error($sameListSync->sync($sameListOptions->all())), 'A same-generation sync must succeed.');
settingsSyncCheck($cache->get('Fresh source', 'de', 'en') === 'Fresh cached translation', 'An ordinary settings sync must preserve cache for the same target generation.');
settingsSyncCheck(count($queueSpy->reconciliations) === $queueReconciliationsAfterChange, 'A same-generation sync must retain queued work.');
$beforeInvalidGeneration = $sameListOptions->all();
$epochBeforeInvalidGeneration = get_option(TranslationCache::LANGUAGE_EPOCHS_OPTION, []);
$invalidGeneration = $GLOBALS['_deepglot_runtime_response'];
$invalidGeneration['project']['version'] = '2026-08-25T16:30:00.000Z';
$invalidGeneration['project']['sourceLanguage'] = 'fr';
$invalidGeneration['project']['targetLanguageGenerations'] = ['en' => 'same-target-row', 'pt-br' => 'foreign-row'];
$sameListOptions->applyRuntimeConfig($invalidGeneration, 'dg_live_same_list', 'https://deepglot.test/api');
$afterInvalidGeneration = $sameListOptions->all();
foreach (['source_language', 'target_languages', 'visible_target_languages', 'automatic_target_languages', 'target_language_generations', 'saas_project_version'] as $field) {
    settingsSyncCheck($afterInvalidGeneration[$field] === $beforeInvalidGeneration[$field],
        'Malformed target generations must not partially apply ' . $field . '.');
}
settingsSyncCheck(get_option(TranslationCache::LANGUAGE_EPOCHS_OPTION, []) === $epochBeforeInvalidGeneration,
    'Malformed target generations must not advance the target cache epoch.');

$pausedSettings = $sameListOptions->all();
$pausedSettings['target_languages'] = [];
$pausedSettings['visible_target_languages'] = [];
$pausedSettings['automatic_target_languages'] = [];
update_option(Options::OPTION_KEY, $pausedSettings);
$GLOBALS['_deepglot_runtime_response']['project']['version'] = '2026-08-25T17:00:00.000Z';
settingsSyncCheck(!$sameListOptions->isConfigured(), 'No active targets must keep delivery disabled.');
settingsSyncCheck(!is_wp_error($sameListSync->sync($pausedSettings)), 'An established identity with no active targets must still refresh.');
settingsSyncCheck($sameListOptions->getTargetLanguages() === ['en'], 'The later runtime snapshot must restore a reenabled target.');

$legacyOptions = new Options();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true, 'api_key' => 'dg_live_legacy', 'api_base_url' => 'https://deepglot.test/api',
    'source_language' => 'de', 'target_languages' => ['en'],
]));
$legacyOptions->applyRuntimeConfig(['project' => [
    'version' => '2026-08-25T18:00:00.000Z', 'sourceLanguage' => 'de', 'targetLanguages' => ['en'],
    'autoRedirect' => false, 'displayAiNotice' => false, 'automaticTranslation' => true,
]], 'dg_live_legacy', 'https://deepglot.test/api');
settingsSyncCheck($legacyOptions->getVisibleTargetLanguages() === ['en']
    && $legacyOptions->shouldAutomaticallyTranslateTarget('en'),
    'A previously released SaaS runtime without lifecycle keys must retain legacy visible and automatic behavior.');

fwrite(STDOUT, "ClientSettingsSyncTest: OK\n");
