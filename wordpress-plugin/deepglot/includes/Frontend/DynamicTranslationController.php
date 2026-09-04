<?php

namespace Deepglot\Frontend;

use Deepglot\Api\Client;
use Deepglot\Api\RestApi;
use Deepglot\Config\Options;
use Deepglot\Support\BotDetector;
use Deepglot\Support\RequestInput;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\TranslationRules;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Same-origin REST proxy that powers the client-side dynamic-content
 * translator (assets/js/dynamic-translator.js).
 *
 * The browser must never hold the Deepglot API key, so the JS layer posts the
 * strings it discovers to this WordPress endpoint, which translates them with
 * the existing {@see Client} + {@see TranslationCache} (so usage accounting and
 * caching behave exactly like the server-side pass) and returns the same
 * `{from_words, to_words}` contract the SaaS `/api/translate` endpoint uses.
 *
 * Abuse controls (a public page is a public endpoint):
 *  • permission: cross-site Referer + bot user-agents are rejected up front;
 *  • per-IP request rate limit (soft, transient-based);
 *  • cache-first — a missing/stale nonce degrades to cache-only;
 *  • quota spend requires a short-lived server-issued ticket (one per page
 *    load). The REST nonce is public in the page source and Origin/Referer are
 *    trivially spoofable in server-side HTTP clients, so the ticket both proves
 *    the page was actually rendered and caps fresh WORDS per render;
 *  • a per-IP fresh-word window budget bounds total spend per IP.
 *
 * SCOPE / RESIDUAL RISK: these controls are an interim mitigation, not a full
 * fix. Budgets are denominated in words (not segments) so a few long strings
 * cannot slip a large spend past the cap, but the per-IP budget is a soft,
 * non-atomic transient cap and is per-IP only — an attacker rotating IPs, or
 * racing concurrent requests, can still burn the victim's remaining monthly
 * quota early (bounded ultimately by the SaaS 402). The authoritative,
 * site-wide fresh-word velocity limit must live SaaS-side next to the org
 * quota. Tracked as a follow-up; issue #199 stays open until that lands.
 */
class DynamicTranslationController
{
    public const ROUTE = '/translate-dynamic';

    /** Header the browser sends with the per-page quota ticket. */
    public const QUOTA_TICKET_HEADER = 'X-Deepglot-Quota-Ticket';

    /**
     * Fresh (uncached) WORDS a single page-load ticket may spend. Denominated
     * in words, not segments: the SaaS bills words, and one segment may be up
     * to MAX_TEXT_LENGTH chars (hundreds of words), so a segment budget would
     * be far coarser than the quota it protects. See estimateFreshWords().
     */
    public const MAX_FRESH_WORDS_PER_TICKET = 4000;

    /**
     * Ticket lifetime in seconds. Matches the WP REST nonce validity window
     * (~24h) so the ticket never expires before the nonce that accompanies it —
     * otherwise full-page-cached pages (whose nonce + ticket are baked into the
     * cached HTML) would stop translating new content after one hour.
     */
    public const QUOTA_TICKET_TTL = 86400;

    /**
     * Fresh WORDS a single client IP may spend across all tickets within
     * FRESH_BUDGET_WINDOW. A ticket is minted per page render and page renders
     * are free, so the per-ticket cap alone does not limit an attacker who
     * re-fetches the page to mint new tickets — this per-IP window budget does.
     *
     * NOTE: this is a best-effort *soft* cap and a per-IP pre-filter only. It
     * does NOT fully close the quota-drain vector: the counters are non-atomic
     * WP transients (concurrent requests can overshoot), and an attacker
     * rotating IPs (IPv6 /64, cloud egress, botnet) gets a fresh budget per IP.
     * The authoritative, site-wide fresh-word velocity limit belongs SaaS-side
     * next to the org quota / 402 logic — tracked as a follow-up. Sized so a
     * legitimate reader's genuinely-new dynamic content stays well under it.
     */
    public const MAX_FRESH_WORDS_PER_IP = 20000;

