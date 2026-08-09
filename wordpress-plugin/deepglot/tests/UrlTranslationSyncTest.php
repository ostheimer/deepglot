<?php

/**
 * Regression contract for the bounded, operator-triggered URL synchronization
 * queue. The URL queue only discovers localized pages; the existing
 * TranslationWarmer remains the single owner of provider work and cache
 * invalidation.
 */

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
if (!defined('DAY_IN_SECONDS')) {
    define('DAY_IN_SECONDS', 86400);
}
if (!defined('MINUTE_IN_SECONDS')) {
    define('MINUTE_IN_SECONDS', 60);
}

class WP_Error
{
    private string $code;
    private string $message;
    private $data;

    public function __construct(string $code, string $message = '', $data = null)
    {
        $this->code = $code;
        $this->message = $message;
        $this->data = $data;
    }

    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data() { return $this->data; }
}

$GLOBALS['_dg_sync_options'] = [];
$GLOBALS['_dg_sync_transients'] = [];
$GLOBALS['_dg_sync_scheduled'] = [];
$GLOBALS['_dg_sync_actions'] = [];
$GLOBALS['_dg_sync_requests'] = [];
$GLOBALS['_dg_sync_safe_requests'] = 0;
$GLOBALS['_dg_sync_responses'] = [];
$GLOBALS['_dg_sync_during_request'] = null;
$GLOBALS['_dg_sync_lock_seen'] = null;

function __(string $text, ?string $domain = null): string { return $text; }
function get_option(string $key, $default = false) { return $GLOBALS['_dg_sync_options'][$key] ?? $default; }
function update_option(string $key, $value, $autoload = null): bool { $GLOBALS['_dg_sync_options'][$key] = $value; return true; }
function add_option(string $key, $value, string $deprecated = '', $autoload = true): bool
{
    if (array_key_exists($key, $GLOBALS['_dg_sync_options'])) return false;
    $GLOBALS['_dg_sync_options'][$key] = $value;
    return true;
}
function delete_option(string $key): bool { unset($GLOBALS['_dg_sync_options'][$key]); return true; }
function get_transient(string $key) { return $GLOBALS['_dg_sync_transients'][$key] ?? false; }
function set_transient(string $key, $value, int $ttl = 0): bool { $GLOBALS['_dg_sync_transients'][$key] = $value; return true; }
function delete_transient(string $key): bool { unset($GLOBALS['_dg_sync_transients'][$key]); return true; }
function wp_cache_delete(string $key, string $group = ''): bool { return true; }
function wp_generate_uuid4(): string { static $i = 0; $i++; return sprintf('00000000-0000-4000-8000-%012d', $i); }
function wp_next_scheduled(string $hook, array $args = []) { return $GLOBALS['_dg_sync_scheduled'][$hook] ?? false; }
function wp_schedule_single_event(int $timestamp, string $hook, array $args = []): bool
{
    $GLOBALS['_dg_sync_scheduled'][$hook] = $timestamp;
    return true;
}
function wp_unschedule_event(int $timestamp, string $hook, array $args = []): bool
{
    unset($GLOBALS['_dg_sync_scheduled'][$hook]);
    return true;
}
function add_action(string $hook, $callback, int $priority = 10, int $args = 1): bool
{
    $GLOBALS['_dg_sync_actions'][$hook][] = $callback;
    return true;
}
function is_wp_error($value): bool { return $value instanceof WP_Error; }
if (!function_exists('wp_parse_url')) {
    function wp_parse_url(string $url, int $component = -1) { return parse_url($url, $component); }
}
function esc_url_raw(string $url): string { return $url; }
if (!function_exists('wp_unslash')) {
    function wp_unslash(string $value): string { return $value; }
}
function sanitize_text_field(string $value): string { return trim($value); }
function untrailingslashit(string $value): string { return rtrim($value, '/'); }
function wp_parse_args($args, array $defaults = []): array { return array_merge($defaults, is_array($args) ? $args : []); }
function home_url(string $path = '/'): string { return 'https://example.com' . (str_starts_with($path, '/') ? $path : '/' . $path); }
function get_site_url(): string { return 'https://example.com'; }
function wp_json_encode($value): string { return json_encode($value); }
function add_query_arg(array $args, string $url): string
{
    $parts = parse_url($url);
    parse_str((string) ($parts['query'] ?? ''), $query);
    foreach ($args as $key => $value) $query[$key] = $value;
    $result = ($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? 'example.com')
        . ($parts['path'] ?? '/');
    if ($query !== []) $result .= '?' . http_build_query($query);
    if (isset($parts['fragment'])) $result .= '#' . $parts['fragment'];
    return $result;
}
function wp_remote_get(string $url, array $args = [])
{
    $GLOBALS['_dg_sync_requests'][] = ['url' => $url, 'args' => $args];
    if (is_callable($GLOBALS['_dg_sync_during_request'])) {
        $callback = $GLOBALS['_dg_sync_during_request'];
        $GLOBALS['_dg_sync_during_request'] = null;
        $callback();
    }
    if ($GLOBALS['_dg_sync_responses'] === []) {
        return ['response' => ['code' => 200], 'headers' => [
            'x-deepglot-sync-pending-segments' => '0',
            'x-deepglot-sync-language' => 'en',
        ]];
    }
    return array_shift($GLOBALS['_dg_sync_responses']);
}
function wp_safe_remote_get(string $url, array $args = [])
{
    $GLOBALS['_dg_sync_safe_requests']++;
    $GLOBALS['_dg_sync_lock_seen'] = get_option(\Deepglot\Support\UrlTranslationSync::LOCK_OPTION, null);
    return wp_remote_get($url, $args);
}
function wp_remote_retrieve_response_code($response): int { return (int) ($response['response']['code'] ?? 0); }
function wp_remote_retrieve_header($response, string $name): string
{
    $headers = array_change_key_case((array) ($response['headers'] ?? []), CASE_LOWER);
    return (string) ($headers[strtolower($name)] ?? '');
}

