"use client";

import { useEffect, useState } from "react";

export type ApiState<T> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: Error }
  | { readonly status: "ready"; readonly data: T };

/**
 * Fetch `fetcher()` whenever `deps` changes, exposing a loading/error/ready state. `fetcher` is read from a
 * fresh closure each render but deliberately left out of the effect's dependency array — only `deps` should
 * decide when to refetch, or a new inline arrow function would refetch on every render.
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): ApiState<T> & { refetch: () => void } {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Resetting to "loading" the instant a dependency changes (a new address, a `refetch()` call) is this
    // hook's whole job, not an accidental cascade; the fetch that follows is what reaches the external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            status: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return {
    ...state,
    refetch: () => {
      setTick((t) => t + 1);
    },
  };
}
