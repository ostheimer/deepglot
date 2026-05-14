<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\SiteRouting;

/**
 * Renders the Deepglot language switcher.
 *
 * Usage:
 *   1. Shortcode:   [deepglot_switcher]
 *   2. PHP call:    do_action('deepglot_language_switcher')
 *   3. Auto-inject: enabled in plugin settings (fires on wp_footer)
 *
 * The rendered markup intentionally mirrors Weglot's switcher contract
 * (semantic <aside>, JS-free <input type="checkbox"> dropdown trigger,
 * unique-id-per-render, full ARIA, data-l / data-code-language /
 * data-name-language attributes) so the same CSS / JS hooks that work
 * with Weglot can be reused, and so two switchers on the same page do
 * not share open/closed state.
 */
class LanguageSwitcher
{
    private Options $options;
    private SiteRouting $routing;

    /**
     * Optional source of truth for the request's active language.
     * RequestRouter captures the language BEFORE it strips the prefix
     * from $_SERVER['REQUEST_URI'], so reading it here is the only way
     * to detect the active language correctly at wp_footer time.
     * Duck-typed (`object`) so unit tests can pass a tiny stub without
     * dragging in the full RequestRouter constructor surface.
     */
    private ?object $requestRouter;

    /**
     * ISO 639-1 → native display label. Matches the dashboard "full name"
     * column so server-rendered output and SaaS preview agree.
     */
    private const LANGUAGE_LABELS = [
        'de' => 'Deutsch',
        'en' => 'English',
        'fr' => 'Français',
        'es' => 'Español',
        'it' => 'Italiano',
        'pt' => 'Português',
        'nl' => 'Nederlands',
        'pl' => 'Polski',
        'ru' => 'Русский',
        'ja' => '日本語',
        'zh' => '中文',
        'ar' => 'العربية',
    ];

    public function __construct(Options $options, SiteRouting $routing, ?object $requestRouter = null)
    {
        $this->options       = $options;
        $this->routing       = $routing;
        $this->requestRouter = $requestRouter;
    }

    public function register(): void
    {
        add_shortcode('deepglot_switcher', [$this, 'renderShortcode']);
        add_action('deepglot_language_switcher', [$this, 'renderAction']);
        add_action('wp_enqueue_scripts', [$this, 'enqueueStyles']);

        if ($this->options->shouldAutoInjectSwitcher()) {
            add_action('wp_footer', [$this, 'renderAction']);
        }
    }

    public function renderShortcode(array $atts = []): string
    {
        return $this->buildHtml(is_array($atts) ? $atts : []);
    }

    public function renderAction(): void
    {
        echo $this->buildHtml([]); // phpcs:ignore WordPress.Security.EscapeOutput
    }

    public function enqueueStyles(): void
    {
        if (!$this->options->isEnabled()) {
            return;
        }

        wp_register_style(
            'deepglot-switcher',
            DEEPGLOT_PLUGIN_URL . 'assets/css/switcher.css',
            [],
            DEEPGLOT_PLUGIN_VERSION
        );

        wp_enqueue_style('deepglot-switcher');

        // Tiny progressive-enhancement script: syncs aria-expanded on the
        // wrapper with the checkbox state so screen readers see the live
        // open/closed status. CSS still drives the visual toggle; the JS
        // is purely accessibility metadata.
        wp_register_script(
            'deepglot-switcher',
            DEEPGLOT_PLUGIN_URL . 'assets/js/switcher.js',
            [],
            DEEPGLOT_PLUGIN_VERSION,
            true
        );

        wp_enqueue_script('deepglot-switcher');
    }

    // -------------------------------------------------------------------------

    private function buildHtml(array $atts): string
    {
        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return '';
        }

        $requestUri    = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $host          = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
        $sourceLang    = $this->options->getSourceLanguage();
        $targetLangs   = $this->options->getTargetLanguages();

        // Active language detection — prefer RequestRouter because it
        // captures the language BEFORE its plugins_loaded hook strips
        // the prefix from $_SERVER['REQUEST_URI']. Falling back to
        // re-detecting from $_SERVER would always see the canonical
        // (stripped) URI and incorrectly resolve to the source language
        // on every translated page.
        $routerLang   = ($this->requestRouter !== null && method_exists($this->requestRouter, 'getCurrentLanguage'))
            ? $this->requestRouter->getCurrentLanguage()
            : null;
        $activeLang   = $routerLang
            ?? $this->routing->detectLanguage($requestUri, $host)
            ?? $sourceLang;
        $canonicalPath = $this->routing->getCanonicalPath($requestUri);