require_once __DIR__ . '/../includes/Support/WordPressInfrastructure.php';
require_once __DIR__ . '/../includes/Support/RequestInput.php';
require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/TranslationWarmer.php';
require_once __DIR__ . '/../includes/Frontend/MultilingualSitemap.php';
require_once __DIR__ . '/../includes/Frontend/RequestRouter.php';
require_once __DIR__ . '/../includes/Support/UrlTranslationSync.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\MultilingualSitemap;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\TranslationWarmer;
use Deepglot\Support\UrlLanguageResolver;
use Deepglot\Support\UrlTranslationSync;

class UrlSyncFakeSitemap extends MultilingualSitemap
{
    public array $entries = [];
    public ?int $lastLimit = null;
    public function __construct() {}
    public function collectSourceEntries(?int $limit = null): array
    {
        $this->lastLimit = $limit;
        return array_slice($this->entries, 0, $limit ?? count($this->entries));
    }
}

class UrlSyncFakeWarmer extends TranslationWarmer
{
    public array $queue = [];
    public function __construct() {}
    public function pending(): array { return $this->queue; }
}

function syncAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

function syncReset(): void
{
    $GLOBALS['_dg_sync_options'] = [];
    $GLOBALS['_dg_sync_transients'] = [];
    $GLOBALS['_dg_sync_scheduled'] = [];
    $GLOBALS['_dg_sync_actions'] = [];
    $GLOBALS['_dg_sync_requests'] = [];
    $GLOBALS['_dg_sync_safe_requests'] = 0;
    $GLOBALS['_dg_sync_responses'] = [];
    $GLOBALS['_dg_sync_during_request'] = null;
    $GLOBALS['_dg_sync_lock_seen'] = null;
    $_GET = [];
    unset($_SERVER['HTTP_HOST'], $_SERVER['REQUEST_URI']);
}

/** @return array{0: UrlTranslationSync, 1: UrlSyncFakeSitemap, 2: UrlSyncFakeWarmer, 3: Options, 4: SiteRouting} */
function syncFixture(array $entries): array
{
    $options = new Options();
    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en'],
    ]), false);

    $routing = new SiteRouting(
        new UrlLanguageResolver('de', ['en']),
        'https://example.com',
        'PATH_PREFIX',
        [],
        ['en' => ['angebot' => 'offer']]
    );
    $sitemap = new UrlSyncFakeSitemap();
    $sitemap->entries = $entries;
    $warmer = new UrlSyncFakeWarmer();

    return [new UrlTranslationSync($options, $routing, $sitemap, $warmer), $sitemap, $warmer, $options, $routing];
}

