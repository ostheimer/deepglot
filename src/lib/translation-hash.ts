import crypto from "crypto";

export function computeTranslationHash(
  originalText: string,
  langFrom: string,
  langTo: string
) {
  return crypto
    .createHash("md5")
    .update(`${originalText}|${langFrom}|${langTo}`)
    .digest("hex");
}
