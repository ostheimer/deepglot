<?php

namespace Deepglot\Support;

defined('ABSPATH') || exit;

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\MultilingualSitemap;

/**
 * Bounded, operator-triggered discovery of target-language pages.
 *
 * This queue deliberately does not translate anything itself. It opens a
 * small number of real localized URLs, which lets HtmlTranslator hand fresh
 * segments to the existing TranslationWarmer. The latter remains the single
 * owner of provider work, quota accounting, retries and page-cache purges.
 */
class UrlTranslationSync
{
    public const HOOK = 'deepglot_sync_urls';
    public const JOB_OPTION = 'deepglot_url_sync_job';
    public const LOCK_OPTION = 'deepglot_url_sync_running';
    public const QUERY_ARG = 'deepglot_url_sync';
    public const PREVIEW_TRANSIENT_PREFIX = 'deepglot_url_sync_preview_';

    public const MAX_URLS = 250;
    public const MAX_SOURCE_OFFSET = 5000;
    public const PREVIEW_SAMPLE_LIMIT = 10;
    public const PREVIEW_TTL = 600;
    public const URLS_PER_RUN = 2;
    public const MAX_PENDING_TEXTS = 500;
    public const MAX_NO_PROGRESS_RETRIES = 4;
    public const MAX_WARM_ROUNDS = 20;
    public const LOCK_TTL = 180;

    private const REQUEST_TIMEOUT = 20;
    private const RESPONSE_SIZE_LIMIT = 65536;
    private const WARM_RECHECK_DELAY = 60;
    private const LOCK_RETRY_DELAY = 10;
    private const WATCHDOG_STALE_AFTER = 60;
    private const SYNC_TOKEN_TTL = 120;

    private Options $options;
    private SiteRouting $routing;
    private MultilingualSitemap $sitemap;
    private TranslationWarmer $warmer;

    public function __construct(
        Options $options,
        SiteRouting $routing,
        MultilingualSitemap $sitemap,
        TranslationWarmer $warmer
    ) {
        $this->options = $options;
        $this->routing = $routing;
        $this->sitemap = $sitemap;
        $this->warmer = $warmer;
    }

    public function register(): void
    {
        add_action(self::HOOK, [$this, 'run']);
        add_action('init', [$this, 'watchdog'], 20);
    }

    /**
     * @param string[] $targetLanguages
     * @return array<string,mixed>|\WP_Error
     */
    public function preview(
        array $targetLanguages,
        int $maxUrls = self::MAX_URLS,
        int $sourceOffset = 0
    )
    {
        $languages = $this->validateSelection($targetLanguages, $maxUrls, $sourceOffset);
        if (is_wp_error($languages)) {
            return $languages;
        }

        // Build one extra target URL to advertise another deterministic batch,
        // but persist only the selected window in the short-lived preview.
        $windowLimit = $sourceOffset + $maxUrls + 1;
        $sourceEntries = $this->sitemap->collectSourceEntries($windowLimit);
        $windowItems = $this->buildSnapshot($sourceEntries, $languages, $windowLimit);
        $items = array_slice($windowItems, $sourceOffset, $maxUrls);
        if ($items === []) {
            return new \WP_Error(
                'deepglot_url_sync_empty',
                __('Es wurden keine sicheren internen URLs gefunden.', 'deepglot'),
                ['status' => 422]
            );
        }

        $now = time();
        $nextSourceOffset = count($windowItems) > $sourceOffset + $maxUrls
            ? $sourceOffset + count($items)
            : null;
        $snapshotHash = $this->snapshotHash($items, $languages, $maxUrls, $sourceOffset);
        $token = bin2hex(random_bytes(32));
        $preview = [
            'snapshot_hash' => $snapshotHash,
            'languages' => $languages,
            'max_urls' => $maxUrls,
            'source_offset' => $sourceOffset,
            'next_source_offset' => $nextSourceOffset,
            'urls' => $items,
            'created_at' => $now,
            'expires_at' => $now + self::PREVIEW_TTL,
        ];

        if (!set_transient($this->previewTransientKey($token), $preview, self::PREVIEW_TTL)) {
            return new \WP_Error(
                'deepglot_url_sync_preview_unavailable',
                __('Die URL-Vorschau konnte nicht gespeichert werden. Bitte versuche es erneut.', 'deepglot'),
                ['status' => 500]
            );
        }

        return [
            'preview_token' => $token,
            'snapshot_hash' => $snapshotHash,
            'languages' => $languages,
            'max_urls' => $maxUrls,
            'source_offset' => $sourceOffset,
            'next_source_offset' => $nextSourceOffset,
            'total' => count($items),
            'sample_urls' => array_slice(array_column($items, 'url'), 0, self::PREVIEW_SAMPLE_LIMIT),
            'expires_at' => $preview['expires_at'],
        ];
    }

