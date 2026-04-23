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
     * @param string $currentPath  The canonical (source-language) path, e.g. "/blog/post/"
     */
    public function inject(\DOMDocument $doc, string $currentPath): void
    {
        $head = $doc->getElementsByTagName('head')->item(0);

        if (!$head instanceof \DOMElement) {
            return;
        }

        $sourceLang  = $this->options->getSourceLanguage();
        $targetLangs = $this->options->getTargetLanguages();

        // Remove any existing hreflang tags to avoid duplicates.
        $this->removeExistingHreflang($head);

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

    private function removeExistingHreflang(\DOMElement $head): void
    {
        $links = $head->getElementsByTagName('link');
        $toRemove = [];

        foreach ($links as $link) {
            if ($link instanceof \DOMElement && strtolower($link->getAttribute('rel')) === 'alternate') {
                $toRemove[] = $link;
            }
        }

        foreach ($toRemove as $link) {
            $head->removeChild($link);
        }
    }
}
