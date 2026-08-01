export type MarketingHeroTitleParts = {
  before: string;
  highlight: string | null;
  after: string;
};

export function splitMarketingHeroTitle(
  title: string,
  highlight: string
): MarketingHeroTitleParts {
  const highlightIndex = highlight ? title.indexOf(highlight) : -1;

  if (highlightIndex < 0) {
    return { before: title, highlight: null, after: "" };
  }

  return {
    before: title.slice(0, highlightIndex),
    highlight,
    after: title.slice(highlightIndex + highlight.length),
  };
}
