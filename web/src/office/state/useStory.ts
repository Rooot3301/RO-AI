// Données de l'« histoire » : statistiques, exécutions récentes et planifications réelles, mises en cache côté client
// et rafraîchies sur run.succeeded / run.failed / schedule.* ainsi que périodiquement.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type { Run, Schedule, StatsAgent } from '../../api/types.ts';
import type { OfficeModel } from './model.ts';
import { EMPTY_STORY, buildStory } from './story.ts';
import type { StoryData } from './story.ts';

const REFRESH_TYPES = /^(run\.succeeded|run\.failed|run\.cancelled|schedule\.)/;
interface Raw { stats: StatsAgent[] | null; runs: Run[]; schedules: Schedule[]; at: number }

export function useStory(model: OfficeModel): StoryData {
  const [raw, setRaw] = useState<Raw | null>(null);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useRef<() => void>(() => {});
  load.current = () => {
    Promise.all([
      api.stats(365).then((s) => s.by_agent).catch(() => null),
      api.runs({ limit: 200 }).catch(() => [] as Run[]),
      api.schedules().catch(() => [] as Schedule[]),
    ]).then(([stats, runs, schedules]) => { if (alive.current) setRaw({ stats, runs, schedules, at: Date.now() }); });
  };
  const ids = model.agents.map((a) => a.id).join(',');
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
  useEffect(() => { if (model.loaded) load.current(); }, [model.loaded, ids]);
  useEffect(() => { const id = setInterval(() => load.current(), 300_000); return () => clearInterval(id); }, []);
  const last = model.lastEvent;
  useEffect(() => {
    if (!last || !REFRESH_TYPES.test(last.type)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load.current(), 1500);
  }, [last?.seq, last?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => (raw ? buildStory(model.agents, raw.stats, raw.runs, raw.schedules, raw.at) : EMPTY_STORY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, ids, model.agents.map((a) => a.department).join('|')]);
}