    /** Window (seconds) for the per-IP fresh-word budget. */
    public const FRESH_BUDGET_WINDOW = 3600;

    /**
     * Chars-per-word floor for estimateFreshWords(): scripts without spaces
     * (CJK) make str_word_count() return ~0, which would let a huge segment
     * bypass the word budget, so each segment counts at least length / this.
     */
    private const CHARS_PER_WORD = 6;

    /** Max strings accepted per request (mirrors HtmlTranslator::BATCH_SIZE). */
    private const MAX_TEXTS = 200;

    /** Strings longer than this are dropped — UI copy is never this long. */
    private const MAX_TEXT_LENGTH = 5000;

    /** Per-IP rate limit: requests allowed per window. */
    private const RATE_LIMIT = 60;

    /** Rate-limit window in seconds. */
    private const RATE_WINDOW = 60;

    private Options $options;
    private Client $client;
    private TranslationCache $cache;
    private ?DynamicUrlLocalizer $urlLocalizer;

    public function __construct(
        Options $options,
        Client $client,
        TranslationCache $cache,
        ?DynamicUrlLocalizer $urlLocalizer = null
    )
    {
        $this->options      = $options;
        $this->client       = $client;
        $this->cache        = $cache;
        $this->urlLocalizer = $urlLocalizer;
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
    }

    public function registerRoutes(): void
    {
        register_rest_route(RestApi::NAMESPACE, self::ROUTE, [
            'methods'             => 'POST',
            'callback'            => [$this, 'handle'],
            'permission_callback' => [$this, 'permissionCheck'],
            'args'                => [
                'texts' => [
                    'required' => true,
                    'type'     => 'array',
                    'items'    => ['type' => 'string'],
                ],
                'urls' => [
                    'required' => false,
                    'type'     => 'array',
                    'items'    => ['type' => 'string'],
                ],
                'lang_to' => [
                    'required'          => true,
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ],
            ],
        ]);
    }

    // -------------------------------------------------------------------------
    // Request handling
    // -------------------------------------------------------------------------

    public function handle(WP_REST_Request $request): WP_REST_Response
    {
        if (!$this->withinRateLimit()) {
            return new WP_REST_Response([
                'code'    => 'rate_limited',
                'message' => __('Zu viele Anfragen.', 'deepglot'),
            ], 429);
        }

        $texts  = (array) $request->get_param('texts');
        $rawUrls = $request->get_param('urls');
        $urls   = is_array($rawUrls) ? $rawUrls : [];
        $langTo = (string) $request->get_param('lang_to');

        // A valid REST nonce plus a server-issued quota ticket unlocks the
        // quota-spending API path. When the authenticated runtime snapshot has
        // already disabled automatic translation, the call is forced into the
        // SaaS cache-only contract below and therefore needs no spend ticket;
        // the nonce and public-endpoint rate limit remain mandatory.
        $nonceValid = (bool) wp_verify_nonce((string) $request->get_header('X-WP-Nonce'), 'wp_rest');
        $quotaTicket = trim((string) $request->get_header(self::QUOTA_TICKET_HEADER));
        $forceCacheOnly = !$this->options->shouldAutomaticallyTranslate();
        $allowApi = $nonceValid
            && (
                $forceCacheOnly
                || $this->hasValidQuotaTicket($quotaTicket)
            );

        $result = $this->translateTexts($texts, $langTo, $allowApi, $quotaTicket, $forceCacheOnly);

        // Preserve the exact established text-only response shape. Browsers
        // that opt into URL localization always send an array (including an
        // empty one), so they receive the independent URL mapping fields.
        if (is_array($rawUrls)) {
            $result = array_merge($result, $this->localizeUrls($urls, $langTo));
        }

        return new WP_REST_Response($result, 200);
    }

