"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { errorText } from "./api";

interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-fetch; keeps showing the current data meanwhile. */
  reload(): Promise<void>;
}

/**
 * Fetch data on mount (and when `key` changes), optionally re-polling every `pollMs`
 * milliseconds. Polling pauses while the tab is hidden.
 */
export function useApi<T>(fetcher: () => Promise<T>, key: string, pollMs?: number | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const reload = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!pollMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, reload]);

  return { data, error, loading, reload };
}
