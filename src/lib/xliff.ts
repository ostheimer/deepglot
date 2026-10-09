import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";

import { computeTranslationHash } from "@/lib/translation-hash";

export const XLIFF_MAX_BYTES = 4_000_000;
export const XLIFF_MAX_SEGMENTS = 5000;
const NS = "urn:oasis:names:tc:xliff:document:1.2";
const EXT_NS = "https://deepglot.ai/ns/xliff";

export type XliffSegment = {
  id: string;
  source: string;
  target: string;
  approved: boolean;
  manual: boolean;
  line: number;
};

export class XliffError extends Error {
  constructor(public readonly detail: string, public readonly line = 0) {
    super(line ? `Segment ${line}: ${detail}` : detail);
    this.name = "XliffError";
  }
}

export function planXliffImport(
  rows: readonly XliffSegment[],
  existing: readonly { originalHash: string; translatedText: string; isManual: boolean; workflowStatus: string }[],
  applyApproved: boolean,
) {
  const current = new Map(existing.map((item) => [item.originalHash, item]));
  const issues: Array<{ segment: number; message: string }> = [];
  for (const row of rows) {
    const item = current.get(row.id);
    if (row.approved && !applyApproved) issues.push({ segment: row.line, message: "Approval requires explicit manager confirmation" });
    if (item && item.translatedText !== row.target && (item.isManual || item.workflowStatus === "APPROVED")) {
      issues.push({ segment: row.line, message: "Existing manual or approved translation differs" });
    }
  }
  return issues;
}

function escapeXml(value: string): string {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if ((point < 0x20 && point !== 0x09 && point !== 0x0a && point !== 0x0d) ||
        (point >= 0xd800 && point <= 0xdfff) || point === 0xfffe || point === 0xffff) {
      throw new XliffError("Translation contains a character unsupported by XML 1.0");
    }
  }
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\r/g, "&#13;");
}

export function serializeXliff(input: {
  projectId: string;
  langFrom: string;
  langTo: string;
  segments: Array<{ originalText: string; translatedText: string; workflowStatus: string; isManual?: boolean;
    originalHash?: string; langFrom?: string; langTo?: string }>;
}): string {
  const units = input.segments.map((item) => {
    const id = item.originalHash ?? computeTranslationHash(item.originalText, input.langFrom, input.langTo);
    if (id !== computeTranslationHash(item.originalText, item.langFrom ?? input.langFrom, item.langTo ?? input.langTo)) {
      throw new XliffError("Stored segment ID does not match its source and languages");
    }
    return `    <trans-unit id="${id}" approved="${item.workflowStatus === "APPROVED" ? "yes" : "no"}" dg:manual="${item.isManual === false ? "no" : "yes"}"><source>${escapeXml(item.originalText)}</source><target>${escapeXml(item.translatedText)}</target></trans-unit>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xliff xmlns="${NS}" xmlns:dg="${EXT_NS}" version="1.2"><file original="${escapeXml(input.projectId)}" source-language="${escapeXml(input.langFrom)}" target-language="${escapeXml(input.langTo)}" datatype="plaintext"><body>\n${units.join("\n")}\n</body></file></xliff>\n`;
}

function children(element: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) result.push(node as XmlElement);
    else if (node.nodeType !== 3 && node.nodeType !== 4) throw new XliffError("Unsupported XML node");
    else if ((node.nodeType === 3 || node.nodeType === 4) && node.nodeValue?.trim()) throw new XliffError("Unexpected text outside a segment");
  }
  return result;
}

function textOnly(element: XmlElement, line: number): string {
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 3 && node.nodeType !== 4) {
      throw new XliffError("Inline XLIFF elements are unsupported; keep inline markup as escaped text", line);
    }
  }
  return element.textContent ?? "";
}

