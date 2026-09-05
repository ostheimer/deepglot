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
     * handled separately; untyped or exclusively generic Thing references can
     * also match the collected graph identities.
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

    // Preserve the existing guard for explicit Page + shared/media multi-types.
    // Reference inference instead uses the positive untyped/Thing-only model.
    private const SHARED_ENTITY_TYPES = [
        'Person',
        'Organization',
        'MediaObject',
        'ImageObject',
        'VideoObject',
        'AudioObject',
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
        // Separate script blocks are part of the same document graph. Resolve
        // safe relationship identities to a fixed point before rewriting: a
        // newly identified generic definition can establish another page URL.
        // The set only grows from the finite original graph, so cycles without
        // a page seed stay inert and traversal order cannot affect the result.
        $pageNodeIds = [];
        do {
            $previousCount = count($pageNodeIds);
            foreach ($mutations as $mutation) {
                $this->collectPageNodeIds($mutation['data'], $pageNodeIds);
            }
        } while (count($pageNodeIds) !== $previousCount);

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
        $this->walk($data, function (&$value, ?string $property, array $parent, array $types, array $node) use (&$accumulator): array {
            $text = isset($node['valueKey']) ? $value[$node['valueKey']] : $value;
            if (
                is_string($text)
                && $property !== null
                && !($node['isIriCoerced'] ?? false)
                && $this->isTranslatableField($property, $parent['isHowToStep'] ?? false)
                && mb_strlen(trim($text)) >= 2
            ) {
                $accumulator[] = $text;
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
        $this->walk($data, function (&$value, ?string $property, array $parent, array $types, array $node) use ($translations, $targetLanguage): array {
            if (isset($node['valueKey'])) {
                $key = $node['valueKey'];
                if (
                    $property !== null
                    && $this->isTranslatableField($property, $parent['isHowToStep'] ?? false)
                    && isset($translations[$value[$key]])
                ) {
                    $value[$key] = $translations[$value[$key]];
                    if (isset($node['languageKey'])) {
                        $value[$node['languageKey']] = $targetLanguage;
                    }
                }
                return [];
            }
            if (is_string($value) && $property !== null) {
                if (in_array($property, self::LANGUAGE_KEYS, true)) {
                    $value = $targetLanguage;
                } elseif (
                    !($node['isIriCoerced'] ?? false)
                    && $this->isTranslatableField($property, $parent['isHowToStep'] ?? false)
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
     * Collects the original internal page identities from explicit page types
     * and safe relationships using exactly the same semantics as URL routing.
     * Untyped or exclusively generic Thing definitions can then inherit those
     * identities, including across script blocks and relationship chains.
     *
     * @param array<mixed> $data
     * @param array<string, true> $pageNodeIds
     */
    private function collectPageNodeIds(array $data, array &$pageNodeIds): void
    {
        $this->walk($data, function (&$value, ?string $property, array $parent, array $types, array $node) use (&$pageNodeIds): array {
            $state = $this->pageSemantics($property, $parent, $types, $node, $pageNodeIds);
            $id = $node['id'] ?? null;
            if ($state['isPageEntity'] && is_string($id)) {
                $pageNodeIds[$id] = true;
            }
            if ($state['isPageUrlValue'] && isset($node['urlReference'])) {
                $pageNodeIds[$node['urlReference']] = true;
            }

            return $state;
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

        $this->walk($data, function (&$value, ?string $property, array $parent, array $types, array $node) use ($targetLanguage, $pageNodeIds): array {
            $state = $this->pageSemantics($property, $parent, $types, $node, $pageNodeIds);
            if ($state['isPageUrlValue'] && isset($node['urlReference'])) {
                $value = $this->routing->rewriteUrl($node['urlReference'], $targetLanguage);
            }

            return $state;
        });
    }

    /**
     * One positive page-semantics model for identity discovery and routing.
     * Relationships or collected IDs can only promote untyped/Thing-only nodes;
     * specific, unresolved or invalid types never gain inferred page semantics.
     * isPartOf/breadcrumb scalars require an existing identity and cannot seed it.
     *
     * @param array<string, true> $pageNodeIds
     * @return array{isListItem: bool, isPageEntity: bool, isPageUrlValue: bool}
     */
    private function pageSemantics(?string $property, array $parent, array $types, array $node, array $pageNodeIds): array
    {
        $isPageUrl = ($parent['isPageEntity'] ?? false) && in_array($property, ['@id', 'url'], true);
        $isPageReference = $property === 'mainEntityOfPage'
            || ($property === 'item' && ($parent['isListItem'] ?? false))
            || ($property === 'url' && ($parent['isPageEntity'] ?? false));
        $reference = $node['urlReference'] ?? null;
        $isCollectedScalarReference = is_string($reference)
            && in_array($property, ['isPartOf', 'breadcrumb'], true)
            && ($node['allowsIdReference'] ?? true)
            && isset($pageNodeIds[$reference]);
        $id = $node['id'] ?? null;

        return [
            'isListItem' => in_array('ListItem', $types, true),
            'isPageEntity' => $this->hasPageRelatedType($types)
                || (($node['canBePageReference'] ?? false) && (
                    $isPageReference || (is_string($id) && isset($pageNodeIds[$id]))
                )),
            'isPageUrlValue' => $isPageUrl || $isPageReference || $isCollectedScalarReference,
        ];
    }

    /** Expand only local prefixes, never @base, terms or remote contexts. */
    private function internalUrlReference($value, array $context): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $expanded = $this->expandContextIri(trim($value), $context['prefixes']);
        return $this->isInternalUrlReference($expanded) ? trim($expanded) : null;
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
     * @param callable $visitor Receives value, semantic property, parent state, resolved types and node metadata; returns child state.
     * @param array{prefixes: array<string, string>, terms: array<string, ?string>, coercions: array<string, mixed>, vocab: ?string}|null $context
     * @param array<string, mixed> $parent
     * @param array<string, mixed> $propertyMetadata
     */
    private function walk(
        &$value,
        callable $visitor,
        ?array $context = null,
        ?string $property = null,
        array $parent = [],
        array $propertyMetadata = []
    ): void {
        $context = $context ?? ['prefixes' => [], 'terms' => [], 'coercions' => [], 'vocab' => 'https://schema.org/'];

        if (is_array($value) && ($value === [] || array_keys($value) === range(0, count($value) - 1))) {
            foreach ($value as &$item) {
                $this->walk($item, $visitor, $context, $property, $parent, $propertyMetadata);
            }
            unset($item);
            return;
        }

        $types = [];
        $node = $propertyMetadata;
        if (is_array($value)) {
            if (array_key_exists('@context', $value)) {
                $context = $this->resolveContext($value['@context'], $context);
            }
            // A value object is a terminal literal, not a graph node. Validate
            // its complete envelope before any visitor can collect prose or IDs.
            $valueObject = $this->valueObjectMetadata($value, $context);
            if ($valueObject !== null) {
                if ($valueObject !== []) {
                    $visitor($value, $property, $parent, [], $valueObject);
                }
                return;
            }

            $node['canBePageReference'] = true;
            foreach ($value as $key => $child) {
                $keyword = is_string($key) ? $this->semanticProperty($key, $context) : null;
                if ($keyword === '@type') {
                    $resolvedTypes = $this->schemaTypes($child, $context);
                    $types = array_merge($types, $resolvedTypes);
                    $node['canBePageReference'] = $node['canBePageReference']
                        && $this->isExclusivelyGenericType($child, $resolvedTypes);
                } elseif ($keyword === '@id') {
                    $node['id'] = $this->internalUrlReference($child, $context);
                }
            }
        } elseif (is_string($value)) {
            $node['urlReference'] = $this->internalUrlReference($value, $context);
        }

        $state = $visitor($value, $property, $parent, $types, $node);
        if (!is_array($value)) {
            return;
        }

        foreach ($value as $key => &$child) {
            if ($key !== '@context') {
                $semanticProperty = is_string($key) ? $this->semanticProperty($key, $context) : $property;
                $metadata = is_string($key) ? $this->propertyMetadata($key, $context) : $propertyMetadata;
                $this->walk($child, $visitor, $context, $semanticProperty, $state, $metadata);
            }
        }
        unset($child);
    }

    /**
     * Resolve only the keywords and Schema.org properties used by this helper.
     * Explicit foreign, disabled or unsupported mappings never fall back to a
     * familiar original key. The original document keys remain unchanged.
     *
     * @param array{prefixes: array<string, string>, terms: array<string, ?string>, coercions: array<string, mixed>, vocab: ?string} $context
     */
    private function semanticProperty(string $key, array $context): ?string
    {
        $iri = $this->termIri($key, $context);
        if (in_array($iri, ['@type', '@id', '@value', '@language'], true)) {
            return $iri;
        }
        if (!is_string($iri) || preg_match('~^https?://schema\.org[/#]([A-Za-z][A-Za-z0-9]*)$~', $iri, $match) !== 1) {
            return null;
        }
        $property = $match[1];
        return in_array($property, self::TRANSLATABLE_KEYS, true)
            || in_array($property, self::LANGUAGE_KEYS, true)
            || in_array($property, ['text', 'url', 'item', 'mainEntityOfPage', 'isPartOf', 'breadcrumb'], true)
            ? $property
            : null;
    }

    /** @return array{allowsIdReference: bool, isIriCoerced: bool} */
    private function propertyMetadata(string $key, array $context): array
    {
        $coercion = $context['coercions'][$key] ?? null;
        return [
            'allowsIdReference' => !array_key_exists($key, $context['coercions']) || $coercion === '@id',
            'isIriCoerced' => in_array($coercion, ['@id', '@vocab'], true),
        ];
    }

    /**
     * null means an ordinary node; [] means an unsupported value object that
     * must stay entirely untouched. Only one string value and an optional string
     * language tag (plus the literal local @context) form the supported envelope.
     *
     * @return array{valueKey?: string, languageKey?: string}|null
     */
    private function valueObjectMetadata(array $value, array $context): ?array
    {
        $metadata = [];
        $hasValue = false;
        $valid = true;
        foreach ($value as $key => $child) {
            if ($key === '@context') {
                continue;
            }
            $property = is_string($key) ? $this->semanticProperty($key, $context) : null;
            if ($property === '@value') {
                $hasValue = true;
                $valid = $valid && !isset($metadata['valueKey']) && is_string($child);
                $metadata['valueKey'] = $key;
            } elseif ($property === '@language') {
                $valid = $valid && !isset($metadata['languageKey']) && is_string($child);
                $metadata['languageKey'] = $key;
            } else {
                $valid = false;
            }
        }
        return $hasValue ? ($valid ? $metadata : []) : null;
    }

    private function termIri(string $term, array $context): ?string
    {
        if (str_starts_with($term, '@')) {
            return $term;
        }
        if (array_key_exists($term, $context['terms'])) {
            return $context['terms'][$term];
        }
        return str_contains($term, ':')
            ? $this->expandContextIri($term, $context['prefixes'])
            : (($context['vocab'] ?? '') . $term);
    }

    /** @param string[] $types */
    private function isExclusivelyGenericType($value, array $types): bool
    {
        if (is_array($value) && ($value === [] || array_keys($value) !== range(0, count($value) - 1))) {
            return false;
        }
        $values = is_array($value) ? $value : [$value];

        // Resolution deliberately drops foreign/invalid types for other uses;
        // cardinality keeps those raw values from making a mixed type generic.
        return $types !== []
            && count($types) === count($values)
            && array_diff($types, ['Thing']) === [];
    }

    /**
     * Resolves local term/prefix/vocabulary definitions without fetching remote
     * contexts. Only the well-known Schema.org remote context is understood;
     * unknown remote contexts fail closed until a local definition restores
     * the relevant vocabulary or prefix.
     *
     * @param mixed $definition
     * @param array{prefixes: array<string, string>, terms: array<string, ?string>, coercions: array<string, mixed>, vocab: ?string} $context
     * @return array{prefixes: array<string, string>, terms: array<string, ?string>, coercions: array<string, mixed>, vocab: ?string}
     */
    private function resolveContext($definition, array $context): array
    {
        if ($definition === null) {
            return ['prefixes' => [], 'terms' => [], 'coercions' => [], 'vocab' => null];
        }
        if (is_string($definition)) {
            if (preg_match('~^(?i:https?://schema\.org)(?:/?|/docs/jsonldcontext\.json(?:ld)?)$~D', trim($definition)) === 1) {
                $context['vocab'] = 'https://schema.org/';
                return $context;
            }
            return ['prefixes' => [], 'terms' => [], 'coercions' => [], 'vocab' => null];
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

        // Resolve ordinary term definitions after all prefixes in this scope are
        // known. Keep them separate: a class alias must never become an IRI prefix.
        // Storing null explicitly also prevents a disabled term falling back to
        // the default vocabulary during type resolution.
        foreach ($definition as $term => $mapping) {
            if (!is_string($term) || str_starts_with($term, '@')) {
                continue;
            }
            $id = is_array($mapping)
                ? (array_key_exists('@id', $mapping) ? $mapping['@id'] : $term)
                : $mapping;
            $context['terms'][$term] = is_string($id)
                ? (str_starts_with($id, '@')
                    ? $id
                    : (str_contains($id, ':')
                        ? $this->expandContextIri($id, $context['prefixes'])
                        : ($context['vocab'] ?? '') . $id))
                : null;
            // Keep coercion independent of the resolved property IRI. An
            // override without @type removes inherited coercion in this scope.
            if (is_array($mapping) && array_key_exists('@type', $mapping)) {
                $context['coercions'][$term] = $mapping['@type'];
            } else {
                unset($context['coercions'][$term]);
            }
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
     * @param array{prefixes: array<string, string>, terms: array<string, ?string>, coercions: array<string, mixed>, vocab: ?string} $context
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
            $iri = $this->termIri($type, $context);
            if (is_string($iri) && preg_match('~^https?://schema\.org[/#]([A-Za-z][A-Za-z0-9]*)$~', $iri, $match) === 1) {
                $types[] = $match[1];
            }
        }

        return $types;
    }

    /** @param string[] $types */
    private function hasPageRelatedType(array $types): bool
    {
        if ($this->hasSharedEntityType($types)) {
            return false;
        }
        foreach ($types as $type) {
            if (in_array($type, self::PAGE_RELATED_TYPES, true) || str_ends_with($type, 'Page') || str_ends_with($type, 'Article')) {
                return true;
            }
        }

        return false;
    }

    /** @param string[] $types */
    private function hasSharedEntityType(array $types): bool
    {
        return array_intersect($types, self::SHARED_ENTITY_TYPES) !== [];
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
