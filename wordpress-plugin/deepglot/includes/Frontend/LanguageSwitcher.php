<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\SiteRouting;

/**
 * Renders a language switcher and injects it into the page.
 *
 * Usage options:
 *  1. Shortcode:   [deepglot_switcher]
 *  2. PHP call:    do_action('deepglot_language_switcher')
 *  3. Auto-inject: enabled in plugin settings (appends switcher before </body>)
 *
 * Every appearance knob is driven by Options (admin settings), so the SaaS
 * Switcher panel — which writes runtime config that flows into the same
 * options — produces an on-page output that mirrors the dashboard preview.
 */
class LanguageSwitcher
{
    private Options $options;
    private SiteRouting $routing;

    /** ISO 639-1 → display label */
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

    public function __construct(Options $options, SiteRouting $routing)
    {
        $this->options  = $options;
        $this->routing = $routing;
    }

    public function register(): void
    {
        add_shortcode('deepglot_switcher', [$this, 'renderShortcode']);
        add_action('deepglot_language_switcher', [$this, 'renderAction']);
        add_action('wp_enqueue_scripts', [$this, 'enqueueStyles']);

        // Auto-inject runs from the footer so the switcher always appears
        // even when a theme has no shortcode / do_action call.
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
    }

    // -------------------------------------------------------------------------

    private function buildHtml(array $atts): string
    {
        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return '';
        }

        $requestUri  = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $host        = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
        $activeLang  = $this->routing->detectLanguage($requestUri, $host) ?? $this->options->getSourceLanguage();
        $sourceLang  = $this->options->getSourceLanguage();
        $targetLangs = $this->options->getTargetLanguages();

        $canonicalPath = $this->routing->getCanonicalPath($requestUri);

        // Style: option default, overridable via shortcode att for backward
        // compatibility with templates that already inline a style choice.
        $style = $this->options->getSwitcherDefaultStyle();
        if (isset($atts['style']) && in_array($atts['style'], Options::SWITCHER_STYLES, true)) {
            $style = $atts['style'];
        }

        $flagStyle    = $this->options->getSwitcherFlagStyle();
        $labelFormat  = $this->options->getSwitcherLabelFormat();
        $showLabel    = $this->options->shouldShowSwitcherLabel();
        $languageOrder = $this->options->getSwitcherLanguageOrder();
        $customCss    = $this->options->getSwitcherCustomCss();

        $configured  = array_values(array_unique(array_merge([$sourceLang], $targetLangs)));
        $orderedLangs = $this->orderLanguages($configured, $languageOrder);

        $items = '';
        foreach ($orderedLangs as $lang) {
            $href   = $this->routing->buildHrefForLanguage($canonicalPath, $lang);
            $label  = $this->labelFor($lang, $labelFormat);
            $active = ($lang === $activeLang) ? ' class="deepglot-active"' : '';

            $flagSpan = ($flagStyle !== 'none')
                ? sprintf(
                    '<span class="deepglot-flag deepglot-flag--%s" aria-hidden="true"></span>',
                    esc_attr($lang)
                )
                : '';

            $labelClass = $showLabel
                ? 'deepglot-label'
                : 'deepglot-label deepglot-label--sr-only';

            $items .= sprintf(
                '<li%s><a href="%s" hreflang="%s">%s<span class="%s">%s</span></a></li>',
                $active,
                esc_attr($href),
                esc_attr($lang),
                $flagSpan,
                esc_attr($labelClass),
                esc_html($label)
            );
        }

        $wrapperClasses = [
            'deepglot-switcher',
            'deepglot-switcher--' . $style,
            'deepglot-switcher--flag-' . $flagStyle,
        ];
        if (!$showLabel) {
            $wrapperClasses[] = 'deepglot-switcher--no-label';
        }

        $css = $this->renderCustomCss($customCss);

        return $css . sprintf(
            '<nav class="%s" aria-label="%s"><ul>%s</ul></nav>',
            esc_attr(implode(' ', $wrapperClasses)),
            esc_attr__('Language switcher', 'deepglot'),
            $items
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
        $ordered = [];

        foreach ($preferred as $lang) {
            if (isset($configuredSet[$lang]) && !in_array($lang, $ordered, true)) {
                $ordered[] = $lang;
            }
        }

        // Anything configured but missing from the preferred list still
        // gets rendered (deterministically, after the explicit order) so a
        // forgotten language never disappears silently.
        foreach ($configured as $lang) {
            if (!in_array($lang, $ordered, true)) {
                $ordered[] = $lang;
            }
        }

        return $ordered;
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
