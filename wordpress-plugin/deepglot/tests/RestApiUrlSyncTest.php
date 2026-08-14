<?php

/** REST contract for the administrator-only URL synchronization controls. */

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}

$GLOBALS['_dg_url_sync_transients'] = [];

function __($text, $domain = null) { return $text; }
function get_current_user_id() { return 42; }
function get_transient($key) { return $GLOBALS['_dg_url_sync_transients'][$key] ?? false; }
function set_transient($key, $value, $ttl = 0) { $GLOBALS['_dg_url_sync_transients'][$key] = $value; return true; }
function is_wp_error($value) { return $value instanceof WP_Error; }

class WP_Error
{
    public function __construct(
        private string $code,
        private string $message = '',
        private array $data = []
    ) {}

    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): array { return $this->data; }
}

class WP_REST_Request
{
    public function __construct(private array $params = []) {}
    public function get_param($key) { return $this->params[$key] ?? null; }
    public function get_json_params() { return $this->params; }
}

class WP_REST_Response
{
    public function __construct(private $data = null, private int $status = 200) {}
    public function get_data() { return $this->data; }
    public function get_status(): int { return $this->status; }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Sync/SettingsSync.php';
require_once __DIR__ . '/../includes/Support/UrlTranslationSync.php';
require_once __DIR__ . '/../includes/Api/RestApi.php';

use Deepglot\Api\RestApi;
use Deepglot\Config\Options;
use Deepglot\Support\UrlTranslationSync;
use Deepglot\Sync\SettingsSync;

class RestUrlSyncFakeSettingsSync extends SettingsSync
{
    public function __construct() {}
}

class RestUrlSyncFake extends UrlTranslationSync
{
    public array $previewedWith = [];
    public array $startedWith = [];
    public string $state = 'idle';
    public int $retryCalls = 0;

    public function __construct() {}
    public function status(): array { return ['status' => $this->state, 'total' => 2]; }
    public function preview(array $targetLanguages, int $maxUrls = self::MAX_URLS, int $sourceOffset = 0)
    {
        $this->previewedWith = [$targetLanguages, $maxUrls, $sourceOffset];
        return [
            'preview_token' => 'preview-token',
            'snapshot_hash' => 'snapshot-hash',
            'total' => 2,
            'sample_urls' => ['https://example.com/en/', 'https://example.com/en/about/'],
        ];
    }
    public function start(
        array $targetLanguages,
        int $maxUrls = self::MAX_URLS,
        string $previewToken = '',
        int $sourceOffset = 0
    )
    {
        $this->startedWith = [$targetLanguages, $maxUrls, $previewToken, $sourceOffset];
        $this->state = 'queued';
        return $this->status();
    }
    public function pause(): bool { $this->state = 'paused'; return true; }
    public function resume(): bool { $this->state = 'queued'; return true; }
    public function cancel(): bool { $this->state = 'cancelled'; return true; }
    public function retryFailed(): bool { $this->retryCalls++; $this->state = 'queued'; return true; }
}

function restSyncAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$sync = new RestUrlSyncFake();
$api = new RestApi(new Options(), new RestUrlSyncFakeSettingsSync(), $sync);

$get = $api->getUrlSync(new WP_REST_Request());
restSyncAssert($get->get_status() === 200 && $get->get_data()['status'] === 'idle', 'GET must expose the durable sync status.');

$preview = $api->previewUrlSync(new WP_REST_Request([
    'target_languages' => ['en'],
    'max_urls' => 25,
    'source_offset' => 50,
]));
restSyncAssert($preview->get_status() === 200, 'Previewing a safe snapshot must return 200 without starting a job.');
restSyncAssert($sync->previewedWith === [['en'], 25, 50] && $sync->state === 'idle', 'Preview must pass selection and source offset without starting it.');
restSyncAssert($preview->get_data()['preview_token'] === 'preview-token', 'REST preview must return the server-side confirmation token.');

$start = $api->startUrlSync(new WP_REST_Request([
    'target_languages' => ['en'],
    'max_urls' => 25,
    'preview_token' => 'preview-token',
    'source_offset' => 50,
]));
restSyncAssert($start->get_status() === 202, 'Starting a sync must return 202.');
restSyncAssert($sync->startedWith === [['en'], 25, 'preview-token', 50], 'Start must pass the exact preview token with the validated selection and source offset.');

$pause = $api->pauseUrlSync(new WP_REST_Request());
restSyncAssert($pause->get_status() === 200 && $pause->get_data()['job']['status'] === 'paused', 'Pause must return the new status.');

$resume = $api->resumeUrlSync(new WP_REST_Request());
restSyncAssert($resume->get_status() === 200 && $resume->get_data()['job']['status'] === 'queued', 'Resume must return the new status.');

$cancel = $api->cancelUrlSync(new WP_REST_Request());
restSyncAssert($cancel->get_status() === 200 && $cancel->get_data()['job']['status'] === 'cancelled', 'DELETE control must cancel the active job.');

$retry = $api->retryFailedUrlSync(new WP_REST_Request());
restSyncAssert($retry->get_status() === 200 && $sync->retryCalls === 1, 'REST must expose an explicit failed-URL retry on the unchanged snapshot.');

$unavailable = new RestApi(new Options(), new RestUrlSyncFakeSettingsSync());
$notImplemented = $unavailable->getUrlSync(new WP_REST_Request());
restSyncAssert($notImplemented->get_status() === 501, 'Older integrations without the sync service must fail closed.');

fwrite(STDOUT, "RestApiUrlSyncTest: OK\n");
