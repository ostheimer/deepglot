<?php

/**
 * Reproduces the live finding from 2026-08-03 (jobspot.at, #245): once the
 * configured API key is revoked or mistyped, the SaaS answers every
 * translation request with HTTP 401
 * ({"code":"invalid_api_key","title":"Authentication failed"}).
 *
 * Before this coverage the plugin handled that case nowhere:
 *   - no admin warning — the settings screen kept showing the green "Aktiv"
 *     badge and "✓ Aktiv – Seiten werden von DE nach EN übersetzt", so the
 *     operator could not see that nothing was being translated at all;
 *   - no circuit breaker — every uncached page view re-fired all translation
 *     batches and waited for the 401s (measured: /en/ 16.7 s cold, 1.5–4.1 s
 *     warm, against 0.68 s for the source language).
 *
 * The contract pinned here mirrors the existing HTTP 402 / quota path:
 * a `deepglot_invalid_api_key` transient acting as circuit breaker, a
 * wp-admin notice, no green "Aktiv" state on the settings page, and a reset
 * as soon as a different key (or backend) is saved.
 *
 * Run standalone: php tests/InvalidApiKeyCircuitBreakerTest.php
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

if (!function_exists('esc_html__')) {
    function esc_html__($text, $domain = null) {
        return $text;
    }

    function esc_html($text) {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }

    function esc_html_e($text, $domain = null) {
        echo htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }

    function esc_attr($text) {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }

    function esc_attr_e($text, $domain = null) {
        echo htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }

    function esc_textarea($text) {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }

    function esc_js($text) {
        return addslashes((string) $text);
    }

    function esc_url($url) {
        return (string) $url;
    }

    function esc_url_raw($url) {
        return (string) $url;
    }
}

if (!function_exists('get_option')) {
    $GLOBALS['_dgkey_options'] = [];
    $GLOBALS['_dgkey_transients'] = [];
    $GLOBALS['_dgkey_remote_status'] = 200;
    $GLOBALS['_dgkey_remote_calls'] = 0;
    $GLOBALS['_dgkey_can_manage'] = true;

    function get_option($key, $default = false) {
        return array_key_exists($key, $GLOBALS['_dgkey_options'])
            ? $GLOBALS['_dgkey_options'][$key]
            : $default;
    }

    function update_option($key, $value, $autoload = null) {
        $GLOBALS['_dgkey_options'][$key] = $value;
        return true;
    }

    function add_option($key, $value, $deprecated = '', $autoload = null) {
        if (array_key_exists($key, $GLOBALS['_dgkey_options'])) {
            return false;
        }
        $GLOBALS['_dgkey_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return $GLOBALS['_dgkey_transients'][$key] ?? false;
    }

    function set_transient($key, $value, $ttl = 0) {
        $GLOBALS['_dgkey_transients'][$key] = ['value' => $value, 'ttl' => $ttl];
        return true;
    }

    function delete_transient($key) {
        unset($GLOBALS['_dgkey_transients'][$key]);
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

    function sanitize_key($value) {
        return preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) $value)) ?? '';
    }

    function untrailingslashit($value) {
        return rtrim((string) $value, '/');
    }

    function home_url($path = '/') {
        return 'https://example.test' . $path;
    }

    function get_site_url() {
        return 'https://example.test';
    }

    function add_query_arg($key, $value, $url) {
        return $url . (str_contains((string) $url, '?') ? '&' : '?') . $key . '=' . $value;
    }

    function do_action($hook, ...$args) {
        return null;
    }

    function checked($checked, $current = true, $echo = true) {
        $markup = ((string) $checked === (string) $current) ? " checked='checked'" : '';
        if ($echo) {
            echo $markup;
        }
        return $markup;
    }

    function selected($selected, $current = true, $echo = true) {
        $markup = ((string) $selected === (string) $current) ? " selected='selected'" : '';
        if ($echo) {
            echo $markup;
        }
        return $markup;
    }

    function settings_errors($slug = '') {
    }

    function settings_fields($group) {
    }

    function submit_button($text = null) {
        echo '<button type="submit">' . htmlspecialchars((string) ($text ?? 'Save')) . '</button>';
    }

    function current_user_can($capability) {
        return (bool) $GLOBALS['_dgkey_can_manage'];
    }

    function wp_json_encode($value, $flags = 0) {
        return json_encode($value, $flags | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    function is_wp_error($value) {
        return $value instanceof \WP_Error;
    }

    function wp_remote_request($url, $args = []) {
        $GLOBALS['_dgkey_remote_calls']++;
        $status = (int) $GLOBALS['_dgkey_remote_status'];

        if ($status === 401) {
            $body = json_encode([
                'code' => 'invalid_api_key',
                'title' => 'Authentication failed',
                'status' => 401,
                'detail' => 'Authentication failed',
            ]);
        } elseif ($status === 402) {
            $body = json_encode([
                'code' => 'quota_exhausted',
                'status' => 402,
                'detail' => 'Monatliches Wortlimit erreicht',
            ]);
        } else {
            $body = json_encode(['from_words' => ['Hallo'], 'to_words' => ['Hello']]);
        }

        return ['response' => ['code' => $status], 'body' => $body];
    }

    function wp_remote_retrieve_response_code($response) {
        return (int) ($response['response']['code'] ?? 0);
    }

    function wp_remote_retrieve_body($response) {
        return (string) ($response['body'] ?? '');
    }

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

        public function get_error_message(): string
        {
            return $this->message;
        }

        public function get_error_data()
        {
            return $this->data;
        }
    }

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }
}

if (!defined('DEEPGLOT_PLUGIN_URL')) {
    define('DEEPGLOT_PLUGIN_URL', 'https://example.test/wp-content/plugins/deepglot/');
}

if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
    define('DEEPGLOT_PLUGIN_VERSION', 'test');
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Config/SwitcherTemplates.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';
require_once __DIR__ . '/../includes/Admin/SettingsPage.php';

use Deepglot\Admin\SettingsPage;
use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Sync\SettingsSync;

const DGKEY_TRANSIENT = 'deepglot_invalid_api_key';
const DGKEY_QUOTA_TRANSIENT = 'deepglot_quota_exhausted';

function dgkeyAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

function dgkeyReset(int $remoteStatus = 200): void
{
    $GLOBALS['_dgkey_transients'] = [];
    $GLOBALS['_dgkey_remote_status'] = $remoteStatus;
    $GLOBALS['_dgkey_remote_calls'] = 0;
}

function dgkeyStoreSettings(array $overrides = []): void
{
    $GLOBALS['_dgkey_options']['deepglot_settings'] = array_merge([
        'enabled' => true,
        'api_key' => 'dg_live_revoked',
        'api_base_url' => 'https://deepglot.test/api',
        'source_language' => 'de',
        'target_languages' => ['en'],
    ], $overrides);
}

function dgkeyRender(callable $callback): string
{
    ob_start();
    $callback();

    return (string) ob_get_clean();
}

dgkeyStoreSettings();

$options = new Options();
$client = new Client($options);

// -----------------------------------------------------------------------------
// 1. A 401 arms the circuit breaker.
// -----------------------------------------------------------------------------
dgkeyReset(401);

$first = $client->translate(['Hallo Welt'], 'de', 'en');

dgkeyAssert(is_wp_error($first), 'A 401 translate response must surface as WP_Error.');
dgkeyAssert(
    (int) (($first->get_error_data()['status'] ?? 0)) === 401,
    'The 401 WP_Error must carry the HTTP status so callers can classify it.'
);
dgkeyAssert($GLOBALS['_dgkey_remote_calls'] === 1, 'The first 401 must still cost exactly one API call.');
dgkeyAssert(
    get_transient(DGKEY_TRANSIENT) !== false,
    'A 401 must set the deepglot_invalid_api_key transient as circuit breaker.'
);

$ttl = (int) (get_transient(DGKEY_TRANSIENT)['ttl'] ?? 0);
dgkeyAssert(
    $ttl > 0 && $ttl <= 3600,
    'The circuit breaker needs a bounded TTL so a repaired key recovers on its own (got ' . $ttl . ').'
);

// -----------------------------------------------------------------------------
// 2. While the breaker is armed, translate() must not touch the network.
// -----------------------------------------------------------------------------
$GLOBALS['_dgkey_remote_calls'] = 0;

$blocked = $client->translate(['Hallo Welt'], 'de', 'en');

dgkeyAssert(
    $GLOBALS['_dgkey_remote_calls'] === 0,
    'An armed circuit breaker must short-circuit translate() without any API call.'
);
dgkeyAssert(is_wp_error($blocked), 'A short-circuited translate() must return a WP_Error.');
dgkeyAssert(
    $blocked->get_error_code() === 'deepglot_invalid_api_key',
    'The short-circuit error must be machine-readable as deepglot_invalid_api_key.'
);
dgkeyAssert(
    (int) (($blocked->get_error_data()['status'] ?? 0)) === 401,
    'The short-circuit error must keep the 401 status for downstream classification.'
);

// -----------------------------------------------------------------------------
// 3. The breaker also covers the multi-batch page path (the 16.7 s case).
// -----------------------------------------------------------------------------
$GLOBALS['_dgkey_remote_calls'] = 0;

$batchResults = $client->translateBatches(
    [['Erster Batch'], ['Zweiter Batch'], ['Dritter Batch']],
    'de',
    'en'
);

dgkeyAssert(
    $GLOBALS['_dgkey_remote_calls'] === 0,
    'An armed circuit breaker must short-circuit every batch of a page render.'
);
dgkeyAssert(count($batchResults) === 3, 'Short-circuited batches must keep the caller-visible key order.');
foreach ($batchResults as $key => $batchResult) {
    dgkeyAssert(is_wp_error($batchResult), 'Batch ' . $key . ' must report the invalid key as WP_Error.');
    dgkeyAssert(
        $batchResult->get_error_code() === 'deepglot_invalid_api_key',
        'Batch ' . $key . ' must expose the deepglot_invalid_api_key code.'
    );
}

// -----------------------------------------------------------------------------
// 4. translateBatches() arms the breaker itself, so the very next page render
//    is already cheap even when the first failure happened mid-batch.
// -----------------------------------------------------------------------------
dgkeyReset(401);

$client->translateBatches([['Erster Batch'], ['Zweiter Batch']], 'de', 'en');

dgkeyAssert(
    get_transient(DGKEY_TRANSIENT) !== false,
    'A 401 from the batch path must arm the circuit breaker too.'
);

$callsAfterArming = $GLOBALS['_dgkey_remote_calls'];
$client->translateBatches([['Erster Batch'], ['Zweiter Batch']], 'de', 'en');
dgkeyAssert(
    $GLOBALS['_dgkey_remote_calls'] === $callsAfterArming,
    'Once armed from the batch path, further renders must not call the API again.'
);

// -----------------------------------------------------------------------------
// 5. No false positives: a quota 402 and a healthy 200 must leave the
//    invalid-key breaker untouched.
// -----------------------------------------------------------------------------
dgkeyReset(402);

$quota = $client->translate(['Hallo Welt'], 'de', 'en');

dgkeyAssert(is_wp_error($quota), 'A 402 must still surface as WP_Error.');
dgkeyAssert(
    get_transient(DGKEY_TRANSIENT) === false,
    'An exhausted quota must not be mistaken for an invalid API key.'
);
dgkeyAssert(
    get_transient(DGKEY_QUOTA_TRANSIENT) !== false,
    'The existing quota transient must keep working unchanged.'
);

dgkeyReset(200);

$ok = $client->translate(['Hallo Welt'], 'de', 'en');

dgkeyAssert(!is_wp_error($ok), 'A healthy backend must translate normally.');
dgkeyAssert($GLOBALS['_dgkey_remote_calls'] === 1, 'A healthy backend must be called exactly once.');
dgkeyAssert(
    get_transient(DGKEY_TRANSIENT) === false,
    'A successful translation must not arm the invalid-key breaker.'
);

// -----------------------------------------------------------------------------
// 6. Saving a corrected key clears the breaker immediately — otherwise the
//    operator would have to wait out the TTL after fixing the key.
// -----------------------------------------------------------------------------
dgkeyReset(200);

$sync = new SettingsSync($options, $client);
$stored = $GLOBALS['_dgkey_options']['deepglot_settings'];

set_transient(DGKEY_TRANSIENT, time(), 900);
$sync->handleOptionUpdate(
    $stored,
    array_merge($stored, ['api_key' => 'dg_live_repaired'])
);

dgkeyAssert(
    get_transient(DGKEY_TRANSIENT) === false,
    'Saving a different API key must clear the invalid-key circuit breaker.'
);

set_transient(DGKEY_TRANSIENT, time(), 900);
$sync->handleOptionUpdate(
    $stored,
    array_merge($stored, ['api_base_url' => 'https://self-hosted.test/api'])
);

dgkeyAssert(
    get_transient(DGKEY_TRANSIENT) === false,
    'Pointing the plugin at a different backend must clear the invalid-key breaker as well.'
);

set_transient(DGKEY_TRANSIENT, time(), 900);
$sync->handleOptionUpdate(
    $stored,
    array_merge($stored, ['source_language' => 'at'])
);

dgkeyAssert(
    get_transient(DGKEY_TRANSIENT) !== false,
    'An unrelated settings change must not clear a still-valid invalid-key breaker.'
);

// -----------------------------------------------------------------------------
// 7. wp-admin notice.
// -----------------------------------------------------------------------------
$settingsPage = new SettingsPage($options);

dgkeyReset();
$GLOBALS['_dgkey_can_manage'] = true;
set_transient(DGKEY_TRANSIENT, time(), 900);

$notice = dgkeyRender([$settingsPage, 'maybeRenderInvalidApiKeyNotice']);

dgkeyAssert($notice !== '', 'An invalid API key must raise a wp-admin notice.');
dgkeyAssert(
    str_contains($notice, 'notice-error'),
    'The invalid-key notice must use the error level — nothing is being translated at all.'
);
dgkeyAssert(
    str_contains($notice, 'API-Key'),
    'The invalid-key notice must name the API key as the cause.'
);
dgkeyAssert(
    str_contains($notice, 'deepglot.ai'),
    'The invalid-key notice must link the dashboard where a new key is issued.'
);

$GLOBALS['_dgkey_can_manage'] = false;
dgkeyAssert(
    dgkeyRender([$settingsPage, 'maybeRenderInvalidApiKeyNotice']) === '',
    'The invalid-key notice must stay hidden from users without manage_options.'
);
$GLOBALS['_dgkey_can_manage'] = true;

delete_transient(DGKEY_TRANSIENT);
dgkeyAssert(
    dgkeyRender([$settingsPage, 'maybeRenderInvalidApiKeyNotice']) === '',
    'Without an armed breaker there must be no invalid-key notice.'
);

// -----------------------------------------------------------------------------
// 8. Settings page status: the green "Aktiv" state must not survive a
//    revoked key — that is exactly what hid the outage on the live site.
// -----------------------------------------------------------------------------
dgkeyReset();
dgkeyStoreSettings();

$healthy = dgkeyRender([$settingsPage, 'render']);

dgkeyAssert(
    str_contains($healthy, 'dg-status active'),
    'A healthy configuration must still show the active status badge.'
);
dgkeyAssert(
    str_contains($healthy, 'Aktiv – Seiten werden von'),
    'A healthy configuration must still confirm the translation direction.'
);

set_transient(DGKEY_TRANSIENT, time(), 900);

$broken = dgkeyRender([$settingsPage, 'render']);

dgkeyAssert(
    !str_contains($broken, 'dg-status active'),
    'A revoked API key must not keep the green "Aktiv" badge.'
);
dgkeyAssert(
    !str_contains($broken, 'Aktiv – Seiten werden von'),
    'A revoked API key must not keep claiming that pages are being translated.'
);
dgkeyAssert(
    str_contains($broken, 'API-Key ungültig'),
    'The settings page must state that the API key is invalid.'
);

fwrite(STDOUT, "InvalidApiKeyCircuitBreakerTest: OK\n");
