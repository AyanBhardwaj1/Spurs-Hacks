"use client";

import { useCallback, useSyncExternalStore, type RefObject } from "react";

// Whether a media element's source failed to load. React reads the element after it subscribes, so a load
// that failed before hydration still counts, which an onError prop would miss.
export function useMediaFailed(ref: RefObject<HTMLMediaElement | null>) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const el = ref.current;
      if (!el) return () => {};
      el.addEventListener("error", onChange);
      el.addEventListener("loadstart", onChange);
      return () => {
        el.removeEventListener("error", onChange);
        el.removeEventListener("loadstart", onChange);
      };
    },
    [ref],
  );
  return useSyncExternalStore(subscribe, () => Boolean(ref.current?.error), () => false);
}
