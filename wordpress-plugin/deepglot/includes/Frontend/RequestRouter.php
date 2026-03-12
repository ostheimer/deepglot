<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\UrlLanguageResolver;

/**
 * Strips language prefixes from REQUEST_URI before WordPress routing
 * so /en/page is served as if it were /page, and adds rewrite rules
 * for the language-prefixed slugs.
 */
class RequestRouter
{
    private Options $options;
    private UrlLanguageResolver $resolver;

    /** Language detected for the current request, or null for source language. */
    private ?string $currentLanguage = null;

    public function __construct(Options $options, UrlLanguageResolver $resolver)
    {
        $this->options = $options;
        $this->resolver = $resolver;
    }

    public function register(): void
    {
        // Must run before WordPress parses the request.
        add_action('init', [$this, 'rewriteRequestUri'], 1);
        add_action('init', [$this, 'addRewriteRules'], 2);

        // Flush rewrite rules once after plugin activation.
        add_action('deepglot_flush_rewrite_rules', 'flush_rewrite_rules');
    }

    /** Returns the language code detected for the current request (null = source language). */
    public function getCurrentLanguage(): ?string
    {
        return $this->currentLanguage;
    }

    /**
     * Strips the language prefix from REQUEST_URI so WordPress routes
     * /en/sample-page exactly the same as /sample-page.
     */
    public function rewriteRequestUri(): void
    {
        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return;
        }

        $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $detected = $this->resolver->detectLanguageFromPath($uri);

        if ($detected === null) {
            return;
        }

        $this->currentLanguage = $detected;

        // Strip language prefix so WordPress sees the canonical URL.
        $stripped = $this->resolver->stripLanguageFromPath($uri);

        // Preserve the query string.
        $queryString = parse_url($uri, PHP_URL_QUERY);
        if ($queryString) {
            $stripped = rtrim($stripped, '/') . '/?' . $queryString;
        }

        $_SERVER['REQUEST_URI'] = $stripped;
    }

    /**
     * Registers a catch-all rewrite rule for each target language prefix
     * so WordPress does not 404 on /en/any-slug.
     */
    public function addRewriteRules(): void
    {
        if (!$this->options->isEnabled()) {
            return;
        }

        foreach ($this->options->getTargetLanguages() as $lang) {
            $lang = preg_quote($lang, '#');
            add_rewrite_rule(
                '^' . $lang . '/(.*)$',
                'index.php?deepglot_lang=' . $lang . '&deepglot_path=$matches[1]',
                'top'
            );
        }

        add_rewrite_tag('%deepglot_lang%', '([a-z-]+)');
        add_rewrite_tag('%deepglot_path%', '(.+)');
    }

    /** Flush rewrite rules when languages change (call from settings save). */
    public static function flushRules(): void
    {
        flush_rewrite_rules();
    }
}
