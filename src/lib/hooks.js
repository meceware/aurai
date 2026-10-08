'use client';

import { useCallback, useSyncExternalStore } from 'react';

const neverChanges = () => () => {};

// Server renders false, the client renders true from the first commit onwards. Used to
// hold back anything whose value is unknowable during SSR, without a setState effect.
export function useHydrated() {
  return useSyncExternalStore(neverChanges, () => true, () => false);
}

export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
