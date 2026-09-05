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
        'recipeInstructions',
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
        // Separate script blocks are part of the same document graph. Collect
        // every original identity before rewriting any definitions or references.
        $pageNodeIds = [];
        foreach ($mutations as $mutation) {
            $this->collectPageNodeIds($mutation['data'], $pageNodeIds);
        }

        foreach ($mutations as $mutation) {
            $data = $mutation['data'];
            $this->applyTranslations($data, $translations, $targetLanguage);
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
    private function collectStrings(array $data, array &$accumulator): void
    {
        $this->walk($data, function (&$value, ?string $property, array $parent, array $types) use (&$accumulator): array {
            if (
                is_string($value)
                && $property !== null
                && $this->isTranslatableField($property, $parent['isHowToStep'] ?? false)
                && mb_strlen(trim($value)) >= 2
            ) {
                $accumulator[] = $value;
            }

            return ['isHowToStep' => in_array('HowToStep', $types, true)];
        });
    }

    /**
     * @param array<mixed> $data
     * @param array<string, string> $translations
     */
    private function applyTranslations(array &$data, array $translations, string $targetLanguage): void
    {
        $this->walk($data, function (&$value, ?string $property, array $parent, array $types) use ($translations, $targetLanguage): array {
            if (is_string($value) && $property !== null) {
                if (in_array($property, self::LANGUAGE_KEYS, true)) {
                    $value = $targetLanguage;
                } elseif (
                    $this->isTranslatableField($property, $parent['isHowToStep'] ?? false)
                    && isset($translations[$value])
                ) {
                    $value = $translations[$value];
                }
            }

            return ['isHowToStep' => in_array('HowToStep', $types, true)];
        });
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
        $this->walk($data, function (&$value, ?string $property, array $parent, array $types) use (&$pageNodeIds): array {
            $id = is_array($value) ? ($value['@id'] ?? null) : null;
            if ($this->hasPageRelatedType($types) && is_string($id) && $this->isInternalUrlReference($id)) {
                $pageNodeIds[trim($id)] = true;
            }

            return [];
        });
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
        array $pageNodeIds
    ): void {
        if ($this->routing === null) {
            return;
        }

        $this->walk($data, function (&$value, ?string $property, array $parent, array $types) use ($targetLanguage, $pageNodeIds): array {
            $isPageUrl = ($parent['isPageEntity'] ?? false) && in_array($property, ['@id', 'url'], true);
            $isPageReference = $property === 'mainEntityOfPage'
                || ($property === 'item' && ($parent['isListItem'] ?? false))
                || ($property === 'url' && ($parent['isPageEntity'] ?? false));

            if (is_string($value) && ($isPageUrl || $isPageReference) && $this->isInternalUrlReference($value)) {
                $value = $this->routing->rewriteUrl(trim($value), $targetLanguage);
            }

            // A relationship can supply page semantics to an untyped reference,
            // but must not override an explicitly typed person or media entity.
            $isUntyped = is_array($value) && !array_key_exists('@type', $value);
            return [
                'isListItem' => in_array('ListItem', $types, true),
                'isPageEntity' => $this->hasPageRelatedType($types)
                    || ($isUntyped && ($isPageReference || $this->isExactPageNodeReference($value, $pageNodeIds))),
            ];
        });
    }

    /**
     * @param array<mixed> $data
     * @param array<string, true> $pageNodeIds
     */
    private function isExactPageNodeReference(array $data, array $pageNodeIds): bool
    {
        if (array_key_exists('@type', $data) || !isset($data['@id']) || !is_string($data['@id'])) {
            return false;
        }

        return isset($pageNodeIds[trim($data['@id'])]);
    }

    private function isInternalUrlReference(string $value): bool
    {
        $value = trim($value);
        if ($this->routing === null || !$this->isUrlReference($value) || str_starts_with($value, '//')) {
            return false;
        }

        if (preg_match('#^https?://#i', $value) !== 1) {
            return true;
        }

        $host = (string) wp_parse_url($value, PHP_URL_HOST);

        return $host !== '' && $this->routing->isInternalHost($host);
    }

    /**
     * One traversal contract for collection, translation and routing. Contexts
     * belong to their object and descendants; list elements retain the parent
     * property's semantics. Context definitions themselves are never visited.
     * Each script starts with a fresh scope, while callers may share graph IDs.
     *
     * Bare types keep the existing Schema.org default for context-free output.
     * An explicit null context or foreign vocabulary removes that default.
     *
     * @param mixed $value
     * @param callable $visitor Receives the value, property, parent state and resolved types; returns child state.
     * @param array{prefixes: array<string, string>, vocab: ?string}|null $context
     * @param array<string, mixed> $parent
     */
    private function walk(
        &$value,
        callable $visitor,
        ?array $context = null,
        ?string $property = null,
        array $parent = []
    ): void {
        $context = $context ?? ['prefixes' => [], 'vocab' => 'https://schema.org/'];

        if (is_array($value) && ($value === [] || array_keys($value) === range(0, count($value) - 1))) {
            foreach ($value as &$item) {
                $this->walk($item, $visitor, $context, $property, $parent);
            }
            unset($item);
            return;
        }

        $types = [];
        if (is_array($value)) {
            if (array_key_exists('@context', $value)) {
                $context = $this->resolveContext($value['@context'], $context);
            }
            $types = $this->schemaTypes($value['@type'] ?? null, $context);
        }

        $state = $visitor($value, $property, $parent, $types);
        if (!is_array($value)) {
            return;
        }

        foreach ($value as $key => &$child) {
            if ($key !== '@context') {
                $this->walk($child, $visitor, $context, is_string($key) ? $key : $property, $state);
            }
        }
        unset($child);
    }

    /**
     * Resolves local prefix/vocabulary definitions without fetching remote
     * contexts. Only the well-known Schema.org remote context is understood;
     * unknown remote contexts fail closed until a local definition restores
     * the relevant vocabulary or prefix.
     *
     * @param mixed $definition
     * @param array{prefixes: array<string, string>, vocab: ?string} $context
     * @return array{prefixes: array<string, string>, vocab: ?string}
     */
    private function resolveContext($definition, array $context): array
    {
        if ($definition === null) {
            return ['prefixes' => [], 'vocab' => null];
        }
        if (is_string($definition)) {
            if (preg_match('~^https?://schema\.org/?$~i', trim($definition)) === 1) {
                $context['vocab'] = 'https://schema.org/';
                return $context;
            }
            return ['prefixes' => [], 'vocab' => null];
        }
        if (!is_array($definition)) {
            return $context;
        }
        if ($definition === [] || array_keys($definition) === range(0, count($definition) - 1)) {
            foreach ($definition as $entry) {
                $context = $this->resolveContext($entry, $context);
            }
            return $context;
        }

        foreach ($definition as $term => $mapping) {
            if (!is_string($term) || str_starts_with($term, '@')) {
                continue;
            }
            $id = is_array($mapping) ? ($mapping['@id'] ?? null) : $mapping;
            $isPrefix = is_string($id) && (
                (is_array($mapping) && ($mapping['@prefix'] ?? null) === true)
                || (preg_match('~[/#:]$~', $id) === 1 && (!is_array($mapping) || ($mapping['@prefix'] ?? null) !== false))
            );
            if ($isPrefix) {
                $context['prefixes'][$term] = $id;
            } else {
                unset($context['prefixes'][$term]);
            }
        }

        if (array_key_exists('@vocab', $definition)) {
            $context['vocab'] = is_string($definition['@vocab'])
                ? $this->expandContextIri($definition['@vocab'], $context['prefixes'])
                : null;
        }
        return $context;
    }

    /** @param array<string, string> $prefixes */
    private function expandContextIri(string $value, array $prefixes, array $seen = []): string
    {
        $colon = strpos($value, ':');
        if ($colon === false || preg_match('~^https?://~i', $value) === 1) {
            return $value;
        }
        $prefix = substr($value, 0, $colon);
        if (!isset($prefixes[$prefix]) || isset($seen[$prefix])) {
            return $value;
        }
        $seen[$prefix] = true;
        return $this->expandContextIri($prefixes[$prefix], $prefixes, $seen) . substr($value, $colon + 1);
    }

    /**
     * @param array{prefixes: array<string, string>, vocab: ?string} $context
     * @return string[]
     */
    private function schemaTypes($value, array $context): array
    {
        $values = is_array($value) ? $value : [$value];
        $types = [];

        foreach ($values as $type) {
            if (!is_string($type) || trim($type) === '') {
                continue;
            }

            $type = trim($type);
            $iri = str_contains($type, ':')
                ? $this->expandContextIri($type, $context['prefixes'])
                : ($context['vocab'] ?? '') . $type;
            if (preg_match('~^https?://schema\.org[/#]([A-Za-z][A-Za-z0-9]*)$~', $iri, $match) === 1) {
                $types[] = $match[1];
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
