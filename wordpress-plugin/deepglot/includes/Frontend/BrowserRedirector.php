<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\SiteRouting;

class BrowserRedirector
{
    private SiteRouting $routing;
    private string $cookieName;
    private ?Options $options;

    public function __construct(SiteRouting $routing, string $cookieName = 'deepglot_preferred_language', ?Options $options = null)
    {
        $this->routing = $routing;
        $this->cookieName = $cookieName;
        $this->options = $options;
    }

    public function pickPreferredLanguage(string $acceptLanguage): ?string
    {
        $candidates = [];
        $supportedTargets = $this->routing->getTargetLanguages();

        foreach (explode(',', $acceptLanguage) as $item) {
            $item = trim($item);
            if ($item === '') {
                continue;
            }

            [$language, $qualityPart] = array_pad(explode(';q=', $item, 2), 2, null);
            $quality = $qualityPart !== null ? (float) $qualityPart : 1.0;
            $baseLanguage = strtolower(trim(explode('-', $language)[0]));

            if ($baseLanguage === '' || $baseLanguage === $this->routing->getSourceLanguage()) {
                continue;
            }

            if (!in_array($baseLanguage, $supportedTargets, true)) {
                continue;
            }

            $candidates[$baseLanguage] = max($candidates[$baseLanguage] ?? 0, $quality);
        }

        arsort($candidates);

        return array_key_first($candidates);
    }

    /**
     * @param array<string, bool> $flags
     */
    public function shouldSkipRedirect(array $flags): bool
    {
        return !empty($flags['hasLocaleCookie'])
            || !empty($flags['isBot'])
            || !empty($flags['isAdmin'])
            || !empty($flags['isAjax'])
            || !empty($flags['isRest'])
            || !empty($flags['isFeed'])
            || !empty($flags['isPreview'])
            || !empty($flags['isCheckout'])
            || !empty($flags['isOrderPay'])
            || !empty($flags['isEditorMode'])
            || !empty($flags['isLocalizedRequest']);
    }

    public function register(): void
    {
        add_action('template_redirect', [$this, 'maybeRedirect'], 0);
    }

    public function maybeRedirect(): void
    {
        if ($this->options === null || !$this->options->isEnabled() || !$this->options->isConfigured() || !$this->options->shouldAutoRedirect()) {
            return;
        }

        $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $host = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
        $currentLanguage = $this->routing->detectLanguage($uri, $host);

        if ($currentLanguage !== null) {
            $this->persistLanguageCookie($currentLanguage);
            return;
        }

        if ($this->shouldSkipRedirect([
            'hasLocaleCookie' => !empty($_COOKIE[$this->cookieName]),
            'isBot' => $this->isBotRequest((string) ($_SERVER['HTTP_USER_AGENT'] ?? '')),
            'isAdmin' => is_admin(),
            'isAjax' => function_exists('wp_doing_ajax') && wp_doing_ajax(),
            'isRest' => function_exists('wp_is_json_request') && wp_is_json_request(),
            'isFeed' => function_exists('is_feed') && is_feed(),
            'isPreview' => function_exists('is_preview') && is_preview(),
            'isCheckout' => function_exists('is_checkout') && is_checkout(),
            'isOrderPay' => function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-pay'),
            'isEditorMode' => isset($_GET['deepglot_editor']) || isset($_GET['deepglot_editor_token']),
            'isLocalizedRequest' => $currentLanguage !== null,
        ])) {
            return;
        }

        $preferredLanguage = $this->pickPreferredLanguage((string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''));

        if ($preferredLanguage === null) {
            return;
        }

        $target = $this->routing->buildUrlForLanguage($uri, $preferredLanguage);

        if ($target === '') {
            return;
        }

        $this->persistLanguageCookie($preferredLanguage);
        wp_safe_redirect($target, 302);
        exit;
    }

    private function isBotRequest(string $userAgent): bool
    {
        if ($userAgent === '') {
            return false;
        }

        return (bool) preg_match('/bot|crawler|spider|slurp|bingpreview|facebookexternalhit|wget|curl/i', $userAgent);
    }

    private function persistLanguageCookie(string $language): void
    {
        if (headers_sent()) {
            return;
        }

        setcookie(
            $this->cookieName,
            $language,
            [
                'expires' => time() + YEAR_IN_SECONDS,
                'path' => '/',
                'samesite' => 'Lax',
            ]
        );
    }
}
