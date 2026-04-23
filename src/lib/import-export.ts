type CsvParseResult = {
  headers: string[];
  rows: Array<{ line: number; values: Record<string, string> }>;
};

export type TranslationCsvRow = {
  line: number;
  originalText: string;
  translatedText: string;
  langFrom: string;
  langTo: string;
  isManual: boolean;
  source: string;
};

export type GlossaryCsvRow = {
  line: number;
  originalTerm: string;
  translatedTerm: string;
  langFrom: string;
  langTo: string;
  caseSensitive: boolean;
};

export type SlugCsvRow = {
  line: number;
  originalSlug: string;
  translatedSlug: string;
  langTo: string;
  urlCount: number;
};

function escapeCsvValue(value: string) {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function normalizeBoolean(value: string) {
  return ["true", "1", "yes"].includes(value.trim().toLowerCase());
}

function parseCsv(content: string): CsvParseResult {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((parsedRow) =>
    parsedRow.some((value) => value.trim() !== "")
  );

  if (nonEmptyRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headerRow, ...dataRows] = nonEmptyRows;
  const headers = headerRow.map((header) => header.trim());

  return {
    headers,
    rows: dataRows.map((values, rowIndex) => ({
      line: rowIndex + 2,
      values: Object.fromEntries(
        headers.map((header, valueIndex) => [header, values[valueIndex] ?? ""])
      ),
    })),
  };
}

function serializeCsv(
  headers: string[],
  rows: Array<Record<string, string | number | boolean>>
) {
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCsvValue(String(row[header] ?? "")))
        .join(",")
    ),
  ].join("\n");
}

function assertHeaders(actual: string[], expected: string[]) {
  if (
    actual.length !== expected.length ||
    actual.some((header, index) => header !== expected[index])
  ) {
    throw new Error(
      `Invalid CSV headers. Expected ${expected.join(", ")} but received ${actual.join(", ")}.`
    );
  }
}

function unquotePoString(value: string) {
  return value
    .replace(/^"/, "")
    .replace(/"$/, "")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n");
}

function quotePoString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function parseTranslationsCsv(content: string): TranslationCsvRow[] {
  const parsed = parseCsv(content);
  const headers = [
    "originalText",
    "translatedText",
    "langFrom",
    "langTo",
    "isManual",
    "source",
  ];

  assertHeaders(parsed.headers, headers);

  return parsed.rows.map(({ line, values }) => ({
    line,
    originalText: values.originalText.trim(),
    translatedText: values.translatedText.trim(),
    langFrom: values.langFrom.trim().toLowerCase(),
    langTo: values.langTo.trim().toLowerCase(),
    isManual: normalizeBoolean(values.isManual),
    source: values.source.trim() || "IMPORT",
  }));
}

export function serializeTranslationsCsv(
  rows: Array<Omit<TranslationCsvRow, "line">>
) {
  return serializeCsv(
    [
      "originalText",
      "translatedText",
      "langFrom",
      "langTo",
      "isManual",
      "source",
    ],
    rows
  );
}

export function parseGlossaryCsv(content: string): GlossaryCsvRow[] {
  const parsed = parseCsv(content);
  const headers = [
    "originalTerm",
    "translatedTerm",
    "langFrom",
    "langTo",
    "caseSensitive",
  ];

  assertHeaders(parsed.headers, headers);

  return parsed.rows.map(({ line, values }) => ({
    line,
    originalTerm: values.originalTerm.trim(),
    translatedTerm: values.translatedTerm.trim(),
    langFrom: values.langFrom.trim().toLowerCase(),
    langTo: values.langTo.trim().toLowerCase(),
    caseSensitive: normalizeBoolean(values.caseSensitive),
  }));
}

export function serializeGlossaryCsv(rows: Array<Omit<GlossaryCsvRow, "line">>) {
  return serializeCsv(
    [
      "originalTerm",
      "translatedTerm",
      "langFrom",
      "langTo",
      "caseSensitive",
    ],
    rows
  );
}

export function parseSlugsCsv(content: string): SlugCsvRow[] {
  const parsed = parseCsv(content);
  const headers = ["originalSlug", "translatedSlug", "langTo", "urlCount"];

  assertHeaders(parsed.headers, headers);

  return parsed.rows.map(({ line, values }) => ({
    line,
    originalSlug: values.originalSlug.trim(),
    translatedSlug: values.translatedSlug.trim(),
    langTo: values.langTo.trim().toLowerCase(),
    urlCount: Number.parseInt(values.urlCount.trim() || "0", 10) || 0,
  }));
}

export function serializeSlugsCsv(rows: Array<Omit<SlugCsvRow, "line">>) {
  return serializeCsv(
    ["originalSlug", "translatedSlug", "langTo", "urlCount"],
    rows
  );
}

export function parsePoTranslations(content: string) {
  const lines = content.split(/\r?\n/);
  const entries: Array<{ originalText: string; translatedText: string }> = [];
  let currentId = "";
  let currentStr = "";
  let state: "msgid" | "msgstr" | null = null;

  const flushEntry = () => {
    if (currentId !== "") {
      entries.push({
        originalText: currentId,
        translatedText: currentStr,
      });
    }
    currentId = "";
    currentStr = "";
    state = null;
  };

  lines.forEach((line) => {
    if (line.startsWith("msgid ")) {
      flushEntry();
      currentId = unquotePoString(line.slice(6));
      state = "msgid";
      return;
    }

    if (line.startsWith("msgstr ")) {
      currentStr = unquotePoString(line.slice(7));
      state = "msgstr";
      return;
    }

    if (line.startsWith('"')) {
      if (state === "msgid") {
        currentId += unquotePoString(line);
      } else if (state === "msgstr") {
        currentStr += unquotePoString(line);
      }
      return;
    }

    if (line.trim() === "") {
      flushEntry();
    }
  });

  flushEntry();

  return entries.filter((entry) => entry.originalText !== "");
}

export function serializePoTranslations(
  rows: Array<{ originalText: string; translatedText: string }>,
  {
    langFrom,
    langTo,
  }: {
    langFrom: string;
    langTo: string;
  }
) {
  const header = [
    'msgid ""',
    'msgstr ""',
    `"Language: ${langTo}\\n"`,
    `"X-Source-Language: ${langFrom}\\n"`,
    "",
  ];

  const entries = rows.flatMap((row) => [
    `msgid ${quotePoString(row.originalText)}`,
    `msgstr ${quotePoString(row.translatedText)}`,
    "",
  ]);

  return [...header, ...entries].join("\n");
}
