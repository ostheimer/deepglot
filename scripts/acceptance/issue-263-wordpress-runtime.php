<?php
/** Run only in an isolated disposable WordPress install (wp eval-file). All content and API responses are neutral local fixtures. */
use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Support\TranslationCache;
use Deepglot\Sync\SettingsSync;

function prove($condition, $message) { if (!$condition) throw new RuntimeException($message); }
$options = new Options();
$settings = $options->all();
$settings['enabled'] = true;
$settings['api_key'] = 'dg_test_issue263';
$settings['api_base_url'] = 'https://mock.deepglot263.invalid/api';
$settings['source_language'] = 'de';
$settings['target_languages'] = ['en'];
$GLOBALS['deepglot_applying_runtime_config'] = true;
update_option(Options::OPTION_KEY, $settings, false);
unset($GLOBALS['deepglot_applying_runtime_config']);
delete_option('deepglot_url_cache_invalidation_cursor');
$cache = new TranslationCache();
$entries = [];
for ($id = 1; $id <= 251; $id++) {
    $text = "Neutral segment $id";
    $digest = sha1("de|en|$text");
    prove($cache->set($text, 'de', 'en', "Old $id"), "current transient seed $id failed");
    set_transient('dg_' . $digest, "Legacy $id", 3600);
    prove(get_transient('dg_' . $digest) === "Legacy $id", "legacy transient seed $id failed");
    $entries[] = ['id' => (string) $id, 'urlPath' => '/en/neutral', 'cacheKey' => $digest];
}
$keep = 'Protected shared segment';
$keepDigest = sha1('de|en|' . $keep);
prove($cache->set($keep, 'de', 'en', 'Keep current'), 'protected current seed failed');
set_transient('dg_' . $keepDigest, 'Keep legacy', 3600);
prove(get_transient('dg_' . $keepDigest) === 'Keep legacy', 'protected legacy seed failed');
$calls = [];
add_filter('pre_http_request', static function ($pre, $args, $url) use (&$calls, $entries) {
    if (strpos($url, '/plugin/runtime-config?') !== false) {
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $after = (int) ($query['cache_after'] ?? -1);
        $calls[] = ['runtime', $after];
        $batch = array_slice($entries, $after, 250);
        $body = ['cacheInvalidations' => ['entries' => $batch]];
    } elseif (strpos($url, '/translate?') !== false) {
        $calls[] = ['translate', 1];
        $body = ['from_words' => ['Neutral segment 251'], 'to_words' => ['Fresh 251']];
    } else {
        throw new RuntimeException('Unexpected network request in isolated WordPress runtime probe');
    }
    return ['headers' => [], 'body' => wp_json_encode($body), 'response' => ['code' => 200, 'message' => 'OK'], 'cookies' => [], 'filename' => null];
}, 10, 3);
$sync = new SettingsSync($options, new Client($options));
$identity = Client::configurationIdentityFor($settings['api_key'], $settings['api_base_url']);
$first = $sync->refreshRuntimeConfig(null, null, true);
prove(!is_wp_error($first), 'first runtime feed failed');
$cursor = get_option('deepglot_url_cache_invalidation_cursor');
prove($cursor === ['identity' => $identity, 'cursor' => '250'], 'first 250 cursor not persisted');
prove($cache->get('Neutral segment 1', 'de', 'en') === null && get_transient('dg_' . $entries[0]['cacheKey']) === false, 'first current and legacy transients remain');
prove($cache->get('Neutral segment 251', 'de', 'en') === 'Old 251', 'continuation segment removed too early');
$stubbornKey = 'dgv1_' . $entries[250]['cacheKey'];
$stubbornValue = get_transient($stubbornKey);
$filter = static fn($pre) => $stubbornValue;
add_filter('pre_transient_' . $stubbornKey, $filter);
$second = $sync->refreshRuntimeConfig(null, null, true);
prove(!is_wp_error($second), 'second runtime feed failed');
prove(get_option('deepglot_url_cache_invalidation_cursor') === $cursor, 'cursor advanced despite failed transient readback');
remove_filter('pre_transient_' . $stubbornKey, $filter);
$third = $sync->refreshRuntimeConfig(null, null, true);
prove(!is_wp_error($third), 'continuation retry failed');
prove(get_option('deepglot_url_cache_invalidation_cursor') === ['identity' => $identity, 'cursor' => '251'], 'continuation cursor missing');
prove($cache->get('Neutral segment 251', 'de', 'en') === null && get_transient('dg_' . $entries[250]['cacheKey']) === false, 'last current and legacy transients remain');
prove($cache->get($keep, 'de', 'en') === 'Keep current' && get_transient('dg_' . $keepDigest) === 'Keep legacy', 'protected/shared cache changed');
$client = new Client($options);
$translation = $client->translate(['Neutral segment 251'], 'de', 'en', 'http://localhost:8093/en/neutral');
prove(!is_wp_error($translation) && ($translation['to_words'][0] ?? null) === 'Fresh 251', 'fresh mock translation failed');
prove($cache->set('Neutral segment 251', 'de', 'en', $translation['to_words'][0]), 'fresh translation cache persistence failed');
prove($cache->get('Neutral segment 251', 'de', 'en') === 'Fresh 251', 'fresh translation cache readback failed');
prove($calls === [['runtime', 0], ['runtime', 250], ['runtime', 250], ['translate', 1]], 'unexpected bounded continuation/request sequence');
echo wp_json_encode(['wordpress' => get_bloginfo('version'), 'plugin' => DEEPGLOT_PLUGIN_VERSION, 'feed' => '250+1', 'cursorAfterFailedReadback' => '250', 'cursorFinal' => '251', 'currentAndLegacyRemoved' => true, 'protectedSharedKept' => true, 'freshTranslationCached' => true, 'calls' => $calls]) . PHP_EOL;
