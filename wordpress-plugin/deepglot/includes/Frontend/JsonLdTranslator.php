<?php

namespace Deepglot\Frontend;

use Deepglot\Support\SiteRouting;

/**
 * Walks every <script type="application/ld+json"> element in a document,
 * extracts the user-facing string fields the translation pipeline can
 * safely localize, and writes the translated values back without losing
 * the surrounding JSON structure.
 *
 * Designed as a pure helper so it can ride on the same dedup/cache batch
 * that HtmlTranslator already builds for body text and head metadata.
 */
class JsonLdTranslator
{
    /**
     * JSON-LD keys whose string values are user-facing copy and should be
     * translated. URLs, IDs, controlled vocabulary, comma-separated tag
     * lists (`keywords`), enum values (`creativeWorkStatus`), and
     * controlled genre vocabulary are intentionally excluded so SEO
     * scoring on the localized page is not distorted.
     */
    private const TRANSLATABLE_KEYS = [
        'name',
        'description',
        'headline',
        'caption',
        'articleBody',
        'alternativeHeadline',
        'disambiguatingDescription',
        'about',
        'abstract',
        'recipeIngredient',
    ];

    /**
     * JSON-LD keys whose value is a BCP-47 / ISO 639-1 language code.
     * They are rewritten to the active target language instead of being
     * sent through the translation engine.
     */
    private const LANGUAGE_KEYS = ['inLanguage'];

    /**
     * Schema entities whose own @id and url identify the localized page (or
     * a page-scoped fragment), rather than a shared person, organization or
     * media asset. Direct breadcrumb items and mainEntityOfPage strings are
     * handled separately; untyped reference objects are matched against the
     * collected graph identities instead of relationship-property names.
     */
    private const PAGE_RELATED_TYPES = [
        'Article',
        'BlogPosting',
        'BreadcrumbList',
        'DiscussionForumPosting',
        'LiveBlogPosting',
        'NewsArticle',
        'Recipe',
        'Report',
        'ScholarlyArticle',
        'SocialMediaPosting',
        'TechArticle',
        'WebSite',
    ];

    private ?SiteRouting $routing;

    public function __construct(?SiteRouting $routing = null)
    {
        $this->routing = $routing;
    }

    /**
     * @return array<int, array{node: \DOMText, data: array<mixed>, strings: string[]}>
     */
    public function collect(\DOMDocument $doc): array
    {
        $mutations = [];
        $scripts = $doc->getElementsByTagName('script');

        foreach ($scripts as $script) {
            if (!$script instanceof \DOMElement) {
                continue;
            }

            if (strtolower(trim($script->getAttribute('type'))) !== 'application/ld+json') {
                continue;
            }

            $textNode = $this->firstTextChild($script);

            if ($textNode === null) {
                continue;
            }

            $raw = trim($textNode->data);

            if ($raw === '') {
                continue;
            }

            $decoded = json_decode($raw, true);

            if (!is_array($decoded)) {
                // Leave malformed JSON untouched so we never destroy theme output.
                continue;
            }

            $strings = [];
            $this->collectStrings($decoded, $strings);

            $mutations[] = [
                'node' => $textNode,
                'data' => $decoded,
                'strings' => array_values(array_unique($strings)),
            ];
        }

        return $mutations;
    }

    /**
     * @param array<int, array{node: \DOMText, data: array<mixed>, strings: string[]}> $mutations
     * @param array<string, string> $translations
     */
    public function apply(array $mutations, array $translations, string $targetLanguage): void
    {
        foreach ($mutations as $mutation) {
            $data = $mutation['data'];
            $this->applyTranslations($data, $translations, $targetLanguage);
            $pageNodeIds = [];
            $this->collectPageNodeIds($data, $pageNodeIds);
            $this->localizePageUrls($data, $targetLanguage, $pageNodeIds);

            // JSON_HEX_TAG escapes "<" and ">" as < / > so a
            // translated value that happens to contain "</script>" cannot
            // break out of the surrounding <script> block. Slashes stay
            // unescaped to keep URL fields readable and identical to the
            // shape WordPress / Yoast emits originally.
            $encoded = wp_json_encode(
                $data,
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG
            );

            if (is_string($encoded)) {
                $mutation['node']->data = $encoded;
            }
        }
    }

    /**
     * @param array<mixed> $data
     * @param string[] $accumulator
     */
    private function collectStrings(
        $data,
        array &$accumulator,
        ?string $parentKey = null,
        bool $parentIsHowToStep = false
    ): void
    {
        if (is_array($data)) {
            $isHowToStep = in_array('HowToStep', $this->schemaTypes($data['@type'] ?? null), true);
            foreach ($data as $key => $value) {
                $childKey = is_string($key) ? $key : $parentKey;
                $this->collectStrings($value, $accumulator, $childKey, $isHowToStep);
            }

            return;
        }

        if (!is_string($data) || $parentKey === null) {
            return;
        }

        if (!$this->isTranslatableField($parentKey, $parentIsHowToStep)) {
            return;
        }

        $trimmed = trim($data);

        if ($trimmed === '' || mb_strlen($trimmed) < 2) {
            return;
        }

        $accumulator[] = $data;
    }

