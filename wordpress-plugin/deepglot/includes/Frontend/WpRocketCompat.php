<?php

namespace Deepglot\Frontend;

/**
 * WP Rocket compatibility layer.
 *
 * WP Rocket's "Remove Unused CSS" (RUCSS) strips every stylesheet from
 * the page and re-inlines only the "used" rules into a single
 * <style id="wpr-usedcss"> block. Its generation pipeline re-encodes the
 * emoji flag glyphs from assets/css/switcher.css (e.g. `content: "🇩🇪"`)
 * as HTML entities (`content: "&#127465;&#127466;"`) — invalid inside a
 * CSS string, so browsers render the literal entity text instead of the
 * flag on every translated page (observed live on meinhaushalt.at).
 *
 * The fix is to tell WP Rocket to leave the switcher CSS alone:
 * keep the original switcher.css <link> tag (RUCSS + minify exclusions)
 * and preserve the per-instance inline <style> blocks that
 * LanguageSwitcher emits (custom CSS / responsive hide / custom flags).
 *
 * The filters are registered unconditionally: they only ever fire when
 * WP Rocket itself applies them, and the used-CSS cache can be
 * regenerated at any time (cron, cache clear), including while Deepglot
 * is temporarily disabled.
 */
class WpRocketCompat
{
    /**
     * Substring RUCSS matches against an inline <style> tag's attributes.
     * Covers all three blocks emitted by LanguageSwitcher:
     * deepglot-switcher__custom-css, deepglot-switcher__responsive-css
     * and deepglot-switcher__custom-flags.
     */
    private const INLINE_ATTR_PATTERN = 'deepglot-switcher__';

    /**
     * Substring RUCSS matches against an inline <style> tag's contents.
     * Belt-and-braces for the flag/instance rules in case a theme or
     * optimizer strips the class attribute off the style tag.
     */
    private const INLINE_CONTENT_PATTERN = '.deepglot-';

    public function register(): void
    {
        add_filter('rocket_rucss_external_exclusions', [$this, 'excludeSwitcherStylesheet']);
        add_filter('rocket_exclude_css', [$this, 'excludeSwitcherFromMinify']);
        add_filter('rocket_rucss_inline_atts_exclusions', [$this, 'preserveInlineStyleAttributes']);
        add_filter('rocket_rucss_inline_content_exclusions', [$this, 'preserveInlineStyleContent']);
    }

    /**
     * Keep the switcher.css <link> tag in the page instead of letting
     * RUCSS drop it and serve the entity-mangled copy from wpr-usedcss.
     *
     * @param mixed $exclusions
     * @return array<int,string>
     */
    public function excludeSwitcherStylesheet($exclusions): array
    {
        return $this->append($exclusions, $this->switcherCssPath());
    }

    /**
     * Exclude switcher.css from WP Rocket's minify/combine stage too, so
     * the emoji content strings are never rewritten by any pipeline.
     *
     * @param mixed $exclusions
     * @return array<int,string>
     */
    public function excludeSwitcherFromMinify($exclusions): array
    {
        return $this->append($exclusions, $this->switcherCssPath());
    }

    /**
     * @param mixed $exclusions
     * @return array<int,string>
     */
    public function preserveInlineStyleAttributes($exclusions): array
    {
        return $this->append($exclusions, self::INLINE_ATTR_PATTERN);
    }

    /**
     * @param mixed $exclusions
     * @return array<int,string>
     */
    public function preserveInlineStyleContent($exclusions): array
    {
        return $this->append($exclusions, self::INLINE_CONTENT_PATTERN);
    }

    /**
     * Rooted URL path of the switcher stylesheet, derived from the plugin
     * URL so subdirectory installs and renamed content dirs keep working.
     */
    private function switcherCssPath(): string
    {
        $path = wp_parse_url(DEEPGLOT_PLUGIN_URL . 'assets/css/switcher.css', PHP_URL_PATH);

        return is_string($path) && $path !== ''
            ? $path
            : '/wp-content/plugins/deepglot/assets/css/switcher.css';
    }

    /**
     * @param mixed $exclusions Filter payload — a broken third-party
     *                          callback may hand over a non-array.
     * @return array<int,string>
     */
    private function append($exclusions, string $pattern): array
    {
        $exclusions = is_array($exclusions) ? $exclusions : [];

        if (!in_array($pattern, $exclusions, true)) {
            $exclusions[] = $pattern;
        }

        return $exclusions;
    }
}
