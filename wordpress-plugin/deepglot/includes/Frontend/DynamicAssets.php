<?php

namespace Deepglot\Frontend;

use Deepglot\Api\RestApi;
use Deepglot\Config\Options;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\TranslationRules;

/**
 * Enqueues the client-side dynamic-content translator and hands it a localized
 * config object. The script only loads on a translated front-end page (active
 * language ≠ source) when the feature is enabled and configured, so source-
 * language pages and unrelated requests carry zero extra weight.
 *
 * The config carries the same extraction rules the server pass uses
 * ({@see TranslationRules}) plus the admin's excluded selectors, so the two
 * passes agree on what is translatable without the JS hard-coding any list.
 */
class DynamicAssets
{
    public const HANDLE = 'deepglot-dynamic';

    private Options $options;
    private SiteRouting $routing;
    private ?object $requestRouter;

    public function __construct(Options $options, SiteRouting $routing, ?object $requestRouter = null)
    {
        $this->options       = $options;
        $this->routing       = $routing;
        $this->requestRouter = $requestRouter;
    }

    public function register(): void
    {
        add_action('wp_enqueue_scripts', [$this, 'enqueue']);
    }

    public function enqueue(): void
    {
        if (!$this->options->isEnabled()
            || !$this->options->isConfigured()
            || !$this->options->shouldTranslateDynamicContent()
        ) {
            return;
        }

        // The visual editor injects and manages its own segments; the dynamic
        // pass would fight it, so stand down whenever the editor is active.
        if (isset($_GET['deepglot_editor'])) {
            return;
        }

        // Mirror OutputBuffer::startBuffer(): on an excluded URL the initial
        // HTML is left untranslated, so dynamic content on that page must not
        // be translated (or billed) either.
        if ($this->options->isUrlExcluded($this->currentRequestUrl())) {
            return;
        }

        $activeLang = $this->detectActiveLanguage();
        $sourceLang = $this->options->getSourceLanguage();

        // Nothing to do on a source-language page.
        if ($activeLang === '' || $activeLang === $sourceLang) {
            return;
        }

        wp_register_script(
            self::HANDLE,
            DEEPGLOT_PLUGIN_URL . 'assets/js/dynamic-translator.js',
            [],
            DEEPGLOT_PLUGIN_VERSION,
            true
        );

        wp_localize_script(self::HANDLE, 'deepglotDynamic', [
            // Root-relative so the fetch stays same-origin on SUBDOMAIN-routed
            // pages served from a mapped host (where rest_url()/home_url() still
            // resolve to the source host). A relative URL resolves against the
            // current page origin, so the cookie + nonce are actually sent.
            'endpoint'         => esc_url_raw(wp_make_link_relative(rest_url(RestApi::NAMESPACE . DynamicTranslationController::ROUTE))),
            'nonce'            => wp_create_nonce('wp_rest'),
            'quotaTicket'      => DynamicTranslationController::issueQuotaTicket(),
            'langFrom'         => $sourceLang,
            'langTo'           => $activeLang,
            'skipTags'         => array_map('strtolower', TranslationRules::SKIP_TAGS),
            'excludeSelectors' => array_values(array_merge(
                $this->options->getExcludedSelectors(),
                TranslationRules::OWN_SKIP_SELECTORS
            )),
            'noTranslateAttr'  => TranslationRules::NO_TRANSLATE_ATTR,
            'attrMap'          => TranslationRules::TRANSLATABLE_BODY_ATTRIBUTES,
            'attrSkipTags'     => array_map('strtolower', TranslationRules::ATTR_SKIP_ANCESTORS),
            'inputValueTypes'  => TranslationRules::TRANSLATABLE_INPUT_VALUE_TYPES,
            'minLength'        => TranslationRules::MIN_TEXT_LENGTH,
            'batchSize'        => 200,
            'maxTextLength'    => 5000,
        ]);

        wp_enqueue_script(self::HANDLE);
    }

    /**
     * Active language for the current request. Mirrors LanguageSwitcher:
     * prefer the RequestRouter (it captures the language before the URL prefix
     * is stripped), then fall back to re-detecting from the raw request.
     */
    private function detectActiveLanguage(): string
    {
        $requestUri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $host       = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';

        $routerLang = ($this->requestRouter !== null && method_exists($this->requestRouter, 'getCurrentLanguage'))
            ? $this->requestRouter->getCurrentLanguage()
            : null;

        return $routerLang
            ?? $this->routing->detectLanguage($requestUri, $host)
            ?? $this->options->getSourceLanguage();
    }

    /** Current request URL, mirroring OutputBuffer::currentRequestUrl(). */
    private function currentRequestUrl(): string
    {
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';

        if (function_exists('home_url')) {
            return home_url($uri);
        }

        return $uri;
    }
}
