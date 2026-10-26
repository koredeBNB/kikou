"use client";

import { useEffect, useRef, useState } from "react";

/** Follows `value` at most once every `ms`, always ending on the latest. `immediate` skips the wait. */
export function useThrottled<T>(value: T, ms: number, immediate = false): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = immediate ? 0 : Math.max(0, last.current + ms - Date.now());
    const id = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(id);
  }, [value, ms, immediate]);
  return shown;
}
