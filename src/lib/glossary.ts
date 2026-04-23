import { countWords } from "@/lib/translation-types";

export type GlossaryRuleInput = {
  originalTerm: string;
  translatedTerm: string;
  caseSensitive: boolean;
  updatedAt?: Date;
};

export type GlossaryProtection = {
  protectedText: string;
  glossaryWords: number;
  latestRuleUpdatedAt: Date | null;
  replacements: Array<{
    token: string;
    translatedTerm: string;
  }>;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildGlossaryProtection(
  text: string,
  rules: GlossaryRuleInput[]
): GlossaryProtection {
  const sortedRules = [...rules]
    .filter((rule) => rule.originalTerm.trim() !== "")
    .sort((a, b) => b.originalTerm.length - a.originalTerm.length);

  let protectedText = text;
  let glossaryWords = 0;
  let latestRuleUpdatedAt: Date | null = null;
  const replacements: GlossaryProtection["replacements"] = [];

  sortedRules.forEach((rule, index) => {
    const flags = rule.caseSensitive ? "g" : "gi";
    const token = `__DEEPGLOT_GLOSSARY_${index}__`;
    const regex = new RegExp(escapeRegExp(rule.originalTerm), flags);

    let occurrences = 0;
    protectedText = protectedText.replace(regex, () => {
      occurrences += 1;
      return token;
    });

    if (occurrences > 0) {
      replacements.push({
        token,
        translatedTerm: rule.translatedTerm,
      });
      glossaryWords += countWords(rule.originalTerm) * occurrences;

      if (
        rule.updatedAt &&
        (!latestRuleUpdatedAt || rule.updatedAt > latestRuleUpdatedAt)
      ) {
        latestRuleUpdatedAt = rule.updatedAt;
      }
    }
  });

  return {
    protectedText,
    glossaryWords,
    latestRuleUpdatedAt,
    replacements,
  };
}

export function hasGlossaryProtection(protection: GlossaryProtection) {
  return protection.replacements.length > 0;
}

export function restoreGlossaryTerms(
  translatedText: string,
  protection: GlossaryProtection
) {
  return protection.replacements.reduce((result, replacement) => {
    return result.split(replacement.token).join(replacement.translatedTerm);
  }, translatedText);
}
