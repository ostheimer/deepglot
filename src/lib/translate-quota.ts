/**
 * Quota gating for /api/translate.
 *
 * Cache hits intentionally bypass the pending-word check so visitors can still
 * receive already-translated content when a subscription is over quota. Health
 * probes set `quota_probe` to detect exhaustion even when the probe text is cached.
 */
export function shouldRejectTranslateRequest(input: {
  wordsUsed: number;
  wordsLimit: number;
  pendingWordCount: number;
  quotaProbe: boolean;
}): boolean {
  const { wordsUsed, wordsLimit, pendingWordCount, quotaProbe } = input;

  if (pendingWordCount > 0 && wordsUsed + pendingWordCount > wordsLimit) {
    return true;
  }

  if (quotaProbe && wordsUsed >= wordsLimit) {
    return true;
  }

  return false;
}
