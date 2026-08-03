<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\SiteRouting;

/**
 * Injects hreflang <link> tags into the document <head> for every
 * supported language (source + all target languages) plus x-default.
 *
 * Example output:
 *   <link rel="alternate" hreflang="de" href="https://example.com/blog/" />
 *   <link rel="alternate" hreflang="en" href="https://example.com/en/blog/" />
 *   <link rel="alternate" hreflang="x-default" href="https://example.com/blog/" />
 */
class HreflangInjector
{
    private const FEED_MEDIA_TYPES = [
        'application/rss+xml',
        'application/atom+xml',
        'application/feed+json',
    ];

    private Options $options;
    private SiteRouting $routing;

    public function __construct(Options $options, SiteRouting $routing)
    {
        $this->options  = $options;
        $this->routing  = $routing;
    }

    /**
     * Injects hreflang tags into the <head> element of the document.
     *
     * @param string      $currentPath           The canonical (source-language) path, e.g. "/blog/post/"
     * @param string|null $currentLanguage       Active response language; defaults to the source language.
     * @param bool        $allowFallbackCanonical Whether Deepglot may add a missing canonical.
     */
    public function inject(
        \DOMDocument $doc,
        string $currentPath,
        ?string $currentLanguage = null,
        bool $allowFallbackCanonical = true
    ): void
    {
        $head = $doc->getElementsByTagName('head')->item(0);

        if (!$head instanceof \DOMElement) {
            return;
        }

        $sourceLang  = $this->options->getSourceLanguage();
        $targetLangs = $this->options->getTargetLanguages();

        // Remove any existing hreflang tags to avoid duplicates.
        $this->removeExistingHreflang($head);

        if ($allowFallbackCanonical) {
            $this->ensureCanonical(
                $doc,
                $head,
                $currentPath,
                $currentLanguage ?? $sourceLang
            );
        }

        // Source language (canonical, no prefix).
        $head->appendChild($this->createHreflangTag($doc, $sourceLang, $currentPath));

        // Target languages.
        foreach ($targetLangs as $lang) {
            $head->appendChild($this->createHreflangTag($doc, $lang, $currentPath));
        }

        // x-default = source language URL.
        $head->appendChild($this->createHreflangTag($doc, 'x-default', $currentPath));
    }

    private function createHreflangTag(\DOMDocument $doc, string $hreflang, string $path): \DOMElement
    {
        $link = $doc->createElement('link');
        $link->setAttribute('rel', 'alternate');
        $link->setAttribute('hreflang', $hreflang);
        $language = $hreflang === 'x-default' ? $this->options->getSourceLanguage() : $hreflang;
        $link->setAttribute('href', $this->routing->buildUrlForLanguage($path, $language));

        return $link;
    }

    private function ensureCanonical(
        \DOMDocument $doc,
        \DOMElement $head,
        string $path,
        string $language
    ): void {
        foreach ($head->getElementsByTagName('link') as $link) {
            if ($link instanceof \DOMElement && $this->hasRelToken($link, 'canonical')) {
                return;
            }
        }

        $canonical = $doc->createElement('link');
        $canonical->setAttribute('rel', 'canonical');
        $canonical->setAttribute('href', $this->routing->buildUrlForLanguage($path, $language));
        $head->appendChild($canonical);
    }

    private function removeExistingHreflang(\DOMElement $head): void
    {
        $links = $head->getElementsByTagName('link');
        $toRemove = [];

        foreach ($links as $link) {
            if (
                !$link instanceof \DOMElement
                || !$this->hasRelToken($link, 'alternate')
                || !$link->hasAttribute('hreflang')
                || $this->isFeedDiscoveryLink($link)
            ) {
                continue;
            }

            if ($this->hasRelToken($link, 'canonical')) {
                $tokens = preg_split('/\s+/u', trim($link->getAttribute('rel'))) ?: [];
                $tokens = array_values(array_filter(
                    $tokens,
                    static fn (string $token): bool => strtolower($token) !== 'alternate'
                ));
                $link->setAttribute('rel', implode(' ', $tokens));
                $link->removeAttribute('hreflang');
                continue;
            }

            $toRemove[] = $link;
        }

        foreach ($toRemove as $link) {
            $head->removeChild($link);
        }
    }

    private function hasRelToken(\DOMElement $link, string $expected): bool
    {
        $tokens = preg_split('/\s+/u', strtolower(trim($link->getAttribute('rel')))) ?: [];

        return in_array(strtolower($expected), $tokens, true);
    }

    private function isFeedDiscoveryLink(\DOMElement $link): bool
    {
        $mediaType = strtolower(trim(explode(';', $link->getAttribute('type'), 2)[0]));

        return in_array($mediaType, self::FEED_MEDIA_TYPES, true);
    }
}
