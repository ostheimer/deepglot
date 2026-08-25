<?php

namespace Deepglot\Frontend;

use Deepglot\Api\Client;
use Deepglot\Api\RestApi;
use Deepglot\Config\Options;
use Deepglot\Support\BotDetector;
use Deepglot\Support\RequestInput;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Anonymous, same-origin bridge between rendered target-language pages and the
 * project-authenticated SaaS collector. Bot user agents are checked only in
 * memory; visitor IP addresses are never inspected or included in any state.
 */
class PageViewController
{
    public const ROUTE = '/page-views';
    public const TICKET_HEADER = 'X-Deepglot-Page-View-Ticket';

    /** Seven-day buckets also accept the previous bucket for full-page caches. */
    private const TICKET_WINDOW_SECONDS = 604800;
    private const MAX_PATH_BYTES = 2048;
    private const MAX_BODY_BYTES = 4096;
    private const RATE_LIMIT = 600;
    private const RATE_WINDOW_SECONDS = 60;

    private Options $options;
    private Client $client;

    public function __construct(Options $options, Client $client)
    {
        $this->options = $options;
        $this->client = $client;
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
    }

    public function registerRoutes(): void
    {
        register_rest_route(RestApi::NAMESPACE, self::ROUTE, [
            'methods' => 'POST',
            'callback' => [$this, 'handle'],
            'permission_callback' => [$this, 'permissionCheck'],
            'args' => [
                'eventId' => ['required' => true, 'type' => 'string', 'maxLength' => 36],
                'urlPath' => ['required' => true, 'type' => 'string', 'maxLength' => self::MAX_PATH_BYTES],
                'langTo' => ['required' => true, 'type' => 'string', 'maxLength' => 16],
            ],
        ]);
    }

    public function permissionCheck(WP_REST_Request $request): bool|WP_Error
    {
        if (
            !$this->options->isEnabled()
            || !$this->options->isConfigured()
            || !$this->options->shouldTrackPageViews()
        ) {
            return $this->forbidden(__('Nicht verfügbar.', 'deepglot'));
        }

        if (BotDetector::detectCurrentRequest() !== BotDetector::HUMAN) {
            return $this->forbidden(__('Nicht verfügbar.', 'deepglot'));
        }

        if (!$this->isTrustedRequestHost()) {
            return $this->forbidden(__('Ungültige Herkunft.', 'deepglot'));
        }

        $origin = trim((string) $request->get_header('origin'));
        $referer = trim((string) $request->get_header('referer'));
        if ($origin === '' && $referer === '') {
            return $this->forbidden(__('Ungültige Herkunft.', 'deepglot'));
        }

        if (
            ($origin !== '' && !$this->isAllowedOrigin($origin))
            || ($referer !== '' && !$this->isAllowedOrigin($referer))
        ) {
            return $this->forbidden(__('Ungültige Herkunft.', 'deepglot'));
        }

        $fetchSite = strtolower(trim((string) $request->get_header('sec-fetch-site')));
        if ($fetchSite !== '' && $fetchSite !== 'same-origin') {
            return $this->forbidden(__('Ungültige Herkunft.', 'deepglot'));
        }

        return true;
    }

    public function handle(WP_REST_Request $request): WP_REST_Response
    {
        $permission = $this->permissionCheck($request);
        if (is_wp_error($permission)) {
            return new WP_REST_Response(['tracked' => false], 403);
        }

        $contentLength = RequestInput::server('CONTENT_LENGTH');
        if (
            ($contentLength !== '' && ctype_digit($contentLength) && (int) $contentLength > self::MAX_BODY_BYTES)
            || (method_exists($request, 'get_body') && strlen((string) $request->get_body()) > self::MAX_BODY_BYTES)
        ) {
            return new WP_REST_Response(['tracked' => false], 413);
        }

        $eventId = strtolower(trim((string) $request->get_param('eventId')));
        $urlPath = (string) $request->get_param('urlPath');
        $langTo = strtolower(trim((string) $request->get_param('langTo')));

        if (
            preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $eventId) !== 1
            || !$this->isValidUrlPath($urlPath)
            || $langTo === $this->options->getSourceLanguage()
            || !in_array($langTo, $this->options->getTargetLanguages(), true)
        ) {
            return new WP_REST_Response(['tracked' => false], 400);
        }

        $ticket = trim((string) $request->get_header(self::TICKET_HEADER));
        if (!$this->hasValidTrackingTicket($ticket, $urlPath, $langTo)) {
            return new WP_REST_Response(['tracked' => false], 403);
        }

        if (!$this->withinRateLimit()) {
            return new WP_REST_Response(['tracked' => false], 429);
        }

        $result = $this->client->recordPageView($eventId, $urlPath, $langTo);
        if (is_wp_error($result)) {
            $errorData = $result->get_error_data();
            $upstreamStatus = is_array($errorData) ? (int) ($errorData['status'] ?? 0) : 0;
            $status = in_array($upstreamStatus, [400, 403, 429], true) ? $upstreamStatus : 502;

            return new WP_REST_Response(['tracked' => false], $status);
        }

