<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\RequestInput;
use Deepglot\Support\SiteRouting;

/**
 * Strips language prefixes from REQUEST_URI before WordPress routing
 * so /en/page is served as if it were /page, and adds rewrite rules
 * for the language-prefixed slugs.
 */
class RequestRouter
{
    private Options $options;
    private SiteRouting $routing;

    /** Language detected for the current request, or null for source language. */
    private ?string $currentLanguage = null;

    /** Original REQUEST_URI before we strip the language prefix. */
    private ?string $originalRequestUri = null;

    /** Canonical localized URL when a request uses stale source slugs. */
    private ?string $canonicalRedirectUrl = null;

    public function __construct(Options $options, SiteRouting $routing)
    {
        $this->options = $options;
        $this->routing = $routing;
    }

    public function register(): void
    {
        // Rewrite REQUEST_URI as early as possible – before WP parses the request.
        add_action('plugins_loaded', [$this, 'rewriteRequestUri'], 1);
        add_action('init', [$this, 'addRewriteRules'], 2);

        // Prevent WordPress and Yoast SEO from issuing a canonical redirect
        // when a language prefix is active (we already served the right content).
        add_filter('redirect_canonical',       [$this, 'preventCanonicalRedirect']);
        add_filter('wpseo_redirect_canonical', [$this, 'preventCanonicalRedirect']);
        // Block wp_redirect only when it strips our language prefix.
        add_filter('wp_redirect',      [$this, 'preventLanguageStrippingRedirect']);
        add_filter('wp_safe_redirect', [$this, 'preventLanguageStrippingRedirect']);
        add_filter('allowed_redirect_hosts', [$this, 'allowInternalRedirectHost'], 10, 2);

        // Redirect stale WPML-era source slugs before the translated response
        // is rendered, but after WordPress has resolved the canonical source.
        add_action('template_redirect', [$this, 'redirectCanonicalSlug'], -50);

        // Belt-and-suspenders: remove the WP core canonical redirect action before
        // it runs (priority 10) when a language prefix is active.
        add_action('template_redirect', [$this, 'removeCanonicalRedirects'], 1);

        // Flush rewrite rules once after plugin activation.
        add_action('deepglot_flush_rewrite_rules', 'flush_rewrite_rules');
    }

    /**
     * Removes canonical redirect actions before they fire (template_redirect priority 10)
     * when a language prefix is active on the current request.
     */
    public function removeCanonicalRedirects(): void
    {
        if ($this->currentLanguage === null) {
            return;
        }

        remove_action('template_redirect', 'redirect_canonical');

        // Yoast SEO owns this legacy global; read it without declaring an
        // unprefixed Deepglot global that directory scanners can misidentify.
        $yoastFrontend = $GLOBALS['wpseo_front'] ?? null;
        if (is_object($yoastFrontend)) {
            remove_action('template_redirect', [$yoastFrontend, 'clean_permalink'], 1);
        }

        // Newer Yoast SEO versions use a different class structure.
        $yoastPriorities = [1, 2, 10];
        foreach ($yoastPriorities as $p) {
            remove_action('template_redirect', ['WPSEO_Frontend', 'clean_permalink'], $p);
        }
    }

    /**
     * Returns false (no redirect) when a language prefix was detected,
     * so canonical redirects do not strip the translated URL.
     *
     * @param string|false $redirectUrl
     * @return string|false
     */
    public function preventCanonicalRedirect($redirectUrl)
    {
        if ($this->currentLanguage !== null) {
            return false;
        }

        return $redirectUrl;
    }

    /**
     * Blocks wp_redirect / wp_safe_redirect only when the destination URL
     * is the same as the current request but without the language prefix.
     * This prevents canonical "cleanup" redirects from Yoast SEO or WP core
     * while allowing legitimate redirects (login, form submissions, etc.).
     *
     * @param string|false $location
     * @return string|false
     */
    public function preventLanguageStrippingRedirect($location)
    {
        if ($this->currentLanguage === null || !$location) {
            return $location;
        }

        // Build the expected canonical path for the current language-prefixed request.
        $originalUri   = $this->originalRequestUri ?? '/';
        $canonicalPath = $this->routing->getCanonicalPath(
            wp_parse_url($originalUri, PHP_URL_PATH) ?: '/',
            $this->currentLanguage
        );
        $siteUrl       = rtrim(get_site_url(), '/');
        $currentHost   = RequestInput::server('HTTP_HOST');

        // If the redirect target equals the canonical URL (= same page without lang prefix), block it.
        $targetPath = wp_parse_url($location, PHP_URL_PATH) ?: '/';
        $targetHost = (string) wp_parse_url($location, PHP_URL_HOST);

        if (rtrim($targetPath, '/') === rtrim($canonicalPath, '/')) {
            return false;
        }

        // Also block if target equals site_url + canonical path.
        if (rtrim($location, '/') === $siteUrl . rtrim($canonicalPath, '/')) {
            return false;
        }

        if (
            $this->routing->usesSubdomains()
            && $targetHost !== ''
            && $currentHost !== ''
            && !$this->routing->hostsMatch($targetHost, $currentHost)
        ) {
            return false;
        }

        return $location;
    }

    /**
     * Allows wp_safe_redirect() to use only configured Deepglot language hosts.
     *
     * @param string[] $hosts
     * @return string[]
     */
    public function allowInternalRedirectHost(array $hosts, string $host): array
    {
        if ($host !== '' && $this->routing->isInternalHost($host)) {
            $hosts[] = strtolower($host);
        }

        return array_values(array_unique($hosts));
    }

    /** Permanently redirects a stale localized slug to its configured target. */
    public function redirectCanonicalSlug(): void
    {
        if ($this->canonicalRedirectUrl === null) {
            return;
        }

        $requestMethod = strtoupper(RequestInput::server('REQUEST_METHOD'));
        if (!in_array($requestMethod, ['GET', 'HEAD'], true)) {
            return;
        }

        if (function_exists('is_404') && is_404()) {
            return;
        }

        $targetHost = (string) wp_parse_url($this->canonicalRedirectUrl, PHP_URL_HOST);
        if ($targetHost === '' || !$this->routing->isInternalHost($targetHost)) {
            return;
        }

        if (wp_safe_redirect($this->canonicalRedirectUrl, 301, 'Deepglot')) {
            exit;
        }
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
        $this->currentLanguage = null;
        $this->originalRequestUri = null;
        $this->canonicalRedirectUrl = null;

        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return;
        }

        $uri = RequestInput::server('REQUEST_URI', '/');
        $host = RequestInput::server('HTTP_HOST');
        $detected = $this->routing->detectLanguage($uri, $host);

        if ($detected === null) {
            return;
        }

        $this->currentLanguage    = $detected;
        $this->originalRequestUri = $uri;
        $this->canonicalRedirectUrl = $this->routing->getCanonicalRedirectUrl(
            $uri,
            $host,
            $detected
        );

        // Strip language prefix so WordPress sees the canonical URL.
        $stripped = $this->routing->getCanonicalPath($uri, $detected);

        // Preserve the query string.
        $queryString = wp_parse_url($uri, PHP_URL_QUERY);
        if (is_string($queryString) && $queryString !== '') {
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
        if (!$this->options->isEnabled() || $this->routing->usesSubdomains()) {
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