    /**
     * @param string[] $targetLanguages
     * @return array<string,mixed>|\WP_Error
     */
    public function start(
        array $targetLanguages,
        int $maxUrls = self::MAX_URLS,
        string $previewToken = '',
        int $sourceOffset = 0
    ) {
        $languages = $this->validateSelection($targetLanguages, $maxUrls, $sourceOffset);
        if (is_wp_error($languages)) {
            return $languages;
        }

        $previewToken = trim($previewToken);
        if ($previewToken === '') {
            return new \WP_Error(
                'deepglot_url_sync_preview_required',
                __('Bestätige zuerst die URL-Vorschau.', 'deepglot'),
                ['status' => 409]
            );
        }

        $lockOwner = $this->acquireLock();
        if ($lockOwner === null) {
            return new \WP_Error(
                'deepglot_url_sync_busy',
                __('Eine URL-Synchronisierung wird gerade verarbeitet.', 'deepglot')
            );
        }

        try {
            $existing = $this->readJob();
            if ($existing !== null && $this->isActiveStatus((string) ($existing['status'] ?? ''))) {
                return new \WP_Error(
                    'deepglot_url_sync_active',
                    __('Es läuft bereits eine URL-Synchronisierung.', 'deepglot')
                );
            }

            $previewKey = $this->previewTransientKey($previewToken);
            $preview = get_transient($previewKey);
            if (!is_array($preview) || (int) ($preview['expires_at'] ?? 0) < time()) {
                return new \WP_Error(
                    'deepglot_url_sync_preview_expired',
                    __('Die URL-Vorschau ist abgelaufen. Erstelle bitte eine neue Vorschau.', 'deepglot'),
                    ['status' => 409]
                );
            }

            $items = isset($preview['urls']) && is_array($preview['urls'])
                ? array_values($preview['urls'])
                : [];
            $matchesSelection = ($preview['languages'] ?? null) === $languages
                && (int) ($preview['max_urls'] ?? 0) === $maxUrls
                && (int) ($preview['source_offset'] ?? 0) === $sourceOffset;
            $matchesSnapshot = isset($preview['snapshot_hash'])
                && hash_equals(
                    (string) $preview['snapshot_hash'],
                    $this->snapshotHash($items, $languages, $maxUrls, $sourceOffset)
                );
            if (!$matchesSelection || !$matchesSnapshot || $items === []) {
                return new \WP_Error(
                    'deepglot_url_sync_preview_mismatch',
                    __('Die bestätigte URL-Vorschau passt nicht mehr zur Auswahl.', 'deepglot'),
                    ['status' => 409]
                );
            }

            $now = time();
            $job = [
                'id' => $this->newJobId(),
                'request_secret' => bin2hex(random_bytes(32)),
                'status' => 'queued',
                'languages' => $languages,
                'source_offset' => $sourceOffset,
                'next_source_offset' => isset($preview['next_source_offset'])
                    ? (int) $preview['next_source_offset']
                    : null,
                'urls' => $items,
                'retry_count' => 0,
                'next_run_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
                'started_at' => null,
                'finished_at' => null,
                'last_error' => null,
            ];

            $this->writeJob($job);
            delete_transient($previewKey);
            $this->schedule(0);

            return $this->publicStatus($job);
        } finally {
            $this->releaseLock($lockOwner);
        }
    }

    /** @return array<string,mixed> */
    public function status(): array
    {
        $job = $this->readJob();

        return $job === null
            ? ['status' => 'idle', 'total' => 0, 'completed' => 0, 'failed' => 0]
            : $this->publicStatus($job);
    }

    public function pause(): bool
    {
        return $this->mutateJob(static function (array $job): array {
            if (!in_array((string) ($job['status'] ?? ''), ['queued', 'running', 'warming', 'backoff_rate_limit'], true)) {
                return $job;
            }

            $job['status'] = 'paused';
            $job['next_run_at'] = 0;
            $job['updated_at'] = time();
            return $job;
        });
    }

    public function resume(): bool
    {
        $changed = $this->mutateJob(static function (array $job): array {
            if (!in_array((string) ($job['status'] ?? ''), [
                'queued', 'running', 'warming', 'backoff_rate_limit', 'paused', 'paused_quota', 'paused_invalid_key',
            ], true)) {
                return $job;
            }

            $job['status'] = 'queued';
            $job['next_run_at'] = time();
            $job['updated_at'] = time();
            $job['last_error'] = null;
            return $job;
        });

        if ($changed) {
            $this->schedule(0);
        }

        return $changed;
    }

    public function cancel(): bool
    {
        return $this->mutateJob(function (array $job): array {
            if (!$this->isActiveStatus((string) ($job['status'] ?? ''))) {
                return $job;
            }

            $job['status'] = 'cancelled';
            $job['next_run_at'] = 0;
            $job['finished_at'] = time();
            $job['updated_at'] = time();
            return $job;
        });
    }

    public function retryFailed(): bool
    {
        $changed = $this->mutateJob(function (array $job): array {
            if ((string) ($job['status'] ?? '') !== 'completed_with_errors') {
                return $job;
            }

            $failed = 0;
            foreach ((array) ($job['urls'] ?? []) as $index => $item) {
                if (!is_array($item) || (string) ($item['state'] ?? '') !== 'failed') {
                    continue;
                }

                $failed++;
                $item['state'] = 'pending';
                $item['attempts'] = 0;
                $item['failure_count'] = 0;
                $item['warm_rounds'] = 0;
                $item['next_attempt_at'] = 0;
                $item['last_error'] = null;
                $job['urls'][$index] = $item;
            }

            if ($failed === 0) {
                return $job;
            }

            $now = time();
            $previousId = (string) ($job['id'] ?? '');
            $job['id'] = $this->newJobId();
            $job['request_secret'] = bin2hex(random_bytes(32));
            $job['retry_of'] = $previousId;
            $job['status'] = 'queued';
            $job['retry_count'] = 0;
            $job['next_run_at'] = $now;
            $job['created_at'] = $now;
            $job['updated_at'] = $now;
            $job['started_at'] = null;
            $job['finished_at'] = null;
            $job['last_error'] = null;
            return $job;
        });

        if ($changed) {
            $this->schedule(0);
        }

        return $changed;
    }

