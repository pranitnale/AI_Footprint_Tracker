import { useEffect, useState } from "react";

export type CursorPage<T> = { items: T[]; next_cursor?: string | null };

export function useCursorPage<T, Page extends CursorPage<T> = CursorPage<T>>(
  loader: (cursor: string) => Promise<Page>,
  resetKey: string,
) {
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setCursor("");
    setHistory([]);
  }, [resetKey]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    loader(cursor)
      .then((value) => {
        if (current) setData(value);
      })
      .catch((value) => {
        if (current) setError(value);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [cursor, resetKey, revision]);

  return {
    data,
    error,
    loading,
    retry: () => setRevision((value) => value + 1),
    hasPrevious: history.length > 0,
    hasNext: Boolean(data?.next_cursor),
    previous: () => {
      const prior = history.at(-1);
      if (prior === undefined) return;
      setHistory((values) => values.slice(0, -1));
      setCursor(prior);
    },
    next: () => {
      if (!data?.next_cursor) return;
      setHistory((values) => [...values, cursor]);
      setCursor(data.next_cursor!);
    },
  };
}

/**
 * Page size for reading the whole member list: the largest the server allows (1 to 200, see
 * pagination in apps/server/aift/service.py), so a list is read in a quarter of the round trips
 * that pages of 50 needed.
 */
export const MEMBER_PAGE_LIMIT = "200";

export async function fetchAllPages<T>(
  loader: (cursor: string) => Promise<CursorPage<T>>,
  maximumPages = 20,
) {
  const items: T[] = [];
  let cursor = "";
  for (let page = 0; page < maximumPages; page += 1) {
    const result = await loader(cursor);
    items.push(...result.items);
    if (!result.next_cursor) return items;
    cursor = result.next_cursor;
  }
  throw new Error(
    "The result exceeded the supported pagination limit. Narrow the filters.",
  );
}