/** @return array<string,mixed> */
function syncPreviewAndStart(UrlTranslationSync $sync, array $languages, int $limit): array
{
    $preview = $sync->preview($languages, $limit);
    syncAssert(!is_wp_error($preview), 'A valid snapshot preview must succeed.');
    $started = $sync->start($languages, $limit, (string) $preview['preview_token']);
    syncAssert(!is_wp_error($started), 'A confirmed snapshot preview must start.');
    return $started;
}

// 1. Preview is side-effect free, bounded, internal-only and uses the actual localized route.
syncReset();
[$sync, $sitemap] = syncFixture([
    ['loc' => 'https://example.com/'],
    ['loc' => 'https://example.com/angebot/?topic=a'],
    ['loc' => 'https://evil.example/steal/'],
]);
$preview = $sync->preview(['en'], 2);
syncAssert(!is_wp_error($preview), 'A valid internal snapshot must be previewable.');
syncAssert(get_option(UrlTranslationSync::JOB_OPTION, false) === false, 'Preview must not create or mutate a durable job.');
syncAssert($GLOBALS['_dg_sync_requests'] === [], 'Preview must not issue page or provider HTTP requests.');
syncAssert($GLOBALS['_dg_sync_scheduled'] === [], 'Preview must not schedule background work.');
syncAssert($preview['total'] === 2, 'Preview must report the actual safe snapshot size.');
syncAssert(
    $preview['sample_urls'] === ['https://example.com/en/', 'https://example.com/en/offer/?topic=a'],
    'Preview must expose a bounded sample of the actual localized snapshot.'
);
syncAssert(!empty($preview['preview_token']) && !empty($preview['snapshot_hash']), 'Preview must return a server-verifiable token and snapshot hash.');
syncAssert(UrlTranslationSync::MAX_URLS === 250, 'Each durable sync job must stay conservatively bounded to 250 target URLs.');

$withoutPreview = $sync->start(['en'], 2);
syncAssert(
    is_wp_error($withoutPreview) && $withoutPreview->get_error_code() === 'deepglot_url_sync_preview_required',
    'Starting without a confirmed preview must fail closed.'
);

$wrongSelection = $sync->start(['en'], 1, (string) $preview['preview_token']);
syncAssert(
    is_wp_error($wrongSelection) && $wrongSelection->get_error_code() === 'deepglot_url_sync_preview_mismatch',
    'A preview token must be bound to its exact language and limit selection.'
);

// Starting consumes the server-side preview and must use its immutable snapshot,
// even if WordPress content changes between the two operator steps.
$sitemap->entries = [['loc' => 'https://example.com/changed-after-preview/']];
$started = $sync->start(['en'], 2, (string) $preview['preview_token']);
syncAssert(!is_wp_error($started), 'A matching confirmed preview must start.');
$status = $sync->status();
syncAssert($sitemap->lastLimit === 3, 'Discovery may read only one extra target candidate to detect a following batch.');
syncAssert($status['total'] === 2, 'The snapshot must contain exactly the bounded internal URLs.');
syncAssert($status['urls'][0]['url'] === 'https://example.com/en/', 'Home must use the localized route.');
syncAssert($status['urls'][1]['url'] === 'https://example.com/en/offer/?topic=a', 'Translated slugs and query strings must survive snapshot creation.');
syncAssert(
    $sync->start(['en'], 2, (string) $preview['preview_token']) instanceof WP_Error,
    'A consumed preview token must never be replayable.'
);

syncReset();
[$sync] = syncFixture(array_map(
    static fn(int $index): array => ['loc' => 'https://example.com/page-' . $index . '/'],
    range(1, 5)
));
$firstBatch = $sync->preview(['en'], 2, 0);
$nextBatch = $sync->preview(['en'], 2, (int) $firstBatch['next_source_offset']);
syncAssert($firstBatch['next_source_offset'] === 2, 'A full preview must advertise the next bounded source offset.');
syncAssert(
    $nextBatch['sample_urls'] === ['https://example.com/en/page-3/', 'https://example.com/en/page-4/'],
    'The next batch must continue the deterministic target-URL snapshot without overlap.'
);

syncReset();
[$sync] = syncFixture([
    ['loc' => 'https://example.com/'],
    ['loc' => 'https://evil.example/steal/'],
    ['loc' => 'https://example.com/angebot/'],
]);
syncPreviewAndStart($sync, ['en'], 3);
syncAssert($sync->status()['total'] === 2, 'A filter-injected external URL must never enter the durable snapshot.');

