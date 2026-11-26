import { useEffect, useState, useSyncExternalStore } from 'react';

// Une seule horloge partagée pour tous les temps relatifs de l'interface.
let now = Date.now();
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) timer = setInterval(() => { now = Date.now(); subs.forEach((s) => s()); }, 1000);
  return () => { subs.delete(cb); if (subs.size === 0 && timer) { clearInterval(timer); timer = undefined; } };
}
/** Horodatage courant, rafraîchi chaque seconde. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now, () => now);
}

export function useDocumentTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · RO·AI` : 'RO·AI'; }, [title]);
}

/** Valeur différée (recherche en saisie). */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
