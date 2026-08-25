<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;

/**
 * Replaces explicitly mapped, same-origin images in translated documents.
 */
class MediaRewriter
{
    private const MAX_MAPPINGS = 500;

    private Options $options;

    /** @var array{scheme: string, host: string, port: int}|null */
    private ?array $siteOrigin;

    public function __construct(Options $options, ?string $siteUrl = null)
    {
        $this->options = $options;

        if ($siteUrl === null) {
            $siteUrl = function_exists('get_site_url') ? (string) get_site_url() : '';
        }

        $this->siteOrigin = $this->parseSiteOrigin($siteUrl);
    }

    public function rewrite(\DOMDocument $document, string $targetLanguage): void
    {
        $targetLanguage = strtolower(trim($targetLanguage));

        if (
            $this->siteOrigin === null
            || $targetLanguage === ''
            || $targetLanguage === strtolower(trim($this->options->getSourceLanguage()))
            || !$this->isActiveTargetLanguage($targetLanguage)
        ) {
            return;
        }

        $replacements = $this->safeReplacements($targetLanguage);

        if ($replacements === []) {
            return;
        }

        foreach ($this->elements($document, 'img') as $image) {
            if ($this->insideNoTranslateSubtree($image)) {
                continue;
            }

            $this->rewriteUrlAttribute($image, 'src', $replacements);
            $this->rewriteUrlAttribute($image, 'data-src', $replacements);
            $this->rewriteSrcsetAttribute($image, 'srcset', $replacements);
            $this->rewriteSrcsetAttribute($image, 'data-srcset', $replacements);
        }

        foreach ($this->elements($document, 'source') as $source) {
            $parent = $source->parentNode;

            if (
                !$parent instanceof \DOMElement
                || strtolower($parent->tagName) !== 'picture'
                || $this->insideNoTranslateSubtree($source)
            ) {
                continue;
            }

            $this->rewriteSrcsetAttribute($source, 'srcset', $replacements);
            $this->rewriteSrcsetAttribute($source, 'data-srcset', $replacements);
        }
    }

    /**
     * @return list<\DOMElement>
     */
    private function elements(\DOMDocument $document, string $tag): array
    {
        $elements = [];

        foreach ($document->getElementsByTagName($tag) as $element) {
            if ($element instanceof \DOMElement) {
                $elements[] = $element;
            }
        }

        return $elements;
    }

