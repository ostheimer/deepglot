<?php

namespace Deepglot\Support;

require_once __DIR__ . '/WordPressInfrastructure.php';

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

    public function replaceUrlSlugMappings(array $urlSlugMappings): void
    {
        [$this->urlSlugMappings, $this->reverseUrlSlugMappings] = $this->normalizeUrlSlugMappings($urlSlugMappings);
    }

    public function usesSubdomains(): bool
    {
        foreach (array_keys($this->domainMappings) as $language) {
            if ($this->getSubdomainHostForLanguage((string) $language) !== null) {
                return true;
            }
        }

        return false;
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

        if ($normalizedHost !== '') {
            foreach (array_keys($this->domainMappings) as $lang) {
                $mappedHost = $this->getSubdomainHostForLanguage((string) $lang);
                if ($mappedHost !== null && $normalizedHost === $mappedHost) {
                    return $lang;
                }
            }
        }

        $segments = $this->getPathSegments($uri);
        foreach ($this->resolver->getTargetLanguages() as $language) {
            if ($this->getPathPrefixLanguageIndex($segments, $language) !== null) {
                return $language;
            }
        }

        return null;
    }

    public function getCanonicalPath(string $uri, ?string $language = null): string
    {
        $detectedLanguage = $language !== null
            ? strtolower(trim($language))
            : $this->detectLanguage($uri);
        $segments = $this->getPathSegments($uri);
        $languageIndex = $this->getPathPrefixLanguageIndex(
            $segments,
            (string) $detectedLanguage
        );

        if ($languageIndex !== null) {
            array_splice($segments, $languageIndex, 1);
        }

        return $this->mapPathSegments(
            $this->pathFromSegments($segments),
            $detectedLanguage,
            true
        );
    }

    public function buildUrlForLanguage(string $path, string $language): string
    {
        [$canonicalPath, $query, $fragment] = $this->splitPath($path);
        $canonicalPath = $this->getSiteRelativePath($canonicalPath);
        $normalizedLanguage = strtolower(trim($language));

        if ($normalizedLanguage !== $this->resolver->getSourceLanguage()) {
            $host = $this->getSubdomainHostForLanguage($normalizedLanguage);

            if ($host !== null) {
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
        $localizedUrl = $this->buildUrlForLanguage($path, $language);

        if ($this->usesSubdomains()) {
            return $localizedUrl;
        }

        $localizedPath = (string) parse_url($localizedUrl, PHP_URL_PATH);
        $query = (string) parse_url($localizedUrl, PHP_URL_QUERY);
        $fragment = (string) parse_url($localizedUrl, PHP_URL_FRAGMENT);

        return $this->appendQueryAndFragment($localizedPath, $query, $fragment);
    }

    /**
     * Returns the canonical localized URL when a target-language request uses
     * stale source slugs, or null when the request is already canonical.
     */
    public function getCanonicalRedirectUrl(string $uri, string $host, string $language): ?string
    {
        $normalizedLanguage = strtolower(trim($language));
        if (!in_array($normalizedLanguage, $this->resolver->getTargetLanguages(), true)) {
            return null;
        }

        $requestPath = (string) parse_url($uri, PHP_URL_PATH);
        if ($requestPath === '') {
            $requestPath = '/';
        }

        $query = (string) parse_url($uri, PHP_URL_QUERY);
        $canonicalPath = $this->getCanonicalPath($requestPath, $normalizedLanguage);
        $canonicalUrl = $this->buildUrlForLanguage(
            $this->appendQueryAndFragment($canonicalPath, $query, ''),
            $normalizedLanguage
        );

        $canonicalHost = (string) parse_url($canonicalUrl, PHP_URL_HOST);
        if ($canonicalHost === '' || !$this->isInternalHost($canonicalHost)) {
            return null;
        }

        $canonicalRequestPath = (string) parse_url($canonicalUrl, PHP_URL_PATH);
        if ($canonicalRequestPath === '') {
            $canonicalRequestPath = '/';
        }

        $canonicalQuery = (string) parse_url($canonicalUrl, PHP_URL_QUERY);
        if (
            $this->normalizeHost($host) === $this->normalizeHost($canonicalHost)
            && $requestPath === $canonicalRequestPath
            && $query === $canonicalQuery
        ) {
            return null;
        }

        return $canonicalUrl;
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

        foreach (array_keys($this->domainMappings) as $language) {
            if ($normalizedHost === $this->getSubdomainHostForLanguage((string) $language)) {
                return true;
            }
        }

        return false;
    }

    public function hostsMatch(string $left, string $right): bool
    {
        $normalizedLeft = $this->normalizeHost($left);
        $normalizedRight = $this->normalizeHost($right);

        return $normalizedLeft !== ''
            && $normalizedRight !== ''
            && $normalizedLeft === $normalizedRight;
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
        $sitePath = rtrim((string) parse_url($this->siteUrl, PHP_URL_PATH), '/');

        return $scheme . '://' . $host . $sitePath;
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

            $originalCounts = [];
            foreach ($languageMappings as $originalSlug => $_translatedSlug) {
                $original = $this->normalizeSlugSegment((string) $originalSlug);
                if ($original === '' || WordPressInfrastructure::isReservedSlugSegment($original)) {
                    continue;
                }

                $originalCounts[$original] = ($originalCounts[$original] ?? 0) + 1;
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
                    || WordPressInfrastructure::isReservedSlugSegment($original)
                    || WordPressInfrastructure::isReservedSlugSegment($translated)
                    || ($originalCounts[$original] ?? 0) !== 1
                    || ($translated !== $original && isset($originalCounts[$translated]))
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

        $structuralPathPrefixLength = $this->getStructuralPathPrefixLength(
            $segments,
            $language,
            $skipLanguageSegment
        );

        if ($this->isWordPressInfrastructurePath($segments, $language, $skipLanguageSegment)) {
            return '/' . implode('/', $segments) . '/';
        }

        foreach ($segments as $index => &$segment) {
            if ($index < $structuralPathPrefixLength || ($skipLanguageSegment && $index === 0)) {
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

    /**
     * @param string[] $segments
     */
    private function isWordPressInfrastructurePath(
        array $segments,
        string $language,
        bool $allowRelativeSitePath = false
    ): bool
    {
        $structuralPathPrefixLength = $this->getStructuralPathPrefixLength(
            $segments,
            $language,
            $allowRelativeSitePath
        );
        if ($structuralPathPrefixLength > 0) {
            $segments = array_slice($segments, $structuralPathPrefixLength);
        }

        return WordPressInfrastructure::isInfrastructurePath($segments);
    }

    /**
     * Returns the exact site path plus at most one language segment and one
     * index.php segment. The two optional segments may appear in either order.
     *
     * @param string[] $segments
     */
    private function getStructuralPathPrefixLength(
        array $segments,
        string $language,
        bool $allowRelativeSitePath = false
    ): int
    {
        $siteSegments = $this->getSitePathSegments();
        $sitePathPrefixLength = $this->getSitePathPrefixLength($segments, $siteSegments);

        if ($siteSegments !== [] && $sitePathPrefixLength === 0) {
            if (!$allowRelativeSitePath) {
                return 0;
            }

            $sitePathPrefixLength = 0;
        }

        $prefixLength = $sitePathPrefixLength;
        $skippedLanguage = false;
        $skippedIndex = false;

        while (isset($segments[$prefixLength])) {
            if (
                !$skippedLanguage
                && $this->isPathPrefixLanguageSegment($segments[$prefixLength], $language)
            ) {
                $prefixLength++;
                $skippedLanguage = true;
                continue;
            }

            if (!$skippedIndex && $this->normalizeSlugSegment($segments[$prefixLength]) === 'index.php') {
                $prefixLength++;
                $skippedIndex = true;
                continue;
            }

            break;
        }

        return $prefixLength;
    }

    /**
     * Finds the removable PATH_PREFIX language relative to the exact WordPress
     * site path, with an optional index.php before or after that language.
     *
     * @param string[] $segments
     */
    private function getPathPrefixLanguageIndex(
        array $segments,
        string $language
    ): ?int
    {
        $siteSegments = $this->getSitePathSegments();
        $sitePathPrefixLength = $this->getSitePathPrefixLength($segments, $siteSegments);

        if ($siteSegments !== [] && $sitePathPrefixLength === 0) {
            return null;
        }

        if (
            isset($segments[$sitePathPrefixLength])
            && $this->isPathPrefixLanguageSegment(
                $segments[$sitePathPrefixLength],
                $language
            )
        ) {
            return $sitePathPrefixLength;
        }

        if (
            isset($segments[$sitePathPrefixLength + 1])
            && $this->normalizeSlugSegment($segments[$sitePathPrefixLength]) === 'index.php'
            && $this->isPathPrefixLanguageSegment(
                $segments[$sitePathPrefixLength + 1],
                $language
            )
        ) {
            return $sitePathPrefixLength + 1;
        }

        return null;
    }

    /**
     * @return string[]
     */
    private function getPathSegments(string $path): array
    {
        $parsedPath = (string) parse_url($path, PHP_URL_PATH);

        return array_values(array_filter(
            explode('/', trim($parsedPath, '/')),
            static fn (string $segment): bool => $segment !== ''
        ));
    }

    /**
     * @param string[] $segments
     */
    private function pathFromSegments(array $segments): string
    {
        return $segments === [] ? '/' : '/' . implode('/', $segments) . '/';
    }

    /**
     * @return string[]
     */
    private function getSitePathSegments(): array
    {
        $sitePath = (string) parse_url($this->siteUrl, PHP_URL_PATH);

        return array_values(array_filter(
            explode('/', trim($sitePath, '/')),
            static fn (string $segment): bool => $segment !== ''
        ));
    }

    private function getSiteRelativePath(string $path): string
    {
        $segments = $this->getPathSegments($path);
        $siteSegments = $this->getSitePathSegments();
        $sitePathPrefixLength = $this->getSitePathPrefixLength($segments, $siteSegments);

        if ($siteSegments !== [] && $sitePathPrefixLength === count($siteSegments)) {
            $segments = array_slice($segments, $sitePathPrefixLength);
        }

        return $this->pathFromSegments($segments);
    }

    /**
     * @param string[] $segments
     * @param string[] $siteSegments
     */
    private function getSitePathPrefixLength(array $segments, array $siteSegments): int
    {
        if ($siteSegments === [] || count($segments) < count($siteSegments)) {
            return 0;
        }

        foreach ($siteSegments as $index => $siteSegment) {
            $normalizedSegment = $this->normalizeSlugSegment($segments[$index]);
            $normalizedSiteSegment = $this->normalizeSlugSegment($siteSegment);
            if ($normalizedSegment === '' || $normalizedSegment !== $normalizedSiteSegment) {
                return 0;
            }
        }

        return count($siteSegments);
    }

    private function isPathPrefixLanguageSegment(
        string $segment,
        string $language
    ): bool
    {
        $language = strtolower(trim($language));
        if (
            !in_array($language, $this->resolver->getTargetLanguages(), true)
            || $this->getSubdomainHostForLanguage($language) !== null
        ) {
            return false;
        }

        $normalizedSegment = $this->normalizeSlugSegment($segment);

        return $normalizedSegment !== ''
            && $normalizedSegment === $this->normalizeSlugSegment($language);
    }

    private function getSubdomainHostForLanguage(string $language): ?string
    {
        if ($this->routingMode !== 'SUBDOMAIN') {
            return null;
        }

        $host = $this->domainMappings[strtolower(trim($language))] ?? null;

        return $host ? $host : null;
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
