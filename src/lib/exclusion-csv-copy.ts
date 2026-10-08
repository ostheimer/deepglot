/** CSV exclusion copy is currently authored in German and English. */
export function exclusionCsvText(locale: string, english: string, german: string): string {
  return locale === "de" ? german : english;
}