    /**
     * Core translation logic, free of WordPress request plumbing so it can be
     * unit-tested directly.
     *
     * @param  array<int, mixed> $texts
     * @param  bool              $allowApi  When false (no valid nonce/ticket) only
     *                                      cached translations are returned.
     * @param  string            $quotaTicket  Per-page ticket for fresh-word budget.
     * @param  bool|null         $forceCacheOnly  Request-bound runtime decision. Null keeps
     *                                           direct callers backward-compatible.
     * @return array{from_words: string[], to_words: string[], quota_exhausted?: bool, retry_after?: int}
     */
    public function translateTexts(
        array $texts,
        string $langTo,
        bool $allowApi,
        string $quotaTicket = '',
        ?bool $forceCacheOnly = null
    ): array
    {
        $empty = ['from_words' => [], 'to_words' => []];

        if (!$this->options->isEnabled()
            || !$this->options->isConfigured()
            || !$this->options->shouldTranslateDynamicContent()
        ) {
            return $empty;
        }

        $langFrom = $this->options->getSourceLanguage();
        $langTo   = strtolower(trim($langTo));

        if ($langTo === '' || $langTo === $langFrom) {
            return $empty;
        }

        if (!in_array($langTo, $this->options->getTargetLanguages(), true)) {
            return $empty;
        }

        $texts = $this->normalizeTexts($texts);

        if (empty($texts)) {
            return $empty;
        }

        $cached  = $this->cache->getMany($texts, $langFrom, $langTo);
        $missing = array_values(array_filter($texts, static fn(string $t) => !isset($cached[$t])));

        $fresh = [];
        $quotaExhausted = false;
        $retryAfter = 0;
        $forceCacheOnly = $forceCacheOnly ?? !$this->options->shouldAutomaticallyTranslate();

        if ($allowApi && !empty($missing)) {
            // Budgets are denominated in words (what the SaaS bills), not
            // segments, so a handful of very long segments cannot slip a large
            // spend past a segment-counting cap.
            $freshWords = $this->estimateFreshWords($missing);

            // Two independent caps must both allow the spend, otherwise this
            // batch degrades to cache-only:
            //  1. the per-IP window budget (drain pre-filter, since page renders
            //     that mint tickets are free — the per-ticket cap alone cannot
            //     limit a re-fetching attacker), and
            //  2. the per-page ticket budget (provenance + per-render cap).
            // Reserve the per-IP budget first so a failed ticket check does not
            // debit the ticket while dropping the batch (shared-NAT breakage).
            if (!$forceCacheOnly) {
                if (!$this->reserveFreshWordsForIp($freshWords)) {
                    $missing = [];
                } elseif ($quotaTicket !== '' && !$this->reserveFreshWordBudget($quotaTicket, $freshWords)) {
                    $this->releaseFreshWordsForIp($freshWords);
                    $missing = [];
                }
            }

            if (!empty($missing)) {
                // BotType::OTHER is the established wire-level cache-only
                // request. It keeps this ticket-free read safe even if the
                // local false snapshot lags behind a dashboard re-enable.
                $response = $this->client->translate(
                    $missing,
                    $langFrom,
                    $langTo,
                    '',
                    $forceCacheOnly ? BotDetector::OTHER : BotDetector::HUMAN
                );
                $cacheOnlyResponse = $forceCacheOnly
                    || (
                        is_array($response)
                        && ($response['cache_only'] ?? null) === true
                    );

                if (is_wp_error($response)) {
                    $errorData = $response->get_error_data();
                    if (is_array($errorData) && (int) ($errorData['status'] ?? 0) === 402) {
                        // Monthly word quota exhausted (issue #148): flag it so the
                        // browser client stops retrying for this session. Cached
                        // translations below still serve.
                        $quotaExhausted = true;
                    } elseif (is_array($errorData) && (int) ($errorData['status'] ?? 0) === 429) {
                        // Forward only the client's normalized, bounded delay.
                        // The browser queue suppresses new dynamic requests
                        // during this window; it never receives raw headers.
                        $retryAfter = max(1, min(
                            Client::MAX_RATE_LIMIT_BACKOFF,
                            (int) ($errorData['retry_after'] ?? Client::DEFAULT_RATE_LIMIT_BACKOFF)
                        ));
                    }
                } elseif (
                    is_array($response)
                    && isset($response['from_words'], $response['to_words'])
                    && is_array($response['from_words'])
                    && is_array($response['to_words'])
                ) {
                    foreach ($response['from_words'] as $index => $original) {
                        if (isset($response['to_words'][$index]) && is_string($original)) {
                            $translated = (string) $response['to_words'][$index];

                            if ($cacheOnlyResponse && $translated === $original) {
                                continue;
                            }

                            $fresh[$original] = $translated;
                        }
                    }
                }

                if (!empty($fresh)) {
                    $this->cache->setMany($fresh, $langFrom, $langTo);
                }

                if (
                    !$forceCacheOnly
                    && $freshWords > 0
                    && ($cacheOnlyResponse || empty($fresh))
                ) {
                    // SaaS did not deliver any fresh translations (5xx, 429, network,
                    // malformed body, 402, or an explicit cache-only response) — undo
                    // the local budgets so non-spending responses do not poison the
                    // ticket/IP window (shared-NAT breakage, same class as #210).
                    $this->releaseFreshWordsForIp($freshWords);
                    if ($quotaTicket !== '') {
                        $this->releaseFreshWordBudget($quotaTicket, $freshWords);
                    }
                }
            }
        }

        $all = $cached + $fresh;

        $fromWords = [];
        $toWords   = [];

        foreach ($texts as $text) {
            if (isset($all[$text])) {
                $fromWords[] = $text;
                $toWords[]   = $all[$text];
            }
        }

        $result = ['from_words' => $fromWords, 'to_words' => $toWords];

        if ($quotaExhausted) {
            $result['quota_exhausted'] = true;
        }

        if ($retryAfter > 0) {
            $result['retry_after'] = $retryAfter;
        }

        return $result;
    }

