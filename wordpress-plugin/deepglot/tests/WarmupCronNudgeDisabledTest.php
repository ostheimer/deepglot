<?php

/**
 * Regression coverage for #278: sites that opt out of WordPress loopback cron
 * must retain the due warm-up event but never receive a direct spawn_cron()
 * nudge. Their configured system cron remains responsible for draining it.
 */

if (!defined('DISABLE_WP_CRON')) {
    define('DISABLE_WP_CRON', true);
}

$GLOBALS['_deepglot_nudge_options'] = [];
$GLOBALS['_deepglot_nudge_scheduled'] = [];
$GLOBALS['_deepglot_nudge_spawns'] = 0;

if (!function_exists('get_option')) {
    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_nudge_options'][$key] ?? $default;
    }

    function update_option($key, $value, $autoload = null) {
        $GLOBALS['_deepglot_nudge_options'][$key] = $value;
        return true;
    }

    function delete_option($key) {
        unset($GLOBALS['_deepglot_nudge_options'][$key]);
        return true;
    }

    function wp_next_scheduled($hook, $args = []) {
        return $GLOBALS['_deepglot_nudge_scheduled'][$hook] ?? false;
    }

    function wp_schedule_single_event($timestamp, $hook, $args = []) {
        $GLOBALS['_deepglot_nudge_scheduled'][$hook] = $timestamp;
        return true;
    }

    function spawn_cron($gmtTime = 0) {
        $GLOBALS['_deepglot_nudge_spawns']++;
        return true;
    }

    function wp_doing_cron() {
        return false;
    }
}

if (!defined('DAY_IN_SECONDS')) {
    define('DAY_IN_SECONDS', 86400);
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/TranslationWarmer.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\TranslationWarmer;

function warmupCronNudgeDisabledAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$warmer = new TranslationWarmer(new Client(new Options()), new Options(), new TranslationCache());
$warmer->enqueue(['System cron only'], 'de', 'en');

warmupCronNudgeDisabledAssert(
    (int) ($GLOBALS['_deepglot_nudge_scheduled'][TranslationWarmer::HOOK] ?? PHP_INT_MAX) <= time(),
    'DISABLE_WP_CRON must still leave a durable, immediately due warm-up event for the system cron.'
);
warmupCronNudgeDisabledAssert(
    $GLOBALS['_deepglot_nudge_spawns'] === 0,
    'DISABLE_WP_CRON must suppress the direct non-blocking spawn_cron() nudge.'
);

fwrite(STDOUT, "WarmupCronNudgeDisabledTest: OK\n");
