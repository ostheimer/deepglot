<?php

namespace Deepglot\Frontend;

use Deepglot\Support\SiteRouting;

/**
 * Localizes links added by dynamic widgets without involving a translation
 * provider. It mirrors LinkRewriter's URL safety and language boundaries.
 */
class DynamicUrlLocalizer
{
    private const MAX_URLS = 200;
    private const MAX_URL_LENGTH = 2048;

    private SiteRouting $routing;

    public function __construct(SiteRouting $routing)
    {
        $this->routing = $routing;
    }

    /**
     * @param array<int, mixed> $urls
     * @return array{from_urls: string[], to_urls: string[]}
     */
    public function localize(array $urls, string $language): array
    {
        $language = strtolower(trim($language));

        if (!in_array($language, $this->routing->getTargetLanguages(), true)) {
            return ['from_urls' => [], 'to_urls' => []];
        }

        $from = [];
        $to = [];
        $seen = [];
        $attempts = 0;

        foreach ($urls as $url) {
            if ($attempts >= self::MAX_URLS) {
                break;
            }
            $attempts++;

            if (!is_string($url)) {
                continue;
            }

            if (
                $url === ''
                || strlen($url) > self::MAX_URL_LENGTH
                || isset($seen[$url])
                || !$this->isInternalPageUrl($url)
                || $this->routing->isWordPressInfrastructureUrl($url)
            ) {
                continue;
            }
            $seen[$url] = true;

            $existingLanguage = $this->detectUrlLanguage($url);

            if ($existingLanguage !== null && $existingLanguage !== $language) {
                continue;
            }

            $localized = $this->routing->rewriteUrl($url, $language);

            if ($localized === $url) {
                continue;
            }

            $from[] = $url;
            $to[] = $localized;
        }

        return ['from_urls' => $from, 'to_urls' => $to];
    }

    private function isInternalPageUrl(string $url): bool
    {
        if ($url[0] === '#' || str_starts_with($url, '//') || str_starts_with($url, '\\')) {
            return false;
        }

        if (!preg_match('#^https?://#i', $url)) {
            // Other schemes (mailto:, tel:, javascript:, …) are actions or
            // resources, never WordPress pages.
            return preg_match('#^[a-z][a-z0-9+.-]*:#i', $url) !== 1;
        }

        $parsed = wp_parse_url($url);
        if (!is_array($parsed)) {
            return false;
        }

        $host = (string) ($parsed['host'] ?? '');

        if (
            $host === ''
            || isset($parsed['user'])
            || isset($parsed['pass'])
            || !$this->routing->isInternalHost($host)
        ) {
            return false;
        }

        return $this->hasConfiguredOrigin($parsed);
    }

    /** @param array<string, mixed> $parsed */
    private function hasConfiguredOrigin(array $parsed): bool
    {
        $scheme = strtolower((string) ($parsed['scheme'] ?? ''));
        $host = strtolower((string) ($parsed['host'] ?? ''));
        $port = $this->effectivePort($scheme, $parsed['port'] ?? null);

        if ($scheme === '' || $host === '' || $port === null) {
            return false;
        }

        $languages = array_merge(
            [$this->routing->getSourceLanguage()],
            $this->routing->getTargetLanguages()
        );

        foreach (array_unique($languages) as $language) {
            $origin = wp_parse_url($this->routing->buildUrlForLanguage('/', $language));

            if (!is_array($origin)) {
                continue;
            }

            $originScheme = strtolower((string) ($origin['scheme'] ?? ''));
            $originHost = strtolower((string) ($origin['host'] ?? ''));
            $originPort = $this->effectivePort($originScheme, $origin['port'] ?? null);

            if ($scheme === $originScheme && $host === $originHost && $port === $originPort) {
                return true;
            }
        }

        return false;
    }

    private function effectivePort(string $scheme, $port): ?int
    {
        if ($port !== null) {
            return is_int($port) || ctype_digit((string) $port) ? (int) $port : null;
        }

        return $scheme === 'https' ? 443 : ($scheme === 'http' ? 80 : null);
    }

    private function detectUrlLanguage(string $url): ?string
    {
        if (preg_match('#^https?://#i', $url)) {
            $path = (string) wp_parse_url($url, PHP_URL_PATH);
            $host = (string) wp_parse_url($url, PHP_URL_HOST);

            return $this->routing->detectLanguage($path !== '' ? $path : '/', $host);
        }

        return $this->routing->detectLanguage($url);
    }
}
