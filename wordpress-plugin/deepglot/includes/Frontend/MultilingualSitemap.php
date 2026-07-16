<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\SiteRouting;

/**
 * Publishes the source site's public URLs with language alternates.
 *
 * WordPress' core sitemap renderer only serializes the standard sitemap
 * fields, so Deepglot owns a small dedicated endpoint for the required XHTML
 * alternate links. Every collected and filtered URL is validated immediately
 * before serialization to prevent plugins from injecting external locations.
 */
class MultilingualSitemap
{
    private const QUERY_VAR = 'deepglot_sitemap';
    private const ENDPOINT = 'deepglot-sitemap.xml';
    private const MAX_ENTRIES = 50000;

    private Options $options;
    private SiteRouting $routing;

    public function __construct(Options $options, SiteRouting $routing)
    {
        $this->options = $options;
        $this->routing = $routing;
    }

    public function register(): void
    {
        add_action('init', [$this, 'addRewriteRules']);
        add_filter('query_vars', [$this, 'filterQueryVars']);
        add_action('template_redirect', [$this, 'maybeRender'], -100);
        add_filter('robots_txt', [$this, 'filterRobotsTxt'], 10, 2);
    }

    public function addRewriteRules(): void
    {
        add_rewrite_rule('^deepglot-sitemap\.xml$', 'index.php?' . self::QUERY_VAR . '=1', 'top');

        if (function_exists('add_rewrite_tag')) {
            add_rewrite_tag('%' . self::QUERY_VAR . '%', '([01])');
        }
    }

    /**
     * @param string[] $queryVars
     * @return string[]
     */
    public function filterQueryVars(array $queryVars): array
    {
        if (!in_array(self::QUERY_VAR, $queryVars, true)) {
            $queryVars[] = self::QUERY_VAR;
        }

        return $queryVars;
    }

    public function filterRobotsTxt(string $output, bool $public): string
    {
        if (!$public || !$this->isAvailable()) {
            return $output;
        }

        $sitemapUrl = $this->getSitemapUrl();

        if (stripos($output, $sitemapUrl) !== false) {
            return $output;
        }

        return rtrim($output) . "\nSitemap: " . $sitemapUrl . "\n";
    }

    public function maybeRender(): void
    {
        if (!$this->isSitemapRequest()) {
            return;
        }

        if (!$this->isAvailable()) {
            if (function_exists('status_header')) {
                status_header(404);
            }
            exit;
        }

        if (function_exists('status_header')) {
            status_header(200);
        }

        if (!headers_sent()) {
            header('Content-Type: application/xml; charset=UTF-8');
        }

        // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- XML document; every value is escaped via htmlspecialchars(ENT_XML1) in xmlEscape().
        echo $this->buildXml($this->collectSourceEntries());
        exit;
    }

    public function getSitemapUrl(): string
    {
        return $this->routing->buildUrlForLanguage(
            '/' . self::ENDPOINT,
            $this->routing->getSourceLanguage()
        );
    }

    /**
     * Collect public source URLs from WordPress itself.
     *
     * @return array<int,array{loc:string,lastmod?:string}>
     */
    public function collectSourceEntries(): array
    {
        $entries = [];

        $this->appendEntry($entries, home_url('/'));

        $postTypes = function_exists('get_post_types')
            ? (array) get_post_types(['public' => true], 'names')
            : [];

        foreach ($postTypes as $postType) {
            if ((string) $postType === 'attachment' || count($entries) >= self::MAX_ENTRIES) {
                continue;
            }

            $postIds = get_posts([
                'post_type' => (string) $postType,
                'post_status' => 'publish',
                'numberposts' => self::MAX_ENTRIES,
                'fields' => 'ids',
                'orderby' => 'ID',
                'order' => 'ASC',
                'no_found_rows' => true,
                'suppress_filters' => false,
            ]);

            foreach ((array) $postIds as $postId) {
                $lastmod = function_exists('get_post_modified_time')
                    ? (string) get_post_modified_time(DATE_W3C, true, $postId)
                    : '';
                $this->appendEntry($entries, (string) get_permalink($postId), $lastmod);

                if (count($entries) >= self::MAX_ENTRIES) {
                    break 2;
                }
            }
        }

        if (count($entries) < self::MAX_ENTRIES) {
            $taxonomies = function_exists('get_taxonomies')
                ? (array) get_taxonomies(['public' => true], 'names')
                : [];

            foreach ($taxonomies as $taxonomy) {
                $terms = get_terms([
                    'taxonomy' => (string) $taxonomy,
                    'hide_empty' => true,
                ]);

                if (is_wp_error($terms)) {
                    continue;
                }

                foreach ((array) $terms as $term) {
                    $termLink = get_term_link($term);

                    if (!is_wp_error($termLink)) {
                        $this->appendEntry($entries, (string) $termLink);
                    }

                    if (count($entries) >= self::MAX_ENTRIES) {
                        break 2;
                    }
                }
            }
        }

        if (function_exists('apply_filters')) {
            $entries = (array) apply_filters('deepglot_multilingual_sitemap_entries', array_values($entries));
        }

        // Re-validate after the extension point. This is intentionally also
        // done in buildXml(), keeping serialization safe for direct callers.
        $validated = [];
        foreach ($entries as $entry) {
            $normalized = $this->normalizeEntry($entry);

            if ($normalized !== null) {
                $validated[$normalized['loc']] = $normalized;
            }

            if (count($validated) >= self::MAX_ENTRIES) {
                break;
            }
        }

        return array_values($validated);
    }