/** Parses the documented Deepglot XLIFF 1.2 subset. It never resolves external entities. */
export function parseXliff(bytes: Uint8Array, expected: {
  projectId: string;
  langFrom: string;
  langTo: string;
}, options: { allowPersistedIds?: boolean } = {}): XliffSegment[] {
  if (bytes.byteLength > XLIFF_MAX_BYTES) throw new XliffError("File exceeds 4 MB");
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new XliffError("File is not valid UTF-8"); }
  const declaration = xml.match(/^\uFEFF?<\?xml\s+([^?]+)\?>/i);
  if (declaration) {
    const encoding = declaration[1].match(/\bencoding\s*=\s*["']([^"']+)["']/i)?.[1];
    if (encoding && !/^utf-8$/i.test(encoding)) throw new XliffError("XML declaration must specify UTF-8");
  }
  if (/\0/.test(xml)) {
    throw new XliffError("DTD, entities, processing instructions, and NUL are forbidden");
  }
  let markupCount = 0;
  for (let position = declaration?.[0].length ?? 0; position < xml.length;) {
    if (xml[position] === "<" && ++markupCount > XLIFF_MAX_SEGMENTS * 6 + 20) {
      throw new XliffError("Too many XML nodes (maximum 5000 segments)");
    }
    if (xml.startsWith("<!--", position) || xml.startsWith("<![CDATA[", position)) {
      const end = xml.indexOf(xml.startsWith("<!--", position) ? "-->" : "]]>", position + 4);
      if (end < 0) throw new XliffError("Invalid XML: unterminated comment or CDATA");
      position = end + 3;
    } else {
      if (xml.startsWith("<?", position) || /^<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml.slice(position, position + 24))) {
        throw new XliffError("DTD, entities, processing instructions, and NUL are forbidden");
      }
      position++;
    }
  }
  const errors: string[] = [];
  let document;
  try {
    document = new DOMParser({ onError: (_level, message) => { errors.push(message); } }).parseFromString(xml, "application/xml");
  } catch (error) {
    throw new XliffError(`Invalid XML: ${error instanceof Error ? error.message : "parse error"}`);
  }
  if (errors.length || !document?.documentElement) throw new XliffError(`Invalid XML: ${errors[0] ?? "missing root"}`);
  const root = document.documentElement;
  if (root.localName !== "xliff" || root.namespaceURI !== NS || root.getAttribute("version") !== "1.2") {
    throw new XliffError("Expected XLIFF 1.2 namespace and version");
  }
  const files = children(root);
  if (files.length !== 1 || files[0].localName !== "file" || files[0].namespaceURI !== NS) throw new XliffError("Expected exactly one file");
  const file = files[0];
  if (file.getAttribute("original") !== expected.projectId ||
      file.getAttribute("source-language") !== expected.langFrom ||
      file.getAttribute("target-language") !== expected.langTo) {
    throw new XliffError("Project or language pair does not match this import");
  }
  const bodies = children(file);
  if (bodies.length !== 1 || bodies[0].localName !== "body" || bodies[0].namespaceURI !== NS) throw new XliffError("Expected exactly one body");
  const units = children(bodies[0]);
  if (units.length > XLIFF_MAX_SEGMENTS) throw new XliffError("Too many segments (maximum 5000)");
  const seen = new Set<string>();
  return units.map((unit, index) => {
    const line = index + 1;
    if (unit.localName !== "trans-unit" || unit.namespaceURI !== NS) throw new XliffError("Expected trans-unit", line);
    const parts = children(unit);
    if (parts.length !== 2 || parts[0].localName !== "source" || parts[1].localName !== "target" || parts.some((part) => part.namespaceURI !== NS)) {
      throw new XliffError("Expected one source followed by one target", line);
    }
    const source = textOnly(parts[0], line);
    const target = textOnly(parts[1], line);
    if (!source || !target) throw new XliffError("Source and target must not be empty", line);
    const id = unit.getAttribute("id") ?? "";
    if (id !== computeTranslationHash(source, expected.langFrom, expected.langTo)
        && (!options.allowPersistedIds || !/^[a-f0-9]{32}$/.test(id))) {
      throw new XliffError("Segment ID does not match its source and languages", line);
    }
    const canonicalId = computeTranslationHash(source, expected.langFrom.toLowerCase(), expected.langTo.toLowerCase());
    if (seen.has(canonicalId)) throw new XliffError("Duplicate segment ID", line);
    seen.add(canonicalId);
    const approved = unit.hasAttribute("approved") ? unit.getAttribute("approved") : "no";
    if (approved !== "yes" && approved !== "no") throw new XliffError("approved must be yes or no", line);
    const manual = unit.hasAttributeNS(EXT_NS, "manual") ? unit.getAttributeNS(EXT_NS, "manual") : null;
    if (manual !== null && manual !== "yes" && manual !== "no") throw new XliffError("dg:manual must be yes or no", line);
    return { id, source, target, approved: approved === "yes", manual: manual !== "no", line };
  });
}
