// Local persistence (spec §16): versioned JSON in browser storage. Progress lives on this device.
import type { Build } from '../sim/types';

export const SAVE_SCHEMA = 1;
const KEY = 'night-shift.save';

export interface RunSummary {
  at: string; // real-world ISO timestamp of when the run finished
  fixture: string;
  buildName: string;
  promiseKept: boolean;
  autonomous: boolean;
  credits: number;
  firstVerified: string | null;
  interventions: number;
}

export interface SaveData {
  schema: number;
  agentName: string;
  accent: string;
  currentBuild: Build | null;
  savedBuilds: Build[];
  openingCompleted: boolean;
  runs: RunSummary[];
  advanced?: boolean;
  missions?: Record<string, { medals: string[]; completed: boolean }>;
  concepts?: string[];
  predictions?: { right: number; total: number };
  /** Recent runs per mission, for honest same-conditions comparison. */
  missionRuns?: Record<string, MissionRun[]>;
}

export interface MissionRun {
  at: string;
  plan: string;
  medals: string[];
  credits: number;
  doneAt: number | null;
  ok: boolean;
}

export function defaultSave(): SaveData {
  return { schema: SAVE_SCHEMA, agentName: 'Relay', accent: '#5eead4', currentBuild: null, savedBuilds: [], openingCompleted: false, runs: [] };
}

export function loadSave(): { data: SaveData; warning: string | null } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { data: defaultSave(), warning: null };
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    if (parsed.schema !== SAVE_SCHEMA)
      return { data: defaultSave(), warning: `Your saved progress uses format v${parsed.schema}; this version reads v${SAVE_SCHEMA}. Starting fresh — the old save was left untouched.` };
    return { data: { ...defaultSave(), ...parsed }, warning: null };
  } catch {
    return { data: defaultSave(), warning: null };
  }
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode): the game still works without saving */
  }
}

export function exportSave(data: SaveData): string {
  return JSON.stringify(data, null, 2);
}
