<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\SiteRouting;

/**
 * Expands a placeholder "Sprachschalter" entry inside any WP nav menu
 * into one menu item per configured language. Mirrors Weglot's
 * `wp_get_nav_menu_items`-filter pattern so theme renderers (classic
 * Walker_Nav_Menu, FSE Navigation block, Avada / Divi / Astra megamenu)
 * all get the same shape and existing CSS for current-menu-item etc.
 * keeps working.
 *
 * Site owner workflow:
 *
 *   1. Appearance → Menus → Custom Links → add a link with URL
 *      "#deepglot-switcher" and any label (we read post_name or URL
 *      anchor to find it).
 *   2. Optional toggles via custom-class field:
 *        - `deepglot-mode-dropdown`  → active language becomes the
 *          parent item, alternatives become children (good for compact
 *          header menus).
 *        - `deepglot-hide-current`   → active language is removed from
 *          the list (good when the trigger is rendered separately).
 *
 * The class is intentionally framework-agnostic: it accepts a plain
 * array of stdClass nav-menu items (the shape `wp_get_nav_menu_items`
 * returns) and gives back the same shape, so it can be unit-tested
 * outside WordPress.
 */
class NavMenuSwitcher
{
    private const MARKER       = 'deepglot-switcher';
    private const CLS_DROPDOWN = 'deepglot-mode-dropdown';
    private const CLS_HIDE     = 'deepglot-hide-current';

    /**
     * ISO 639-1 → native display label. Kept in sync with
     * LanguageSwitcher::LANGUAGE_LABELS so a site using both renderers
     * shows the same name in both places.
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

    private Options $options;
    private SiteRouting $routing;

    public function __construct(Options $options, SiteRouting $routing)
    {
        $this->options = $options;
        $this->routing = $routing;
    }

    public function register(): void
    {
        // Priority 20 matches Weglot — after most theme filters but
        // before walker rendering, so highlight / active classes that
        // themes assign get to see the expanded items.
        add_filter('wp_get_nav_menu_items', [$this, 'expand'], 20);
    }

    /**
     * Expand any placeholder marker items into per-language items.
     *
     * @param array<int,object> $items
     * @return array<int,object>
     */
    public function expand(array $items): array
    {
        $hasMarker = false;
        foreach ($items as $item) {
            if ($this->isMarker($item)) { $hasMarker = true; break; }
        }
        if (!$hasMarker) {
            return $items;
        }

        // Plugin disabled or missing API key → swallow the marker so
        // visitors don't see an orphan "Sprachschalter" entry.
        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return array_values(array_filter($items, fn($item) => !$this->isMarker($item)));
        }

        $requestUri    = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $host          = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
        $activeLang    = $this->routing->detectLanguage($requestUri, $host) ?? $this->options->getSourceLanguage();
        $sourceLang    = $this->options->getSourceLanguage();
        $targetLangs   = $this->options->getTargetLanguages();
        $orderedLangs  = $this->orderLanguages(
            array_values(array_unique(array_merge([$sourceLang], $targetLangs))),
            $this->options->getSwitcherLanguageOrder()
        );
        $canonicalPath = $this->routing->getCanonicalPath($requestUri);
        $autoRedirect  = $this->options->shouldAutoRedirect();
        $labelFormat   = $this->options->getSwitcherLabelFormat();

        $output = [];
        foreach ($items as $item) {
            if (!$this->isMarker($item)) {
                $output[] = $item;
                continue;
            }

            $isDropdown        = $this->hasModifier($item, self::CLS_DROPDOWN);
            $isHideCur         = $this->hasModifier($item, self::CLS_HIDE);
            $markerId          = (int) $item->ID;
            $markerParentId    = (int) ($item->menu_item_parent ?? 0);
            $baseOrder         = (int) ($item->menu_order ?? $markerId);

            $rendered = $this->renderLangItems(
                $orderedLangs,
                $activeLang,
                $canonicalPath,
                $autoRedirect,
                $labelFormat,
                $isHideCur,
                $isDropdown,
                $markerId,
                $markerParentId,
                $baseOrder
            );

            foreach ($rendered as $rItem) {
                $output[] = $rItem;
            }
        }

