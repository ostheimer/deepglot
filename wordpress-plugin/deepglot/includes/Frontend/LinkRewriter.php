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
            $normalizedValue = $this->withoutLeadingHtmlWhitespace($value);

            if ($normalizedValue === '' || !$this->isInternalUrl($normalizedValue)) {
                continue;
            }

            // Skip anything inside a `data-deepglot-no-translate` subtree
            // (language switcher, plugin-owned widgets) — those build
            // their own per-language hrefs and must not be re-prefixed.
            if ($this->insideNoTranslateSubtree($node) || $this->insideDeepglotNavMenuItem($node)) {
                continue;
            }

            // Keep deliberate cross-language links untouched. A link already
            // prefixed for the CURRENT language still runs through SiteRouting
            // so stale source slugs from a WPML migration are canonicalized
            // without adding a second language prefix.
            $existing = $this->detectUrlLanguage($normalizedValue);

            if ($existing !== null && $existing !== strtolower(trim($language))) {
                continue;
            }

            $node->setAttribute($attr, $this->routing->rewriteUrl($normalizedValue, $language));
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

    /**
     * NavMenuSwitcher entries own their per-language hrefs but WordPress only
     * exposes them through menu-item classes, not a no-translate wrapper.
     */
    private function insideDeepglotNavMenuItem(\DOMNode $node): bool
    {
        $cursor = $node;
        while ($cursor !== null) {
            if ($cursor instanceof \DOMElement) {
                $classes = preg_split('/\s+/', trim($cursor->getAttribute('class'))) ?: [];

                foreach ($classes as $class) {
                    if ($this->isDeepglotNavMenuClass($class)) {
                        return true;
                    }
                }
            }
            $cursor = $cursor->parentNode;
        }
        return false;
    }

    /**
     * Accepts the native WordPress markers and theme-prefixed variants such as
     * `ubermenu-item-deepglot` and `ubermenu-deepglot-lang-en`.
     */
    private function isDeepglotNavMenuClass(string $class): bool
    {
        return preg_match('/^(?:[a-z0-9_-]*menu)-item-deepglot$/i', $class) === 1
            || preg_match('/^(?:[a-z0-9_-]+-)?deepglot-lang(?:-[a-z0-9_-]+)?$/i', $class) === 1;
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
            $normalizedHref = $this->withoutLeadingHtmlWhitespace($href);

            if (in_array($rel, ['canonical', 'shortlink'], true) && $normalizedHref !== '' && $this->isInternalUrl($normalizedHref)) {
                $existing = $this->detectUrlLanguage($normalizedHref);

                if ($existing === null || $existing === strtolower(trim($language))) {
                    $link->setAttribute('href', $this->routing->rewriteUrl($normalizedHref, $language));
                }
            }
        }
    }

    private function withoutLeadingHtmlWhitespace(string $value): string
    {
        return preg_replace('/^[\t\n\f\r ]+/', '', $value) ?? $value;
    }

    private function isInternalUrl(string $url): bool
    {
        // URI schemes other than HTTP(S) are actions/resources, not site URLs.
        if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $url) && !preg_match('#^https?://#i', $url)) {
            return false;
        }

        // Relative URLs are always internal.
        if (!preg_match('#^https?://#i', $url)) {
            return !str_starts_with($url, '//');
        }

        $host = (string) wp_parse_url($url, PHP_URL_HOST);

        return $this->routing->isInternalHost($host);
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
