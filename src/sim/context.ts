// Deterministic context packing (spec §11.2). Units are a game abstraction, not real tokens.
import { MODELS, type ContextPacket, type ContextRule, type ContextTile, type Fixture, type ModelId, type TaskRun } from './types';
import { fmtTime } from './types';

type Candidate = Omit<ContextTile, 'included' | 'reason'> & { mandatory?: boolean; skipReason?: string };

export function candidateTiles(run: TaskRun, fixture: Fixture, rule: ContextRule): Candidate[] {
  const n = run.notes;
  const c: Candidate[] = [
    { id: 'header', label: 'Runtime + tool schema', units: 2, source: 'runtime', category: 'header', mandatory: true },
    {
      id: 'goal',
      label: fixture.needsTagline ? 'Goal: Isha’s logo + the brand tagline on the preview' : 'Goal: put Isha’s logo on the preview',
      units: 1,
      source: 'task card',
      category: 'pinned',
      data: { needsTagline: !!fixture.needsTagline },
    },
    {
      id: 'constraint',
      label: 'Maya: preview is editable; leave the live page alone',
      units: 2,
      source: 'Maya’s message',
      category: 'pinned',
    },
  ];
  if (n.metadata)
    c.push({
      id: 'metadata',
      label: `Attachment: ${n.metadata.name} · from Isha · revision ${n.metadata.logoRev}`,
      units: 2,
      source: 'Read attachment',
      category: 'retrieved',
      data: { logoRev: n.metadata.logoRev },
    });
  if (n.previewState)
    c.push({
      id: 'preview',
      label: `Preview page shows ${n.previewState.logoRev ? `logo revision ${n.previewState.logoRev}` : 'no logo'} (read ${fmtTime(n.previewState.observedAt)})`,
      units: 2,
      source: 'Read current preview',
      category: 'retrieved',
      data: { logoRev: n.previewState.logoRev, tagline: n.previewState.tagline },
    });
  if (n.guide)
    c.push({
      id: 'guide',
      label: `${n.guide.name}${n.guide.tagline ? ' (includes the tagline)' : ''}`,
      units: n.guide.units,
      source: 'Read brand guide',
      category: 'retrieved',
      data: { tagline: n.guide.tagline },
    });
  if (n.metadata)
    c.push({
      id: 'raw',
      label: 'Full artwork file (raw)',
      units: 6,
      source: 'Read attachment',
      category: 'raw',
      skipReason: rule === 'focused' ? 'Not selected: the Focused rule sends metadata, not the raw file' : undefined,
    });
  for (const f of fixture.shelfFiles.filter((f) => f.id !== n.guide?.fileId))
    c.push({
      id: f.id,
      label: f.name,
      units: f.units,
      source: 'shared shelf',
      category: 'file',
      skipReason: 'On the shelf, but no step read it — a saved file is not automatically in context',
    });
  return c;
}

export function packContext(run: TaskRun, fixture: Fixture, model: ModelId, rule: ContextRule): ContextPacket {
  const capacity = MODELS[model].capacity;
  let used = 0;
  const tiles: ContextTile[] = [];
  for (const cand of candidateTiles(run, fixture, rule)) {
    const { mandatory: _m, skipReason, ...tile } = cand;
    if (skipReason) {
      tiles.push({ ...tile, included: false, reason: skipReason });
      continue;
    }
    if (used + tile.units <= capacity) {
      used += tile.units;
      const reason =
        tile.category === 'header'
          ? 'Always included'
          : tile.category === 'pinned'
            ? 'Pinned'
            : 'Selected by context rule';
      tiles.push({ ...tile, included: true, reason });
    } else {
      tiles.push({
        ...tile,
        included: false,
        reason: `Doesn’t fit: needs ${tile.units} units, ${capacity - used} of ${capacity} left (${MODELS[model].name})`,
      });
    }
  }
  return { model, capacity, used, tiles };
}
