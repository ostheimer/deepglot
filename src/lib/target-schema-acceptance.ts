/** Prisma's live-database → schema.prisma SQL diff is the acceptance source. */
export type SchemaDriftKind = "table" | "column" | "index" | "constraint" | "other";

export type SchemaDrift = {
  kind: SchemaDriftKind;
  /** A fixed description; never include raw SQL or connection information. */
  action: string;
};

export type TargetSchemaAssessment = {
  ready: boolean;
  drift: SchemaDrift[];
};

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => (line.trimStart().startsWith("--") ? "" : line))
    .join("\n");
}

/**
 * Classify every Prisma DDL statement, including unexpected ones. A statement
 * we do not recognize still fails acceptance instead of being silently ignored.
 */
export function assessTargetSchemaDiff(sql: string): TargetSchemaAssessment {
  const source = stripLineComments(sql).trim();
  if (!source) return { ready: true, drift: [] };

  const statements = source.split(";").map((part) => part.trim()).filter(Boolean);
  const drift = statements.map((statement): SchemaDrift => {
    if (/^(?:CREATE|DROP)\s+TABLE\b/i.test(statement)) {
      return { kind: "table", action: "table definition differs" };
    }
    if (/^ALTER\s+TABLE\b[\s\S]*?\b(?:ADD|DROP)\s+COLUMN\b/i.test(statement)) {
      return { kind: "column", action: "column definition differs" };
    }
    if (/^(?:CREATE|DROP|ALTER)\s+(?:UNIQUE\s+)?INDEX\b/i.test(statement)) {
      return { kind: "index", action: "index definition differs" };
    }
    if (/^ALTER\s+TABLE\b[\s\S]*?\b(?:ADD|DROP)\s+(?:CONSTRAINT|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i.test(statement)) {
      return { kind: "constraint", action: "constraint definition differs" };
    }
    return { kind: "other", action: "unclassified schema statement" };
  });

  return { ready: drift.length === 0, drift };
}
