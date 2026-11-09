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
  are all open — play in order or skip ahead. **Customize…** reveals the full controls (step editor, models, context rules,
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
- **Phase 4 — The full campaign (23 missions)** ✅ Shifts 2–6 of the spec, each as an intro
  mission, the shift itself, and a challenge variant, built on a data-driven job engine
  (`src/content/campaign.ts`): read sources with retrieval rules, decide (rules read only the
  tray), local CPU work with fair core sharing, RAM admission, versioned writes with stale-write
  rejection, sends, approvals, questions to people with availability windows, durable waits,
  cancellation, notifications, quiet-interval/restart/queue policies, and precommitted admission
  of mid-shift opportunities (Away mode).
  - Shift 2 *Plans changed* (9–11): memory, authority, supersession; facts that change mid-shift.
  - Shift 3 *The noisy evening* (12–14): coalescing updates, urgent priority, digests vs pings.
  - Shift 4 *Shared workshop* (15–17): two workers on one file, CPU sharing, RAM, machine sizing.
  - Shift 5 *A procedure worth keeping* (18–20): skills, loading one vs all, adapting to new formats.
  - Shift 6 *The weekend handoff* (21–23): admission control, multi-day durable waits, selective escalation.
  - Shift 7 *Untrusted input* (24–26): see Phase 6.

  `tests/campaign.test.ts` proves, for every mission, which builds earn which medals.
- **Phase 5 — Failure Labs** ✅ (spec §6.4, `src/content/labs.ts`) Five optional, disposable
  experiments on the mission map, each suggested after the mission that teaches its protection;
  replays the same small evening with the protection on and then removed, and awards no medals.
  - *Forgotten rule* (after 4): the rule left off the tray → the gate blocks; no gate → a violation.
  - *Blind retry* (after 6): a lost reply plus a blind resend → Nora gets two copies.
  - *No journal* (after 12): a restart mid-render → without a journal the promise is forgotten.
  - *Blind overwrite* (after 15): no version check → a lost update that every report calls “done”.
  - *Memory overcommit* (after 16): no RAM admission → out of memory, a running job is killed.

  `tests/labs.test.ts` proves both versions of every lab behave as described.
- **Phase 6 — Security, field guide pages and illustrations** ✅
  - Shift 7 *Untrusted input* (24–26, `src/content/security.ts`): prompt injection (outside text
    labelled as untrusted data vs pasted into the instructions), least-privilege send tools behind
    the permission gate, secrets held by the runtime instead of the tray, and a third-party skill
    that must not widen permissions.
  - A full field-guide page for each of the 13 concepts (`src/content/guide.ts`): the idea, how it
    works, a worked example from the game, what to watch on the board, common mistakes, the same
    idea in real AI agents, key terms, and links to the missions and labs that practise it.
  - Illustrations drawn as inline SVG (`src/ui/art.ts`): a diagram per concept (concept pages,
    mission briefs, shift banners), portraits of the cast, and a per-worker run timeline in debriefs.
- **Visual theme — “Lamplight”**: a midnight-indigo sky with a faint starfield, desk-lamp amber
  for everything you can act on, moonlight lilac for secondary detail. Fraunces (soft display
  serif) for titles and story text, Figtree for the interface, JetBrains Mono for clocks and
  numbers — all bundled with the site via Fontsource. The title screen is a night skyline where
  your agent’s window glows in its colour; the 3D board uses the same palette with wooden desks.
- **Later**: save import/export UI, accessibility polish, performance checks.
