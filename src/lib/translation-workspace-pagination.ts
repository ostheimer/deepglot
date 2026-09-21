export function planTranslationPaginationAfterDeletion({
  total,
  page,
  pageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
}) {
  const normalizedPageSize = Math.max(1, Math.trunc(pageSize));
  const nextTotal = Math.max(0, Math.trunc(total) - 1);
  const totalPages = Math.max(1, Math.ceil(nextTotal / normalizedPageSize));

  return {
    total: nextTotal,
    totalPages,
    page: Math.min(Math.max(1, Math.trunc(page)), totalPages),
  };
}
