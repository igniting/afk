# Night Shift

> Build your own agent. Leave it in charge. See whether your design survives the night.

A browser game (three.js + TypeScript) about how information, responsibility, computation,
authority and external actions move through an always-on AI agent. You assemble **Relay** from
watchers, workers and procedures, then watch a deterministic simulation run it while the
world changes. No live LLM calls, accounts or API keys — all model behaviour is authored and
inspectable.

Design spec: [`docs/game-design-spec-v2.md`](docs/game-design-spec-v2.md).

## Play locally

```bash
npm install
npm run dev
```

```bash
npm test        # headless simulation tests
npm run build   # production build into dist/
```

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every push to `main`.
One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
The Vite `base` is relative, so the site works under `https://<user>.github.io/<repo>/`.

## Architecture (spec §16)

| Module | Path | Notes |
|---|---|---|
| Simulation core | `src/sim/engine.ts`, `types.ts` | Discrete-event, integer-ms time, stable phases, world vs agent state, snapshots |
| Decision engine | `src/sim/rules.ts`, `context.ts` | Authored rules that read **only** the packed context tray |
| Construction compiler | `src/sim/compiler.ts`, `steps.ts` | Validates the bounded step vocabulary and explains problems before Run |
| Evaluator | `src/sim/evaluate.ts` | Judges world state + receipts, never the chosen settings |
| Content | `src/content/opening.ts` | Fixtures, messages, templates |
| Presentation | `src/ui/scene.ts`, `app.ts` | three.js board + DOM panels; reads sim state, never decides outcomes |
| Persistence | `src/persistence/save.ts` | Versioned local save (this device only) |

The same engine powers interactive play and the headless tests.

## Roadmap

- **Phase 1 — Construction proof (Gate A)** ✅ Three short missions, each teaching one agent concept:
  1. *First job* — the agent loop (a watcher waits; the AI runs only when there's something to decide).
  2. *The correction* — watchers: “check once” finishes a job, “keep watching” keeps a promise current.
  3. *What the AI sees* — context: a file on the shelf is only useful if it is read **and** fits the AI's tray.

  Each mission has a guided build, a prediction before you run, three medals tied to real tradeoffs
  (finish / spend less / finish sooner / need no help), and a field-guide card you unlock. Missions
  unlock in order. **Customize…** reveals the full controls (step editor, models, context rules,
  CPU/RAM, journal, timeline, inspector, rewind, live edits). `tests/missions.test.ts` proves which
  builds earn which medals.
- **Phase 2 — Permissions and the evening shift** ✅ Two more missions on the same engine:
  4. *Hands off* — permissions & approvals: the gate only lets out a version Maya approved;
     asking costs waiting time, publishing straight away is blocked (not a violation).
  5. *The evening shift* — a simplified “Everyone is leaving” (spec §9): launch (required, with
     approval), feedback board and partner message (optional), one worker or two, feedback
     sorted by one big model or routed by difficulty, and a hard 50-credit budget. Workers switch
     jobs while one waits for a person; the partner message waits for the launch receipt.

  Engine additions: approvals bound to a draft version, dependency waits, multi-job workers,
  the Team machine, and an evaluator for live-page and shift goals. `tests/phase2.test.ts`
  proves e.g. Team + routed earns every medal at 44 credits, Team + big-model sorting runs out
  of credits, and one worker finishes everything cheaply but later.
- **Phase 3 — Uncertainty, changed conditions, comparison** ✅
  6. *Lost reply* — uncertain outcomes (spec “Uncertain publication”): the publish commits but its
     reply is lost; the player pre-decides the timeout response. Status check confirms with one
     request; resending with the same key is deduplicated; a brand-new request is blocked by the
     existing-operation check; giving up reports failure while the page is actually live.
  7. *Early departure* — Maya leaves at 18:24: only two workers with routed sorting gets the board
     to her in time.
  8. *Quiet evening* — 3 easy threads: one worker with routing does everything for 24 credits; a
     second worker mostly costs rent.

  Results now compare each run with your previous runs of the same mission (medals, credits,
  finish time). `tests/phase3.test.ts` covers every timeout response and both condition changes.
- **Next**: the social-image opportunity with an Away-mode admission policy; mission 9 (memory and
  changed plans); the remaining shifts of the campaign.
- **Later — Layer expansion (Gate C)**: shifts 2–5 (memory, event coalescing, filesystem
  versions, skills).
- **Later — Weekend handoff & release (Gate D)**: capstone, Failure Labs, accessibility polish,
  save import/export UI, performance checks.