    /**
     * @param array<int,string|array{loc:string,lastmod?:string}> $entries
     */
    public function buildXml(array $entries): string
    {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $xml .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' . "\n";
        $serialized = [];

        foreach ($entries as $entry) {
            $normalized = $this->normalizeEntry($entry);

            if ($normalized === null) {
                continue;
            }

            $relative = $this->relativeLocation($normalized['loc']);
            $sourceLanguage = $this->routing->getSourceLanguage();
            $sourceUrl = $this->routing->buildUrlForLanguage($relative, $sourceLanguage);

            if (!$this->isSafeInternalUrl($sourceUrl) || isset($serialized[$sourceUrl])) {
                continue;
            }

            $alternates = [];
            $languages = array_values(array_unique(array_merge(
                [$sourceLanguage],
                $this->routing->getTargetLanguages()
            )));

            foreach ($languages as $language) {
                $href = $this->routing->buildUrlForLanguage($relative, $language);

                if ($this->isSafeInternalUrl($href)) {
                    $alternates[(string) $language] = $href;
                }
            }

            if (!isset($alternates[$sourceLanguage])) {
                continue;
            }

            $serialized[$sourceUrl] = true;
            $xml .= "  <url>\n";
            $xml .= '    <loc>' . $this->escapeXml($sourceUrl) . "</loc>\n";

            if (isset($normalized['lastmod'])) {
                $xml .= '    <lastmod>' . $this->escapeXml($normalized['lastmod']) . "</lastmod>\n";
            }

            foreach ($alternates as $language => $href) {
                $xml .= '    <xhtml:link rel="alternate" hreflang="'
                    . $this->escapeXml($language)
                    . '" href="'
                    . $this->escapeXml($href)
                    . '" />' . "\n";
            }

            $xml .= '    <xhtml:link rel="alternate" hreflang="x-default" href="'
                . $this->escapeXml($alternates[$sourceLanguage])
                . '" />' . "\n";
            $xml .= "  </url>\n";

            if (count($serialized) >= self::MAX_ENTRIES) {
                break;
            }
        }

        return $xml . "</urlset>\n";
    }

    private function isAvailable(): bool
    {
        return $this->options->isEnabled()
            && $this->options->isConfigured()
            && !empty($this->routing->getTargetLanguages());
    }

    private function isSitemapRequest(): bool
    {
        if ((string) get_query_var(self::QUERY_VAR, '') === '1') {
            return true;
        }

        $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '';
        $path = (string) wp_parse_url($uri, PHP_URL_PATH);

        return trim($path, '/') === self::ENDPOINT;
    }

    /**
     * @param array<string,array{loc:string,lastmod?:string}> $entries
     */
    private function appendEntry(array &$entries, string $loc, string $lastmod = ''): void
    {
        $entry = $this->normalizeEntry(['loc' => $loc, 'lastmod' => $lastmod]);

        if ($entry !== null) {
            $entries[$entry['loc']] = $entry;
        }
    }

    /**
     * @param mixed $entry
     * @return array{loc:string,lastmod?:string}|null
     */
    private function normalizeEntry($entry): ?array
    {
        if (is_string($entry)) {
            $entry = ['loc' => $entry];
        }

        if (!is_array($entry) || !isset($entry['loc'])) {
            return null;
        }

        $loc = trim((string) $entry['loc']);

        if (!$this->isSafeInternalUrl($loc) || $this->options->isUrlExcluded($loc)) {
            return null;
        }

        $normalized = ['loc' => $loc];
        $lastmod = isset($entry['lastmod']) ? trim((string) $entry['lastmod']) : '';

        if ($lastmod !== '' && $this->isValidLastModified($lastmod)) {
            $normalized['lastmod'] = $lastmod;
        }

        return $normalized;
    }

    private function isSafeInternalUrl(string $url): bool
    {
        $parts = wp_parse_url($url);

        if (!is_array($parts)) {
            return false;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = (string) ($parts['host'] ?? '');

        return in_array($scheme, ['http', 'https'], true)
            && $host !== ''
            && !isset($parts['user'])
            && !isset($parts['pass'])
            && $this->routing->isInternalHost($host);
    }

    private function relativeLocation(string $url): string
    {
        $path = (string) wp_parse_url($url, PHP_URL_PATH);
        $query = (string) wp_parse_url($url, PHP_URL_QUERY);
        $relative = $this->routing->getCanonicalPath($path !== '' ? $path : '/');

        if ($query !== '') {
            $relative .= '?' . $query;
        }

        return $relative;
    }

    private function isValidLastModified(string $value): bool
    {
        $isDateOnly = preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1;
        $isDateTime = preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/', $value) === 1;

        if (!$isDateOnly && !$isDateTime) {
            return false;
        }

        $format = $isDateOnly ? '!Y-m-d' : '!Y-m-d\TH:i:sP';
        $date = \DateTimeImmutable::createFromFormat($format, $value);
        $errors = \DateTimeImmutable::getLastErrors();

        return $date instanceof \DateTimeImmutable
            && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0));
    }

    private function escapeXml(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