$tooLarge = $sync->start(['en'], UrlTranslationSync::MAX_URLS + 1);
syncAssert(is_wp_error($tooLarge) && $tooLarge->get_error_code() === 'deepglot_url_sync_limit', 'Requests above the hard URL limit must be rejected.');

syncReset();
[$sync] = syncFixture(array_map(
    static fn(int $index): array => ['loc' => 'https://example.com/page-' . $index . '/'],
    range(1, UrlTranslationSync::PREVIEW_SAMPLE_LIMIT + 2)
));
$boundedPreview = $sync->preview(['en'], UrlTranslationSync::PREVIEW_SAMPLE_LIMIT + 2);
syncAssert($boundedPreview['total'] === UrlTranslationSync::PREVIEW_SAMPLE_LIMIT + 2, 'Preview count must cover the whole bounded snapshot.');
syncAssert(count($boundedPreview['sample_urls']) === UrlTranslationSync::PREVIEW_SAMPLE_LIMIT, 'Preview must never expose more than the safe sample limit.');
$expiredToken = (string) $boundedPreview['preview_token'];
$GLOBALS['_dg_sync_transients'] = [];
$expiredStart = $sync->start(['en'], UrlTranslationSync::PREVIEW_SAMPLE_LIMIT + 2, $expiredToken);
syncAssert(
    is_wp_error($expiredStart) && $expiredStart->get_error_code() === 'deepglot_url_sync_preview_expired',
    'Expired or unknown preview tokens must fail closed.'
);

// 2. Public query contract accepts only a live HMAC-signed token for the exact
// target URL (including its ordinary query, excluding the control argument).
syncReset();
[$sync, , , $options, $routing] = syncFixture([[
    'loc' => 'https://example.com/?topic=one&tag=a&tag=b&encoded=%2Fkeep%2F',
]]);
$activePreview = $sync->preview(['en'], 1);
$status = $sync->start(['en'], 1, (string) $activePreview['preview_token']);
syncAssert(!is_wp_error($status), 'A fresh confirmed preview must create the active query-contract job.');
$GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 200], 'headers' => [
    'x-deepglot-sync-pending-segments' => '1',
    'x-deepglot-sync-language' => 'en',
]];
$sync->run();
$requestedUrl = $GLOBALS['_dg_sync_requests'][0]['url'];
syncAssert(
    str_contains($requestedUrl, 'tag=a&tag=b&encoded=%2Fkeep%2F'),
    'Appending the signed control token must preserve duplicate query keys and original encoding.'
);
$requestedParts = parse_url($requestedUrl);
$_SERVER['HTTP_HOST'] = (string) ($requestedParts['host'] ?? '');
$_SERVER['REQUEST_URI'] = (string) ($requestedParts['path'] ?? '/');
if (!empty($requestedParts['query'])) {
    $_SERVER['REQUEST_URI'] .= '?' . $requestedParts['query'];
}
parse_str((string) ($requestedParts['query'] ?? ''), $_GET);
$token = (string) ($_GET[UrlTranslationSync::QUERY_ARG] ?? '');
syncAssert($sync->isCurrentRequest(), 'The active job token must authorize the control query.');
syncAssert(!array_key_exists('request_secret', $sync->status()), 'The HMAC secret must never leak through public job status.');

$originalLocalizedUri = $_SERVER['REQUEST_URI'];
$router = new RequestRouter($options, $routing);
$router->rewriteRequestUri();
syncAssert(
    !str_starts_with((string) $_SERVER['REQUEST_URI'], '/en/'),
    'RequestRouter must reproduce the Stage rewrite by stripping /en/ before output processing.'
);
syncAssert(
    !$sync->isCurrentRequest(),
    'The already rewritten REQUEST_URI cannot satisfy the URL-bound token by itself.'
);
syncAssert(
    method_exists($router, 'getOriginalRequestUri'),
    'RequestRouter must expose its original localized URI for downstream sync authorization.'
);
syncAssert(
    $sync->isCurrentRequest($router->getOriginalRequestUri()),
    'Sync diagnostics must authorize against RequestRouter original URI after /en/ was stripped.'
);
$outputBufferSource = file_get_contents(__DIR__ . '/../includes/Frontend/OutputBuffer.php');
syncAssert(
    is_string($outputBufferSource)
        && str_contains($outputBufferSource, 'isCurrentRequest($this->router->getOriginalRequestUri())'),
    'OutputBuffer must pass RequestRouter original URI explicitly to sync authorization.'
);

