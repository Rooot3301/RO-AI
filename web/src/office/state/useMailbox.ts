// Boîte aux lettres de l'accueil : nombre de rapports réels arrivés depuis ta dernière visite de la bibliothèque.
// « Dernière visite » est une commodité de ce navigateur (localStorage) ; les rapports viennent de GET /api/office/archive.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type { OfficeReport } from '../../api/types.ts';

const KEY = 'roai.office.mail.seen.v1';
const read = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* stockage indisponible : compteur de session */ } };

/** Rapports plus récents que la dernière visite (aucune visite connue : la boîte démarre vide). */
export function unread(reports: readonly OfficeReport[], seen: string | null): number {
  if (!seen) return 0;
  return reports.filter((r) => r.finished_at > seen).length;
}

export function useMailbox(enabled: boolean, lastType: string | null, lastSeq: number): { count: number; markRead: () => void } {
  const [reports, setReports] = useState<OfficeReport[]>([]);
  const [seen, setSeen] = useState<string | null>(read);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useCallback(() => {
    if (document.hidden) return;
    api.officeArchive(30).then((r) => {
      setReports(r.reports);
      setSeen((s) => { if (s) return s; const v = r.reports[0]?.finished_at ?? new Date().toISOString().slice(0, 19) + 'Z'; write(v); return v; });
    }).catch(() => { /* boîte inchangée */ });
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useEffect(() => {
    if (!enabled || lastType !== 'run.succeeded') return;
    clearTimeout(timer.current); timer.current = setTimeout(load, 3000);
  }, [enabled, lastType, lastSeq, load]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const markRead = useCallback(() => {
    const v = reports[0]?.finished_at ?? new Date().toISOString().slice(0, 19) + 'Z';
    write(v); setSeen(v);
  }, [reports]);
  return { count: unread(reports, seen), markRead };
}
