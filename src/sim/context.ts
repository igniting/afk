// Deterministic context packing (spec §11.2). Units are a game abstraction, not real tokens.
import { MODELS, type ContextPacket, type ContextRule, type ContextTile, type DecidePurpose, type Fixture, type ModelId, type TaskRun } from './types';
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

type T = Omit<ContextTile, 'included' | 'reason'>;

/** Packets for shift work. Small, explicit tiles; whole tiles fit or stay out with a reason. */
export function shiftPacket(run: TaskRun, purpose: DecidePurpose, model: ModelId): ContextPacket {
  const n = run.notes;
  const tiles: T[] = [{ id: 'header', label: 'Runtime + tool schema', units: 2, source: 'runtime', category: 'header' }];
  const add = (t: T) => tiles.push(t);
  switch (purpose) {
    case 'approval_check':
      add({ id: 'goal', label: 'Goal: publish the approved launch page', units: 1, source: 'task card', category: 'pinned' });
      add({ id: 'constraint', label: 'Maya: publish only the version I approved', units: 2, source: 'Maya’s message', category: 'pinned' });
      if (n.written) add({ id: 'draft', label: `Current draft: version ${n.written.version}`, units: 2, source: 'shelf', category: 'retrieved', data: { version: n.written.version } });
      if (n.approval) add({ id: 'approval', label: `Maya’s approval for version ${n.approval.version}`, units: 1, source: 'Maya’s reply', category: 'retrieved', data: { version: n.approval.version } });
      break;
    case 'sort_complete':
      add({ id: 'goal', label: 'Goal: categorise feedback (Bug / Feature / Question)', units: 1, source: 'task card', category: 'pinned' });
      add({ id: 'batch', label: '3 complete threads (thread_complete = true)', units: 4, source: 'Fetch feedback', category: 'retrieved' });
      break;
    case 'sort_incomplete':
      add({ id: 'goal', label: 'Goal: categorise feedback; mark conflicts for follow-up', units: 1, source: 'task card', category: 'pinned' });
      add({ id: 'batch', label: '3 incomplete threads + their linked evidence', units: 9, source: 'Fetch feedback', category: 'retrieved' });
      break;
    case 'sort_all':
      add({ id: 'goal', label: 'Goal: categorise feedback; mark conflicts for follow-up', units: 1, source: 'task card', category: 'pinned' });
      add({ id: 'batch', label: '4 mixed threads + linked evidence', units: 8, source: 'Fetch feedback', category: 'retrieved' });
      break;
    case 'reduce':
      add({ id: 'goal', label: 'Goal: one board Maya can read', units: 1, source: 'task card', category: 'pinned' });
      add({ id: 'results', label: '12 structured category records', units: 3, source: 'earlier decisions', category: 'retrieved' });
      break;
    case 'partner_prepare':
      add({ id: 'goal', label: 'Goal: Nora’s announcement from the approved template', units: 1, source: 'task card', category: 'pinned' });
      add({ id: 'template', label: 'Partner template (pre-approved)', units: 2, source: 'shelf', category: 'pinned' });
      add({ id: 'facts', label: 'Release facts from the draft', units: 2, source: 'Read release draft', category: 'retrieved' });
      break;
    case 'partner_check':
      add({ id: 'goal', label: 'Goal: send only verified live facts', units: 1, source: 'task card', category: 'pinned' });
      add({ id: 'message', label: 'Prepared message draft', units: 2, source: 'shelf', category: 'retrieved' });
      add({ id: 'live', label: 'Verified live page facts', units: 2, source: 'launch receipt', category: 'retrieved' });
      break;
    default:
      break;
  }
  const capacity = MODELS[model].capacity;
  let used = 0;
  const packed: ContextTile[] = tiles.map((t) => {
    if (used + t.units <= capacity) {
      used += t.units;
      return { ...t, included: true, reason: t.category === 'header' ? 'Always included' : t.category === 'pinned' ? 'Pinned' : 'Selected for this step' };
    }
    return { ...t, included: false, reason: `Doesn’t fit: needs ${t.units} units, ${capacity - used} of ${capacity} left (${MODELS[model].name})` };
  });
  return { model, capacity, used, tiles: packed };
}
