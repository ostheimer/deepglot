<?php

/**
 * Regression coverage for #278: a warmer running within WordPress cron must
 * retain its due follow-up event without recursively spawning another cron
 * loopback from that same cron request.
 */

if (!defined('DOING_CRON')) {
    define('DOING_CRON', true);
}

$GLOBALS['_deepglot_cron_context_options'] = [];
$GLOBALS['_deepglot_cron_context_scheduled'] = [];
$GLOBALS['_deepglot_cron_context_spawns'] = 0;

if (!function_exists('get_option')) {
    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_cron_context_options'][$key] ?? $default;
    }

    function update_option($key, $value, $autoload = null) {
        $GLOBALS['_deepglot_cron_context_options'][$key] = $value;
        return true;
    }

    function delete_option($key) {
        unset($GLOBALS['_deepglot_cron_context_options'][$key]);
        return true;
    }

    function wp_next_scheduled($hook, $args = []) {
        return $GLOBALS['_deepglot_cron_context_scheduled'][$hook] ?? false;
    }

    function wp_schedule_single_event($timestamp, $hook, $args = []) {
        $GLOBALS['_deepglot_cron_context_scheduled'][$hook] = $timestamp;
        return true;
    }

    function spawn_cron($gmtTime = 0) {
        $GLOBALS['_deepglot_cron_context_spawns']++;
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

function warmupCronNudgeContextAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$warmer = new TranslationWarmer(new Client(new Options()), new Options(), new TranslationCache());
$warmer->enqueue(['Already running cron'], 'de', 'en');

warmupCronNudgeContextAssert(
    (int) ($GLOBALS['_deepglot_cron_context_scheduled'][TranslationWarmer::HOOK] ?? PHP_INT_MAX) <= time(),
    'A cron context must leave its warm-up event durable and immediately due.'
);
warmupCronNudgeContextAssert(
    $GLOBALS['_deepglot_cron_context_spawns'] === 0,
    'DOING_CRON must suppress a recursive spawn_cron() nudge.'
);

fwrite(STDOUT, "WarmupCronNudgeCronContextTest: OK\n");