        return array_values($output);
    }

    /**
     * @param string[] $orderedLangs
     * @return object[]
     */
    private function renderLangItems(
        array $orderedLangs,
        string $activeLang,
        string $canonicalPath,
        bool $autoRedirect,
        string $labelFormat,
        bool $hideCurrent,
        bool $dropdown,
        int $markerId,
        int $markerParentId,
        int $baseOrder
    ): array {
        $items = [];

        // Preserve the marker's original position in the menu tree: a
        // marker nested under another item must keep that parent after
        // expansion. In dropdown mode the synthetic "active language
        // parent" slot inherits the marker's parent so submenu layouts
        // (mobile drawers, megamenus) survive the expansion.
        if ($dropdown) {
            $parent = (object) [
                'ID'               => $markerId,
                'db_id'            => $markerId,
                'menu_item_parent' => $markerParentId,
                'menu_order'       => $baseOrder,
                'title'            => $hideCurrent
                    ? __('Sprache wählen', 'deepglot')
                    : $this->labelFor($activeLang, $labelFormat),
                'url'              => '#',
                'type'             => 'custom',
                'object'           => 'custom',
                'post_name'        => 'deepglot-switcher-parent',
                'classes'          => $this->classesFor($activeLang, true, false),
                'xfn'              => '',
                'description'      => '',
                'attr_title'       => $this->labelFor($activeLang, 'full_name'),
                'target'           => '',
            ];
            $items[] = $parent;
        }

        // In list mode each language item replaces the marker at its own
        // depth — so it inherits the marker's parent. In dropdown mode
        // the language items become children of the marker itself.
        $childParent = $dropdown ? $markerId : $markerParentId;

        $i = 0;
        foreach ($orderedLangs as $lang) {
            $isActive = ($lang === $activeLang);
            if ($hideCurrent && $isActive) {
                continue;
            }
            if ($dropdown && $isActive) {
                // Active language is already shown as the parent.
                continue;
            }

            $href = $this->routing->buildHrefForLanguage($canonicalPath, $lang);
            if ($autoRedirect) {
                $href = $this->appendExplicitMarker($href);
            }

            $i++;
            $items[] = (object) [
                'ID'               => $markerId * 1000 + $i,
                'db_id'            => $markerId * 1000 + $i,
                'menu_item_parent' => $childParent,
                'menu_order'       => $baseOrder + $i,
                'title'            => $this->labelFor($lang, $labelFormat),
                'url'              => $href,
                'type'             => 'custom',
                'object'           => 'custom',
                'post_name'        => 'deepglot-switcher-' . $lang,
                'classes'          => $this->classesFor($lang, false, $isActive && !$dropdown),
                'xfn'              => '',
                'description'      => $this->labelFor($lang, 'full_name'),
                'attr_title'       => $this->labelFor($lang, 'full_name'),
                'target'           => '',
            ];
        }

        return $items;
    }

    private function isMarker(object $item): bool
    {
        $postName = isset($item->post_name) ? (string) $item->post_name : '';
        if ($postName !== '' && stripos($postName, self::MARKER) !== false) {
            return true;
        }

        $url = isset($item->url) ? (string) $item->url : '';
        if ($url !== '' && stripos($url, self::MARKER) !== false) {
            return true;
        }

        return false;
    }

    private function hasModifier(object $item, string $cssClass): bool
    {
        $classes = isset($item->classes) && is_array($item->classes) ? $item->classes : [];
        return in_array($cssClass, $classes, true);
    }

    /**
     * @return string[]
     */
    private function classesFor(string $lang, bool $isParent, bool $isCurrent): array
    {
        $classes = [
            'menu-item',
            'menu-item-type-custom',
            'menu-item-deepglot',
            'deepglot-lang',
            'deepglot-lang-' . $lang,
        ];
        if ($isParent) {
            $classes[] = 'menu-item-has-children';
            $classes[] = 'deepglot-switcher-parent';
        }
        if ($isCurrent) {
            $classes[] = 'current-menu-item';
        }
        return $classes;
    }

    private function labelFor(string $lang, string $format): string
    {
        if ($format === 'iso_code') {
            return strtoupper($lang);
        }
        return self::LANGUAGE_LABELS[$lang] ?? strtoupper($lang);
    }

    /**
     * @param string[] $configured
     * @param string[] $preferred
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

    private function appendExplicitMarker(string $href): string
    {
        if ($href === '') {
            return $href;
        }

        $fragment = '';
        $hashPos  = strpos($href, '#');
        if ($hashPos !== false) {
            $fragment = substr($href, $hashPos);
            $href     = substr($href, 0, $hashPos);
        }

        $separator = (strpos($href, '?') === false) ? '?' : '&';
        return $href . $separator . 'deepglot-explicit=1' . $fragment;
    }
}
