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
    }

    public function renderShortcode(array $atts = []): string
    {
        return $this->buildHtml($atts);
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
        $host = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
        $activeLang  = $this->routing->detectLanguage($requestUri, $host) ?? $this->options->getSourceLanguage();
        $sourceLang  = $this->options->getSourceLanguage();
        $targetLangs = $this->options->getTargetLanguages();
        $allLangs    = array_merge([$sourceLang], $targetLangs);

        // Current canonical path (no language prefix).
        $canonicalPath = $this->routing->getCanonicalPath($requestUri);

        $style = isset($atts['style']) && $atts['style'] === 'dropdown' ? 'dropdown' : 'list';

        $items = '';

        foreach ($allLangs as $lang) {
            $href   = $this->routing->buildHrefForLanguage($canonicalPath, $lang);
            $label  = self::LANGUAGE_LABELS[$lang] ?? strtoupper($lang);
            $active = ($lang === $activeLang) ? ' class="deepglot-active"' : '';
            $items .= sprintf(
                '<li%s><a href="%s" hreflang="%s">%s</a></li>',
                $active,
                esc_attr($href),
                esc_attr($lang),
                esc_html($label)
            );
        }

        $wrapperClass = 'deepglot-switcher deepglot-switcher--' . esc_attr($style);

        return sprintf('<nav class="%s" aria-label="%s"><ul>%s</ul></nav>',
            $wrapperClass,
            esc_attr__('Language switcher', 'deepglot'),
            $items
        );
    }
}