    /**
     * @param array<mixed> $data
     * @param array<string, string> $translations
     */
    private function applyTranslations(array &$data, array $translations, string $targetLanguage, ?string $parentKey = null): void
    {
        $isHowToStep = in_array('HowToStep', $this->schemaTypes($data['@type'] ?? null), true);
        foreach ($data as $key => &$value) {
            $childKey = is_string($key) ? $key : $parentKey;

            if (is_array($value)) {
                $this->applyTranslations($value, $translations, $targetLanguage, $childKey);
                continue;
            }

            if (!is_string($value) || $childKey === null) {
                continue;
            }

            if (in_array($childKey, self::LANGUAGE_KEYS, true)) {
                $value = $targetLanguage;
                continue;
            }

            if (
                $this->isTranslatableField($childKey, $isHowToStep)
                && isset($translations[$value])
            ) {
                $value = $translations[$value];
            }
        }
    }

    private function isTranslatableField(string $key, bool $isHowToStep): bool
    {
        return in_array($key, self::TRANSLATABLE_KEYS, true)
            || ($key === 'text' && $isHowToStep);
    }

    /**
     * Collects the original identities of internal page-like graph nodes before
     * any URL is rewritten. Untyped reference objects can then be localized by
     * exact graph identity without relying on a potentially incomplete list of
     * relationship property names.
     *
     * @param array<mixed> $data
     * @param array<string, true> $pageNodeIds
     */
    private function collectPageNodeIds(array $data, array &$pageNodeIds): void
    {
        $types = $this->schemaTypes($data['@type'] ?? null);
        $id = $data['@id'] ?? null;

        if (
            $this->hasPageRelatedType($types)
            && is_string($id)
            && $this->isInternalUrlReference($id)
        ) {
            $pageNodeIds[$id] = true;
        }

        foreach ($data as $value) {
            if (is_array($value)) {
                $this->collectPageNodeIds($value, $pageNodeIds);
            }
        }
    }

    /**
     * Localizes only page identities and page references. Restricting this to
     * page-like schema types keeps shared Person/Organization/Publisher IDs,
     * ImageObject URLs and other media or external resources untouched.
     *
     * @param array<mixed> $data
     * @param array<string, true> $pageNodeIds
     */
    private function localizePageUrls(
        array &$data,
        string $targetLanguage,
        array $pageNodeIds,
        bool $isPageReference = false
    ): void {
        if ($this->routing === null) {
            return;
        }

        $types = $this->schemaTypes($data['@type'] ?? null);
        $isListItem = in_array('ListItem', $types, true);
        $isPageEntity = $isPageReference
            || $this->hasPageRelatedType($types)
            || $this->isExactPageNodeReference($data, $pageNodeIds);

        foreach ($data as $key => &$value) {
            $key = is_string($key) ? $key : '';
            $childIsPageReference = ($isListItem && $key === 'item')
                || $key === 'mainEntityOfPage';

            if (is_array($value)) {
                $this->localizePageUrls($value, $targetLanguage, $pageNodeIds, $childIsPageReference);
                continue;
            }

            if (!is_string($value)) {
                continue;
            }

            $isOwnPageUrl = $isPageEntity && ($key === '@id' || $key === 'url');
            $isDirectPageReference = $childIsPageReference;

            if (($isOwnPageUrl || $isDirectPageReference) && $this->isUrlReference($value)) {
                $value = $this->routing->rewriteUrl($value, $targetLanguage);
            }
        }
        unset($value);
    }

    /**
     * @param array<mixed> $data
     * @param array<string, true> $pageNodeIds
     */
    private function isExactPageNodeReference(array $data, array $pageNodeIds): bool
    {
        if (count($data) !== 1 || !array_key_exists('@id', $data) || !is_string($data['@id'])) {
            return false;
        }

        return isset($pageNodeIds[$data['@id']]);
    }

    private function isInternalUrlReference(string $value): bool
    {
        if ($this->routing === null || !$this->isUrlReference($value) || str_starts_with($value, '//')) {
            return false;
        }

        if (preg_match('#^https?://#i', $value) !== 1) {
            return true;
        }

        $host = (string) wp_parse_url($value, PHP_URL_HOST);

        return $host !== '' && $this->routing->isInternalHost($host);
    }

    /** @return string[] */
    private function schemaTypes($value): array
    {
        $values = is_array($value) ? $value : [$value];
        $types = [];

        foreach ($values as $type) {
            if (!is_string($type) || trim($type) === '') {
                continue;
            }

            $normalized = preg_replace('~^.*[/#]~', '', trim($type));
            if (is_string($normalized) && $normalized !== '') {
                $types[] = $normalized;
            }
        }

        return $types;
    }

    /** @param string[] $types */
    private function hasPageRelatedType(array $types): bool
    {
        foreach ($types as $type) {
            if (in_array($type, self::PAGE_RELATED_TYPES, true) || str_ends_with($type, 'Page')) {
                return true;
            }
        }

        return false;
    }

    private function isUrlReference(string $value): bool
    {
        return preg_match('#^(?:https?://|/)#i', trim($value)) === 1;
    }

    private function firstTextChild(\DOMElement $element): ?\DOMText
    {
        foreach ($element->childNodes as $child) {
            if ($child instanceof \DOMText) {
                return $child;
            }
        }

        return null;
    }
}
