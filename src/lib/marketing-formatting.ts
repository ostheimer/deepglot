import { getIntlLocale } from "@/lib/locale-formatting";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

const COUNTED_WORD_LABELS: Record<SiteLocale, string> = {
  en: "words",
  bg: "думи",
  hr: "riječi",
  cs: "slov",
  da: "ord",
  nl: "woorden",
  et: "sõna",
  fi: "sanaa",
  fr: "mots",
  de: "Wörter",
  el: "λέξεις",
  hu: "szó",
  ga: "focal",
  it: "parole",
  lv: "vārdu",
  lt: "žodžių",
  mt: "kelma",
  pl: "słów",
  pt: "palavras",
  ro: "cuvinte",
  sk: "slov",
  sl: "besed",
  es: "palabras",
  sv: "ord",
};

export function getDateTimeFieldLabel(
  locale: SiteLocale,
  field: "month" | "year"
): string {
  const intlLocale = getIntlLocale(locale);

  try {
    const displayNames = new Intl.DisplayNames([intlLocale], {
      type: "dateTimeField",
    } as Intl.DisplayNamesOptions);
    const label = displayNames.of(field);

    if (label) {
      return label;
    }
  } catch {
    // Older runtimes may not support dateTimeField display names.
  }

  return field === "month"
    ? uiText(locale, "month", "Monat")
    : uiText(locale, "year", "Jahr");
}

export function formatCompactWordCount(value: number, locale: SiteLocale): string {
  if (value < 1_000) {
    return value.toLocaleString(getIntlLocale(locale));
  }

  const formatted = new Intl.NumberFormat(getIntlLocale(locale), {
    compactDisplay: "short",
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);

  return locale === "en" ? formatted.replace("K", "k") : formatted;
}

export function getLocalizedWordLabel(locale: SiteLocale): string {
  const countedLabel = COUNTED_WORD_LABELS[locale];

  if (countedLabel) {
    return countedLabel;
  }

  const wordsPerMonth = uiText(locale, "words / month", "Wörter / Monat");
  const [wordsLabel] = wordsPerMonth.split("/");
  const trimmed = wordsLabel?.trim();

  if (trimmed) {
    return trimmed;
  }

  return uiText(locale, "Words", "Wörter").toLocaleLowerCase(getIntlLocale(locale));
}

export function formatCompactWords(value: number, locale: SiteLocale): string {
  return `${formatCompactWordCount(value, locale)} ${getLocalizedWordLabel(locale)}`;
}
