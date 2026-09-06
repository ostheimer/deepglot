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
     * Relevant definitions from Schema.org's published JSON-LD context. Keep
     * this local and bounded: recognizing its URL never performs a fetch.
     */
    private const SCHEMA_CONTEXT = [
        '@vocab' => 'http://schema.org/',
        'type' => '@type',
        'id' => '@id',
        'schema' => 'http://schema.org/',
        'xsd' => 'http://www.w3.org/2001/XMLSchema#',
        'rdf' => 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
        'rdfs' => 'http://www.w3.org/2000/01/rdf-schema#',
        'HTML' => ['@id' => 'rdf:HTML'],
        'url' => ['@id' => 'schema:url', '@type' => '@id'],
        'mainEntityOfPage' => ['@id' => 'schema:mainEntityOfPage', '@type' => '@id'],
        'isPartOf' => ['@id' => 'schema:isPartOf', '@type' => '@id'],
    ];

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

    // Bounded Schema.org taxonomy for the explicit Page + shared/media veto:
    // Organization and common business/education/group subtypes, plus media
    // assets and snapshots. This is an explicit list, not suffix inference or
    // runtime subclass expansion (schema.org/Organization, schema.org/MediaObject).
    // Reference inference instead uses the positive untyped/Thing-only model.
    private const SHARED_ENTITY_TYPES = [
        'Person',
        'Organization',
        'Airline',
        'Consortium',
        'Cooperative',
        'FundingScheme',
        'GovernmentOrganization',
        'LibrarySystem',
        'LocalBusiness',
        'NewsMediaOrganization',
        'OnlineBusiness',
        'PoliticalParty',
        'Project',
        'ResearchOrganization',
        'SearchRescueOrganization',
        'WorkersUnion',
        'Corporation',
        'NGO',
        'Restaurant',
        'Store',
        'MedicalOrganization',
        'MedicalClinic',
        'EducationalOrganization',
        'CollegeOrUniversity',
        'SportsOrganization',
        'SportsTeam',
        'PerformingGroup',
        'MusicGroup',
        'MediaObject',
        'AmpStory',
        'ImageObject',
        'LegislationObject',
        'TextObject',
        'VideoObject',
        'AudioObject',
        'DataDownload',
        '3DModel',
        'AudioObjectSnapshot',
        'ImageObjectSnapshot',
        'VideoObjectSnapshot',
        'MusicVideoObject',
    ];

    private const EMPTY_CONTEXT = [
        'prefixes' => [],
        'terms' => [],
        'coercions' => [],
        'reverses' => [],
        'containers' => [],
        'indexMappings' => [],
        'scopedContexts' => [],
        'languages' => [],
        'language' => null,
        'documentBase' => null,
        'base' => null,
        // False preserves root-relative compatibility when no document URL
        // was supplied. An explicit null/unknown base is not that fallback.
        'hasBase' => false,
        'vocab' => null,
        // Unlike the legacy property/type default, only a declared vocabulary
        // participates in expanding @vocab-coerced IRI values.
        'valueVocab' => null,
        'previousContext' => null,
    ];

    private ?SiteRouting $routing;
    /** @var array<string, true>|null Scheme/host/effective-port origins, built once per helper. */
    private ?array $internalOrigins = null;
    private ?string $sourceScheme = null;
    private ?string $sourceSitePath = null;

    public function __construct(?SiteRouting $routing = null)
    {
        $this->routing = $routing;
    }

    /**
     * @return array<int, array{node: \DOMText, data: array<mixed>, strings: string[], sourceLanguage: ?string, documentBase: ?string}>
     */
    public function collect(\DOMDocument $doc, ?string $targetLanguage = null, ?string $sourceLanguage = null): array
    {
        $sourceLanguage = $sourceLanguage ?? $this->routing?->getSourceLanguage();
        $documentBase = trim($doc->documentURI ?? '');
        $documentBase = $documentBase !== '' ? $documentBase : null;
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
            $this->collectStrings($decoded, $strings, $targetLanguage, $sourceLanguage, $documentBase);

            $mutations[] = [
                'node' => $textNode,
                'data' => $decoded,
                'strings' => array_values(array_unique($strings)),
                'sourceLanguage' => $sourceLanguage,
                'documentBase' => $documentBase,
            ];
        }

        return $mutations;
    }

    /**
     * @param array<int, array{node: \DOMText, data: array<mixed>, strings: string[], sourceLanguage?: ?string, documentBase?: ?string}> $mutations
     * @param array<string, string> $translations
     */
    public function apply(array $mutations, array $translations, string $targetLanguage): void
    {
        // Separate script blocks share one graph. Discover its safe edges once,
        // then propagate seeds before rewriting any of the original values.
        $pageNodeIds = $this->collectPageNodeIds($mutations);

        foreach ($mutations as $mutation) {
            $data = $mutation['data'];
            $this->applyTranslations($data, $translations, $targetLanguage, $mutation['sourceLanguage'] ?? null, $mutation['documentBase'] ?? null);
            $this->localizePageUrls($data, $targetLanguage, $pageNodeIds, $mutation['documentBase'] ?? null);

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
    private function collectStrings(array $data, array &$accumulator, ?string $targetLanguage, ?string $sourceLanguage, ?string $documentBase): void
    {
        $this->walk($data, function (&$value, ?string $property, array $parent, array $types, array $node) use (&$accumulator, $targetLanguage, $sourceLanguage): array {
            $texts = isset($node['valueKey']) ? [$value[$node['valueKey']]] : [$value];
            if (isset($node['languageMapNoneKeys'])) {
                if ($targetLanguage !== null && isset($node['languageMapNoneKeys'][$targetLanguage])) {
                    return [];
                }
                $texts = [];
                foreach ($value as $language => $bucket) {
                    if (!isset($node['languageMapNoneKeys'][$language])
                        && !$this->isSourceLanguageBucket($language, $sourceLanguage, $targetLanguage)) {
                        continue;
                    }
                    foreach (is_array($bucket) ? $bucket : [$bucket] as $text) {
                        $texts[] = $text;
                    }
                }
            }
            foreach ($texts as $text) {
                if (
                    is_string($text)
                    && $property !== null
                    && !($node['isIriCoerced'] ?? false)
                    && (!is_string($value) || ($node['allowsScalarProse'] ?? true))
                    && $this->isTranslatableField($property, $parent)
                    && $this->isSourceLiteral($node, $sourceLanguage, $targetLanguage)
                    && mb_strlen(trim($text)) >= 2
                ) {
                    $accumulator[] = $text;
                }
            }

            return $this->proseState($property, $parent, $types);
        }, $this->initialContext($documentBase));
    }

    /**
     * @param array<mixed> $data
     * @param array<string, string> $translations
     */
    private function applyTranslations(array &$data, array $translations, string $targetLanguage, ?string $sourceLanguage, ?string $documentBase): void
    {
        $this->walk($data, function (&$value, ?string $property, array $parent, array $types, array $node) use ($translations, $targetLanguage, $sourceLanguage): array {
            if (isset($node['languageMapNoneKeys'])) {
                if ($property !== null && $this->isTranslatableField($property, $parent)) {
                    $this->translateLanguageMap($value, $translations, $targetLanguage, $sourceLanguage, $node['languageMapNoneKeys']);
                }
                return [];
            }
            if (isset($node['valueKey'])) {
                $key = $node['valueKey'];
                if ($property !== null && !($node['isIriCoerced'] ?? false)) {
                    if (in_array($property, self::LANGUAGE_KEYS, true)) {
                        $value[$key] = $targetLanguage;
                    } elseif (
                        $this->isTranslatableField($property, $parent)
                        && $this->isSourceLiteral($node, $sourceLanguage, $targetLanguage)
                        && isset($translations[$value[$key]])
                    ) {
                        $value[$key] = $translations[$value[$key]];
                    } else {
                        return [];
                    }
                    if (isset($node['languageKey'])) {
                        $value[$node['languageKey']] = $targetLanguage;
                    }
                }
                return [];
            }
            if (is_string($value) && $property !== null && !($node['isIriCoerced'] ?? false)
                && ($node['allowsScalarProse'] ?? true)) {
                if (in_array($property, self::LANGUAGE_KEYS, true)) {
                    $value = $targetLanguage;
                } elseif (
                    $this->isTranslatableField($property, $parent)
                    && $this->isSourceLiteral($node, $sourceLanguage, $targetLanguage)
                    && isset($translations[$value])
                ) {
                    $value = $translations[$value];
                } else {
                    return [];
                }
                // Override only the changed literal, including language codes.
                // A context edit would also relabel untouched cache misses.
                if (isset($node['language'])) {
                    $value = ['@value' => $value, '@language' => $targetLanguage];
                }
            }

            return $this->proseState($property, $parent, $types);
        }, $this->initialContext($documentBase));
    }

    private function isTranslatableField(string $key, array $parent): bool
    {
        return in_array($key, self::TRANSLATABLE_KEYS, true)
            || ($key === 'text' && (($parent['isHowToStep'] ?? false) || ($parent['isRecipeDirection'] ?? false)))
            || ($key === 'itemListElement' && ($parent['isRecipeSection'] ?? false));
    }

    /** Sections/directions need recipe relationships; ordinary HowToStep text remains supported. */
    private function proseState(?string $property, array $parent, array $types): array
    {
        $isRecipeInstruction = $property === 'recipeInstructions'
            || ($property === 'itemListElement' && (($parent['isRecipeSection'] ?? false) || ($parent['isRecipeStep'] ?? false)));
        return [
            'isHowToStep' => in_array('HowToStep', $types, true),
            'isRecipeStep' => $isRecipeInstruction && in_array('HowToStep', $types, true),
            'isRecipeSection' => $isRecipeInstruction && in_array('HowToSection', $types, true),
            'isRecipeDirection' => $isRecipeInstruction && in_array('HowToDirection', $types, true),
        ];
    }

    /** Untagged prose is source copy; an explicit/effective tag must match the configured source. */
    private function isSourceLiteral(array $node, ?string $sourceLanguage, ?string $targetLanguage): bool
    {
        return !isset($node['language'])
            || $this->isSourceLanguageBucket($node['language'], $sourceLanguage, $targetLanguage);
    }

    /** Exact configured source only: neither regional nor unrelated buckets share a cache namespace. */
    private function isSourceLanguageBucket(string $language, ?string $sourceLanguage, ?string $targetLanguage): bool
    {
        return $sourceLanguage !== null && $sourceLanguage !== ''
            && strcasecmp($language, $sourceLanguage) === 0
            && ($targetLanguage === null || strcasecmp($language, $targetLanguage) !== 0);
    }

    /** Move only translated source values; untagged values stay in their bucket. */
    private function translateLanguageMap(array &$value, array $translations, string $targetLanguage, ?string $sourceLanguage, array $noneKeys): void
    {
        // This spelling cannot express the requested language in this context.
        // Preserve the whole map rather than silently creating untagged output.
        if (isset($noneKeys[$targetLanguage])) {
            return;
        }
        $targetKey = $targetLanguage;
        foreach ($value as $language => $_) {
            if (!isset($noneKeys[$language]) && strcasecmp($language, $targetLanguage) === 0) {
                $targetKey = $language;
                break;
            }
        }
        $translated = [];
        $preserveArray = false;
        foreach ($value as $language => $bucket) {
            $untagged = isset($noneKeys[$language]);
            if (!$untagged && !$this->isSourceLanguageBucket($language, $sourceLanguage, $targetLanguage)) {
                continue;
            }
            $remaining = [];
            $changed = false;
            foreach (is_array($bucket) ? $bucket : [$bucket] as $text) {
                if (is_string($text) && mb_strlen(trim($text)) >= 2 && isset($translations[$text])) {
                    $changed = true;
                    if ($untagged) {
                        $remaining[] = $translations[$text];
                    } else {
                        $translated[] = $translations[$text];
                        $preserveArray = $preserveArray || is_array($bucket);
                    }
                } else {
                    $remaining[] = $text;
                }
            }
            if (!$changed) {
                continue;
            }
            if ($remaining === []) {
                unset($value[$language]);
            } else {
                $value[$language] = is_array($bucket) ? $remaining : $remaining[0];
            }
        }
        if ($translated === []) {
            return;
        }
        if (array_key_exists($targetKey, $value)) {
            $existing = is_array($value[$targetKey]) ? $value[$targetKey] : [$value[$targetKey]];
            $value[$targetKey] = array_merge($existing, $translated);
        } else {
            $value[$targetKey] = $preserveArray || count($translated) > 1 ? $translated : $translated[0];
        }
    }

    /**
     * Build a graph of eligible object states and canonical identity states.
     * Object -> identity edges publish page IDs/URLs; identity -> object edges
     * promote only untyped/Thing-only definitions. Conditional url children use
     * object -> object edges. Explicit page types and direct safe relationships
     * are the only seeds, so unseeded cycles remain inert in either script order.
     *
     * Each document node is visited once, and the queue visits each reachable
     * state/edge at most once: no repeated full-graph fixed-point scans.
     *
     * @param array<int, array{data: array<mixed>}> $mutations
     * @return array<string, true>
     */
    private function collectPageNodeIds(array $mutations): array
    {
        $edges = [];
        $reachable = [];
        $queue = [];
        $objectCount = 0;
        $seed = static function (string $vertex) use (&$reachable, &$queue): void {
            if (!isset($reachable[$vertex])) {
                $reachable[$vertex] = true;
                $queue[] = $vertex;
            }
        };

        foreach ($mutations as $mutation) {
            $data = $mutation['data'];
            $this->walk($data, function (&$value, ?string $property, array $parent, array $types, array $node) use (&$edges, &$objectCount, $seed): array {
                $isExplicitPage = $this->hasPageRelatedType($types);
                $isGeneric = $node['canBePageReference'] ?? false;
                $directReference = $this->isDirectPageReference($property, $parent, $node);
                $parentVertex = $parent['pageVertex'] ?? null;
                $vertex = null;

                if ($isExplicitPage || $isGeneric) {
                    $vertex = 'node:' . $objectCount++;
                    if ($isExplicitPage || $directReference) {
                        $seed($vertex);
                    }
                    if ($isGeneric && $property === 'url' && $parentVertex !== null) {
                        $edges[$parentVertex][] = $vertex;
                    }
                    if (isset($node['idKey'])) {
                        $identity = 'id:' . $node['idKey'];
                        $edges[$vertex][] = $identity;
                        if ($isGeneric) {
                            $edges[$identity][] = $vertex;
                        }
                    }
                }
                if (isset($node['referenceKey'])) {
                    $identity = 'id:' . $node['referenceKey'];
                    if ($directReference) {
                        $seed($identity);
                    }
                    if ($parentVertex !== null && in_array($property, ['@id', 'url'], true)) {
                        $edges[$parentVertex][] = $identity;
                    }
                }

                return ['isListItem' => in_array('ListItem', $types, true), 'pageVertex' => $vertex];
            }, $this->initialContext($mutation['documentBase'] ?? null));
        }

        for ($cursor = 0; $cursor < count($queue); $cursor++) {
            foreach ($edges[$queue[$cursor]] ?? [] as $destination) {
                $seed($destination);
            }
        }

        $pageNodeIds = [];
        foreach ($reachable as $vertex => $_) {
            if (str_starts_with($vertex, 'id:')) {
                $pageNodeIds[substr($vertex, 3)] = true;
            }
        }
        return $pageNodeIds;
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
        ?string $documentBase
    ): void {
        if ($this->routing === null) {
            return;
        }

        $this->walk($data, function (&$value, ?string $property, array $parent, array $types, array $node) use ($targetLanguage, $pageNodeIds): array {
            $state = $this->pageSemantics($property, $parent, $types, $node, $pageNodeIds);
            if ($state['isPageUrlValue'] && isset($node['urlReference'])) {
                $localized = $this->preserveIriSuffix(
                    $node['urlReference'],
                    $this->routing->rewriteUrl($node['urlReference'], $targetLanguage)
                );
                if (isset($node['valueKey'])) {
                    $value[$node['valueKey']] = $localized;
                } else {
                    $value = $localized;
                }
            }

            return $state;
        }, $this->initialContext($documentBase));
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
        $isPageReference = $this->isDirectPageReference($property, $parent, $node)
            || ($property === 'url' && ($parent['isPageEntity'] ?? false));
        $reference = $node['referenceKey'] ?? null;
        $isCollectedScalarReference = is_string($reference)
            && in_array($property, ['isPartOf', 'breadcrumb'], true)
            && ($node['allowsIdReference'] ?? true)
            && isset($pageNodeIds[$reference]);
        $id = $node['idKey'] ?? null;

        return [
            'isListItem' => in_array('ListItem', $types, true),
            'isPageEntity' => $this->hasPageRelatedType($types)
                || (($node['canBePageReference'] ?? false) && (
                    $isPageReference || (is_string($id) && isset($pageNodeIds[$id]))
                )),
            'isPageUrlValue' => $isPageUrl || $isPageReference || $isCollectedScalarReference,
        ];
    }

    /** Relationships that establish a page target without a collected ID. */
    private function isDirectPageReference(?string $property, array $parent, array $node): bool
    {
        // Coercion controls scalar relationships, not explicit node references.
        // Both discovery and routing use this guard so literals cannot seed IDs.
        return (!array_key_exists('urlReference', $node) || ($node['allowsIdReference'] ?? true))
            && ($property === 'mainEntityOfPage'
                || ($property === 'item' && ($parent['isListItem'] ?? false)));
    }

    /**
     * Canonical graph identity only; never use this key as the output URL.
     * The already-validated internal reference is normalized to the source
     * site by SiteRouting, including language hosts/slugs and site subpaths.
     */
    private function pageIdentityKey(string $reference): string
    {
        return $this->preserveIriSuffix(
            $reference,
            $this->routing->buildUrlForLanguage($reference, $this->routing->getSourceLanguage())
        );
    }

    /** Empty query/fragment components are distinct IRI suffixes, not absent ones. */
    private function preserveIriSuffix(string $reference, string $routed): string
    {
        return substr($routed, 0, strcspn($routed, '?#'))
            . substr($reference, strcspn($reference, '?#'));
    }

    /** Expand terms/vocabulary only for @vocab scalars, then resolve the active base. */
    private function internalUrlReference($value, array $context, bool $vocabCoerced = false): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        if ($vocabCoerced) {
            // Do not apply the compatibility Schema.org vocabulary used for
            // bare properties/types to IRI values without a real @vocab.
            $context['vocab'] = $context['valueVocab'];
            $expanded = $this->termIri(trim($value), $context);
        } else {
            $expanded = $this->expandContextIri(trim($value), $context['prefixes']);
        }
        // A blank-node identifier is never an IRI relative to the document.
        if ($expanded !== null && str_starts_with($expanded, '_:')) {
            return null;
        }
        if ($expanded !== null && $context['hasBase']
            && preg_match('~^[A-Za-z][A-Za-z0-9+.-]*:~', $expanded) !== 1) {
            // Term/prefix/vocabulary expansion precedes document-relative
            // resolution. Removed/unknown bases still permit absolute IRIs,
            // but never reinterpret a relative value against the local site.
            $expanded = $this->resolveDocumentIri($expanded, $context['base']);
        }
        if ($expanded === null || !$this->isInternalUrlReference($expanded)) {
            return null;
        }
        if (str_starts_with($expanded, '//')) {
            // SiteRouting accepts absolute URLs, but deliberately leaves
            // network paths alone. Supply the source scheme only after the
            // network path's nonempty host has passed the internal-host guard.
            $scheme = $this->sourceScheme;
            if (!in_array($scheme, ['http', 'https'], true)) {
                return null;
            }
            $expanded = $scheme . ':' . $expanded;
        }
        return trim($expanded);
    }

    /** RFC 3986 section 5.2 resolution; preserve empty query/fragment components. */
    private function resolveDocumentIri(string $reference, ?string $base): ?string
    {
        $parts = $this->iriParts($reference);
        if ($parts === null) {
            return null;
        }
        if ($parts['scheme'] !== null) {
            $parts['path'] = $this->removeDotSegments($parts['path']);
        } else {
            $baseParts = $base !== null ? $this->iriParts($base) : null;
            if ($baseParts === null || $baseParts['scheme'] === null) {
                return null;
            }
            $parts['scheme'] = $baseParts['scheme'];
            if ($parts['authority'] !== null) {
                $parts['path'] = $this->removeDotSegments($parts['path']);
            } else {
                $parts['authority'] = $baseParts['authority'];
                if ($parts['path'] === '') {
                    $parts['path'] = $baseParts['path'];
                    $parts['query'] = $parts['query'] ?? $baseParts['query'];
                } else {
                    if (!str_starts_with($parts['path'], '/')) {
                        $slash = strrpos($baseParts['path'], '/');
                        $directory = $baseParts['authority'] !== null && $baseParts['path'] === ''
                            ? '/'
                            : ($slash === false ? '' : substr($baseParts['path'], 0, $slash + 1));
                        $parts['path'] = $directory . $parts['path'];
                    }
                    $parts['path'] = $this->removeDotSegments($parts['path']);
                }
            }
        }
        return $parts['scheme'] . ':'
            . ($parts['authority'] !== null ? '//' . $parts['authority'] : '')
            . $parts['path']
            . ($parts['query'] !== null ? '?' . $parts['query'] : '')
            . ($parts['fragment'] !== null ? '#' . $parts['fragment'] : '');
    }

    /** Split an IRI without decoding reserved characters or guessing an origin. */
    private function iriParts(string $iri): ?array
    {
        if (preg_match('~[\x00-\x20\x7f\\\\]~', $iri) === 1
            || preg_match('~^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?://([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$~D', $iri, $match, PREG_UNMATCHED_AS_NULL) !== 1) {
            return null;
        }
        return ['scheme' => $match[1], 'authority' => $match[2], 'path' => $match[3], 'query' => $match[4], 'fragment' => $match[5]];
    }

    /** RFC dot-segment removal preserves encoded segments and repeated slashes. */
    private function removeDotSegments(string $path): string
    {
        $output = '';
        while ($path !== '') {
            if (str_starts_with($path, '../') || str_starts_with($path, './')) {
                $path = substr($path, strpos($path, '/') + 1);
            } elseif (str_starts_with($path, '/./') || $path === '/.') {
                $path = '/' . substr($path, 3);
            } elseif (str_starts_with($path, '/../') || $path === '/..') {
                $path = '/' . substr($path, 4);
                $slash = strrpos($output, '/');
                $output = $slash === false ? '' : substr($output, 0, $slash);
            } elseif ($path === '.' || $path === '..') {
                $path = '';
            } else {
                $slash = strpos($path, '/', str_starts_with($path, '/') ? 1 : 0);
                $length = $slash === false ? strlen($path) : $slash;
                $output .= substr($path, 0, $length);
                $path = substr($path, $length);
            }
        }
        return $output;
    }

    /** A document supplies its own immutable initial base for every script/pass. */
    private function initialContext(?string $documentBase): array
    {
        return array_replace(self::EMPTY_CONTEXT, [
            'vocab' => 'https://schema.org/',
            'documentBase' => $documentBase,
            'base' => $documentBase !== null ? $this->resolveDocumentIri($documentBase, null) : null,
            'hasBase' => $documentBase !== null,
        ]);
    }

    /** Explicit null restores the original document base; unknown contexts do not. */
    private function resetContext(array $context, ?array $previousContext, bool $restoreDocumentBase): array
    {
        $initial = $this->initialContext($context['documentBase']);
        return array_replace(self::EMPTY_CONTEXT, [
            'documentBase' => $context['documentBase'],
            'base' => $restoreDocumentBase ? $initial['base'] : null,
            'hasBase' => $restoreDocumentBase ? $initial['hasBase'] : true,
            'previousContext' => $previousContext,
        ]);
    }

    private function isInternalUrlReference(string $value): bool
    {
        $value = trim($value);
        if ($this->routing === null || !$this->isUrlReference($value)) {
            return false;
        }

        $parts = wp_parse_url($value);
        if (!is_array($parts)) {
            return false;
        }
        $origins = $this->getInternalOrigins();
        if (preg_match('#^https?://#i', $value) === 1 || str_starts_with($value, '//')) {
            $host = $parts['host'] ?? '';
            $origin = $this->originKey($parts, $this->sourceScheme);
            if ($host === '' || !$this->routing->isInternalHost($host)
                || $origin === null || !isset($origins[$origin])) {
                return false;
            }
        }

        // Origin membership does not make a sibling WordPress installation
        // ours. Resolve literal escapes before comparing exact path segments.
        $path = $this->removeDotSegments($parts['path'] ?? '/');
        if ($this->sourceSitePath === null || ($this->sourceSitePath !== ''
            && $path !== $this->sourceSitePath
            && !str_starts_with($path, $this->sourceSitePath . '/'))) {
            return false;
        }

        // Host membership was checked above. Reuse the routing policy on the
        // normalized path without another host lookup or changing the IRI.
        return !$this->routing->isWordPressInfrastructureUrl('/' . ltrim($path, '/'));
    }

    /** Actual language hosts may use default ports even when the source does not. */
    private function getInternalOrigins(): array
    {
        if ($this->internalOrigins !== null) {
            return $this->internalOrigins;
        }
        $this->internalOrigins = [];
        $sourceLanguage = $this->routing->getSourceLanguage();
        $languages = array_unique(array_merge([$sourceLanguage], $this->routing->getTargetLanguages()));
        foreach ($languages as $language) {
            $parts = wp_parse_url($this->routing->buildUrlForLanguage('/', $language));
            if (!is_array($parts)) {
                continue;
            }
            if ($language === $sourceLanguage) {
                $this->sourceScheme = strtolower($parts['scheme'] ?? '');
                $this->sourceSitePath = rtrim($this->removeDotSegments($parts['path'] ?? '/'), '/');
            }
            $origin = $this->originKey($parts);
            if ($origin !== null) {
                $this->internalOrigins[$origin] = true;
            }
        }
        return $this->internalOrigins;
    }

    /** Scheme supplies an implicit port; network paths inherit the source scheme. */
    private function originKey(array $parts, ?string $fallbackScheme = null): ?string
    {
        $scheme = strtolower($parts['scheme'] ?? $fallbackScheme ?? '');
        if (empty($parts['host']) || !in_array($scheme, ['http', 'https'], true)) {
            return null;
        }
        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
        return $scheme . '://' . strtolower($parts['host']) . ':' . $port;
    }

    /**
     * One traversal contract for collection, translation and routing. Contexts
     * follow their values, with non-propagating scopes restored at the next node
     * boundary; list elements retain the parent property's semantics. Context
     * definitions themselves are never visited.
     * Each script starts with a fresh scope, while callers may share graph IDs.
     *
     * Bare types keep the existing Schema.org default for context-free output.
     * An explicit null context or foreign vocabulary removes that default.
     *
     * @param mixed $value
     * @param callable $visitor Receives value, semantic property, parent state, resolved types and node metadata; returns child state.
     * @param array<string, mixed>|null $context
     * @param array<string, mixed> $parent
     * @param array<string, mixed> $propertyMetadata
     * @param bool $containerValue False for array/wrapper elements, which are not fresh property values.
     * @param bool $fromMap Retain the incoming context for an index bucket's first node, not its descendants.
     */
    private function walk(
        &$value,
        callable $visitor,
        ?array $context = null,
        ?string $property = null,
        array $parent = [],
        array $propertyMetadata = [],
        bool $containerValue = true,
        bool $fromMap = false
    ): void {
        $context = $context ?? $this->initialContext(null);

        // JSON payloads, reverse edges and unsupported implicit-type maps
        // are opaque before any visitor or nested context can see them.
        if ($this->isOpaqueProperty($propertyMetadata)) {
            return;
        }

        // Identity/graph-ID maps need implicit identity semantics that this
        // helper does not implement. Never mistake buckets for ordinary nodes,
        // even when their payload contains recognizable prose or page types.
        if ($containerValue && ($propertyMetadata['hasIdMap'] ?? false) && is_array($value)
            && ($value === [] || array_keys($value) !== range(0, count($value) - 1))) {
            return;
        }

        // Property expansion establishes the term context before container or
        // recursive expansion. Arrays and wrappers retain it without repeating
        // this phase; actual object expansion reapplies the scope after rollback.
        $incomingTerm = $propertyMetadata['termKey'] ?? null;
        if ($containerValue && $incomingTerm !== null && array_key_exists($incomingTerm, $context['scopedContexts'])) {
            $context = $this->resolveContext($context['scopedContexts'][$incomingTerm], $context);
            if ($this->isOpaqueProperty($this->propertyMetadata($incomingTerm, $context))) {
                return;
            }
        }

        // Language maps expand directly from the incoming property context,
        // before node rollback or any contexts/keywords inside their payload.
        if ($containerValue && ($propertyMetadata['hasLanguageMap'] ?? false) && is_array($value)
            && ($value === [] || array_keys($value) !== range(0, count($value) - 1))) {
            $mapMetadata = $this->languageMapMetadata($value, $context);
            if ($mapMetadata !== null) {
                $visitor($value, $property, $parent, [], array_merge($propertyMetadata, $mapMetadata, ['isIriCoerced' => false]));
            }
            return;
        }

        // Plain index maps group values of the enclosing property. Their keys
        // never become properties or nodes. Custom index/graph maps require
        // additional semantics and remain entirely opaque in this helper.
        if ($containerValue && ($propertyMetadata['hasIndexMap'] ?? false) && is_array($value)
            && ($value === [] || array_keys($value) !== range(0, count($value) - 1))) {
            if ($propertyMetadata['isPlainIndexMap']) {
                foreach ($value as &$bucket) {
                    $this->walk($bucket, $visitor, $context, $property, $parent, $propertyMetadata, false, true);
                }
                unset($bucket);
            }
            return;
        }

        if (is_array($value) && ($value === [] || array_keys($value) === range(0, count($value) - 1))) {
            foreach ($value as &$item) {
                $this->walk($item, $visitor, $context, $property, $parent, $propertyMetadata, false, $fromMap);
            }
            unset($item);
            return;
        }

        $types = [];
        $isObject = is_array($value);
        $termKey = $propertyMetadata['termKey'] ?? null;
        $hasPropertyScope = $termKey !== null && array_key_exists($termKey, $context['scopedContexts']);
        $propertyScope = $hasPropertyScope ? $context['scopedContexts'][$termKey] : null;

        // Capture the property scope before reverting a type/non-propagating
        // context. Scalars and value/id-only maps retain the current scope.
        if ($isObject && !$fromMap && isset($context['previousContext']) && !$this->retainsContext($value, $context)) {
            $context = $context['previousContext'];
        }
        if ($hasPropertyScope && $isObject) {
            $context = $this->resolveContext($propertyScope, $context);
        }
        if ($termKey !== null && $this->isOpaqueProperty($this->propertyMetadata($termKey, $context))) {
            return;
        }
        if ($isObject && array_key_exists('@context', $value)) {
            $context = $this->resolveContext($value['@context'], $context);
        }
        $typeContext = $context;
        if ($isObject) {
            $context = $this->applyTypeScopes($value, $context);
        }
        if ($termKey !== null) {
            $propertyMetadata = $this->propertyMetadata($termKey, $context);
        }
        if ($this->isOpaqueProperty($propertyMetadata)) {
            return;
        }
        $node = $propertyMetadata;
        if ($isObject) {
            // A value object is a terminal literal, not a graph node. Validate
            // its complete envelope before any visitor can collect prose or IDs.
            $valueObject = $this->valueObjectMetadata($value, $context);
            if ($valueObject !== null) {
                if ($valueObject !== []) {
                    $literalMetadata = array_merge($propertyMetadata, $valueObject);
                    // Value objects do not inherit default/term language. This
                    // includes xsd:string literals, which remain untagged.
                    $literalMetadata['language'] = isset($valueObject['languageKey'])
                        ? $value[$valueObject['languageKey']]
                        : null;
                    // Only untagged, untyped, direction-free envelopes may
                    // represent URLs; @id never accepts a value object.
                    if (!isset($valueObject['typeKey'])
                        && !isset($valueObject['languageKey'])
                        && !isset($valueObject['directionKey'])
                        && in_array($property, ['url', 'mainEntityOfPage', 'item', 'isPartOf', 'breadcrumb'], true)) {
                        $literalMetadata['urlReference'] = $this->internalUrlReference($value[$valueObject['valueKey']], $context);
                        if ($literalMetadata['urlReference'] !== null) {
                            $literalMetadata['referenceKey'] = $this->pageIdentityKey($literalMetadata['urlReference']);
                        }
                    }
                    $visitor($value, $property, $parent, [], $literalMetadata);
                }
                return;
            }

            // Lists/sets are envelopes for the enclosing property's values,
            // not graph nodes. Keep its parent state and coercion metadata,
            // and never visit envelope metadata as independently named fields.
            $wrapper = $this->wrapperMetadata($value, $context);
            if ($wrapper !== null) {
                if ($wrapper !== []) {
                    $this->walk($value[$wrapper['valueKey']], $visitor, $context, $property, $parent, $propertyMetadata, false);
                }
                return;
            }

            $node['canBePageReference'] = true;
            $this->visitNodeProperties($value, $context, function (&$child, string $key, ?string $keyword) use (&$node, &$types, $context, $typeContext): void {
                if ($keyword === '@type') {
                    // A type scope may redefine its own class term. It affects
                    // properties, never the class identity that activated it.
                    $resolvedTypes = $this->schemaTypes($child, $typeContext);
                    $types = array_merge($types, $resolvedTypes);
                    $node['canBePageReference'] = $node['canBePageReference']
                        && $this->isExclusivelyGenericType($child, $resolvedTypes);
                } elseif ($keyword === '@id') {
                    $reference = $this->internalUrlReference($child, $context);
                    $node['idKey'] = $reference !== null ? $this->pageIdentityKey($reference) : null;
                }
            });
        } elseif (is_string($value)) {
            $node['language'] = $this->propertyLanguage($propertyMetadata['termKey'] ?? '', $context);
            $node['urlReference'] = $this->internalUrlReference($value, $context, $node['isVocabCoerced'] ?? false);
            if ($node['urlReference'] !== null) {
                $node['referenceKey'] = $this->pageIdentityKey($node['urlReference']);
            }
        }

        $state = $visitor($value, $property, $parent, $types, $node);
        // A visitor may replace a scalar with a tagged value object. It is
        // still terminal for this pass and must not be translated a second time.
        if (!$isObject || !is_array($value)) {
            return;
        }

        $this->visitNodeProperties($value, $context, function (&$child, string $key, ?string $semanticProperty) use ($visitor, $context, $state): void {
            $this->walk($child, $visitor, $context, $semanticProperty, $state, $this->propertyMetadata($key, $context));
        });
    }

    /**
     * @nest repeats property processing on the same node, not node expansion.
     * Collect nested types/IDs before the node visitor, then descend using that
     * single visitor state. Nesting does not apply local/type contexts, roll
     * back a scope, or create a graph vertex; actual child nodes still do.
     */
    private function visitNodeProperties(array &$value, array $context, callable $visit): void
    {
        foreach ($value as $key => &$child) {
            if ($key === '@context' || !is_string($key)) {
                continue;
            }
            $property = $this->semanticProperty($key, $context);
            if ($this->isOpaqueProperty($this->propertyMetadata($key, $context))) {
                continue;
            }
            if ($property !== '@nest') {
                $visit($child, $key, $property);
                continue;
            }
            if ($this->propertyMetadata($key, $context)['isJsonCoerced'] || !$this->validNest($child, $context)) {
                continue;
            }
            if ($child === [] || array_keys($child) === range(0, count($child) - 1)) {
                foreach ($child as &$group) {
                    $this->visitNodeProperties($group, $context, $visit);
                }
                unset($group);
            } else {
                $this->visitNodeProperties($child, $context, $visit);
            }
        }
        unset($child);
    }

    /** Validate the entire grouping before any of its properties are visited. */
    private function validNest($value, array $context): bool
    {
        if (!is_array($value)) {
            return false;
        }
        $groups = ($value === [] || array_keys($value) === range(0, count($value) - 1)) ? $value : [$value];
        foreach ($groups as $group) {
            if (!is_array($group) || ($group !== [] && array_keys($group) === range(0, count($group) - 1))) {
                return false;
            }
            foreach ($group as $key => $_) {
                if (is_string($key) && $this->semanticProperty($key, $context) === '@value') {
                    return false;
                }
            }
        }
        return true;
    }

    /** W3C expansion exceptions to previous-context rollback, before local @context. */
    private function retainsContext(array $value, array $context): bool
    {
        foreach ($value as $key => $_) {
            $keyword = is_string($key) ? $this->semanticProperty($key, $context) : null;
            if ($keyword === '@value' || ($keyword === '@id' && count($value) === 1)) {
                return true;
            }
        }
        return false;
    }

    /** Activate class-term contexts in lexical order from a fixed pre-scope snapshot. */
    private function applyTypeScopes(array $value, array $context): array
    {
        $typeContext = $context;
        $typeKeys = [];
        foreach ($value as $key => $_) {
            if (is_string($key) && $this->semanticProperty($key, $typeContext) === '@type') {
                $typeKeys[] = $key;
            }
        }
        sort($typeKeys, SORT_STRING);
        foreach ($typeKeys as $key) {
            $terms = is_array($value[$key]) ? $value[$key] : [$value[$key]];
            $terms = array_filter($terms, 'is_string');
            sort($terms, SORT_STRING);
            foreach ($terms as $term) {
                if (array_key_exists($term, $typeContext['scopedContexts'])) {
                    $context = $this->resolveContext($typeContext['scopedContexts'][$term], $context, false);
                }
            }
        }
        return $context;
    }

    /**
     * Resolve only the keywords and Schema.org properties used by this helper.
     * Explicit foreign, disabled or unsupported mappings never fall back to a
     * familiar original key. The original document keys remain unchanged.
     *
     * @param array<string, mixed> $context
     */
    private function semanticProperty(string $key, array $context): ?string
    {
        $iri = $this->termIri($key, $context);
        if (in_array($iri, ['@type', '@id', '@value', '@language', '@direction', '@list', '@set', '@index', '@nest', '@reverse'], true)) {
            return $iri;
        }
        if (!is_string($iri) || preg_match('~^(?i:https?://schema\.org)[/#]([A-Za-z][A-Za-z0-9]*)$~', $iri, $match) !== 1) {
            return null;
        }
        $property = $match[1];
        return in_array($property, self::TRANSLATABLE_KEYS, true)
            || in_array($property, self::LANGUAGE_KEYS, true)
            || in_array($property, ['text', 'url', 'item', 'itemListElement', 'mainEntityOfPage', 'isPartOf', 'breadcrumb'], true)
            ? $property
            : null;
    }

    /** @return array<string, mixed> */
    private function propertyMetadata(string $key, array $context): array
    {
        $coercion = $context['coercions'][$key] ?? null;
        $container = $context['containers'][$key] ?? null;
        $containers = is_array($container) ? $container : [$container];
        return [
            'termKey' => $key,
            'allowsIdReference' => !array_key_exists($key, $context['coercions']) || in_array($coercion, ['@id', '@vocab'], true),
            'isIriCoerced' => in_array($coercion, ['@id', '@vocab'], true),
            // Scalar coercions do not determine an explicit value object's
            // own datatype, nor the literals of a language-map container.
            'allowsScalarProse' => in_array($coercion, [null, '@none', 'http://www.w3.org/2001/XMLSchema#string'], true),
            'isVocabCoerced' => $coercion === '@vocab',
            'isJsonCoerced' => $coercion === '@json',
            'isReverse' => ($context['reverses'][$key] ?? false) || $this->termIri($key, $context) === '@reverse',
            'hasLanguageMap' => $container === '@language' || (is_array($container) && in_array('@language', $container, true)),
            'hasIdMap' => in_array('@id', $containers, true),
            'hasTypeMap' => in_array('@type', $containers, true),
            'hasIndexMap' => in_array('@index', $containers, true),
            'isPlainIndexMap' => in_array('@index', $containers, true)
                && array_diff($containers, ['@index', '@set']) === []
                && !array_key_exists($key, $context['indexMappings']),
        ];
    }

    /** All traversal passes share these unsupported-property boundaries. */
    private function isOpaqueProperty(array $metadata): bool
    {
        return ($metadata['isJsonCoerced'] ?? false)
            || ($metadata['isReverse'] ?? false)
            || ($metadata['hasTypeMap'] ?? false);
    }

    /** Validate every bucket before any visitor sees the map; keys are language tags, not properties. */
    private function languageMapMetadata(array $value, array $context): ?array
    {
        // Include aliases without a bucket too: a newly created target key
        // must not accidentally be an alias for the untagged @none bucket.
        $noneKeys = ['@none' => true];
        foreach ($context['terms'] as $term => $iri) {
            if ($iri === '@none') {
                $noneKeys[$term] = true;
            }
        }
        foreach ($value as $language => $bucket) {
            if (!is_string($language) || (is_array($bucket) && $bucket !== [] && array_keys($bucket) !== range(0, count($bucket) - 1))) {
                return null;
            }
            foreach (is_array($bucket) ? $bucket : [$bucket] as $text) {
                if ($text !== null && !is_string($text)) {
                    return null;
                }
            }
        }
        return ['languageMapNoneKeys' => $noneKeys];
    }

    /** Default/term language applies only to non-datatype-coerced strings. */
    private function propertyLanguage(string $key, array $context): ?string
    {
        $coercion = $context['coercions'][$key] ?? null;
        if ($coercion !== null && $coercion !== '@none') {
            return null;
        }
        $language = array_key_exists($key, $context['languages'])
            ? $context['languages'][$key]
            : $context['language'];
        return is_string($language) ? $language : null;
    }

    /**
     * null means an ordinary node; [] is a malformed recognized envelope.
     * A single list/set value permits only an optional string index and local
     * context. Keyword aliases retain their original spelling in the output.
     *
     * @return array{valueKey?: string}|null
     */
    private function wrapperMetadata(array $value, array $context): ?array
    {
        $metadata = [];
        $hasWrapper = false;
        $hasIndex = false;
        $valid = true;
        foreach ($value as $key => $child) {
            if ($key === '@context') {
                continue;
            }
            $property = is_string($key) ? $this->semanticProperty($key, $context) : null;
            if (in_array($property, ['@list', '@set'], true)) {
                $hasWrapper = true;
                $valid = $valid && !isset($metadata['valueKey']);
                $metadata['valueKey'] = $key;
            } elseif ($property === '@index') {
                $valid = $valid && !$hasIndex && is_string($child);
                $hasIndex = true;
            } else {
                $valid = false;
            }
        }
        return $hasWrapper ? ($valid ? $metadata : []) : null;
    }

    /**
     * null means an ordinary node; [] means an unsupported value object that
     * must stay entirely untouched. A string value permits either a language
     * tag/direction or the exact xsd:string datatype, plus local @context.
     * Tagged, directed and datatype literals never become URL references.
     *
     * @return array{valueKey?: string, languageKey?: string, directionKey?: string, typeKey?: string}|null
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
            } elseif ($property === '@direction') {
                $valid = $valid && !isset($metadata['directionKey']) && in_array($child, ['ltr', 'rtl'], true);
                $metadata['directionKey'] = $key;
            } elseif ($property === '@type') {
                $valid = $valid && !isset($metadata['typeKey']) && is_string($child)
                    && $this->termIri($child, $context) === 'http://www.w3.org/2001/XMLSchema#string';
                $metadata['typeKey'] = $key;
            } else {
                $valid = false;
            }
        }
        $valid = $valid && !(isset($metadata['typeKey']) && (isset($metadata['languageKey']) || isset($metadata['directionKey'])));
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
     * @param array<string, mixed> $context
     * @param bool $propagate Default false for type scopes, overridable by @propagate.
     * @param array<string, mixed>|null $scopeOrigin Shared rollback point for entries in one context array.
     * @return array<string, mixed>
     */
    private function resolveContext($definition, array $context, bool $propagate = true, ?array $scopeOrigin = null): array
    {
        $scopeOrigin = $scopeOrigin ?? $context;
        if (is_array($definition) && isset($definition['@propagate']) && is_bool($definition['@propagate'])) {
            $propagate = $definition['@propagate'];
        }
        if (!$propagate && !isset($context['previousContext'])) {
            $context['previousContext'] = $scopeOrigin;
        }
        if ($definition === null) {
            return $this->resetContext($context, $propagate ? null : $context, true);
        }
        if (is_string($definition)) {
            if ($this->isSchemaContext($definition)) {
                return $this->resolveContext(self::SCHEMA_CONTEXT, $context, $propagate, $scopeOrigin);
            }
            return $this->resetContext($context, $context['previousContext'], false);
        }
        if (!is_array($definition)) {
            return $context;
        }
        if ($definition === [] || array_keys($definition) === range(0, count($definition) - 1)) {
            foreach ($definition as $entry) {
                // Every entry in one context array shares its initial rollback
                // point; later non-propagating entries must not capture an
                // intermediate scope established by an earlier entry.
                $context = $this->resolveContext($entry, $context, $propagate, $scopeOrigin);
            }
            return $context;
        }

        if (array_key_exists('@import', $definition)) {
            // Import merges complete term definitions before processing them;
            // importing definitions replace, rather than recursively combine,
            // the imported ones. Unknown imports cannot preserve a guessed
            // vocabulary, but explicit local definitions can restore semantics.
            if (is_string($definition['@import']) && $this->isSchemaContext($definition['@import'])) {
                $definition = array_replace(self::SCHEMA_CONTEXT, $definition);
            } else {
                $context = $this->resetContext($context, $context['previousContext'], false);
            }
            unset($definition['@import']);
        }

        if (array_key_exists('@base', $definition)) {
            $context['base'] = is_string($definition['@base'])
                ? $this->resolveDocumentIri($definition['@base'], $context['base'])
                : null;
            $context['hasBase'] = true;
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
            $vocab = is_string($definition['@vocab'])
                ? $this->expandContextIri($definition['@vocab'], $context['prefixes'])
                : null;
            if ($vocab !== null && !str_starts_with($vocab, '_:')
                && preg_match('~^[A-Za-z][A-Za-z0-9+.-]*:~', $vocab) !== 1) {
                // An existing declared vocabulary concatenates relative IRIs
                // verbatim. Only its absence enables document-base resolution;
                // the context-free Schema.org compatibility default is not a
                // declaration. Never normalize an absolute concatenated IRI.
                $vocab = $context['valueVocab'] !== null
                    ? $context['valueVocab'] . $vocab
                    : $this->resolveDocumentIri($vocab, $context['base']);
            }
            $context['vocab'] = $vocab;
            $context['valueVocab'] = $vocab;
        }
        if (array_key_exists('@language', $definition)) {
            $context['language'] = is_string($definition['@language']) ? $definition['@language'] : null;
        }

        // Resolve dependent term definitions once, independently of key order.
        // Keep ordinary terms separate from prefixes: class aliases are not
        // namespace prefixes. Inherited terms are already expanded and frozen.
        $defined = [];
        foreach ($definition as $term => $mapping) {
            if (!is_string($term) || str_starts_with($term, '@')) {
                continue;
            }
            $this->resolveTerm($term, $definition, $context, $defined);
            if (is_array($mapping) && array_key_exists('@reverse', $mapping)) {
                $context['reverses'][$term] = true;
            } else {
                unset($context['reverses'][$term]);
            }
            // Property scopes and term language mappings are replaced with the
            // term definition, never inherited after an unscoped redefinition.
            foreach (['@context' => 'scopedContexts', '@language' => 'languages', '@container' => 'containers', '@index' => 'indexMappings'] as $keyword => $field) {
                if (is_array($mapping) && array_key_exists($keyword, $mapping)) {
                    $context[$field][$term] = $mapping[$keyword];
                } else {
                    unset($context[$field][$term]);
                }
            }
        }
        // Expand new coercions only after every local term is defined, so
        // keyword aliases work in either definition order. Inherited coercions
        // are already resolved and must not change when an alias is redefined.
        foreach ($definition as $term => $mapping) {
            if (!is_string($term) || str_starts_with($term, '@')) {
                continue;
            }
            if (is_array($mapping) && array_key_exists('@type', $mapping)) {
                $coercion = $mapping['@type'];
                $context['coercions'][$term] = is_string($coercion) ? $this->termIri($coercion, $context) : $coercion;
            } else {
                unset($context['coercions'][$term]);
            }
        }
        return $context;
    }

    private function isSchemaContext(string $definition): bool
    {
        return preg_match('~^(?i:https?://schema\.org)(?:/?|/docs/jsonldcontext\.json(?:ld)?)$~D', trim($definition)) === 1;
    }

    /**
     * The bounded local dependency resolver follows Create Term Definition's
     * defined/being-defined states. Cycles and disabled aliases resolve to null
     * without falling back to @vocab. Metadata stays on its own term definition.
     *
     * @param array<string, bool> $defined
     */
    private function resolveTerm(string $term, array $definition, array &$context, array &$defined): ?string
    {
        if (array_key_exists($term, $defined)) {
            return $defined[$term] ? $context['terms'][$term] : null;
        }
        $defined[$term] = false;
        $mapping = $definition[$term];
        $id = is_array($mapping)
            ? (array_key_exists('@reverse', $mapping) ? $mapping['@reverse']
                : (array_key_exists('@id', $mapping) ? $mapping['@id'] : $term))
            : $mapping;
        $iri = null;
        if (is_string($id)) {
            if (str_starts_with($id, '@')) {
                $iri = $id;
            } elseif ($id !== $term && array_key_exists($id, $definition)) {
                $iri = $this->resolveTerm($id, $definition, $context, $defined);
            } elseif ($id !== $term && array_key_exists($id, $context['terms'])) {
                $iri = $context['terms'][$id];
            } else {
                // A self mapping (explicit or implicit) expands using the
                // vocabulary/prefix, not an inherited definition of itself.
                $iri = str_contains($id, ':')
                    ? $this->expandContextIri($id, $context['prefixes'])
                    : ($context['vocab'] ?? '') . $id;
            }
        }
        $context['terms'][$term] = $iri;
        $defined[$term] = true;
        return $iri;
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
     * @param array<string, mixed> $context
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
            if (is_string($iri) && preg_match('~^(?i:https?://schema\.org)[/#]([A-Za-z0-9]+)$~', $iri, $match) === 1) {
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