    /** Repairs a due active job if its WP-Cron event was lost or went stale. */
    public function watchdog(): void
    {
        $job = $this->readJob();
        if (
            $job === null
            || !$this->isRunnableStatus((string) ($job['status'] ?? ''))
            || (int) ($job['next_run_at'] ?? 0) > time()
        ) {
            return;
        }

        if (
            $this->hasActiveLock()
            || (int) ($job['updated_at'] ?? 0) >= time() - self::WATCHDOG_STALE_AFTER
        ) {
            return;
        }

        $scheduled = wp_next_scheduled(self::HOOK);
        if (!$scheduled || (int) $scheduled < time() - self::WATCHDOG_STALE_AFTER) {
            $this->schedule(0);
        }
    }

    /**
     * True only for a short-lived HMAC signed control query for the current
     * non-terminal job. A copied job ID or random public query parameter can
     * therefore never opt a response into sync-only headers/cache behaviour.
     */
    public function isCurrentRequest(?string $requestUri = null): bool
    {
        $token = RequestInput::query(self::QUERY_ARG);
        if ($token === '') {
            return false;
        }

        $job = $this->readJob();
        if ($job === null || !$this->isActiveStatus((string) ($job['status'] ?? ''))) {
            return false;
        }

        $parts = explode('.', $token);
        if (count($parts) !== 6) {
            return false;
        }

        [$tokenJobId, $expires, $language, $nonce, $urlHash, $signature] = $parts;
        $jobId = (string) ($job['id'] ?? '');
        $secret = (string) ($job['request_secret'] ?? '');
        if (
            $jobId === ''
            || $secret === ''
            || !hash_equals($jobId, $tokenJobId)
            || !ctype_digit($expires)
            || (int) $expires < time()
            || preg_match('/^[a-z0-9_-]{2,16}$/', $language) !== 1
            || preg_match('/^[a-f0-9]{16}$/', $nonce) !== 1
            || preg_match('/^[a-f0-9]{64}$/', $urlHash) !== 1
            || preg_match('/^[a-f0-9]{64}$/', $signature) !== 1
        ) {
            return false;
        }

        $payload = implode('.', [$tokenJobId, $expires, $language, $nonce, $urlHash]);
        if (!hash_equals(hash_hmac('sha256', $payload, $secret), $signature)) {
            return false;
        }

        $currentIdentity = $this->currentRequestIdentity($requestUri);
        return $currentIdentity !== null
            && hash_equals($urlHash, hash('sha256', $currentIdentity));
    }

    /**
     * Removes only Deepglot's control parameter and preserves the remaining
     * URL, query and fragment for analytics, canonical output and cache purge.
     */
    public function stripQueryArg(string $uri): string
    {
        $parts = wp_parse_url($uri);
        if (!is_array($parts)) {
            return $uri;
        }

        $rawQuery = (string) ($parts['query'] ?? '');
        $queryParts = $rawQuery === '' ? [] : explode('&', $rawQuery);
        $keptQueryParts = array_values(array_filter(
            $queryParts,
            static function (string $part): bool {
                $name = explode('=', $part, 2)[0];
                return rawurldecode($name) !== self::QUERY_ARG;
            }
        ));
        if (count($keptQueryParts) === count($queryParts)) {
            return $uri;
        }

        $result = '';
        if (isset($parts['scheme'])) {
            $result .= $parts['scheme'] . '://';
        }
        if (isset($parts['host'])) {
            $result .= $parts['host'];
            if (isset($parts['port'])) {
                $result .= ':' . (int) $parts['port'];
            }
        }
        $result .= (string) ($parts['path'] ?? '');
        if ($keptQueryParts !== []) {
            $result .= '?' . implode('&', $keptQueryParts);
        }
        if (isset($parts['fragment']) && $parts['fragment'] !== '') {
            $result .= '#' . $parts['fragment'];
        }

        return $result !== '' ? $result : '/';
    }