    /**
     * Local URL routing is independent of provider translation and quota
     * tickets. The DynamicUrlLocalizer owns all URL count/length validation.
     *
     * @param array<int, mixed> $urls
     * @return array{from_urls: string[], to_urls: string[]}
     */
    private function localizeUrls(array $urls, string $langTo): array
    {
        if (
            $this->urlLocalizer === null
            || !$this->options->isEnabled()
            || !$this->options->isConfigured()
            || !$this->options->shouldTranslateDynamicContent()
        ) {
            return ['from_urls' => [], 'to_urls' => []];
        }

        return $this->urlLocalizer->localize($urls, $langTo);
    }

    // -------------------------------------------------------------------------
    // Permission + rate limiting
    // -------------------------------------------------------------------------

    /**
     * Public endpoint, but only for same-origin human traffic: cross-origin
     * Referer and bot user-agents are rejected before any work happens. Bots
     * already receive the fully server-translated page and never need this.
     */
    public function permissionCheck(WP_REST_Request $request): bool|WP_Error
    {
        if ($this->isBot(RequestInput::server('HTTP_USER_AGENT'))) {
            return new WP_Error('rest_forbidden', __('Nicht verfügbar.', 'deepglot'), ['status' => 403]);
        }

        $referer = (string) $request->get_header('referer');

        if ($referer !== '') {
            $refererHost = wp_parse_url($referer, PHP_URL_HOST);

            if (is_string($refererHost) && !$this->isAllowedHost($refererHost)) {
                return new WP_Error('rest_forbidden', __('Ungültige Herkunft.', 'deepglot'), ['status' => 403]);
            }
        }

        return true;
    }

    /**
     * Same-origin host allow-list. Accepts the host the request actually came
     * in on (so SUBDOMAIN-routed mapped hosts work — there the translated page,
     * and therefore the relative-URL fetch, lives on the mapped host), the
     * canonical site host, and every configured subdomain mapping. A cross-site
     * POST, whose Referer host is none of these, is still rejected.
     */
    private function isAllowedHost(string $host): bool
    {
        $host = strtolower($host);
        $allowed = [];

        $currentHost = RequestInput::server('HTTP_HOST');
        if ($currentHost !== '') {
            $requestHost = wp_parse_url('http://' . $currentHost, PHP_URL_HOST);
            if (is_string($requestHost)) {
                $allowed[] = strtolower($requestHost);
            }
        }

        $homeHost = wp_parse_url(home_url(), PHP_URL_HOST);
        if (is_string($homeHost)) {
            $allowed[] = strtolower($homeHost);
        }

        foreach ($this->options->getDomainMappings() as $mappedHost) {
            if (is_string($mappedHost) && $mappedHost !== '') {
                $allowed[] = strtolower($mappedHost);
            }
        }

        return in_array($host, $allowed, true);
    }

