<?php

namespace Deepglot\Support;

/**
 * The single load/save gateway for every DOMDocument round-trip in the plugin.
 *
 * Why this class exists (issue #223):
 * PHP's DOMDocument::saveHTML() picks its output encoding by asking libxml for
 * the document's meta encoding. libxml only understands the CLASSIC form
 *
 *     <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
 *
 * WordPress emits the HTML5 short form `<meta charset="UTF-8">`, which libxml
 * 2.9 does NOT recognise. With no encoding it can read, libxml falls back to
 * its "HTML" output handler, which escapes every non-ASCII character as an HTML
 * entity. In text nodes that is harmless (browsers decode entities), but inside
 * <style> and <script> it is corruption — CSS and JS have no HTML entities, so
 * `content: "🇩🇪"` shipped as the literal text `content: "&#127465;&#127466;"`
 * and broke the language-switcher flags on meinhaushalt.at.
 *
 * The `<?xml encoding="UTF-8">` prefix only steers INPUT parsing; it has no
 * effect on output. Setting $doc->encoding after loadHTML() does not help
 * either. The only lever is the meta tag libxml actually reads, so load()
 * injects one and save() takes it back out.
 *
 * The pipeline round-trips a page TWICE (HtmlTranslator, then OutputBuffer for
 * links + hreflang), and entities inside raw-text elements never decode on
 * re-parse — so a half-fix cannot heal a document. Both serializers must go
 * through this class; that is why it is one shared helper and not a private
 * method copied into each.
 */
class HtmlDocument
{
    /**
     * Marks the meta tag we inject so save() can strip exactly the tag we
     * added and never one the page author wrote.
     */
    private const MARKER_ATTRIBUTE = 'data-deepglot-charset';

    private const LIBXML_FLAGS = LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOWARNING | LIBXML_NOERROR;

    /**
     * Parses $html and installs the encoding meta that makes saveHTML() emit
     * raw UTF-8 for the whole document.
     */
    public static function load(string $html): \DOMDocument
    {
        $doc = new \DOMDocument('1.0', 'UTF-8');

        libxml_use_internal_errors(true);

        // The xml prefix steers INPUT parsing (kept for the fragment case,
        // which carries no meta of its own).
        $doc->loadHTML('<?xml encoding="UTF-8">' . $html, self::LIBXML_FLAGS);

        libxml_clear_errors();

        if (!self::declaresConflictingCharset($html)) {
            self::injectEncodingMeta($doc);
        }

        return $doc;
    }

    /**
     * Serializes $doc as raw UTF-8 and removes the injected encoding meta.
     */
    public static function save(\DOMDocument $doc): string
    {
        $html = $doc->saveHTML();

        if ($html === false) {
            return '';
        }

        $html = self::stripEncodingMeta($doc, $html);

        // Remove the xml declaration we injected in load().
        return str_replace('<?xml encoding="UTF-8">', '', $html);
    }

    // -------------------------------------------------------------------------

    /**
     * libxml's htmlGetMetaEncoding() only scans the document's top-level
     * children and the direct children of <head>. So the meta goes first into
     * <head> when there is one, and otherwise straight onto the document —
     * which is what makes this work for FRAGMENTS, where LIBXML_HTML_NOIMPLIED
     * means no <head> is ever synthesized.
     *
     * Inserting first also means the tag we add is the first Content-Type meta
     * libxml finds, so it wins over a short `<meta charset>` further down.
     */
    private static function injectEncodingMeta(\DOMDocument $doc): void
    {
        $meta = $doc->createElement('meta');
        $meta->setAttribute('http-equiv', 'Content-Type');
        $meta->setAttribute('content', 'text/html; charset=utf-8');
        $meta->setAttribute(self::MARKER_ATTRIBUTE, '');

        $head = $doc->getElementsByTagName('head')->item(0);

        if ($head instanceof \DOMElement) {
            $head->insertBefore($meta, $head->firstChild);

            return;
        }

        // Fragment (or otherwise head-less document): a top-level meta is read
        // by libxml just the same. $doc->firstChild is null for empty input,
        // in which case insertBefore() simply appends.
        $doc->insertBefore($meta, $doc->firstChild);
    }

    /**
     * Removes the injected meta from the serialized output.
     *
     * The needle is produced by libxml itself (saveHTML($meta)), so it is
     * byte-identical to the substring inside the full dump — no guessing about
     * attribute order or quoting. Only the FIRST occurrence is replaced, and
     * the marker attribute guarantees that occurrence is ours.
     */
    private static function stripEncodingMeta(\DOMDocument $doc, string $html): string
    {
        $xpath = new \DOMXPath($doc);
        $nodes = $xpath->query('//meta[@' . self::MARKER_ATTRIBUTE . ']');

        if ($nodes === false) {
            return $html;
        }

        foreach ($nodes as $meta) {
            if (!$meta instanceof \DOMElement) {
                continue;
            }

            $needle = $doc->saveHTML($meta);

            if ($needle === false || $needle === '') {
                continue;
            }

            $position = strpos($html, $needle);

            if ($position !== false) {
                $html = substr_replace($html, '', $position, strlen($needle));
            }
        }

        return $html;
    }

    /**
     * True when the document declares a charset that is not UTF-8.
     *
     * Such a document is already parsed as that charset by libxml, so its text
     * lives in the DOM as mojibake and only survives because saveHTML() encodes
     * it straight back. Forcing UTF-8 output would turn that accidental
     * round-trip into permanent mojibake, so we leave those documents on the
     * legacy path — never worse than today.
     */
    private static function declaresConflictingCharset(string $html): bool
    {
        if (preg_match('/<meta[^>]*?charset\s*=\s*["\']?\s*([a-z0-9_.:-]+)/i', $html, $matches) !== 1) {
            return false;
        }

        $charset = strtolower($matches[1]);

        return $charset !== 'utf-8' && $charset !== 'utf8';
    }
}