        $reason = (string) ($result['reason'] ?? $result['status'] ?? '');
        $duplicate = !empty($result['duplicate']) || $reason === 'duplicate';
        $ignored = !empty($result['ignored'])
            || $reason === 'ignored'
            || (array_key_exists('tracked', $result) && $result['tracked'] !== true);

        return new WP_REST_Response([
            'tracked' => !$duplicate && !$ignored,
            'duplicate' => $duplicate,
        ], $duplicate || $ignored ? 200 : 201);
    }

    /** Bind a long-cache-compatible capability to one public path and language. */
    public function issueTrackingTicket(string $urlPath, string $langTo): string
    {
        if (
            !$this->isValidUrlPath($urlPath)
            || !$this->options->shouldTrackPageViews()
            || !$this->isTrustedRequestHost()
        ) {
            return '';
        }

        $bucket = intdiv(time(), self::TICKET_WINDOW_SECONDS);

        return $bucket . '.' . $this->trackingTicketSignature($bucket, $urlPath, strtolower(trim($langTo)));
    }

    private function hasValidTrackingTicket(string $ticket, string $urlPath, string $langTo): bool
    {
        if (preg_match('/^([0-9]{1,12})\.([0-9a-f]{64})$/D', $ticket, $matches) !== 1) {
            return false;
        }

        $bucket = (int) $matches[1];
        $currentBucket = intdiv(time(), self::TICKET_WINDOW_SECONDS);
        if ($bucket > $currentBucket || $bucket < $currentBucket - 1) {
            return false;
        }

        return hash_equals(
            $this->trackingTicketSignature($bucket, $urlPath, $langTo),
            $matches[2]
        );
    }

    private function trackingTicketSignature(int $bucket, string $urlPath, string $langTo): string
    {
        $host = $this->requestHost();
        $signingKey = wp_salt('auth') . "\n" . $this->options->getApiKey();

        return hash_hmac(
            'sha256',
            "deepglot-page-view-v1\n" . $bucket . "\n" . $host . "\n" . $urlPath . "\n" . $langTo,
            $signingKey
        );
    }

    private function isValidUrlPath(string $urlPath): bool
    {
        return $urlPath !== ''
            && strlen($urlPath) <= self::MAX_PATH_BYTES
            && str_starts_with($urlPath, '/')
            && !str_starts_with($urlPath, '//')
            && preg_match('/[\x00-\x1f\x7f?#\\\\]/', $urlPath) !== 1
            && wp_parse_url($urlPath, PHP_URL_PATH) === $urlPath;
    }

    private function isAllowedOrigin(string $value): bool
    {
        $scheme = strtolower((string) wp_parse_url($value, PHP_URL_SCHEME));
        $host = strtolower((string) wp_parse_url($value, PHP_URL_HOST));
        if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
            return false;
        }

        $requestHost = $this->requestHost();

        return $requestHost !== ''
            && $host === $requestHost
            && in_array($requestHost, $this->trustedHosts(), true);
    }

    private function isTrustedRequestHost(): bool
    {
        $requestHost = $this->requestHost();

        return $requestHost !== '' && in_array($requestHost, $this->trustedHosts(), true);
    }

    /** @return string[] Explicit site configuration only; never HTTP_HOST itself. */
    private function trustedHosts(): array
    {
        $allowedHosts = [];
        $homeHost = wp_parse_url(home_url(), PHP_URL_HOST);
        if (is_string($homeHost) && $homeHost !== '') {
            $allowedHosts[] = strtolower($homeHost);
        }

        foreach ($this->options->getDomainMappings() as $mappedHost) {
            if (is_string($mappedHost) && $mappedHost !== '') {
                $allowedHosts[] = strtolower($mappedHost);
            }
        }

        return array_values(array_unique($allowedHosts));
    }

    private function requestHost(): string
    {
        $rawHost = RequestInput::server('HTTP_HOST');
        $parsedHost = $rawHost !== '' ? wp_parse_url('http://' . $rawHost, PHP_URL_HOST) : null;

        return is_string($parsedHost) ? strtolower($parsedHost) : '';
    }

    /**
     * Best-effort site/project bucket; never derive its key from a visitor IP,
     * cookie, user agent, or another personal identifier. The SaaS collector
     * independently enforces the authoritative project-wide velocity limit.
     */
    private function withinRateLimit(): bool
    {
        $projectIdentity = $this->options->getApiBaseUrl()
            . "\n" . $this->options->getApiKey()
            . "\n" . home_url();
        $transientKey = 'deepglot_pgvr_' . hash_hmac('sha256', $projectIdentity, wp_salt('auth'));
        $now = time();
        $bucket = get_transient($transientKey);

        if (!is_array($bucket) || !isset($bucket['reset'], $bucket['count']) || (int) $bucket['reset'] <= $now) {
            $bucket = ['count' => 0, 'reset' => $now + self::RATE_WINDOW_SECONDS];
        }

        if ((int) $bucket['count'] >= self::RATE_LIMIT) {
            return false;
        }

        $bucket['count'] = (int) $bucket['count'] + 1;
        set_transient($transientKey, $bucket, self::RATE_WINDOW_SECONDS + 5);

        return true;
    }

    private function forbidden(string $message): WP_Error
    {
        return new WP_Error('rest_forbidden', $message, ['status' => 403]);
    }
}