    /**
     * Mint a short-lived quota ticket for one page load. Stored server-side so
     * clients cannot raise the fresh-word budget.
     */
    public static function issueQuotaTicket(): string
    {
        $ticket = bin2hex(random_bytes(16));
        set_transient(
            self::quotaTicketTransientKey($ticket),
            ['spent' => 0, 'max' => self::MAX_FRESH_WORDS_PER_TICKET],
            self::QUOTA_TICKET_TTL
        );

        return $ticket;
    }

    private static function quotaTicketTransientKey(string $ticket): string
    {
        return 'deepglot_dynqt_' . hash('sha256', $ticket);
    }

    private function hasValidQuotaTicket(string $ticket): bool
    {
        if ($ticket === '') {
            return false;
        }

        $bucket = get_transient(self::quotaTicketTransientKey($ticket));

        return is_array($bucket) && isset($bucket['spent'], $bucket['max']);
    }

    /**
     * Estimate the billable word count of the fresh (uncached) segments, with a
     * character-length floor so scripts without spaces (CJK — where
     * str_word_count() returns ~0) cannot smuggle a large spend past the word
     * budget. This mirrors the SaaS billing unit closely enough for a cap; the
     * SaaS remains the authority on the exact charge.
     *
     * @param array<int, string> $segments
     */
    private function estimateFreshWords(array $segments): int
    {
        $words = 0;

        foreach ($segments as $segment) {
            $byWords = str_word_count($segment);
            $byChars = (int) ceil(mb_strlen($segment, 'UTF-8') / self::CHARS_PER_WORD);
            $words  += max(1, $byWords, $byChars);
        }

        return $words;
    }

    /**
     * Reserve fresh-word budget against a page-load ticket before calling SaaS.
     * Returns false (→ cache-only) when the ticket is missing/expired or its
     * per-render budget is exhausted.
     */
    private function reserveFreshWordBudget(string $ticket, int $wordCount): bool
    {
        if ($ticket === '' || $wordCount <= 0) {
            return false;
        }

        $key    = self::quotaTicketTransientKey($ticket);
        $bucket = get_transient($key);

        if (!is_array($bucket) || !isset($bucket['spent'], $bucket['max'])) {
            return false;
        }

        $spent = (int) $bucket['spent'];
        $max   = (int) $bucket['max'];

        if ($spent + $wordCount > $max) {
            return false;
        }

        $bucket['spent'] = $spent + $wordCount;
        set_transient($key, $bucket, self::QUOTA_TICKET_TTL);

        return true;
    }

    /**
     * Reserve fresh-word budget against the client IP for the current window.
     * A best-effort per-IP pre-filter: page renders that mint tickets are free,
     * so the per-ticket cap alone cannot limit a re-fetching attacker, and this
     * bounds total fresh spend per IP. Non-atomic (like the rate limiter) and
     * per-IP only — the authoritative site-wide bound lives SaaS-side. Keyed on
     * a hashed IP; returns false (→ cache-only) once the window budget is spent.
     */
    private function reserveFreshWordsForIp(int $wordCount): bool
    {
        if ($wordCount <= 0) {
            return false;
        }

        $ip        = RequestInput::server('REMOTE_ADDR', 'unknown');
        $transient = 'deepglot_dynfw_' . sha1($ip);
        $now       = time();

        $bucket = get_transient($transient);

        if (!is_array($bucket) || !isset($bucket['reset'], $bucket['spent']) || $bucket['reset'] <= $now) {
            $bucket = ['spent' => 0, 'reset' => $now + self::FRESH_BUDGET_WINDOW];
        }

        if ((int) $bucket['spent'] + $wordCount > self::MAX_FRESH_WORDS_PER_IP) {
            return false;
        }

        $bucket['spent'] = (int) $bucket['spent'] + $wordCount;
        set_transient($transient, $bucket, self::FRESH_BUDGET_WINDOW + 5);

        return true;
    }

