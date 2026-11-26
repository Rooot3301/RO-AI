// Vie intérieure (GET /api/office/society) : relue à l'ouverture, après chaque génération (événement office.society)
// et chaque minute (les publications apparaissent à leur heure) ; jamais quand l'onglet est masqué. Lecture seule, aucun appel aux clients IA ici.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type { OfficeSociety } from '../../api/types.ts';

export function useSociety(enabled: boolean, lastType: string | null, lastSeq: number): { society: OfficeSociety | null; reload: () => void } {
  const [society, setSociety] = useState<OfficeSociety | null>(null);
  const alive = useRef(true);
  const load = useCallback(() => {
    if (document.hidden) return;
    api.officeSociety().then((s) => { if (alive.current) setSociety(s); }, () => { /* la dernière version reste affichée */ });
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    load();
    const t = setInterval(load, 60_000);
    return () => { alive.current = false; clearInterval(t); };
  }, [enabled, load]);
  useEffect(() => { if (lastType === 'office.society') load(); }, [lastType, lastSeq, load]);
  return { society, reload: load };
}
