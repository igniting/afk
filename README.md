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

- **Phase 1 — Construction proof (Gate A)** ✅ The opening, *“Take one thing off my plate”*:
  place a watcher and worker, pick/edit a procedure, choose a model and context rule, run it,
  get a verified first success, then meet the “do it once” vs “keep this current” complication.
  Practice mode with pause, speeds, next-event, rewind and live edits; inspector with causal
  “follow cause”; context tray with visible exclusions; permission gate; debrief.
- **Phase 2 — One satisfying shift (Gate B)**: *“Everyone is leaving”* with optional commitments,
  two workers on the Team machine, approvals, CPU/RAM contention, credits, the social-image
  opportunity, Away mode, run comparison, and the three alternate fixtures.
- **Phase 3 — Layer expansion (Gate C)**: shifts 2–5 (memory, event coalescing, filesystem
  versions, skills).
- **Phase 4 — Weekend handoff & release (Gate D)**: capstone, Failure Labs, accessibility polish,
  save import/export UI, performance checks.