$otherUri = '/en/b/?' . (string) ($requestedParts['query'] ?? '');
syncAssert(
    !$sync->isCurrentRequest($otherUri),
    'A token issued for snapshot URL A must not authorize another internal URL B.'
);
$changedQueryUri = str_replace('topic=one', 'topic=two', $originalLocalizedUri);
syncAssert(
    !$sync->isCurrentRequest($changedQueryUri),
    'A token must not authorize a different ordinary query on the same host and path.'
);

$_GET[UrlTranslationSync::QUERY_ARG] = substr($token, 0, -1) . ($token[-1] === 'a' ? 'b' : 'a');
syncAssert(!$sync->isCurrentRequest($originalLocalizedUri), 'A forged signature must not be trusted even when the job ID prefix matches.');
$rawJob = get_option(UrlTranslationSync::JOB_OPTION, []);
$expiredParts = explode('.', $token);
$expiredParts[1] = (string) (time() - 1);
$expiredPayload = implode('.', array_slice($expiredParts, 0, -1));
$_GET[UrlTranslationSync::QUERY_ARG] = $expiredPayload . '.' . hash_hmac('sha256', $expiredPayload, $rawJob['request_secret']);
syncAssert(!$sync->isCurrentRequest($originalLocalizedUri), 'A correctly signed but expired control token must not be trusted.');
$_GET[UrlTranslationSync::QUERY_ARG] = $token;
syncAssert(
    $sync->stripQueryArg('/en/offer/?topic=a&' . UrlTranslationSync::QUERY_ARG . '=' . rawurlencode($token) . '#details') === '/en/offer/?topic=a#details',
    'The control query must be removed without losing ordinary query parameters or the fragment.'
);
syncAssert(
    $sync->stripQueryArg('/en/?tag=a&tag=b&encoded=%2Fkeep%2F&' . UrlTranslationSync::QUERY_ARG . '=' . rawurlencode($token))
        === '/en/?tag=a&tag=b&encoded=%2Fkeep%2F',
    'Removing the control query must preserve duplicate parameters and their original encoding.'
);

// 3. Backpressure blocks discovery hits while the existing warmer is full.
syncReset();
[$sync, , $warmer] = syncFixture([
    ['loc' => 'https://example.com/a/'],
    ['loc' => 'https://example.com/b/'],
    ['loc' => 'https://example.com/c/'],
]);
syncPreviewAndStart($sync, ['en'], 3);
$warmer->queue = ['de|en' => array_fill(0, UrlTranslationSync::MAX_PENDING_TEXTS, 'pending')];
$sync->run();
syncAssert($GLOBALS['_dg_sync_requests'] === [], 'A full warmer queue must prevent new URL hits.');
syncAssert(($sync->status()['status'] ?? '') === 'warming', 'Backpressure must be visible as warming.');

// 4. A run opens at most two pages, never follows redirects and uses a unique control query.
$warmer->queue = [];
$GLOBALS['_dg_sync_scheduled'] = [];
$sync->resume();
$sync->run();
$signedRequests = array_values(array_filter(
    $GLOBALS['_dg_sync_requests'],
    static fn(array $request): bool => str_contains(
        $request['url'],
        UrlTranslationSync::QUERY_ARG . '='
    )
));
syncAssert(count($signedRequests) === 2, 'One cron run must open at most two signed target URLs.');
syncAssert(
    count($GLOBALS['_dg_sync_requests']) === 6,
    'Each completed target must add bounded public-cache and origin-bypass status probes.'
);
foreach ($signedRequests as $request) {
    syncAssert(($request['args']['redirection'] ?? null) === 0, 'Sync requests must not follow redirects.');
    syncAssert(($request['args']['sslverify'] ?? null) === true, 'TLS verification must stay enabled.');
    syncAssert(str_contains($request['url'], UrlTranslationSync::QUERY_ARG . '='), 'Every request needs a cache-busting control query.');
    syncAssert(str_contains((string) ($request['args']['headers']['Cache-Control'] ?? ''), 'no-cache'), 'Every request must bypass reusable page-cache objects.');
    syncAssert(!preg_match('/bot|crawler|spider|headless|curl/i', (string) ($request['args']['user-agent'] ?? '')), 'The controlled sync request must enter the human warm-up path.');
}
syncAssert(
    $GLOBALS['_dg_sync_safe_requests'] === count($GLOBALS['_dg_sync_requests']),
    'Every loopback must use WordPress safe HTTP validation.'
);
syncAssert(
    is_array($GLOBALS['_dg_sync_lock_seen'])
        && (int) $GLOBALS['_dg_sync_lock_seen']['expires'] >= time() + 100,
    'The runner lock must outlive two sequential 20-second requests with a wide safety margin.'
);

