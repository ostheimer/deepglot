export const WEBSITE_TYPES = [
  "Blog",
  "Corporate website",
  "E-Commerce store",
  "Hotel website",
  "Media website",
  "Online service",
  "Showcase website",
  "Just testing Deepglot",
  "Other",
] as const;

export const INDUSTRY_TYPES = [
  "Banking & finance",
  "Business services",
  "Consumer services",
  "Education",
  "Media & Entertainment",
  "Food & Beverage",
  "Government & non-profit",
  "Health & medical",
  "Insurance & legal",
  "Retail & Fashion",
  "Real estate & property",
  "Software & technology",
  "Hospitality & tourism",
  "Other",
] as const;

export const SOURCE_LANGUAGE_MIGRATION_COPY = {
  en: "You can only choose an active target language as the new original language. The languages are swapped: the previous original language becomes an active target, the selected target is deactivated, and its domain mapping is removed.",
  de: "Als neue Originalsprache kannst du nur eine aktive Zielsprache wählen. Die Sprachen werden getauscht: Die bisherige Originalsprache wird als Ziel aktiviert, die gewählte Zielsprache deaktiviert und ihre Domain-Zuordnung entfernt.",
} as const;
