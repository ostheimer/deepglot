<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\UrlLanguageResolver;

/**
 * Captures the WordPress HTML output, translates text nodes via the
 * Deepglot API, rewrites internal links and injects hreflang tags.
 */
class OutputBuffer
{
    private Options $options;
    private UrlLanguageResolver $resolver;
    private HtmlTranslator $translator;
    private LinkRewriter $linkRewriter;
    private HreflangInjector $hreflangInjector;
    private RequestRouter $router;

    public function __construct(
        Options $options,
        UrlLanguageResolver $resolver,
        HtmlTranslator $translator,
        LinkRewriter $linkRewriter,
        HreflangInjector $hreflangInjector,
        RequestRouter $router
    ) {
        $this->options          = $options;
        $this->resolver         = $resolver;
        $this->translator       = $translator;
        $this->linkRewriter     = $linkRewriter;
        $this->hreflangInjector = $hreflangInjector;
        $this->router           = $router;
    }

    public function register(): void
    {
        add_action('template_redirect', [$this, 'startBuffer'], 0);
    }

    public function startBuffer(): void
    {
        $targetLanguage = $this->detectTargetLanguage();

        if ($targetLanguage === null) {
            return;
        }

        ob_start(function (string $html) use ($targetLanguage): string {
            return $this->process($html, $targetLanguage);
        });
    }

    // -------------------------------------------------------------------------

    /**
     * Full pipeline: translate → rewrite links → inject hreflang.
     */
    public function process(string $html, string $targetLanguage): string
    {
        if ($html === '' || stripos($html, '<html') === false) {
            return $html;
        }

        // Step 1: translate text nodes.
        $html = $this->translator->translate($html, $targetLanguage);

        // Steps 2 + 3 need the DOM, so load once.
        $doc = $this->loadDocument($html);

        // Step 2: rewrite internal links to include language prefix.
        $this->linkRewriter->rewrite($doc, $targetLanguage);

        // Step 3: inject hreflang tags.
        // Use the original (pre-rewrite) REQUEST_URI to get the canonical path.
        $rawUri        = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $canonicalPath = $this->resolver->stripLanguageFromPath($rawUri);
        $this->hreflangInjector->inject($doc, $canonicalPath);

        // Step 4: add translate="no" so browser extensions don't double-translate.
        $htmlEl = $doc->getElementsByTagName('html')->item(0);

        if ($htmlEl instanceof \DOMElement && !$htmlEl->hasAttribute('translate')) {
            $htmlEl->setAttribute('translate', 'no');
        }

        return $this->saveDocument($doc);
    }

    // -------------------------------------------------------------------------

    private function detectTargetLanguage(): ?string
    {
        if (is_admin() || wp_doing_ajax() || wp_is_json_request()) {
            return null;
        }

        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return null;
        }

        if (headers_sent()) {
            return null;
        }

        // The RequestRouter already stripped the language prefix from REQUEST_URI,
        // but it stored the detected language for us.
        $detected = $this->router->getCurrentLanguage();

        if ($detected !== null) {
            return $detected;
        }

        // Fallback: re-detect from the original URI (before REQUEST_URI was rewritten).
        // The router stores the original URI in a request attribute; if not available,
        // detect from the still-current REQUEST_URI.
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        return $this->resolver->detectLanguageFromPath($uri);
    }

    private function loadDocument(string $html): \DOMDocument
    {
        $doc = new \DOMDocument('1.0', 'UTF-8');

        libxml_use_internal_errors(true);
        $doc->loadHTML(
            '<?xml encoding="UTF-8">' . $html,
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOWARNING | LIBXML_NOERROR
        );
        libxml_clear_errors();

        return $doc;
    }

    private function saveDocument(\DOMDocument $doc): string
    {
        $html = $doc->saveHTML();

        if ($html === false) {
            return '';
        }

        return str_replace('<?xml encoding="UTF-8">', '', $html);
    }
}
