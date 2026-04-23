<?php

namespace Deepglot\Support;

class SiteRouting
{
    private UrlLanguageResolver $resolver;
    private string $siteUrl;
    private string $routingMode;

    /** @var array<string, string> */
    private array $domainMappings;

    public function __construct(
        UrlLanguageResolver $resolver,
        string $siteUrl,
        string $routingMode,
        array $domainMappings
    ) {
        $this->resolver = $resolver;
        $this->siteUrl = rtrim($siteUrl, '/');
        $this->routingMode = strtoupper($routingMode) === 'SUBDOMAIN' ? 'SUBDOMAIN' : 'PATH_PREFIX';
        $this->domainMappings = array_map([$this, 'normalizeHost'], $domainMappings);
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

    public function getCanonicalPath(string $uri): string
    {
        return $this->resolver->stripLanguageFromPath($uri);
    }

    public function buildUrlForLanguage(string $path, string $language): string
    {
        [$canonicalPath, $query, $fragment] = $this->splitPath($path);
        $normalizedLanguage = strtolower(trim($language));

        if ($this->usesSubdomains() && $normalizedLanguage !== $this->resolver->getSourceLanguage()) {
            $host = $this->domainMappings[$normalizedLanguage] ?? null;

            if ($host) {
                return $this->siteBaseUrlForHost($host) . $this->appendQueryAndFragment($canonicalPath, $query, $fragment);
            }
        }

        $localizedPath = $this->resolver->withLanguage($canonicalPath, $normalizedLanguage);

        return $this->siteUrl . $this->appendQueryAndFragment($localizedPath, $query, $fragment);
    }

    public function buildHrefForLanguage(string $path, string $language): string
    {
        [$canonicalPath, $query, $fragment] = $this->splitPath($path);

        if ($this->usesSubdomains()) {
            return $this->buildUrlForLanguage($path, $language);
        }

        $localizedPath = $this->resolver->withLanguage($canonicalPath, $language);

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
        $relative = $this->appendQueryAndFragment($path ?: '/', $query, $fragment);

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
        $canonicalPath = $this->resolver->stripLanguageFromPath((string) ($parsed['path'] ?? '/'));

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
}
