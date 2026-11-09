// Decision engine for data-driven missions. Retrieval policies choose which already-read tiles
// go on the tray (using only their visible metadata: subject, author, authority, time,
// supersession, declared format). Rules then read ONLY the packed tray.
import { MODELS, type ContextPacket, type ContextTile, type ModelId, type TileDef } from './types';

export type RuleOutput = Record<string, string | number | boolean | null>;
export interface RuleResult {
  output?: RuleOutput;
  /** Set when the packet lacks evidence the rule needs (a following “when: need” step may ask). */
  need?: string;
  explanation: string;
}
export type Rule = (p: ContextPacket, tiles: ContextTile[]) => RuleResult;

const RULES: Record<string, Rule> = {};
export function registerRule(name: string, rule: Rule) {
  RULES[name] = rule;
}
export function getRule(name: string): Rule {
  const r = RULES[name];
  if (!r) throw new Error(`Unknown rule “${name}” — content validation should have caught this.`);
  return r;
}

// ---------------------------------------------------------------------------
// Retrieval policies

interface Picked {
  chosen: TileDef[];
  skipped: { tile: TileDef; reason: string }[];
}

const newestFirst = (a: TileDef, b: TileDef) => b.at - a.at || a.id.localeCompare(b.id);

export const SELECT: Record<string, (tiles: TileDef[]) => Picked> = {
  /** Everything read, newest first. */
  all: (tiles) => ({ chosen: [...tiles].sort(newestFirst), skipped: [] }),

  /** One tile per subject: whichever is newest. */
  recent: (tiles) => {
    const chosen: TileDef[] = [];
    const skipped: Picked['skipped'] = [];
    for (const t of [...tiles].sort(newestFirst)) {
      if (t.subject && chosen.some((c) => c.subject === t.subject)) skipped.push({ tile: t, reason: 'Older note on the same subject (most-recent rule)' });
      else chosen.push(t);
    }
    return { chosen, skipped };
  },

  /** Per subject: the newest authoritative note that nothing has superseded. */
  authority: (tiles) => {
    const chosen: TileDef[] = [];
    const skipped: Picked['skipped'] = [];
    const superseded = new Set(tiles.map((t) => t.supersedes).filter(Boolean));
    for (const t of [...tiles].sort(newestFirst)) {
      if (!t.subject) chosen.push(t);
      else if (t.authority === 'speculative') skipped.push({ tile: t, reason: `Speculative (${t.author ?? 'unknown'}) — not from the decision-maker` });
      else if (superseded.has(t.id)) skipped.push({ tile: t, reason: 'Superseded by a later correction' });
      else if (chosen.some((c) => c.subject === t.subject)) skipped.push({ tile: t, reason: 'Older authoritative note on the same subject' });
      else chosen.push(t);
    }
    return { chosen, skipped };
  },

  /** Load only skills that declare the current input's format; keep everything else. */
  oneSkill: (tiles) => {
    const formats = new Set(tiles.filter((t) => t.kind === 'input').map((t) => String(t.data?.format)));
    const chosen: TileDef[] = [];
    const skipped: Picked['skipped'] = [];
    // A skill declares the input formats it accepts; load it only if one matches.
    const fits = (t: TileDef) => String(t.data?.for ?? '').split(',').some((f) => formats.has(f.trim()));
    for (const t of [...tiles].sort(newestFirst)) {
      if (t.kind === 'skill' && !fits(t)) skipped.push({ tile: t, reason: 'Skill not applicable to this input — not loaded' });
      else chosen.push(t);
    }
    return { chosen, skipped };
  },

  /** Everything, but outside content is wrapped and labelled: data to read, not instructions to follow. */
  quoted: (tiles) => ({
    chosen: [...tiles]
      .map((t) => (t.untrusted ? { ...t, label: `[untrusted · quoted] ${t.label}`, units: t.units + 1, data: { ...(t.data ?? {}), quoted: true } } : t))
      .sort(newestFirst),
    skipped: [],
  }),

  /** Failure Lab: everything except the constraints — as if they were never packed. */
  noConstraint: (tiles) => ({
    chosen: tiles.filter((t) => t.kind !== 'note' || t.subject !== 'constraint').sort(newestFirst),
    skipped: tiles.filter((t) => t.kind === 'note' && t.subject === 'constraint').map((tile) => ({ tile, reason: 'Left off the tray (lab: constraint omitted)' })),
  }),

  /** Every installed skill, in installation order (alphabetical), then the rest. */
  allSkills: (tiles) => {
    const skills = tiles.filter((t) => t.kind === 'skill').sort((a, b) => a.id.localeCompare(b.id));
    const rest = tiles.filter((t) => t.kind !== 'skill').sort(newestFirst);
    return { chosen: [...rest, ...skills], skipped: [] };
  },
};

/** Pack a tray: runtime header, goal, then the chosen tiles in order. Whole tiles fit or stay out. */
export function packGeneric(tiles: TileDef[], select: string, goal: string, model: ModelId): ContextPacket {
  const capacity = MODELS[model].capacity;
  const out: ContextTile[] = [
    { id: 'header', label: 'Runtime + tool schema', units: 2, source: 'runtime', category: 'header', included: true, reason: 'Always included' },
    { id: 'goal', label: goal, units: 1, source: 'task card', category: 'pinned', included: true, reason: 'Pinned' },
  ];
  let used = 3;
  const picked = (SELECT[select] ?? SELECT.all)(tiles);
  for (const t of picked.chosen) {
    const base = { id: t.id, label: t.label, units: t.units, source: t.source, category: t.kind === 'skill' ? ('file' as const) : ('retrieved' as const), data: tileData(t) };
    if (used + t.units <= capacity) {
      used += t.units;
      out.push({ ...base, included: true, reason: 'Selected by the retrieval rule' });
    } else out.push({ ...base, included: false, reason: `Doesn’t fit: needs ${t.units} units, ${capacity - used} of ${capacity} left (${MODELS[model].name})` });
  }
  for (const { tile: t, reason } of picked.skipped)
    out.push({ id: t.id, label: t.label, units: t.units, source: t.source, category: 'retrieved', included: false, reason, data: tileData(t) });
  return { model, capacity, used, tiles: out };
}

/** Rules may read a tile's visible metadata and content through `data`. */
function tileData(t: TileDef): ContextTile['data'] {
  return {
    ...(t.data ?? {}),
    subject: t.subject ?? null,
    authority: t.authority ?? null,
    supersedes: t.supersedes ?? null,
    kind: t.kind ?? null,
    untrusted: t.untrusted ?? false,
    at: t.at,
  } as ContextTile['data'];
}