    /**
     * Undo a per-page ticket reservation when the SaaS call did not deliver fresh
     * translations, mirroring {@see releaseFreshWordsForIp()}.
     */
    private function releaseFreshWordBudget(string $ticket, int $wordCount): void
    {
        if ($ticket === '' || $wordCount <= 0) {
            return;
        }

        $key    = self::quotaTicketTransientKey($ticket);
        $bucket = get_transient($key);

        if (!is_array($bucket) || !isset($bucket['spent'], $bucket['max'])) {
            return;
        }

        $bucket['spent'] = max(0, (int) $bucket['spent'] - $wordCount);
        set_transient($key, $bucket, self::QUOTA_TICKET_TTL);
    }

    /**
     * Undo a per-IP fresh-word reservation when a later gate (ticket budget)
     * rejects the batch so the IP window is not consumed without a SaaS call.
     */
    private function releaseFreshWordsForIp(int $wordCount): void
    {
        if ($wordCount <= 0) {
            return;
        }

        $ip        = RequestInput::server('REMOTE_ADDR', 'unknown');
        $transient = 'deepglot_dynfw_' . sha1($ip);
        $bucket    = get_transient($transient);

        if (!is_array($bucket) || !isset($bucket['spent'], $bucket['reset'])) {
            return;
        }

        $bucket['spent'] = max(0, (int) $bucket['spent'] - $wordCount);
        set_transient($transient, $bucket, self::FRESH_BUDGET_WINDOW + 5);
    }

    /**
     * Sliding-window per-IP rate limiter, mirroring {@see RestApi::checkRateLimit()}
     * but keyed on a hashed client IP since dynamic-content visitors are
     * anonymous (user id 0).
     */
    private function withinRateLimit(): bool
    {
        $ip        = RequestInput::server('REMOTE_ADDR', 'unknown');
        $transient = 'deepglot_dynrl_' . sha1($ip);
        $now       = time();

        $bucket = get_transient($transient);

        if (!is_array($bucket) || !isset($bucket['reset'], $bucket['count']) || $bucket['reset'] <= $now) {
            $bucket = ['count' => 1, 'reset' => $now + self::RATE_WINDOW];
        } else {
            $bucket['count']++;
        }

        set_transient($transient, $bucket, self::RATE_WINDOW + 5);

        return $bucket['count'] <= self::RATE_LIMIT;
    }

    private function isBot(string $userAgent): bool
    {
        if ($userAgent === '') {
            return false;
        }

        // Mirrors BrowserRedirector::isBotRequest().
        return (bool) preg_match('/bot|crawler|spider|slurp|bingpreview|facebookexternalhit|wget|curl|lighthouse|headlesschrome|gtmetrix|ptst/i', $userAgent);
    }

    /**
     * Filters raw input down to a unique, translation-worthy, length-bounded
     * set of strings, capped at MAX_TEXTS.
     *
     * @param  array<int, mixed> $texts
     * @return string[]
     */
    private function normalizeTexts(array $texts): array
    {
        $clean = [];

        foreach ($texts as $text) {
            if (!is_string($text)) {
                continue;
            }

            if (mb_strlen($text) > self::MAX_TEXT_LENGTH) {
                continue;
            }

            // Gate on the trimmed form (length / numeric-only), but key on the
            // RAW text so the cache key matches the server pass, which caches
            // the untrimmed DOMText value. A dynamic " Hello " then reuses the
            // server's existing entry instead of re-translating a trimmed copy.
            if (!TranslationRules::isTranslatableText(trim($text))) {
                continue;
            }

            $clean[$text] = true;

            if (count($clean) >= self::MAX_TEXTS) {
                break;
            }
        }

        return array_keys($clean);
    }
}