        $style = $this->options->getSwitcherDefaultStyle();
        if (isset($atts['style']) && in_array($atts['style'], Options::SWITCHER_STYLES, true)) {
            $style = $atts['style'];
        }

        $flagStyle     = $this->options->getSwitcherFlagStyle();
        $labelFormat   = $this->options->getSwitcherLabelFormat();
        $showLabel     = $this->options->shouldShowSwitcherLabel();
        $languageOrder = $this->options->getSwitcherLanguageOrder();
        $position      = $this->options->getSwitcherPosition();
        $customCss     = $this->options->getSwitcherCustomCss();
        $autoRedirect  = $this->options->shouldAutoRedirect();

        $configured   = array_values(array_unique(array_merge([$sourceLang], $targetLangs)));
        $orderedLangs = $this->orderLanguages($configured, $languageOrder);

        // Unique id per render so multiple switchers on the same page do
        // not share the checkbox open/closed state. Uses uniqid() because
        // wp_rand() can collide under heavy parallel rendering.
        $uniqId = 'dg' . uniqid('', true);

        $wrapperClasses = [
            'deepglot-switcher',
            'deepglot-switcher--' . $style,
            'deepglot-switcher--flag-' . $flagStyle,
        ];
        if (!$showLabel) {
            $wrapperClasses[] = 'deepglot-switcher--no-label';
        }
        if ($position !== 'inline') {
            $wrapperClasses[] = 'deepglot-switcher--' . $position;
        }

        // Always-visible trigger: the current language. Wrapped in a
        // <label for="{uniqId}"> so clicking it toggles the checkbox
        // that drives the dropdown — no JavaScript required for the
        // open/close interaction.
        $activeLabelText = $this->labelFor($activeLang, $labelFormat);
        $activeNative    = self::LANGUAGE_LABELS[$activeLang] ?? strtoupper($activeLang);

        $labelClass = $showLabel
            ? 'deepglot-label'
            : 'deepglot-label deepglot-label--sr-only';

        $activeFlagSpan = $this->flagSpan($activeLang, $flagStyle);

        $current = sprintf(
            '<input id="%s" class="deepglot-choice" type="checkbox" aria-hidden="true" tabindex="-1">'
            . '<label for="%s" class="deepglot-current %s" data-l="%s">'
            . '%s<span class="%s">%s</span>'
            . '</label>',
            esc_attr($uniqId),
            esc_attr($uniqId),
            'deepglot-flag-' . esc_attr($flagStyle) . ' deepglot-lang-' . esc_attr($activeLang),
            esc_attr($activeLang),
            $activeFlagSpan,
            esc_attr($labelClass),
            esc_html($activeLabelText)
        );

        $items = '<ul role="none">';
        foreach ($orderedLangs as $lang) {
            $isActive = ($lang === $activeLang);
            $href     = $this->routing->buildHrefForLanguage($canonicalPath, $lang);

            if ($autoRedirect) {
                $href = $this->appendExplicitMarker($href);
            }

            $label    = $this->labelFor($lang, $labelFormat);
            $native   = self::LANGUAGE_LABELS[$lang] ?? strtoupper($lang);
            $flagSpan = $this->flagSpan($lang, $flagStyle);

            $liClasses = [
                'deepglot-li',
                'deepglot-lang-' . $lang,
            ];
            if ($isActive) {
                $liClasses[] = 'deepglot-active';
            }

            $items .= sprintf(
                '<li class="%s" role="option" data-l="%s" data-code-language="%s" data-name-language="%s">'
                . '<a href="%s" hreflang="%s" role="option" data-deepglot-no-translate '
                . 'title="%s" class="deepglot-lang-link deepglot-lang-link--%s">'
                . '%s<span class="%s">%s</span>'
                . '</a>'
                . '</li>',
                esc_attr(implode(' ', $liClasses)),
                esc_attr($lang),
                esc_attr($lang),
                esc_attr($native),
                esc_attr($href),
                esc_attr($lang),
                esc_attr(sprintf(__('Switch language to %s', 'deepglot'), $native)),
                esc_attr($lang),
                $flagSpan,
                esc_attr($labelClass),
                esc_html($label)
            );
        }
        $items .= '</ul>';

        $css           = $this->renderCustomCss($customCss);
        $responsiveCss = $this->renderResponsiveCss(
            $this->options->getSwitcherResponsiveHide(),
            $this->options->getSwitcherResponsiveBreakpoint()
        );
        $ariaLabel = sprintf(__('Sprache: %s', 'deepglot'), $activeNative);
        $marker    = '<!--Deepglot ' . DEEPGLOT_PLUGIN_VERSION . '-->';