    /** Cron callback; one run is intentionally small and restart-safe. */
    public function run(): void
    {
        $job = $this->readJob();
        if ($job === null || !$this->isRunnableStatus((string) ($job['status'] ?? ''))) {
            return;
        }

        $now = time();
        $nextRunAt = (int) ($job['next_run_at'] ?? 0);
        if ($nextRunAt > $now) {
            $this->schedule(max(1, $nextRunAt - $now));
            return;
        }

        $lockOwner = $this->acquireLock();
        if ($lockOwner === null) {
            $this->schedule(self::LOCK_RETRY_DELAY);
            return;
        }

        try {
            $job = $this->readJob();
            if ($job === null || !$this->isRunnableStatus((string) ($job['status'] ?? ''))) {
                return;
            }

            if (get_transient('deepglot_quota_exhausted')) {
                $this->pauseFor($job, 'paused_quota', 'quota_exhausted');
                return;
            }

            if (Client::hasInvalidApiKeyMarkerFor($this->options)) {
                $this->pauseFor($job, 'paused_invalid_key', 'invalid_api_key');
                return;
            }

            $rateLimitRetryAt = Client::rateLimitRetryAtForOptions($this->options);
            if ($rateLimitRetryAt > $now) {
                $nextJob = $job;
                $nextJob['status'] = 'backoff_rate_limit';
                $nextJob['last_error'] = 'rate_limited';
                $nextJob['next_run_at'] = $rateLimitRetryAt;
                $nextJob['updated_at'] = $now;
                if ($this->storeJobIfUnchanged($job, $nextJob)) {
                    $this->schedule(max(1, $rateLimitRetryAt - $now));
                }
                return;
            }

            if ($this->pendingTextCount() >= self::MAX_PENDING_TEXTS) {
                $nextJob = $job;
                $nextJob['status'] = 'warming';
                $nextJob['next_run_at'] = $now + self::WARM_RECHECK_DELAY;
                $nextJob['updated_at'] = $now;
                if (!$this->storeJobIfUnchanged($job, $nextJob)) {
                    return;
                }
                $this->ensureWarmerScheduled();
                $this->schedule(self::WARM_RECHECK_DELAY);
                return;
            }

            $nextJob = $job;
            $nextJob['status'] = 'running';
            $nextJob['started_at'] = $job['started_at'] ?? $now;
            $nextJob['updated_at'] = $now;
            if (!$this->storeJobIfUnchanged($job, $nextJob)) {
                return;
            }

            $processed = 0;
            while ($processed < self::URLS_PER_RUN) {
                $job = $this->readJob();
                if ($job === null || (string) ($job['status'] ?? '') !== 'running') {
                    return;
                }

                $index = $this->nextRunnableItemIndex($job, time());
                if ($index === null) {
                    break;
                }

                $item = $job['urls'][$index];
                $response = $this->requestPage(
                    (string) $item['url'],
                    (string) $job['id'],
                    (string) ($item['language'] ?? ''),
                    (string) ($job['request_secret'] ?? '')
                );
                $processed++;

                // An operator may pause or cancel while the HTTP call is in
                // flight. Re-read before committing so that control wins.
                $current = $this->readJob();
                if (
                    $current === null
                    || (string) ($current['id'] ?? '') !== (string) ($job['id'] ?? '')
                    || (string) ($current['status'] ?? '') !== 'running'
                ) {
                    return;
                }

                $this->applyResponse($current, $index, $response);

                if ($this->pendingTextCount() >= self::MAX_PENDING_TEXTS) {
                    break;
                }
            }

            $this->finalizeRun();
        } finally {
            $this->releaseLock($lockOwner);
        }
    }

    /**
     * @param string[] $targetLanguages
     * @return string[]|\WP_Error
     */
    private function validateSelection(array $targetLanguages, int $maxUrls, int $sourceOffset = 0)
    {
        if ($maxUrls < 1 || $maxUrls > self::MAX_URLS) {
            return new \WP_Error(
                'deepglot_url_sync_limit',
                /* translators: %d: maximum number of URLs accepted by one synchronization job. */
                sprintf(__('Es können höchstens %d URLs synchronisiert werden.', 'deepglot'), self::MAX_URLS),
                ['status' => 400]
            );
        }

        if ($sourceOffset < 0 || $sourceOffset > self::MAX_SOURCE_OFFSET) {
            return new \WP_Error(
                'deepglot_url_sync_offset',
                /* translators: %d: maximum target-URL offset accepted for batched synchronization. */
                sprintf(__('Der URL-Startpunkt darf höchstens %d betragen.', 'deepglot'), self::MAX_SOURCE_OFFSET),
                ['status' => 400]
            );
        }

        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return new \WP_Error(
                'deepglot_url_sync_unconfigured',
                __('Deepglot muss aktiviert und vollständig eingerichtet sein.', 'deepglot'),
                ['status' => 409]
            );
        }

        $activeLanguages = array_map('strtolower', $this->options->getTargetLanguages());
        $languages = array_values(array_unique(array_filter(array_map(
            static fn($language): string => strtolower(trim((string) $language)),
            $targetLanguages
        ))));
        sort($languages, SORT_STRING);

        if ($languages === [] || array_diff($languages, $activeLanguages) !== []) {
            return new \WP_Error(
                'deepglot_url_sync_language',
                __('Mindestens eine aktive Zielsprache ist erforderlich.', 'deepglot'),
                ['status' => 400]
            );
        }

