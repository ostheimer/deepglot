export function findDestructiveSchemaStatements(raw: string): string[] {
  const withoutComments = raw.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");
  const statements = withoutComments.split(";").map((statement) => statement.trim()).filter(Boolean);
  const destructiveRe = /\b(DROP|TRUNCATE|DELETE)\b|ALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i;
  return statements.filter((statement) => {
    // A foreign key's ON DELETE action describes future row behavior. It does
    // not delete rows while the schema plan is applied.
    const operation = statement.replace(/\bON\s+DELETE\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)\b/gi, "");
    return destructiveRe.test(operation);
  });
}
