<?php

namespace Deepglot\Frontend;

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Support\TranslationCache;

/**
 * Parses an HTML document, extracts translatable text nodes, sends them
 * in one batch to the Deepglot API and replaces them with the translations.
 *
 * Uses PHP's built-in DOMDocument / DOMXPath – no external dependencies.
 */
class HtmlTranslator
{
    /** Tags whose text content must never be translated. */
    private const SKIP_TAGS = [
        'script', 'style', 'pre', 'code', 'textarea', 'noscript',
        'svg', 'math', 'head',
    ];

    /** Maximum number of text nodes sent in one API request. */
    private const BATCH_SIZE = 100;

    private Client $client;
    private Options $options;
    private TranslationCache $cache;

    public function __construct(Client $client, Options $options, TranslationCache $cache)
    {
        $this->client  = $client;
        $this->options = $options;
        $this->cache   = $cache;
    }

    /**
     * Translates all text nodes in the given HTML string from the source
     * language to $targetLanguage and returns the modified HTML.
     */
    public function translate(string $html, string $targetLanguage): string
    {
        if ($html === '') {
            return $html;
        }

        $sourceLang = $this->options->getSourceLanguage();

        $doc = $this->loadHtml($html);

        // Collect all translatable DOMText nodes.
        $nodes = $this->collectTextNodes($doc);

        if (empty($nodes)) {
            return $html;
        }

        // Deduplicate texts so we don't pay twice for the same string.
        $texts = array_values(array_unique(array_map(static fn(\DOMText $n) => $n->data, $nodes)));

        // Load from cache.
        $cached  = $this->cache->getMany($texts, $sourceLang, $targetLanguage);
        $missing = array_values(array_filter($texts, static fn(string $t) => !isset($cached[$t])));

        // Fetch missing translations from API in batches.
        $apiResults = [];

        foreach (array_chunk($missing, self::BATCH_SIZE) as $batch) {
            $result = $this->client->translate([
                'texts'    => $batch,
                'lang_to'  => $targetLanguage,
                'lang_from'=> $sourceLang,
            ]);

            if (!is_wp_error($result) && isset($result['translations']) && is_array($result['translations'])) {
                foreach ($result['translations'] as $item) {
                    if (isset($item['original'], $item['translated'])) {
                        $apiResults[$item['original']] = $item['translated'];
                    }
                }
            }
        }

        // Persist new translations in cache.
        if (!empty($apiResults)) {
            $this->cache->setMany($apiResults, $sourceLang, $targetLanguage);
        }

        $all = array_merge($cached, $apiResults);

        if (empty($all)) {
            return $html;
        }

        // Replace text node data in the DOM.
        foreach ($nodes as $node) {
            $original = $node->data;

            if (isset($all[$original])) {
                $node->data = $all[$original];
            }
        }

        return $this->saveHtml($doc);
    }

    // -------------------------------------------------------------------------
    // DOM helpers
    // -------------------------------------------------------------------------

    /**
     * @return \DOMText[]
     */
    private function collectTextNodes(\DOMDocument $doc): array
    {
        $xpath = new \DOMXPath($doc);

        // Build an XPath expression that skips all SKIP_TAGS.
        $skipConditions = array_map(
            static fn(string $tag) => 'ancestor-or-self::' . $tag,
            self::SKIP_TAGS
        );
        $skipExpr = implode(' or ', $skipConditions);

        // Also skip nodes that carry translate="no".
        $expr = '//text()[not(' . $skipExpr . ') and not(ancestor-or-self::*[@translate="no"])]';

        $textNodes = $xpath->query($expr);

        if ($textNodes === false) {
            return [];
        }

        $result = [];

        foreach ($textNodes as $node) {
            if (!$node instanceof \DOMText) {
                continue;
            }

            $trimmed = trim($node->data);

            // Skip whitespace-only nodes and very short fragments.
            if ($trimmed === '' || mb_strlen($trimmed) < 2) {
                continue;
            }

            // Skip nodes that are purely numeric / special characters.
            if (preg_match('/^[\d\s\p{P}\p{S}]+$/u', $trimmed)) {
                continue;
            }

            $result[] = $node;
        }

        return $result;
    }

    private function loadHtml(string $html): \DOMDocument
    {
        $doc = new \DOMDocument('1.0', 'UTF-8');

        libxml_use_internal_errors(true);

        // The meta charset hint ensures DOMDocument preserves UTF-8.
        $doc->loadHTML(
            '<?xml encoding="UTF-8">' . $html,
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOWARNING | LIBXML_NOERROR
        );

        libxml_clear_errors();

        return $doc;
    }

    private function saveHtml(\DOMDocument $doc): string
    {
        $html = $doc->saveHTML();

        if ($html === false) {
            return '';
        }

        // Remove the xml declaration we injected.
        $html = str_replace('<?xml encoding="UTF-8">', '', $html);

        return $html;
    }
}
