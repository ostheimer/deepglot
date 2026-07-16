<?php

namespace Deepglot\Frontend;

use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

/**
 * Rewrites internal <a href>, <link href>, <form action> and <img src>
 * attributes to include the active language prefix.
 *
 * Example: href="/blog/post/" → href="/en/blog/post/"
 */
class LinkRewriter
{
    private SiteRouting $routing;

    public function __construct(UrlLanguageResolver|SiteRouting $routing, string $siteUrl = '')
    {
        if ($routing instanceof SiteRouting) {
            $this->routing = $routing;
            return;
        }

        $this->routing = new SiteRouting($routing, $siteUrl, 'PATH_PREFIX', []);
    }

    /**
     * Rewrites all internal links in the HTML document to include $language.
     */
    public function rewrite(\DOMDocument $doc, string $language): void
    {
        $this->rewriteAttribute($doc, 'a',    'href',   $language);
        $this->rewriteAttribute($doc, 'form', 'action', $language);
        // Canonical + alternate links in <head>.
        $this->rewriteLinkTags($doc, $language);
    }

    // -------------------------------------------------------------------------

    private function rewriteAttribute(\DOMDocument $doc, string $tag, string $attr, string $language): void
    {
        $nodes = $doc->getElementsByTagName($tag);

        // Iterate over a static list because modifying live NodeList causes issues.
        $items = [];

        foreach ($nodes as $node) {
            $items[] = $node;
        }

        foreach ($items as $node) {
            if (!$node instanceof \DOMElement) {
                continue;
            }

            $value = $node->getAttribute($attr);

            if ($value === '' || !$this->isInternalUrl($value)) {
                continue;
            }

            // Skip anything inside a `data-deepglot-no-translate` subtree
            // (language switcher, plugin-owned widgets) — those build
            // their own per-language hrefs and must not be re-prefixed.
            if ($this->insideNoTranslateSubtree($node)) {
                continue;
            }

            // Do not rewrite anchors that already carry a language prefix.
            $existing = $this->routing->detectLanguage($value);

            if ($existing !== null) {
                continue;
            }

            $node->setAttribute($attr, $this->routing->rewriteUrl($value, $language));
        }
    }

    /**
     * Walks ancestor-or-self chain looking for an element carrying the
     * `data-deepglot-no-translate` attribute. Mirrors the same opt-out
     * semantics HtmlTranslator uses so the switcher / plugin-owned UI
     * gets consistent treatment across the whole output pipeline.
     */
    private function insideNoTranslateSubtree(\DOMNode $node): bool
    {
        $cursor = $node;
        while ($cursor !== null) {
            if ($cursor instanceof \DOMElement && $cursor->hasAttribute('data-deepglot-no-translate')) {
                return true;
            }
            $cursor = $cursor->parentNode;
        }
        return false;
    }

    private function rewriteLinkTags(\DOMDocument $doc, string $language): void
    {
        $links = $doc->getElementsByTagName('link');
        $items = [];

        foreach ($links as $link) {
            $items[] = $link;
        }

        foreach ($items as $link) {
            if (!$link instanceof \DOMElement) {
                continue;
            }

            $rel  = strtolower($link->getAttribute('rel'));
            $href = $link->getAttribute('href');

            if (in_array($rel, ['canonical', 'shortlink'], true) && $href !== '' && $this->isInternalUrl($href)) {
                $existing = $this->routing->detectLanguage($href);

                if ($existing === null) {
                    $link->setAttribute('href', $this->routing->rewriteUrl($href, $language));
                }
            }
        }
    }

    private function isInternalUrl(string $url): bool
    {
        // Relative URLs are always internal.
        if (!preg_match('#^https?://#i', $url)) {
            return !str_starts_with($url, '//');
        }

        $host = (string) wp_parse_url($url, PHP_URL_HOST);

        return $this->routing->isInternalHost($host);
    }
}
