<?php

namespace Deepglot\Frontend;

use Deepglot\Api\RestApi;
use Deepglot\Config\Options;
use Deepglot\Support\BotDetector;
use Deepglot\Support\RequestInput;
use Deepglot\Support\SiteRouting;

/** Load the independent, anonymous tracker only for opted-in translated pages. */
class PageViewAssets
{
    public const HANDLE = 'deepglot-page-views';

    private Options $options;
    private SiteRouting $routing;
    private PageViewController $controller;
    private ?object $requestRouter;

    public function __construct(
        Options $options,
        SiteRouting $routing,
        PageViewController $controller,
        ?object $requestRouter = null
    ) {
        $this->options = $options;
        $this->routing = $routing;
        $this->controller = $controller;
        $this->requestRouter = $requestRouter;
    }

    public function register(): void
    {
        add_action('wp_enqueue_scripts', [$this, 'enqueue']);
    }

    public function enqueue(): void
    {
        if (
            !$this->options->isEnabled()
            || !$this->options->isConfigured()
            || !$this->options->shouldTrackPageViews()
            || BotDetector::detectCurrentRequest() !== BotDetector::HUMAN
            || RequestInput::hasQuery('deepglot_editor')
        ) {
            return;
        }

        $requestUri = RequestInput::server('REQUEST_URI', '/');
        $requestHost = RequestInput::server('HTTP_HOST');
        $routerLanguage = $this->requestRouter !== null && method_exists($this->requestRouter, 'getCurrentLanguage')
            ? $this->requestRouter->getCurrentLanguage()
            : null;
        $language = $routerLanguage ?? $this->routing->detectLanguage($requestUri, $requestHost);

        if (
            !is_string($language)
            || $language === $this->options->getSourceLanguage()
            || !in_array($language, $this->options->getTargetLanguages(), true)
            || $this->options->isUrlExcluded(function_exists('home_url') ? home_url($requestUri) : $requestUri)
        ) {
            return;
        }

        // RequestRouter rewrites REQUEST_URI to the source-language route
        // before this hook. Signing that internal path would make every public
        // /en/... page fail the browser's pathname/capability comparison.
        $originalRequestUri = $this->requestRouter !== null
            && method_exists($this->requestRouter, 'getOriginalRequestUri')
            ? $this->requestRouter->getOriginalRequestUri()
            : null;
        $publicRequestUri = is_string($originalRequestUri) && $originalRequestUri !== ''
            ? $originalRequestUri
            : $requestUri;
        $urlPath = wp_parse_url($publicRequestUri, PHP_URL_PATH);
        if (!is_string($urlPath) || $urlPath === '') {
            return;
        }

        $ticket = $this->controller->issueTrackingTicket($urlPath, $language);
        if ($ticket === '') {
            return;
        }

        wp_register_script(
            self::HANDLE,
            DEEPGLOT_PLUGIN_URL . 'assets/js/page-view-tracker.js',
            [],
            DEEPGLOT_PLUGIN_VERSION,
            true
        );

        wp_localize_script(self::HANDLE, 'deepglotPageViews', [
            'endpoint' => esc_url_raw(wp_make_link_relative(rest_url(RestApi::NAMESPACE . PageViewController::ROUTE))),
            'ticket' => $ticket,
            'urlPath' => $urlPath,
            'langTo' => $language,
            'dedupeSeconds' => 30,
        ]);

        wp_enqueue_script(self::HANDLE);
    }
}
