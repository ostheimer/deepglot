export const EXCLUSION_TYPES = ["URL", "REGEX", "CSS_CLASS", "CSS_ID"] as const;

export type ExclusionType = (typeof EXCLUSION_TYPES)[number];

export type ExclusionInput = {
  type: string;
  value: string;
};

export type NormalizedExclusion = {
  type: ExclusionType;
  value: string;
};

export type RuntimeExclusions = {
  urls: string[];
  regexes: string[];
  selectors: string[];
};

const EMPTY_RUNTIME_EXCLUSIONS: RuntimeExclusions = {
  urls: [],
  regexes: [],
  selectors: [],
};

export function isExclusionType(value: string): value is ExclusionType {
  return EXCLUSION_TYPES.includes(value as ExclusionType);
}

export function normalizeExclusionInput(input: ExclusionInput): NormalizedExclusion {
  const type = input.type.trim().toUpperCase();

  if (!isExclusionType(type)) {
    throw new Error("INVALID_EXCLUSION_TYPE");
  }

  const trimmedValue = input.value.trim();
  const value =
    type === "CSS_CLASS" || type === "CSS_ID"
      ? trimmedValue.replace(/^[.#]+/, "").trim()
      : trimmedValue;

  if (value === "") {
    throw new Error("EMPTY_EXCLUSION_VALUE");
  }

  return { type, value };
}

export function buildRuntimeExclusions(
  exclusions: Array<Pick<NormalizedExclusion, "type" | "value">>
): RuntimeExclusions {
  return exclusions.reduce<RuntimeExclusions>(
    (result, exclusion) => {
      if (exclusion.value.trim() === "") {
        return result;
      }

      switch (exclusion.type) {
        case "URL":
          result.urls.push(exclusion.value);
          break;
        case "REGEX":
          result.regexes.push(exclusion.value);
          break;
        case "CSS_CLASS":
          result.selectors.push(`.${exclusion.value}`);
          break;
        case "CSS_ID":
          result.selectors.push(`#${exclusion.value}`);
          break;
      }

      return result;
    },
    { ...EMPTY_RUNTIME_EXCLUSIONS, urls: [], regexes: [], selectors: [] }
  );
}

export function isUrlExcluded(urlOrPath: string, exclusions: RuntimeExclusions): boolean {
  const candidates = getUrlCandidates(urlOrPath);

  for (const pattern of exclusions.urls) {
    if (matchesUrlPattern(candidates, pattern)) {
      return true;
    }
  }

  for (const pattern of exclusions.regexes) {
    if (matchesSafeRegex(candidates, pattern)) {
      return true;
    }
  }

  return false;
}

function getUrlCandidates(urlOrPath: string): string[] {
  const value = urlOrPath.trim();
  if (value === "") {
    return [];
  }

  try {
    const parsed = new URL(value);
    return Array.from(
      new Set([
        value,
        parsed.pathname,
        `${parsed.pathname}${parsed.search}`,
      ])
    );
  } catch {
    return [value];
  }
}

function matchesUrlPattern(candidates: string[], pattern: string): boolean {
  const normalizedPattern = pattern.trim();
  if (normalizedPattern === "") {
    return false;
  }

  if (normalizedPattern.includes("*")) {
    const regex = new RegExp(
      normalizedPattern
        .split("*")
        .map(escapeRegExp)
        .join(".*")
    );
    return candidates.some((candidate) => regex.test(candidate));
  }

  return candidates.some(
    (candidate) => candidate === normalizedPattern || candidate.includes(normalizedPattern)
  );
}

function matchesSafeRegex(candidates: string[], pattern: string): boolean {
  const normalizedPattern = pattern.trim();
  if (normalizedPattern === "") {
    return false;
  }

  try {
    const regex = new RegExp(normalizedPattern);
    return candidates.some((candidate) => regex.test(candidate));
  } catch {
    return false;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
