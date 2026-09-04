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
            if ($this->insideNoTranslateSubtree($image) || $this->matchesExcludedSelector($image)) {
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
                || $this->matchesExcludedSelector($source)
            ) {
                continue;
            }

            $replacementMime = $this->replacementMimeForSource($source, $replacements);

            if ($source->hasAttribute('type') && $replacementMime === null) {
                // A typed picture source is selected by its MIME hint before
                // the browser fetches a candidate. Keep the complete source
                // untouched when its rewritten candidate set cannot retain one
                // truthful, supported MIME type.
                continue;
            }

            $this->rewriteSrcsetAttribute($source, 'srcset', $replacements);
            $this->rewriteSrcsetAttribute($source, 'data-srcset', $replacements);

            if ($replacementMime !== null) {
                $source->setAttribute('type', $replacementMime);
            }
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
        $candidates = $this->srcsetCandidates($original);

        if ($candidates === null) {
            // A partially rewritten malformed srcset changes browser candidate
            // selection unpredictably; leave the complete attribute untouched.
            return;
        }

        $rewritten = '';
        $offset = 0;
        $changed = false;

        foreach ($candidates as $candidate) {
            $replacement = $this->replacementForUrl($candidate['url'], $replacements);

            if ($replacement !== null) {
                $rewritten .= substr($original, $offset, $candidate['offset'] - $offset) . $replacement;
                $offset = $candidate['offset'] + strlen($candidate['url']);
                $changed = true;
            }
        }

        if ($changed) {
            $element->setAttribute($attribute, $rewritten . substr($original, $offset));
        }
    }

    /**
     * Returns the MIME type of the complete candidate set after replacements,
     * but only when at least one replacement is available and every resulting
     * candidate across eager and lazy srcsets has the same supported format.
     * Callers leave typed sources entirely untouched on any ambiguity.
     *
     * @param array<string, string> $replacements
     */
    private function replacementMimeForSource(\DOMElement $source, array $replacements): ?string
    {
        if (!$source->hasAttribute('type')) {
            return null;
        }

        $replacementMime = null;
        $replacementSeen = false;

        foreach (['srcset', 'data-srcset'] as $attribute) {
            if (!$source->hasAttribute($attribute)) {
                continue;
            }

            $candidates = $this->srcsetCandidates($source->getAttribute($attribute));

            if ($candidates === null || $candidates === []) {
                return null;
            }

            foreach ($candidates as $candidate) {
                $replacement = $this->replacementForUrl($candidate['url'], $replacements);
                $mime = $this->imageMimeTypeForUrl($replacement ?? $candidate['url']);

                if ($mime === null || ($replacementMime !== null && $replacementMime !== $mime)) {
                    return null;
                }

                $replacementMime = $mime;
                $replacementSeen = $replacementSeen || $replacement !== null;
            }
        }

        return $replacementSeen ? $replacementMime : null;
    }

    private function imageMimeTypeForUrl(string $url): ?string
    {
        $parts = wp_parse_url($url);

        if (!is_array($parts) || !isset($parts['path'])) {
            return null;
        }

        $extension = strtolower(pathinfo((string) $parts['path'], PATHINFO_EXTENSION));

        return match ($extension) {
            'avif' => 'image/avif',
            'gif' => 'image/gif',
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'svg' => 'image/svg+xml',
            'webp' => 'image/webp',
            default => null,
        };
    }

    /**
     * @return list<array{url: string, offset: int}>|null
     */
    private function srcsetCandidates(string $value): ?array
    {
        $length = strlen($value);
        $offset = 0;
        $candidates = [];
        $whitespace = "\x09\x0a\x0c\x0d\x20";

        while ($offset < $length) {
            $offset += strspn($value, $whitespace, $offset);

            if ($offset >= $length || $value[$offset] === ',') {
                return null;
            }

            $urlOffset = $offset;
            $offset += strcspn($value, $whitespace, $offset);
            $token = substr($value, $urlOffset, $offset - $urlOffset);
            $url = rtrim($token, ',');
            $trailingCommas = strlen($token) - strlen($url);

            if (
                $trailingCommas > 1
                || $url === ''
                || $this->parseSameOriginUrl($url) === null
            ) {
                return null;
            }

            $candidates[] = [
                'url' => $url,
                'offset' => $urlOffset,
            ];

            if ($trailingCommas === 1) {
                // HTML's srcset algorithm treats only a trailing comma on the
                // whitespace-delimited URL token as a candidate separator.
                if ($offset >= $length) {
                    return null;
                }

                continue;
            }

            $separator = strpos($value, ',', $offset);
            $descriptorEnd = $separator === false ? $length : $separator;
            $descriptor = substr($value, $offset, $descriptorEnd - $offset);

            if (!$this->isValidSrcsetDescriptor($descriptor)) {
                return null;
            }

            if ($separator === false) {
                return $candidates;
            }

            $offset = $separator + 1;

            if ($offset >= $length) {
                return null;
            }
        }

        return null;
    }

    private function isValidSrcsetDescriptor(string $suffix): bool
    {
        $descriptor = trim($suffix, " \t\n\r\0\x0B\f");

        if ($descriptor === '') {
            return true;
        }

        $tokens = preg_split('/[ \t\n\r\f]+/', $descriptor);

        if (!is_array($tokens) || count($tokens) > 2) {
            return false;
        }

        $width = false;
        $height = false;

        foreach ($tokens as $token) {
            if (preg_match('/^([0-9]+)([wh])$/D', $token, $matches) === 1) {
                if (ltrim($matches[1], '0') === '') {
                    return false;
                }

                if ($matches[2] === 'w') {
                    if ($width) {
                        return false;
                    }

                    $width = true;
                    continue;
                }

                if ($height) {
                    return false;
                }

                $height = true;
                continue;
            }

            if (count($tokens) !== 1) {
                return false;
            }

            if (
                preg_match(
                    '/^((?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)x$/D',
                    $token,
                    $matches
                ) !== 1
            ) {
                return false;
            }

            $density = (float) $matches[1];

            return is_finite($density) && $density > 0;
        }

        return $width && (!$height || count($tokens) === 2);
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

    private function matchesExcludedSelector(\DOMElement $element): bool
    {
        $classSelectors = [];
        $idSelectors = [];

        foreach ($this->options->getExcludedSelectors() as $selector) {
            if (str_starts_with($selector, '.') && strlen($selector) > 1) {
                $classSelectors[] = substr($selector, 1);
            } elseif (str_starts_with($selector, '#') && strlen($selector) > 1) {
                $idSelectors[] = substr($selector, 1);
            }
        }

        for ($cursor = $element; $cursor !== null; $cursor = $cursor->parentNode) {
            if (!$cursor instanceof \DOMElement) {
                continue;
            }

            foreach ($idSelectors as $id) {
                if ($cursor->getAttribute('id') === $id) {
                    return true;
                }
            }

            if ($classSelectors === []) {
                continue;
            }

            $classAttribute = $cursor->getAttribute('class');
            if ($classAttribute === '') {
                continue;
            }

            $classes = preg_split('/\s+/', $classAttribute) ?: [];
            foreach ($classSelectors as $className) {
                if (in_array($className, $classes, true)) {
                    return true;
                }
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
            || preg_match('/[\x00-\x1f\x7f\\\\]/', $url) === 1
            || preg_match('/%(?![a-f0-9]{2})/i', $url) === 1
            || str_starts_with($url, '//')
        ) {
            return null;
        }

        if (preg_match('//u', $url) !== 1) {
            return null;
        }

        // PHP parse_url replaces some valid UTF-8 continuation bytes with
        // underscores. Encode rendered Unicode and spaces before parsing so
        // its path/query identity matches the SaaS WHATWG URL canonicalizer.
        $parseableUrl = preg_replace_callback(
            '/[^\x21-\x7e]/',
            static fn (array $matches): string => rawurlencode($matches[0]),
            $url
        );

        if (!is_string($parseableUrl)) {
            return null;
        }

        $parts = wp_parse_url($parseableUrl);

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

        $identity = $this->canonicalizeUrlComponent($path, false);

        if ($identity === null) {
            return null;
        }

        if (isset($parts['query'])) {
            $query = $this->canonicalizeUrlComponent((string) $parts['query'], true);

            if ($query === null) {
                return null;
            }

            $identity .= '?' . $query;
        }

        return [
            'identity' => $identity,
            'absolute' => $absolute,
            'origin' => $origin,
        ];
    }

    private function canonicalizeUrlComponent(string $value, bool $query): ?string
    {
        if (preg_match('//u', $value) !== 1) {
            return null;
        }

        $pattern = $query
            ? '/[^\x21-\x7e]|["\'<>]/'
            : '/[^\x21-\x7e]|["<>^`{}]/';

        $canonical = preg_replace_callback(
            $pattern,
            static fn (array $matches): string => rawurlencode($matches[0]),
            $value
        );

        if (!is_string($canonical)) {
            return null;
        }

        $canonical = preg_replace_callback(
            '/%[a-f0-9]{2}/i',
            static fn (array $matches): string => strtoupper($matches[0]),
            $canonical
        );

        return is_string($canonical) ? $canonical : null;
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