// A nominal 200 response for the wrong target language is not progress.
syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
$GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 200], 'headers' => [
    'x-deepglot-sync-pending-segments' => '0',
    'x-deepglot-sync-language' => 'fr',
]];
$sync->run();
syncAssert(
    $sync->status()['retry_count'] === 1 && $sync->status()['last_error'] === 'language_mismatch',
    'A sync response must echo the exact item language before it can complete.'
);

// A signed cache-busting request can return a healthy translated 200 while the
// public query-free cache still redirects visitors back to the source URL.
// pending=0 is therefore only complete after a separate cache-only status hit.
syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/?preview=1']]);
syncPreviewAndStart($sync, ['en'], 1);
$GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 200], 'headers' => [
    'x-deepglot-sync-pending-segments' => '0',
    'x-deepglot-sync-language' => 'en',
]];
$GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 301], 'headers' => [
    'location' => 'https://example.com/a-de/',
]];
$sync->run();
$publicFallback = $sync->status();
syncAssert(
    $publicFallback['status'] !== 'completed'
        && $publicFallback['retry_count'] === 1
        && $publicFallback['last_error'] === 'public_status_redirect_301',
    'A query-free public redirect must keep the item in the bounded retry path.'
);
syncAssert(count($GLOBALS['_dg_sync_requests']) === 2, 'pending=0 must trigger one separate public status probe.');
$statusProbe = $GLOBALS['_dg_sync_requests'][1];
syncAssert(
    $statusProbe['url'] === 'https://example.com/en/a/',
    'The public status probe must remove every cache-busting or ordinary query parameter.'
);
syncAssert(
    ($statusProbe['args']['redirection'] ?? null) === 0
        && ($statusProbe['args']['sslverify'] ?? null) === true
        && ($statusProbe['args']['limit_response_size'] ?? null) === 1
        && preg_match('/bot/i', (string) ($statusProbe['args']['user-agent'] ?? '')) === 1,
    'The status probe must be safe, no-redirect, body-bounded and cache-only for translation.'
);
for ($attempt = 1; $attempt < UrlTranslationSync::MAX_NO_PROGRESS_RETRIES; $attempt++) {
    $job = get_option(UrlTranslationSync::JOB_OPTION, []);
    $job['status'] = 'queued';
    $job['next_run_at'] = 0;
    $job['urls'][0]['next_attempt_at'] = 0;
    update_option(UrlTranslationSync::JOB_OPTION, $job, false);
    $GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 200], 'headers' => [
        'x-deepglot-sync-pending-segments' => '0',
        'x-deepglot-sync-language' => 'en',
    ]];
    $GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 301], 'headers' => [
        'location' => 'https://example.com/a-de/',
    ]];
    $sync->run();
}
syncAssert(
    $sync->status()['status'] === 'completed_with_errors'
        && $sync->status()['failed'] === 1,
    'Repeated public-cache redirects must stop at the existing no-progress retry cap.'
);

