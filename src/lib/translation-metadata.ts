import { z } from "zod";
import { translationTokenCounts } from "./translation-quality";

export const normalizeTranslationLabel = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase();

export const translationLabelSchema = z
  .string()
  .max(100)
  .transform(normalizeTranslationLabel)
  .pipe(
    z
      .string()
      .min(1)
      .max(40)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
  );

export const translationMetadataSchema = z
  .object({
    labels: z
      .array(translationLabelSchema)
      .max(20)
      .transform((values) => [...new Set(values)].sort()),
    variables: z
      .array(
        z
          .string()
          .min(1)
          .max(160)
          .regex(/^[^\u0000-\u001f\u007f]+$/),
      )
      .max(50)
      .transform((values) => [...new Set(values)].sort()),
    note: z
      .string()
      .max(2000)
      .refine((value) => !value.includes("\0")),
  })
  .strict();

export type TranslationMetadataInput = z.input<
  typeof translationMetadataSchema
>;
export type TranslationMetadataValue = TranslationMetadataInput & {
  version: number;
};

/** Suggestions only: simple named brace tokens and printf string/number tokens.
 * Not an ICU/HTML parser, and never a command to rewrite source content.
 */
export function detectTranslationVariables(text: string): string[] {
  return [...translationTokenCounts(text).keys()].sort().slice(0, 50);
}