        // For the dropdown variant the wrapper is an expandable popup
        // trigger: announce that to assistive tech via aria-haspopup AND
        // start with aria-expanded="false" (truthful at first paint
        // because the checkbox is unchecked). switcher.js then keeps
        // aria-expanded in sync with the checkbox so the announcement
        // doesn't go stale when the user opens the menu. The inline-list
        // variant has no popup, so neither attribute is emitted.
        $popupAttrs = '';
        if ($style === 'dropdown') {
            $popupAttrs = ' aria-haspopup="listbox" aria-expanded="false"';
        }

        return $css . $responsiveCss . $marker . sprintf(
            '<aside class="%s" data-deepglot-no-translate tabindex="0"%s aria-label="%s">%s%s</aside>',
            esc_attr(implode(' ', $wrapperClasses)),
            $popupAttrs,
            esc_attr($ariaLabel),
            $current,
            $items
        );
    }

    /**
     * Emit a scoped @media rule that hides the switcher above (desktop)
     * or below (mobile) the configured breakpoint. The cutoff for
     * `desktop` is breakpoint+1 so the breakpoint itself counts as the
     * last mobile width — matches the common `max-width: 768px` /
     * `min-width: 769px` convention site themes already use.
     */
    private function renderResponsiveCss(string $hide, int $breakpoint): string
    {
        if ($hide === 'none') {
            return '';
        }

        if ($hide === 'mobile') {
            $mediaQuery = '@media (max-width: ' . $breakpoint . 'px)';
        } else { // 'desktop'
            $mediaQuery = '@media (min-width: ' . ($breakpoint + 1) . 'px)';
        }

        return '<style class="deepglot-switcher__responsive-css">'
            . $mediaQuery
            . ' { .deepglot-switcher { display: none !important; } }'
            . '</style>';
    }

    private function flagSpan(string $lang, string $flagStyle): string
    {
        if ($flagStyle === 'none') {
            return '';
        }

        return sprintf(
            '<span class="deepglot-flag deepglot-flag--%s" aria-hidden="true"></span>',
            esc_attr($lang)
        );
    }

    private function labelFor(string $lang, string $format): string
    {
        if ($format === 'iso_code') {
            return strtoupper($lang);
        }

        return self::LANGUAGE_LABELS[$lang] ?? strtoupper($lang);
    }

    /**
     * @param string[] $configured Configured languages in default order.
     * @param string[] $preferred  Admin-supplied preferred order.
     * @return string[]
     */
    private function orderLanguages(array $configured, array $preferred): array
    {
        if (empty($preferred)) {
            return $configured;
        }

        $configuredSet = array_flip($configured);
        $ordered       = [];

        foreach ($preferred as $lang) {
            if (isset($configuredSet[$lang]) && !in_array($lang, $ordered, true)) {
                $ordered[] = $lang;
            }
        }

        foreach ($configured as $lang) {
            if (!in_array($lang, $ordered, true)) {
                $ordered[] = $lang;
            }
        }

        return $ordered;
    }

    /**
     * Append `deepglot-explicit=1` to a URL so the BrowserRedirector knows
     * the visitor picked this language deliberately (matches Weglot's
     * `?wg-choose-original=…` marker).
     */
    private function appendExplicitMarker(string $href): string
    {
        if ($href === '') {
            return $href;
        }

        $separator = (strpos($href, '?') === false) ? '?' : '&';
        $fragment  = '';

        $hashPos = strpos($href, '#');
        if ($hashPos !== false) {
            $fragment = substr($href, $hashPos);
            $href     = substr($href, 0, $hashPos);
            $separator = (strpos($href, '?') === false) ? '?' : '&';
        }

        return $href . $separator . 'deepglot-explicit=1' . $fragment;
    }

    /**
     * Wrap admin-provided CSS in a scoped <style> tag. Any '<' is stripped
     * because legitimate CSS never needs it (no comparison operators, no
     * tag-like syntax) and removing it neutralises any `</style>` /
     * `<script>` breakout that a hostile or sloppy paste could smuggle in.
     */
    private function renderCustomCss(string $css): string
    {
        $css = trim($css);
        if ($css === '') {
            return '';
        }

        $safe = str_replace('<', '', $css);

        return '<style class="deepglot-switcher__custom-css">' . $safe . '</style>';
    }
}