// A split edge can return a stale target-language HIT to an origin loopback
// while a cache-bypassing request to the same query-free target is already 404.
// The stale edge HIT must never be enough to complete the sitemap item.
syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/removed-treatment/']]);
syncPreviewAndStart($sync, ['en'], 1);
$GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 200], 'headers' => [
    'x-deepglot-sync-pending-segments' => '0',
    'x-deepglot-sync-language' => 'en',
]];
$GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 200], 'headers' => [
    'x-cache' => 'HIT',
]];
$GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 404], 'headers' => []];
$sync->run();
$splitEdge = $sync->status();
syncAssert(
    $splitEdge['status'] !== 'completed'
        && $splitEdge['retry_count'] === 1
        && $splitEdge['last_error'] === 'origin_status_http_404',
    'A stale target cache HIT must never hide a query-free origin 404 for the same URL.'
);
syncAssert(
    count($GLOBALS['_dg_sync_requests']) === 3
        && $GLOBALS['_dg_sync_requests'][2]['url'] === 'https://example.com/en/removed-treatment/'
        && ($GLOBALS['_dg_sync_requests'][2]['args']['redirection'] ?? null) === 0
        && ($GLOBALS['_dg_sync_requests'][2]['args']['sslverify'] ?? null) === true
        && ($GLOBALS['_dg_sync_requests'][2]['args']['limit_response_size'] ?? null) === 1
        && preg_match(
            '/bot/i',
            (string) ($GLOBALS['_dg_sync_requests'][2]['args']['user-agent'] ?? '')
        ) === 1
        && str_contains(
            (string) ($GLOBALS['_dg_sync_requests'][2]['args']['headers']['Cookie'] ?? ''),
            'wordpress_logged_in_deepglot_probe='
        ),
    'Completion must repeat the exact query-free target with an invalid cache-bypass cookie.'
);

// 5. Transient failures back off; redirects are failures, never followed.
syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
$GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 500], 'headers' => []];
$sync->run();
$failedOnce = $sync->status();
syncAssert($failedOnce['retry_count'] === 1, 'A transient failure must be counted.');
syncAssert($failedOnce['next_run_at'] > time(), 'A transient failure must apply backoff.');
$requestCount = count($GLOBALS['_dg_sync_requests']);
$sync->run();
syncAssert(count($GLOBALS['_dg_sync_requests']) === $requestCount, 'Backoff must prevent an immediate retry.');

syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
$GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 301], 'headers' => ['location' => 'https://example.com/a/']];
$sync->run();
syncAssert($sync->status()['retry_count'] === 1, 'A redirect must be surfaced as a failed attempt.');

// Repeated no-progress failures stop after the hard retry cap.
for ($attempt = 1; $attempt < UrlTranslationSync::MAX_NO_PROGRESS_RETRIES; $attempt++) {
    $job = get_option(UrlTranslationSync::JOB_OPTION, []);
    $job['status'] = 'queued';
    $job['next_run_at'] = 0;
    $job['urls'][0]['next_attempt_at'] = 0;
    update_option(UrlTranslationSync::JOB_OPTION, $job, false);
    $GLOBALS['_dg_sync_responses'][] = ['response' => ['code' => 500], 'headers' => []];
    $sync->run();
}
syncAssert(
    $sync->status()['status'] === 'completed_with_errors' && $sync->status()['failed'] === 1,
    'A URL that makes no progress through the bounded retries must terminate as failed.'
);
$failedSnapshot = array_column($sync->status()['urls'], 'url');
$failedJobId = $sync->status()['id'];
syncAssert($sync->retryFailed(), 'A terminal job with failed URLs must support an explicit retry.');
syncAssert($sync->status()['status'] === 'queued', 'Retrying failed URLs must queue the same snapshot again.');
syncAssert(array_column($sync->status()['urls'], 'url') === $failedSnapshot, 'Retry must preserve the confirmed URL snapshot exactly.');
syncAssert($sync->status()['id'] !== $failedJobId, 'Retry must rotate the job ID so old control-query URLs cannot authorize the new run.');
syncAssert($sync->status()['urls'][0]['state'] === 'pending', 'Only failed items must be reset for retry.');
syncAssert(!$sync->retryFailed(), 'A job without terminal failed items must not be retryable again.');

// 6. Quota and invalid-key markers pause before any page hit.
syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
set_transient('deepglot_quota_exhausted', time(), 60);
$sync->run();
syncAssert($sync->status()['status'] === 'paused_quota', 'An exhausted quota must pause the job.');
syncAssert($GLOBALS['_dg_sync_requests'] === [], 'A quota-paused job must spend no requests.');

syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
set_transient(Client::INVALID_API_KEY_TRANSIENT, time(), 60);
$sync->run();
syncAssert($sync->status()['status'] === 'paused_invalid_key', 'An invalid API key must pause the job.');

syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
set_transient(Client::RATE_LIMIT_TRANSIENT, ['retry_at' => time() + 300], 300);
$sync->run();
syncAssert($sync->status()['status'] === 'backoff_rate_limit', 'A provider rate limit must enter automatic backoff.');
syncAssert($sync->status()['next_run_at'] >= time() + 290, 'Rate-limit backoff must honor the persisted retry time.');
syncAssert($GLOBALS['_dg_sync_requests'] === [], 'Rate-limit backoff must not open more target pages.');

