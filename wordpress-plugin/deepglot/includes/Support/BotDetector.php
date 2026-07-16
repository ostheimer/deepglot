<?php

namespace Deepglot\Support;

/**
 * Maps the visitor's user agent to the legacy translate-API `bot` code.
 *
 * The SaaS exempts bot traffic from the word quota and never spends provider
 * calls on it (bots are served from the translation cache only). Until v0.8.2
 * the plugin hardcoded `bot: 0` (human), so crawlers grinding the long-tail
 * archive burned the entire monthly quota (issue #147). Pages humans visit are
 * cached, so crawlers still receive translated content for them.
 *
 * Codes follow the legacy contract (BotType in the SaaS route):
 * 0 human · 1 other bot · 2 Google · 3 Bing · 4 Yahoo · 5 Baidu · 6 Yandex.
 */
class BotDetector
{
    public const HUMAN  = 0;
    public const OTHER  = 1;
    public const GOOGLE = 2;
    public const BING   = 3;
    public const YAHOO  = 4;
    public const BAIDU  = 5;
    public const YANDEX = 6;

    public static function detect(?string $userAgent): int
    {
        $userAgent = strtolower(trim((string) $userAgent));

        if ($userAgent === '') {
            return self::HUMAN;
        }

        if (str_contains($userAgent, 'googlebot') || str_contains($userAgent, 'google-inspectiontool')) {
            return self::GOOGLE;
        }
        if (str_contains($userAgent, 'bingbot') || str_contains($userAgent, 'bingpreview')) {
            return self::BING;
        }
        if (str_contains($userAgent, 'slurp')) {
            return self::YAHOO;
        }
        if (str_contains($userAgent, 'baiduspider')) {
            return self::BAIDU;
        }
        if (str_contains($userAgent, 'yandex')) {
            return self::YANDEX;
        }

        // Generic crawler/tool signatures, mirroring (and extending) the
        // BrowserRedirector bot regex.
        if (preg_match('/bot|crawler|spider|facebookexternalhit|wget|curl|python-requests|httpclient|headless|lighthouse|gtmetrix|ptst/i', $userAgent)) {
            return self::OTHER;
        }

        return self::HUMAN;
    }

    /** Bot code for the current request. */
    public static function detectCurrentRequest(): int
    {
        return self::detect(isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '');
    }
}
