export function shouldCreateFreshTranslations({
  isBot,
  automaticTranslation,
}: {
  isBot: boolean;
  automaticTranslation: boolean | null | undefined;
}) {
  return !isBot && automaticTranslation !== false;
}