// 7. Pause/resume/cancel and the atomic runner lock are durable controls.
syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
syncAssert($sync->pause(), 'An active job must pause.');
$sync->run();
syncAssert($GLOBALS['_dg_sync_requests'] === [], 'A paused job must not open pages.');
syncAssert($sync->resume(), 'A paused job must resume.');
update_option(UrlTranslationSync::LOCK_OPTION, ['owner' => 'other', 'expires' => time() + 30], false);
$GLOBALS['_dg_sync_scheduled'] = [];
$sync->run();
syncAssert($GLOBALS['_dg_sync_requests'] === [], 'A live atomic lock must prevent duplicate URL hits.');
syncAssert(
    isset($GLOBALS['_dg_sync_scheduled'][UrlTranslationSync::HOOK]),
    'A lock collision must schedule another bounded runner attempt instead of stranding the job.'
);
delete_option(UrlTranslationSync::LOCK_OPTION);
syncAssert($sync->cancel(), 'An active job must cancel.');
syncAssert($sync->status()['status'] === 'cancelled', 'Cancellation must be visible.');
$_GET[UrlTranslationSync::QUERY_ARG] = $sync->status()['id'];
syncAssert(!$sync->isCurrentRequest(), 'A cancelled job token must no longer authorize sync output.');

// A control action landing while the loopback is in flight must win the CAS.
syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
$GLOBALS['_dg_sync_during_request'] = static function () use ($sync): void {
    $sync->pause();
};
$sync->run();
syncAssert(
    $sync->status()['status'] === 'paused',
    'A pause issued during the loopback request must not be overwritten by the runner outcome.'
);

// The init watchdog must not race a fresh runner whose one-shot cron event has
// already been removed while its loopback request is still in flight.
syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
$GLOBALS['_dg_sync_scheduled'] = [];
$sync->register();
syncAssert(isset($GLOBALS['_dg_sync_actions']['init']), 'URL sync must register an init watchdog.');
$GLOBALS['_dg_sync_watchdog_scheduled_during_request'] = null;
$GLOBALS['_dg_sync_during_request'] = static function () use ($sync): void {
    $sync->watchdog();
    $GLOBALS['_dg_sync_watchdog_scheduled_during_request'] = isset(
        $GLOBALS['_dg_sync_scheduled'][UrlTranslationSync::HOOK]
    );
};
$sync->run();
syncAssert(
    $GLOBALS['_dg_sync_watchdog_scheduled_during_request'] === false,
    'Watchdog must not schedule over a runner that still owns the active lock.'
);

// A freshly updated due job also gets a grace window even if its lock has just
// been released; stale due jobs still need watchdog repair.
syncReset();
[$sync] = syncFixture([['loc' => 'https://example.com/a/']]);
syncPreviewAndStart($sync, ['en'], 1);
$GLOBALS['_dg_sync_scheduled'] = [];
$sync->watchdog();
syncAssert(
    !isset($GLOBALS['_dg_sync_scheduled'][UrlTranslationSync::HOOK]),
    'Watchdog must not repair a due job whose state was updated moments ago.'
);
$job = get_option(UrlTranslationSync::JOB_OPTION, []);
$job['updated_at'] = time() - 120;
$job['next_run_at'] = 0;
update_option(UrlTranslationSync::JOB_OPTION, $job, false);
$sync->watchdog();
syncAssert(isset($GLOBALS['_dg_sync_scheduled'][UrlTranslationSync::HOOK]), 'Watchdog must restore missing cron for an overdue active job.');

// If an early retry event still occurs, it must schedule itself at the durable
// next_run_at instead of returning silently and stranding the job.
$job = get_option(UrlTranslationSync::JOB_OPTION, []);
$job['status'] = 'queued';
$job['next_run_at'] = time() + 120;
$job['updated_at'] = time();
update_option(UrlTranslationSync::JOB_OPTION, $job, false);
$GLOBALS['_dg_sync_scheduled'] = [];
$sync->run();
syncAssert(
    (int) ($GLOBALS['_dg_sync_scheduled'][UrlTranslationSync::HOOK] ?? 0) >= $job['next_run_at'],
    'A runner invoked before next_run_at must schedule the durable follow-up event.'
);

fwrite(STDOUT, "UrlTranslationSyncTest: OK\n");
