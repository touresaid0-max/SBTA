// Supabase returns at most 1 000 rows per request, silently.
const PAGE_SIZE = 1000;

/**
 * Reads every row of a query, 1 000 at a time, until the last page.
 * `page(from, to)` must return the query with a stable order and `.range(from, to)` applied.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null };
  }
}