        return $languages;
    }

    /**
     * @param array<int,array<string,mixed>> $items
     * @param string[] $languages
     */
    private function snapshotHash(
        array $items,
        array $languages,
        int $maxUrls,
        int $sourceOffset
    ): string
    {
        return hash('sha256', (string) wp_json_encode([
            'languages' => $languages,
            'max_urls' => $maxUrls,
            'source_offset' => $sourceOffset,
            'urls' => $items,
        ]));
    }

    private function previewTransientKey(string $token): string
    {
        return self::PREVIEW_TRANSIENT_PREFIX . hash('sha256', $token);
    }

    /**
     * @param array<int,array{loc:string,lastmod?:string}> $sourceEntries
     * @param string[] $languages
     * @return array<int,array<string,mixed>>
     */
    private function buildSnapshot(array $sourceEntries, array $languages, int $limit): array
    {
        $items = [];
        $seen = [];

        foreach ($sourceEntries as $entry) {
            $sourceUrl = isset($entry['loc']) ? trim((string) $entry['loc']) : '';
            $sourceParts = wp_parse_url($sourceUrl);
            if (!$this->isSafeInternalParts($sourceParts)) {
                continue;
            }

            $relative = (string) ($sourceParts['path'] ?? '/');
            if (isset($sourceParts['query']) && $sourceParts['query'] !== '') {
                $relative .= '?' . $sourceParts['query'];
            }

            foreach ($languages as $language) {
                $targetUrl = $this->routing->buildUrlForLanguage($relative, $language);
                $targetParts = wp_parse_url($targetUrl);
                if (!$this->isSafeInternalParts($targetParts) || isset($seen[$targetUrl])) {
                    continue;
                }

                $seen[$targetUrl] = true;
                $items[] = [
                    'url' => $targetUrl,
                    'language' => $language,
                    'state' => 'pending',
                    'attempts' => 0,
                    'failure_count' => 0,
                    'warm_rounds' => 0,
                    'next_attempt_at' => 0,
                    'last_error' => null,
                ];

                if (count($items) >= $limit) {
                    break 2;
                }
            }
        }

        return $items;
    }

    private function isSafeInternalParts($parts): bool
    {
        if (!is_array($parts)) {
            return false;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = (string) ($parts['host'] ?? '');

        return in_array($scheme, ['http', 'https'], true)
            && $host !== ''
            && !isset($parts['user'])
            && !isset($parts['pass'])
            && $this->routing->isInternalHost($host);
    }

    /** @return array<string,mixed>|\WP_Error */
    private function requestPage(
        string $url,
        string $jobId,
        string $language,
        string $requestSecret
    )
    {
        $requestIdentity = $this->requestIdentity($url);
        if ($requestIdentity === null) {
            return new \WP_Error('deepglot_url_sync_unsafe_request');
        }

        // A new signed nonce for every attempt prevents intermediaries from
        // replaying an earlier cold response or forging sync diagnostics.
        $nonce = substr(hash(
            'sha256',
            $url . '|' . microtime(true) . '|' . uniqid('', true)
        ), 0, 16);
        $payload = implode('.', [
            $jobId,
            (string) (time() + self::SYNC_TOKEN_TTL),
            $language,
            $nonce,
            hash('sha256', $requestIdentity),
        ]);
        $token = $payload . '.' . hash_hmac('sha256', $payload, $requestSecret);
        $requestUrl = $this->appendControlQuery($url, $token);

        return wp_safe_remote_get($requestUrl, [
            'timeout' => self::REQUEST_TIMEOUT,
            'redirection' => 0,
            'sslverify' => true,
            'limit_response_size' => self::RESPONSE_SIZE_LIMIT,
            'user-agent' => 'Mozilla/5.0 (compatible; DeepglotSync/0.12; +https://deepglot.ai)',
            'headers' => [
                'Accept' => 'text/html,application/xhtml+xml',
                'Cache-Control' => 'no-cache, no-store',
            ],
        ]);
    }

    private function currentRequestIdentity(?string $requestUri = null): ?string
    {
        $host = RequestInput::server('HTTP_HOST');
        if ($host === '') {
            return null;
        }

        $uri = $this->stripQueryArg(
            $requestUri ?? RequestInput::server('REQUEST_URI', '/')
        );
        $path = str_starts_with($uri, '/') ? $uri : '/' . $uri;
        return $this->requestIdentity('https://' . $host . $path);
    }

    private function requestIdentity(string $url): ?string
    {
        $parts = wp_parse_url($url);
        if (
            !is_array($parts)
            || empty($parts['host'])
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            return null;
        }

        $host = strtolower(rtrim((string) $parts['host'], '.'));
        $port = isset($parts['port']) ? (int) $parts['port'] : 0;
        $origin = $host;
        if ($port > 0 && $port !== 80 && $port !== 443) {
            $origin .= ':' . $port;
        }

        $path = (string) ($parts['path'] ?? '/');
        if ($path === '') {
            $path = '/';
        } elseif (!str_starts_with($path, '/')) {
            $path = '/' . $path;
        }

        $identity = $origin . $path;
        if (isset($parts['query']) && $parts['query'] !== '') {
            $identity .= '?' . $parts['query'];
        }

        return $identity;
    }

    private function appendControlQuery(string $url, string $token): string
    {
        $fragment = '';
        $fragmentAt = strpos($url, '#');
        if ($fragmentAt !== false) {
            $fragment = substr($url, $fragmentAt);
            $url = substr($url, 0, $fragmentAt);
        }

        if (!str_contains($url, '?')) {
            $separator = '?';
        } elseif (str_ends_with($url, '?') || str_ends_with($url, '&')) {
            $separator = '';
        } else {
            $separator = '&';
        }

        return $url
            . $separator
            . rawurlencode(self::QUERY_ARG)
            . '='
            . rawurlencode($token)
            . $fragment;
    }

    /** @param array<string,mixed> $job */
    private function applyResponse(array $job, int $index, $response): void
    {
        if (!isset($job['urls'][$index]) || !is_array($job['urls'][$index])) {
            return;
        }

        $expectedJob = $job;
        $now = time();
        $item = $job['urls'][$index];
        $item['attempts'] = (int) ($item['attempts'] ?? 0) + 1;

        if (is_wp_error($response)) {
            $this->retryItem($job, $index, $item, 'request_failed', $now);
            return;
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            $error = $code >= 300 && $code < 400
                ? 'redirect_' . $code
                : 'http_' . $code;
            $this->retryItem($job, $index, $item, $error, $now);
            return;
        }

        $pendingHeader = trim((string) wp_remote_retrieve_header(
            $response,
            'x-deepglot-sync-pending-segments'
        ));

        $responseLanguage = trim((string) wp_remote_retrieve_header(
            $response,
            'x-deepglot-sync-language'
        ));
        if (
            $responseLanguage === ''
            || !hash_equals((string) ($item['language'] ?? ''), $responseLanguage)
        ) {
            $this->retryItem($job, $index, $item, 'language_mismatch', $now);
            return;
        }

        if ($pendingHeader === '' || !ctype_digit($pendingHeader)) {
            $this->retryItem($job, $index, $item, 'missing_sync_header', $now);
            return;
        }

        $pending = (int) $pendingHeader;
        if ($pending === 0) {
            $publicStatus = $this->probePublicStatus((string) ($item['url'] ?? ''));
            if (is_wp_error($publicStatus)) {
                $this->retryItem(
                    $job,
                    $index,
                    $item,
                    'public_status_request_failed',
                    $now
                );
                return;
            }

            $publicCode = wp_remote_retrieve_response_code($publicStatus);
            $publicLocation = trim((string) wp_remote_retrieve_header(
                $publicStatus,
                'location'
            ));
            if ($publicCode !== 200 || $publicLocation !== '') {
                $publicError = $publicCode >= 300 && $publicCode < 400
                    ? 'public_status_redirect_' . $publicCode
                    : ($publicCode !== 200
                        ? 'public_status_http_' . $publicCode
                        : 'public_status_location');
                $this->retryItem($job, $index, $item, $publicError, $now);
                return;
            }

            $originStatus = $this->probePublicStatus(
                (string) ($item['url'] ?? ''),
                true
            );
            if (is_wp_error($originStatus)) {
                $this->retryItem(
                    $job,
                    $index,
                    $item,
                    'origin_status_request_failed',
                    $now
                );
                return;
            }

            $originCode = wp_remote_retrieve_response_code($originStatus);
            $originLocation = trim((string) wp_remote_retrieve_header(
                $originStatus,
                'location'
            ));
            if ($originCode !== 200 || $originLocation !== '') {
                $originError = $originCode >= 300 && $originCode < 400
                    ? 'origin_status_redirect_' . $originCode
                    : ($originCode !== 200
                        ? 'origin_status_http_' . $originCode
                        : 'origin_status_location');
                $this->retryItem($job, $index, $item, $originError, $now);
                return;
            }

            $item['failure_count'] = 0;
            $item['state'] = 'completed';
            $item['next_attempt_at'] = 0;
            $item['last_error'] = null;
            $job['urls'][$index] = $item;
            $job['updated_at'] = $now;
            $job['last_error'] = null;
            $this->storeJobIfUnchanged($expectedJob, $job);
            return;
        }

        $item['failure_count'] = 0;
        $item['warm_rounds'] = (int) ($item['warm_rounds'] ?? 0) + 1;
        if ($item['warm_rounds'] > self::MAX_WARM_ROUNDS) {
            $item['state'] = 'failed';
            $item['last_error'] = 'warm_round_limit';
            $item['next_attempt_at'] = 0;
        } else {
            $item['state'] = 'warming';
            $item['last_error'] = null;
            $item['next_attempt_at'] = $now + self::WARM_RECHECK_DELAY;
        }

        $job['urls'][$index] = $item;
        $job['status'] = 'running';
        $job['updated_at'] = $now;
        $job['next_run_at'] = $item['next_attempt_at'];
        $this->storeJobIfUnchanged($expectedJob, $job);
        $this->ensureWarmerScheduled();
    }

    /**
     * Verifies the target without a query string, either through the public
     * cache key or with an invalid login cookie that bypasses the page cache.
     * The bot signature keeps HtmlTranslator cache-only, so neither probe can
     * call a provider or add missing text to TranslationWarmer.
     *
     * @return array<string,mixed>|\WP_Error
     */
    private function probePublicStatus(string $url, bool $bypassPageCache = false)
    {
        $parts = wp_parse_url($url);
        if (!$this->isSafeInternalParts($parts)) {
            return new \WP_Error('deepglot_url_sync_unsafe_status_probe');
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? 'https'));
        $probeUrl = $scheme . '://' . (string) $parts['host'];
        if (isset($parts['port'])) {
            $probeUrl .= ':' . (int) $parts['port'];
        }
        $probeUrl .= (string) ($parts['path'] ?? '/');

        $headers = [
            'Accept' => 'text/html,application/xhtml+xml',
        ];
        if ($bypassPageCache) {
            // WP Engine bypasses its page cache for wordpress_logged_in_*
            // cookies. This static invalid value cannot authenticate to WP.
            $headers['Cookie'] = 'wordpress_logged_in_deepglot_probe=invalid';
        }

        return wp_safe_remote_get($probeUrl, [
            'timeout' => self::REQUEST_TIMEOUT,
            'redirection' => 0,
            'sslverify' => true,
            'limit_response_size' => 1,
            'user-agent' => 'DeepglotCacheProbeBot/0.12 (+https://deepglot.ai)',
            'headers' => $headers,
        ]);
    }

    /** @param array<string,mixed> $job @param array<string,mixed> $item */
    private function retryItem(array $job, int $index, array $item, string $error, int $now): void
    {
        $expectedJob = $job;
        $failureCount = (int) ($item['failure_count'] ?? 0) + 1;
        $item['failure_count'] = $failureCount;
        $job['retry_count'] = (int) ($job['retry_count'] ?? 0) + 1;
        $job['last_error'] = $error;
        $job['updated_at'] = $now;

        if ($failureCount >= self::MAX_NO_PROGRESS_RETRIES) {
            $item['state'] = 'failed';
            $item['next_attempt_at'] = 0;
        } else {
            $item['state'] = 'retry';
            $item['next_attempt_at'] = $now + $this->retryDelay($failureCount);
        }
        $item['last_error'] = $error;
        $job['urls'][$index] = $item;
        $job['next_run_at'] = (int) $item['next_attempt_at'];
        $this->storeJobIfUnchanged($expectedJob, $job);
    }

    private function retryDelay(int $attempt): int
    {
        return match ($attempt) {
            1 => 60,
            2 => 300,
            default => 900,
        };
    }

    /** @param array<string,mixed> $job */
    private function nextRunnableItemIndex(array $job, int $now): ?int
    {
        foreach ((array) ($job['urls'] ?? []) as $index => $item) {
            if (!is_array($item)) {
                continue;
            }

            if (
                in_array((string) ($item['state'] ?? ''), ['pending', 'retry', 'warming'], true)
                && (int) ($item['next_attempt_at'] ?? 0) <= $now
            ) {
                return (int) $index;
            }
        }

        return null;
    }

    private function finalizeRun(): void
    {
        $job = $this->readJob();
        if ($job === null || (string) ($job['status'] ?? '') !== 'running') {
            return;
        }
        $expectedJob = $job;

        $states = array_map(
            static fn($item): string => is_array($item) ? (string) ($item['state'] ?? '') : '',
            (array) ($job['urls'] ?? [])
        );
        $remaining = array_filter($states, static fn(string $state): bool => !in_array($state, ['completed', 'failed'], true));
        $failed = count(array_filter($states, static fn(string $state): bool => $state === 'failed'));

        if ($remaining === []) {
            $job['status'] = $failed > 0 ? 'completed_with_errors' : 'completed';
            $job['finished_at'] = time();
            $job['next_run_at'] = 0;
            $job['updated_at'] = time();
            $this->storeJobIfUnchanged($expectedJob, $job);
            return;
        }

        $nextAttempts = [];
        $hasWarming = false;
        foreach ((array) $job['urls'] as $item) {
            if (!is_array($item) || in_array((string) ($item['state'] ?? ''), ['completed', 'failed'], true)) {
                continue;
            }
            $hasWarming = $hasWarming || (string) ($item['state'] ?? '') === 'warming';
            $nextAttempts[] = max(time() + 1, (int) ($item['next_attempt_at'] ?? 0));
        }

        $job['status'] = $hasWarming ? 'warming' : 'queued';
        $job['next_run_at'] = min($nextAttempts);
        $job['updated_at'] = time();
        $this->storeJobIfUnchanged($expectedJob, $job);
        $this->schedule(max(1, $job['next_run_at'] - time()));
    }

    private function pendingTextCount(): int
    {
        $count = 0;
        foreach ($this->warmer->pending() as $texts) {
            if (is_array($texts)) {
                $count += count($texts);
            }
        }
        return $count;
    }

    /** @param array<string,mixed> $job */
    private function pauseFor(array $job, string $status, string $error): void
    {
        $nextJob = $job;
        $nextJob['status'] = $status;
        $nextJob['last_error'] = $error;
        $nextJob['next_run_at'] = 0;
        $nextJob['updated_at'] = time();
        $this->storeJobIfUnchanged($job, $nextJob);
    }

    private function ensureWarmerScheduled(): void
    {
        $identity = Client::configurationIdentityForOptions($this->options);
        if ($identity === '') {
            return;
        }

        $eventArgs = [$identity];
        if (wp_next_scheduled(TranslationWarmer::HOOK, $eventArgs)) {
            return;
        }

        // Honor a due argument-less event during an upgrade. A future legacy
        // event may belong to an old configuration, so it is safe to wait for
        // it only when the current identity's bounded retry/backoff lasts at
        // least that long. New events are always identity-scoped.
        $legacyScheduledAt = wp_next_scheduled(TranslationWarmer::HOOK);
        if ($legacyScheduledAt) {
            $now = time();
            if ((int) $legacyScheduledAt <= $now) {
                return;
            }

            $backoff = get_option(TranslationWarmer::BACKOFF_OPTION, false);
            $warmerRetryAt = is_array($backoff)
                && ($backoff['identity'] ?? null) === $identity
                ? (int) ($backoff['retry_at'] ?? 0)
                : 0;
            $currentRetryAt = max(
                Client::rateLimitRetryAtForIdentity($identity),
                $warmerRetryAt
            );
            if ($currentRetryAt >= (int) $legacyScheduledAt) {
                return;
            }
        }

        wp_schedule_single_event(time(), TranslationWarmer::HOOK, $eventArgs);
    }

    private function schedule(int $delay): void
    {
        $timestamp = time() + max(0, $delay);
        $scheduled = wp_next_scheduled(self::HOOK);

        if (
            $scheduled
            && (int) $scheduled <= $timestamp
            && (int) $scheduled >= time() - self::WATCHDOG_STALE_AFTER
        ) {
            return;
        }
        if ($scheduled && function_exists('wp_unschedule_event')) {
            wp_unschedule_event((int) $scheduled, self::HOOK);
        }
        wp_schedule_single_event($timestamp, self::HOOK);
    }

    /** @return array<string,mixed>|null */
    private function readJob(): ?array
    {
        $job = get_option(self::JOB_OPTION, false);
        return is_array($job) ? $job : null;
    }

    /** @param array<string,mixed> $job */
    private function writeJob(array $job): void
    {
        update_option(self::JOB_OPTION, $job, false);
        $this->clearOptionCache(self::JOB_OPTION);
    }

    /**
     * Runner-side compare-and-set. If an administrator pauses or cancels in
     * the small window around a loopback request, their newer state wins.
     *
     * @param array<string,mixed> $expected
     * @param array<string,mixed> $next
     */
    private function storeJobIfUnchanged(array $expected, array $next): bool
    {
        return $this->compareAndStoreOption(self::JOB_OPTION, $expected, $next);
    }

    /** @param callable(array<string,mixed>):array<string,mixed> $mutation */
    private function mutateJob(callable $mutation): bool
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $raw = get_option(self::JOB_OPTION, false);
            if (!is_array($raw)) {
                return false;
            }

            $next = $mutation($raw);
            if ($next === $raw) {
                return false;
            }

            if ($this->compareAndStoreOption(self::JOB_OPTION, $raw, $next)) {
                return true;
            }

            $this->clearOptionCache(self::JOB_OPTION);
        }

        return false;
    }

    /** @param array<string,mixed> $job @return array<string,mixed> */
    private function publicStatus(array $job): array
    {
        $states = array_map(
            static fn($item): string => is_array($item) ? (string) ($item['state'] ?? '') : '',
            (array) ($job['urls'] ?? [])
        );
        $job['total'] = count($states);
        $job['completed'] = count(array_filter($states, static fn(string $state): bool => $state === 'completed'));
        $job['failed'] = count(array_filter($states, static fn(string $state): bool => $state === 'failed'));
        $job['warming'] = count(array_filter($states, static fn(string $state): bool => $state === 'warming'));
        unset($job['request_secret']);
        return $job;
    }

    private function isRunnableStatus(string $status): bool
    {
        return in_array($status, ['queued', 'running', 'warming', 'backoff_rate_limit'], true);
    }

    private function isActiveStatus(string $status): bool
    {
        return in_array($status, [
            'queued', 'running', 'warming', 'backoff_rate_limit', 'paused', 'paused_quota', 'paused_invalid_key',
        ], true);
    }

    private function newJobId(): string
    {
        if (function_exists('wp_generate_uuid4')) {
            return wp_generate_uuid4();
        }
        return bin2hex(random_bytes(16));
    }

    private function acquireLock(): ?string
    {
        $owner = $this->newJobId();
        $lock = ['owner' => $owner, 'expires' => time() + self::LOCK_TTL];

        if (add_option(self::LOCK_OPTION, $lock, '', false)) {
            return $owner;
        }

        $current = get_option(self::LOCK_OPTION, false);
        if (is_array($current) && (int) ($current['expires'] ?? 0) > time()) {
            return null;
        }

        if (!$this->compareAndDeleteOption(self::LOCK_OPTION, $current)) {
            return null;
        }

        return add_option(self::LOCK_OPTION, $lock, '', false) ? $owner : null;
    }

    private function hasActiveLock(): bool
    {
        $lock = get_option(self::LOCK_OPTION, false);
        return is_array($lock) && (int) ($lock['expires'] ?? 0) > time();
    }

    private function releaseLock(string $owner): void
    {
        $current = get_option(self::LOCK_OPTION, false);
        if (!is_array($current) || !hash_equals((string) ($current['owner'] ?? ''), $owner)) {
            return;
        }
        $this->compareAndDeleteOption(self::LOCK_OPTION, $current);
    }

    private function compareAndStoreOption(string $option, $expected, array $next): bool
    {
        global $wpdb;

        if (!isset($wpdb) || !is_object($wpdb) || !isset($wpdb->options) || !method_exists($wpdb, 'update')) {
            if (get_option($option, false) !== $expected) {
                return false;
            }
            update_option($option, $next, false);
            return true;
        }

        $expectedStored = function_exists('maybe_serialize') ? maybe_serialize($expected) : serialize($expected);
        $nextStored = function_exists('maybe_serialize') ? maybe_serialize($next) : serialize($next);
        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Atomic option compare-and-set prevents lost pause/cancel updates.
        $changed = $wpdb->update(
            $wpdb->options,
            ['option_value' => $nextStored],
            ['option_name' => $option, 'option_value' => $expectedStored],
            ['%s'],
            ['%s', '%s']
        );
        if ((int) $changed !== 1) {
            return false;
        }
        $this->clearOptionCache($option);
        return true;
    }

    private function compareAndDeleteOption(string $option, $expected): bool
    {
        global $wpdb;

        if (!isset($wpdb) || !is_object($wpdb) || !isset($wpdb->options) || !method_exists($wpdb, 'delete')) {
            if (get_option($option, false) !== $expected) {
                return false;
            }
            return (bool) delete_option($option);
        }

        $expectedStored = function_exists('maybe_serialize') ? maybe_serialize($expected) : serialize($expected);
        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Conditional deletion preserves lock ownership.
        $deleted = $wpdb->delete(
            $wpdb->options,
            ['option_name' => $option, 'option_value' => $expectedStored],
            ['%s', '%s']
        );
        if ((int) $deleted !== 1) {
            return false;
        }
        $this->clearOptionCache($option);
        return true;
    }

    private function clearOptionCache(string $option): void
    {
        if (!function_exists('wp_cache_delete')) {
            return;
        }
        wp_cache_delete($option, 'options');
        wp_cache_delete('alloptions', 'options');
    }
}
