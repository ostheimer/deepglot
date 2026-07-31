<?php

namespace Deepglot\Support;

class SiteRouting
{
    private UrlLanguageResolver $resolver;
    private string $siteUrl;
    private string $routingMode;

    /** @var array<string, string> */
    private array $domainMappings;

    /** @var array<string, array<string, string>> */
    private array $urlSlugMappings;

    /** @var array<string, array<string, string>> */
    private array $reverseUrlSlugMappings;

    public function __construct(
        UrlLanguageResolver $resolver,
        string $siteUrl,
        string $routingMode,
        array $domainMappings,
        array $urlSlugMappings = []
    ) {
        $this->resolver = $resolver;
        $this->siteUrl = rtrim($siteUrl, '/');
        $this->routingMode = strtoupper($routingMode) === 'SUBDOMAIN' ? 'SUBDOMAIN' : 'PATH_PREFIX';
        $this->domainMappings = array_map([$this, 'normalizeHost'], $domainMappings);
        [$this->urlSlugMappings, $this->reverseUrlSlugMappings] = $this->normalizeUrlSlugMappings($urlSlugMappings);
    }

    public function usesSubdomains(): bool
    {
        return $this->routingMode === 'SUBDOMAIN' && !empty($this->domainMappings);
    }

    public function getSourceLanguage(): string
    {
        return $this->resolver->getSourceLanguage();
    }

    /**
     * @return string[]
     */
    public function getTargetLanguages(): array
    {
        return $this->resolver->getTargetLanguages();
    }

    public function detectLanguage(string $uri, string $host = ''): ?string
    {
        $normalizedHost = $this->normalizeHost($host);

        if ($this->usesSubdomains() && $normalizedHost !== '') {
            foreach ($this->domainMappings as $lang => $mappedHost) {
                if ($normalizedHost === $mappedHost) {
                    return $lang;
                }
            }
        }

        return $this->resolver->detectLanguageFromPath($uri);
    }

    public function getCanonicalPath(string $uri, ?string $language = null): string
    {
        $detectedLanguage = $language !== null
            ? strtolower(trim($language))
            : $this->resolver->detectLanguageFromPath($uri);
        $canonicalPath = $this->resolver->stripLanguageFromPath($uri);

        return $this->mapPathSegments($canonicalPath, $detectedLanguage, true);
    }

    public function buildUrlForLanguage(string $path, string $language): string
    {
        [$canonicalPath, $query, $fragment] = $this->splitPath($path);
        $normalizedLanguage = strtolower(trim($language));

        if ($this->usesSubdomains() && $normalizedLanguage !== $this->resolver->getSourceLanguage()) {
            $host = $this->domainMappings[$normalizedLanguage] ?? null;

            if ($host) {
                $translatedPath = $this->mapPathSegments($canonicalPath, $normalizedLanguage, false);
                return $this->siteBaseUrlForHost($host) . $this->appendQueryAndFragment($translatedPath, $query, $fragment);
            }
        }

        $localizedPath = $this->resolver->withLanguage($canonicalPath, $normalizedLanguage);
        $localizedPath = $this->mapPathSegments(
            $localizedPath,
            $normalizedLanguage,
            false,
            $normalizedLanguage !== $this->resolver->getSourceLanguage()
        );

        return $this->siteUrl . $this->appendQueryAndFragment($localizedPath, $query, $fragment);
    }

    public function buildHrefForLanguage(string $path, string $language): string
    {
        [$canonicalPath, $query, $fragment] = $this->splitPath($path);

        if ($this->usesSubdomains()) {
            return $this->buildUrlForLanguage($path, $language);
        }

        $normalizedLanguage = strtolower(trim($language));
        $localizedPath = $this->resolver->withLanguage($canonicalPath, $normalizedLanguage);
        $localizedPath = $this->mapPathSegments(
            $localizedPath,
            $normalizedLanguage,
            false,
            $normalizedLanguage !== $this->resolver->getSourceLanguage()
        );

        return $this->appendQueryAndFragment($localizedPath, $query, $fragment);
    }

    public function rewriteUrl(string $url, string $language): string
    {
        if (!preg_match('#^https?://#i', $url)) {
            if (str_starts_with($url, '//')) {
                return $url;
            }

            return $this->buildHrefForLanguage($url, $language);
        }

        $host = (string) parse_url($url, PHP_URL_HOST);

        if (!$this->isInternalHost($host)) {
            return $url;
        }

        $path = (string) parse_url($url, PHP_URL_PATH);
        $query = (string) parse_url($url, PHP_URL_QUERY);
        $fragment = (string) parse_url($url, PHP_URL_FRAGMENT);
        $sourceLanguage = $this->detectLanguage($path ?: '/', $host);
        $canonicalPath = $this->getCanonicalPath($path ?: '/', $sourceLanguage);
        $relative = $this->appendQueryAndFragment($canonicalPath, $query, $fragment);

        return $this->buildUrlForLanguage($relative, $language);
    }

    public function isInternalHost(string $host): bool
    {
        $normalizedHost = $this->normalizeHost($host);
        $sourceHost = $this->normalizeHost((string) parse_url($this->siteUrl, PHP_URL_HOST));

        if ($normalizedHost === '' || $normalizedHost === $sourceHost) {
            return true;
        }

        return in_array($normalizedHost, $this->domainMappings, true);
    }