    private function isActiveTargetLanguage(string $language): bool
    {
        foreach ($this->options->getTargetLanguages() as $targetLanguage) {
            if (is_string($targetLanguage) && strtolower(trim($targetLanguage)) === $language) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string, string>
     */
    private function safeReplacements(string $language): array
    {
        $safe = [];
        $conflicting = [];
        $mappings = array_slice(
            $this->options->getMediaReplacements($language),
            0,
            self::MAX_MAPPINGS,
            true
        );

        foreach ($mappings as $original => $replacement) {
            if (!is_string($original) || !is_string($replacement)) {
                continue;
            }

            $source = $this->parseSameOriginUrl($original);
            $destination = $this->parseSameOriginUrl($replacement);

            if ($source === null || $destination === null) {
                continue;
            }

            $identity = $source['identity'];

            if (isset($conflicting[$identity])) {
                continue;
            }

            if (isset($safe[$identity]) && $safe[$identity] !== $destination['identity']) {
                unset($safe[$identity]);
                $conflicting[$identity] = true;
                continue;
            }

            $safe[$identity] = $destination['identity'];
        }

        return $safe;
    }

    /**
     * @param array<string, string> $replacements
     */
    private function rewriteUrlAttribute(\DOMElement $element, string $attribute, array $replacements): void
    {
        if (!$element->hasAttribute($attribute)) {
            return;
        }

        $replacement = $this->replacementForUrl($element->getAttribute($attribute), $replacements);

        if ($replacement !== null) {
            $element->setAttribute($attribute, $replacement);
        }
    }

    /**
     * @param array<string, string> $replacements
     */
    private function rewriteSrcsetAttribute(\DOMElement $element, string $attribute, array $replacements): void
    {
        if (!$element->hasAttribute($attribute)) {
            return;
        }

        $original = $element->getAttribute($attribute);
        $candidates = explode(',', $original);
        $rewritten = [];
        $changed = false;

        foreach ($candidates as $candidate) {
            if (
                preg_match('/^([\x09\x0a\x0c\x0d\x20]*)([^\x09\x0a\x0c\x0d\x20]+)([\s\S]*)$/D', $candidate, $parts) !== 1
                || !$this->isValidSrcsetDescriptor($parts[3])
                || $this->parseSameOriginUrl($parts[2]) === null
            ) {
                // A partially rewritten malformed srcset changes browser candidate
                // selection unpredictably; leave the complete attribute untouched.
                return;
            }

            $replacement = $this->replacementForUrl($parts[2], $replacements);

            if ($replacement !== null) {
                $rewritten[] = $parts[1] . $replacement . $parts[3];
                $changed = true;
                continue;
            }

            $rewritten[] = $candidate;
        }

        if ($changed) {
            $element->setAttribute($attribute, implode(',', $rewritten));
        }
    }

    private function isValidSrcsetDescriptor(string $suffix): bool
    {
        $descriptor = trim($suffix, " \t\n\r\0\x0B\f");

        if ($descriptor === '') {
            return true;
        }

        if (preg_match('/^[1-9][0-9]*w$/D', $descriptor) === 1) {
            return true;
        }

        if (preg_match('/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)x$/D', $descriptor) !== 1) {
            return false;
        }

        return (float) substr($descriptor, 0, -1) > 0;
    }

    /**
     * @param array<string, string> $replacements
     */
    private function replacementForUrl(string $url, array $replacements): ?string
    {
        $source = $this->parseSameOriginUrl($url);

        if ($source === null || !array_key_exists($source['identity'], $replacements)) {
            return null;
        }

        $replacement = $replacements[$source['identity']];

        return $source['absolute'] ? $source['origin'] . $replacement : $replacement;
    }

    private function insideNoTranslateSubtree(\DOMNode $node): bool
    {
        for ($cursor = $node; $cursor !== null; $cursor = $cursor->parentNode) {
            if (!$cursor instanceof \DOMElement) {
                continue;
            }

            if (
                $cursor->hasAttribute('data-deepglot-no-translate')
                || strtolower(trim($cursor->getAttribute('translate'))) === 'no'
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{scheme: string, host: string, port: int}|null
     */
    private function parseSiteOrigin(string $siteUrl): ?array
    {
        $parts = wp_parse_url($siteUrl);

        if (
            !is_array($parts)
            || !isset($parts['scheme'], $parts['host'])
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['query'])
            || isset($parts['fragment'])
        ) {
            return null;
        }

        $scheme = strtolower((string) $parts['scheme']);

        if ($scheme !== 'http' && $scheme !== 'https') {
            return null;
        }

        return [
            'scheme' => $scheme,
            'host' => strtolower((string) $parts['host']),
            'port' => isset($parts['port']) ? (int) $parts['port'] : $this->defaultPort($scheme),
        ];
    }

    /**
     * @return array{identity: string, absolute: bool, origin: string}|null
     */
    private function parseSameOriginUrl(string $url): ?array
    {
        if (
            $this->siteOrigin === null
            || $url === ''
            || preg_match('/[\x00-\x20\x7f\\\\]/', $url) === 1
            || preg_match('/%(?![a-f0-9]{2})/i', $url) === 1
            || str_starts_with($url, '//')
        ) {
            return null;
        }

        $parts = wp_parse_url($url);

        if (
            !is_array($parts)
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['fragment'])
            || !isset($parts['path'])
        ) {
            return null;
        }

        $absolute = isset($parts['scheme']) || isset($parts['host']) || isset($parts['port']);
        $origin = '';

        if ($absolute) {
            $scheme = strtolower((string) ($parts['scheme'] ?? ''));
            $host = strtolower((string) ($parts['host'] ?? ''));
            $port = isset($parts['port']) ? (int) $parts['port'] : $this->defaultPort($scheme);

            if (
                ($scheme !== 'http' && $scheme !== 'https')
                || $scheme !== $this->siteOrigin['scheme']
                || $host !== $this->siteOrigin['host']
                || $port !== $this->siteOrigin['port']
            ) {
                return null;
            }

            $origin = $scheme . '://' . (string) $parts['host'];

            if (isset($parts['port'])) {
                $origin .= ':' . (int) $parts['port'];
            }
        } elseif (!str_starts_with($url, '/')) {
            return null;
        }

        $path = (string) $parts['path'];

        if (!str_starts_with($path, '/') || !$this->hasSafePathSegments($path)) {
            return null;
        }

        $identity = $path;

        if (isset($parts['query'])) {
            $identity .= '?' . $parts['query'];
        }

        return [
            'identity' => $identity,
            'absolute' => $absolute,
            'origin' => $origin,
        ];
    }

    private function hasSafePathSegments(string $path): bool
    {
        foreach (explode('/', $path) as $segment) {
            $decoded = rawurldecode($segment);

            if (
                $decoded === '.'
                || $decoded === '..'
                || str_contains($decoded, '/')
                || str_contains($decoded, '\\')
                || preg_match('/[\x00-\x1f\x7f]/', $decoded) === 1
                || preg_match('/%(?:2e|2f|5c)/i', $decoded) === 1
            ) {
                return false;
            }
        }

        return true;
    }

    private function defaultPort(string $scheme): int
    {
        return $scheme === 'https' ? 443 : 80;
    }
}
