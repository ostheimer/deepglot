<?php

namespace Deepglot\Frontend;

use Deepglot\Support\UrlLanguageResolver;

/**
 * Rewrites internal <a href>, <link href>, <form action> and <img src>
 * attributes to include the active language prefix.
 *
 * Example: href="/blog/post/" → href="/en/blog/post/"
 */
class LinkRewriter
{
    private UrlLanguageResolver $resolver;
    private string $siteHost;

    public function __construct(UrlLanguageResolver $resolver, string $siteUrl)
    {
        $this->resolver = $resolver;
        $this->siteHost = (string) parse_url($siteUrl, PHP_URL_HOST);
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

            // Do not rewrite anchors that already carry a language prefix.
            $existing = $this->resolver->detectLanguageFromPath($value);

            if ($existing !== null) {
                continue;
            }

            $node->setAttribute($attr, $this->resolver->withLanguage($value, $language));
        }
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
                $existing = $this->resolver->detectLanguageFromPath($href);

                if ($existing === null) {
                    $link->setAttribute('href', $this->resolver->withLanguage($href, $language));
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

        $host = (string) parse_url($url, PHP_URL_HOST);

        return $host === $this->siteHost;
    }
}
