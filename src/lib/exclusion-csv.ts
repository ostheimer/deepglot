import { normalizeExclusionInput, type NormalizedExclusion } from "@/lib/exclusions";

export const MAX_EXCLUSION_CSV_BYTES = 128 * 1024;
export const MAX_EXCLUSION_CSV_ROWS = 100;
const MAX_EXCLUSION_CSV_ISSUES = 100;

export type ExclusionCsvRow = NormalizedExclusion & { line: number };
export type ExclusionCsvIssue = { line: number; message: string };

function validRule(rule: NormalizedExclusion): string | null {
  if (rule.value.length > 2000) return "Value exceeds 2000 characters";
  if (/[\u0000-\u001f\u007f]/u.test(rule.value)) return "Control characters are not allowed";
  if (rule.type === "CSS_CLASS" || rule.type === "CSS_ID") {
    // The WordPress PHP and JS runtimes compare one literal class/ID token.
    if (/\s/u.test(rule.value)) return "Use one CSS class or ID name";
  }
  return null;
}

/** Strict two-column CSV parser. Row numbers track physical lines, including quoted newlines. */
export function parseExclusionCsv(content: string): { rows: ExclusionCsvRow[]; issues: ExclusionCsvIssue[] } {
  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let recordLine = 1;
  const issues: ExclusionCsvIssue[] = [];
  const addIssue = (issue: ExclusionCsvIssue) => {
    if (issues.length < MAX_EXCLUSION_CSV_ISSUES) issues.push(issue);
    else if (issues.length === MAX_EXCLUSION_CSV_ISSUES) {
      issues.push({ line: issue.line, message: "Too many CSV errors; fix the first 100" });
    }
  };
  const finish = () => {
    fields.push(field);
    if (fields.some((value) => value.trim() !== "")) records.push({ line: recordLine, fields });
    fields = []; field = ""; closedQuote = false; recordLine = line + 1;
  };
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (char === '"' && content[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else { field += char; if (char === "\n") line++; }
    } else if (char === '"') {
      if (field !== "" || closedQuote) addIssue({ line, message: "Unexpected quote" });
      else quoted = true;
    } else if (char === ",") { fields.push(field); field = ""; closedQuote = false; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[i + 1] === "\n") i++;
      finish(); line++;
    } else {
      if (closedQuote && char !== " " && char !== "\t") addIssue({ line, message: "Unexpected text after quote" });
      field += char;
    }
  }
  if (quoted) addIssue({ line: recordLine, message: "Unclosed quoted value" });
  if (field !== "" || fields.length) finish();
  if (records[0]?.fields[0]?.replace(/^\uFEFF/u, "") !== "type" || records[0]?.fields[1] !== "value" || records[0]?.fields.length !== 2) {
    addIssue({ line: 1, message: "Expected CSV header: type,value" });
  }
  const data = records.slice(1);
  if (data.length > MAX_EXCLUSION_CSV_ROWS) addIssue({ line: data[MAX_EXCLUSION_CSV_ROWS].line, message: `Maximum ${MAX_EXCLUSION_CSV_ROWS} rows per import` });
  const rows: ExclusionCsvRow[] = [];
  for (const record of data.slice(0, MAX_EXCLUSION_CSV_ROWS)) {
    if (record.fields.length !== 2) { addIssue({ line: record.line, message: "Expected exactly two columns" }); continue; }
    try {
      const rawValue = record.fields[1];
      const value = rawValue.startsWith("'") && /^['=+\-@\t]/u.test(rawValue.slice(1))
        ? rawValue.slice(1)
        : rawValue;
      const normalized = normalizeExclusionInput({ type: record.fields[0], value });
      const issue = validRule(normalized);
      if (issue) addIssue({ line: record.line, message: issue });
      else rows.push({ line: record.line, ...normalized });
    } catch { addIssue({ line: record.line, message: "Invalid exclusion type or empty value" }); }
  }
  return { rows, issues };
}

function csvCell(value: string): string {
  const guarded = /^['=+\-@\t]/u.test(value) ? `'${value}` : value;
  return /[,"\r\n]/u.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function serializeExclusionCsv(rows: readonly NormalizedExclusion[]): string {
  return ["type,value", ...rows.map((row) => `${csvCell(row.type)},${csvCell(row.value)}`)].join("\r\n") + "\r\n";
}

export function planExclusionImport(rows: readonly ExclusionCsvRow[], existing: readonly NormalizedExclusion[]) {
  const known = new Set(existing.map((item) => `${item.type}\u0000${item.value}`));
  const seen = new Set<string>();
  const creates: ExclusionCsvRow[] = [];
  const skips: ExclusionCsvRow[] = [];
  const conflicts: ExclusionCsvIssue[] = [];
  for (const row of rows) {
    const key = `${row.type}\u0000${row.value}`;
    if (seen.has(key)) conflicts.push({ line: row.line, message: "Duplicate rule in CSV" });
    else if (known.has(key)) skips.push(row);
    else creates.push(row);
    seen.add(key);
  }
  return { creates, skips, conflicts };
}