    private function splitPath(string $path): array
    {
        $parsed = parse_url($path);
        $parsedPath = (string) ($parsed['path'] ?? '/');
        $host = (string) ($parsed['host'] ?? '');
        $language = $this->detectLanguage($parsedPath, $host);
        $canonicalPath = $this->getCanonicalPath($parsedPath, $language);

        return [
            $canonicalPath,
            (string) ($parsed['query'] ?? ''),
            (string) ($parsed['fragment'] ?? ''),
        ];
    }

    private function appendQueryAndFragment(string $path, string $query, string $fragment): string
    {
        $result = $path;

        if ($query !== '') {
            $result .= '?' . $query;
        }

        if ($fragment !== '') {
            $result .= '#' . $fragment;
        }

        return $result;
    }

    private function siteBaseUrlForHost(string $host): string
    {
        $scheme = (string) parse_url($this->siteUrl, PHP_URL_SCHEME) ?: 'https';

        return $scheme . '://' . $host;
    }

    private function normalizeHost(string $host): string
    {
        $host = strtolower(trim($host));

        if ($host === '') {
            return '';
        }

        $parsed = parse_url(str_starts_with($host, 'http') ? $host : 'https://' . $host, PHP_URL_HOST);

        return is_string($parsed) ? strtolower($parsed) : '';
    }

    /**
     * Builds both directions once per request. Ambiguous translated slugs are
     * removed from both maps: emitting an URL that cannot be resolved back to
     * one canonical WordPress path is less safe than keeping the source slug.
     *
     * @return array{0: array<string, array<string, string>>, 1: array<string, array<string, string>>}
     */
    private function normalizeUrlSlugMappings(array $mappings): array
    {
        $forward = [];
        $reverse = [];

        foreach ($mappings as $language => $languageMappings) {
            $language = strtolower(trim((string) $language));
            if ($language === '' || !is_array($languageMappings)) {
                continue;
            }

            $accepted = [];
            $owners = [];
            $ambiguousTranslations = [];
            $ambiguousOriginals = [];
            $seenOriginals = [];

            foreach ($languageMappings as $originalSlug => $translatedSlug) {
                if (!is_string($translatedSlug)) {
                    continue;
                }

                $original = $this->normalizeSlugSegment((string) $originalSlug);
                $translated = $this->normalizeSlugSegment($translatedSlug);

                if (
                    $original === ''
                    || $translated === ''
                    || isset($ambiguousOriginals[$original])
                ) {
                    continue;
                }

                // Distinct raw keys can normalize to the same segment (for
                // example Foo/foo or mixed percent encodings). Treat that as
                // malformed input instead of letting iteration order win.
                if (isset($seenOriginals[$original])) {
                    if (isset($accepted[$original])) {
                        unset($owners[$accepted[$original]], $accepted[$original]);
                    }
                    $ambiguousOriginals[$original] = true;
                    continue;
                }
                $seenOriginals[$original] = true;

                if (isset($ambiguousTranslations[$translated])) {
                    continue;
                }

                if (isset($owners[$translated]) && $owners[$translated] !== $original) {
                    unset($accepted[$owners[$translated]], $owners[$translated]);
                    $ambiguousTranslations[$translated] = true;
                    continue;
                }

                $accepted[$original] = $translated;
                $owners[$translated] = $original;
            }

            if ($accepted === []) {
                continue;
            }

            $forward[$language] = $accepted;
            $reverse[$language] = array_flip($accepted);
        }

        return [$forward, $reverse];
    }

    private function mapPathSegments(
        string $path,
        ?string $language,
        bool $reverse,
        bool $skipLanguageSegment = false
    ): string
    {
        $language = strtolower(trim((string) $language));
        if ($language === '' || $language === $this->resolver->getSourceLanguage()) {
            return $path;
        }

        $mappings = $reverse
            ? ($this->reverseUrlSlugMappings[$language] ?? [])
            : ($this->urlSlugMappings[$language] ?? []);

        if ($mappings === []) {
            return $path;
        }

        $segments = array_values(array_filter(explode('/', trim($path, '/')), static fn (string $segment): bool => $segment !== ''));
        if ($segments === []) {
            return '/';
        }

        foreach ($segments as $index => &$segment) {
            if ($skipLanguageSegment && $index === 0) {
                continue;
            }

            $normalized = $this->normalizeSlugSegment($segment);
            if ($normalized !== '' && isset($mappings[$normalized])) {
                $segment = $mappings[$normalized];
            }
        }
        unset($segment);

        return '/' . implode('/', $segments) . '/';
    }

    private function normalizeSlugSegment(string $slug): string
    {
        $decoded = rawurldecode(trim($slug));
        $decoded = function_exists('mb_strtolower')
            ? mb_strtolower($decoded, 'UTF-8')
            : strtolower($decoded);
        $decoded = preg_replace_callback(
            '/%[0-9a-f]{2}/i',
            static fn (array $match): string => strtoupper($match[0]),
            $decoded
        ) ?? $decoded;

        if (
            $decoded === ''
            || $decoded === '.'
            || $decoded === '..'
            || strlen($decoded) > 200
            || preg_match('//u', $decoded) !== 1
            || preg_match('/[\x00-\x20\x7f\/\\\\?#]/u', $decoded) === 1
        ) {
            return '';
        }

        // Store/emit one canonical encoding. This makes literal Unicode and
        // already percent-encoded input equivalent without double-encoding.
        return rawurlencode($decoded);
    }
}
