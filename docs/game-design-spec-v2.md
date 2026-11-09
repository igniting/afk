# Night Shift
## Game design specification · v2.0

**Audience:** game designers, gameplay engineers, artists, writers, and QA. No knowledge of AI agents is assumed.

**Status:** specification for a gameplay prototype and a gated path to a full game. Fun, retention, and balance remain hypotheses to test. No playtest or implementation results are claimed.

**Version authority:** this is a standalone replacement design. It supersedes v1's mission structure, controls, scoring, economy, model profiles, and progression. Do not combine conflicting numbers or rules from the two versions. The original remains an archival reference.

**Terminology:** MUST indicates a release or prototype acceptance requirement; SHOULD indicates a default that can change after playtesting. All timings, costs, and model capabilities are fictional game values.

## 1. The game we are making

The player builds a persistent assistant called Relay for a small team preparing a product launch. Each evening, the team leaves behind responsibilities. The player chooses which additional promises to make, assembles a system, and watches it work while people, documents, and services change.

**Player promise:** “Build your own agent. Leave it in charge. See whether your design survives the night.”

**Genre:** a pausable construction and management puzzle game, with investigation and experimentation.

**Primary audience:** software developers curious about agents, including those who have never built one. The game must also make sense to technically interested players without infrastructure experience.

**Platform:** browser; desktop and mobile portrait. Single player, local save, no account, API key, or real integrations required.

**The emotional sequence:** I made something → it worked → I took on more → the world complicated my plan → my design helped or failed → I have an idea for another build.

**The central learning objective:** understand how information, responsibility, computation, authority, and external actions move through an always-on agent.

### 1.1 Three promises the prototype must prove

1. **Building is satisfying.** Before a run, the player makes a decision that changes how the agent works.
2. **Watching is engaging.** The player can anticipate a consequence from the visible machine before opening a detailed log.
3. **Replaying is voluntary.** After succeeding, the player has a reason to try a different build.

Do not proceed to a large campaign merely because the simulation is correct or players understand the lesson.

### 1.2 Scope

Prototype: a short opening, one complete shift, three alternate conditions, comparison, and saved builds. Full game: six shifts using the same systems and world.

Excluded from initial production: live LLM calls, real email or payments, arbitrary code execution, multiplayer, a public leaderboard, procedural dialogue generation, a 3D world, and an unrestricted visual programming language.

The game teaches general systems behind persistent assistants. It does not reproduce the private architecture of a named commercial product.

## 2. Changes from v1 and why they matter

| v1 weakness | v2 decision | Evidence required from the prototype |
|---|---|---|
| Opening consists of watching a supplied agent fail | Player assembles a small working agent and sees a success first | Player can identify something they built before the first complication |
| Most repairs are obvious permanent upgrades | Correctness foundations are provided; choices concern scope, routing, timing, resources, and coordination | At least two different architectures pass the main shift |
| Player mainly toggles supplied policies | Player assigns responsibilities to workers, composes small procedures, and chooses context and escalation rules | Saved builds differ in behavior, not just model tier |
| Missions dictate their fixes | Evaluate outcomes; diagnostic teaching tasks are separate from shift completion | An unanticipated valid solution is accepted |
| Changed incident timings masquerade as replayability | Different workloads, opportunity windows, budgets, and source capabilities change strategy | A condition change creates a reason to alter the build |
| Failure dominates the rhythm | Alternate creation, success, ambition, complication, and recovery | Player sees useful autonomous work regularly |
| Cast provides exposition rather than stakes | Give characters availability, commitments, and visible consequences | Players recognize who benefited from their design |
| Logs carry most of the information | Visible waiting, congestion, context omission, and unresolved actions support prediction | Players can locate a problem without reading the full trace |
| Stars and unlocks substitute for motivation | Reward additional useful outcomes and self-directed improvement | Players replay after passing without being instructed |
| Tests emphasize comprehension | Add observation-based enjoyment and ownership gates | Voluntary replay, experimentation, and anticipation are observed |

## 3. Agent concepts for the development team

An agent is software that pursues a goal through repeated observation, decisions, actions, and recorded progress. It can wait between these steps and resume later. The model is one component of that system.

An LLM accepts a packet of information and generates a response. Here, the response may propose a tool operation, ask for evidence, revise a plan, or decide to wait. It does not automatically see every file or retain every previous call.

The **runtime**, also called a harness, handles wake-ups, task state, context assembly, permissions, execution, and recovery. “Always on” means responsibilities persist and the system can wake when needed. Continuous model inference is unnecessary.

| Concept | Plain meaning | Visible game representation |
|---|---|---|
| Event | Something happened | An artwork revision arrives as a tile |
| Watcher | Notices selected events or checks on a schedule | A receiver with source and wake rule |
| Task | An unfinished responsibility and its current state | A promise card attached to a worker or waiting hook |
| Worker | Executes steps for one task at a time | A workbench with a current task and resource meters |
| Model | Interprets supplied information and proposes a next action | A replaceable decision module on a workbench |
| Context | What one model call is given | A bounded tray of evidence tiles |
| Working memory | The current plan and intermediate findings | Notes on the task card |
| Durable task state | Saved state that survives a worker restart | A journal link on the task card |
| Long-term memory | Stored facts and preferences used across tasks | Source-labeled entries in a cabinet |
| Retrieval | Selecting stored information for a call | Evidence tiles pulled from the cabinet |
| Tool | An executable operation | Read file, render image, send message, publish page |
| Skill | A reusable procedure with instructions and supported steps | A short recipe installed on a workbench |
| Filesystem | Named artifacts and their versions | A shared shelf showing draft, approved, and live versions |
| CPU | Capacity for local computation | Progress bars for parsing and rendering |
| RAM | Temporary space occupied by active programs | Capacity meter holding browser and job blocks |
| Model routing | Choosing which model handles which work | Rules on a workbench or task assignment |
| Approval | Permission for a specified action and version | A seal tied to one artifact revision |
| Verification | Checking what actually happened | A receipt connected to a live result |
| Idempotency | Repeating one logical request without duplicating its effect, when the service supports it | Reused operation ticket |
| Reconciliation | Checking external state after an uncertain result | A probe attached to an unresolved operation |
| Trace | Linked evidence of what the system did | An expandable causal timeline |

### 3.1 Concepts that must remain accurate

- A saved file is not automatically included in model context.
- Context capacity and machine RAM are different resources.
- Saving a transcript is not the same as saving a pending task and its wake condition.
- A tool proposal, a request, an external commit, and a reply are different events.
- A timeout may happen after a successful external action.
- A stronger model cannot act on missing evidence or recover an event never delivered.
- More local CPU does not accelerate a remote model call.
- Permission is enforced independently of the model's proposed action.
- A skill does not grant permission to its tools.
- Cancellation cannot reverse an already committed external action.
- Tool guarantees vary; never teach that all APIs support idempotency or universal exactly-once execution.

## 4. Fiction, ownership, and consequences

### 4.1 Cast

**Maya, founder:** needs the launch prepared, but is leaving to attend her sister's performance. She is reachable until 18:40. Repeated routine questions interfere with that evening. Required approval requests are legitimate, not punishable interruptions.

**Isha, designer:** can send final artwork and correct a mistake before her train departs. Respecting her availability produces a tangible benefit; she does not remain online indefinitely to rescue the player.

**Leo, engineer:** hands off a build and its status. If Relay keeps track of the dependencies, he can leave without monitoring a dashboard all night.

**Nora, partner:** has a separate announcement window. Meeting it creates an additional useful outcome; missing it does not magically destroy the company.

**Relay, the agent:** the player can name it and choose its visual accent. Its behavior reflects the player's design. A quiet build sends few updates; a highly parallel build has several workbenches moving together. No hidden personality statistic changes success rates.

### 4.2 World surfaces

Use compact representations of an inbox, calendar, task board, file shelf, live launch page, and service status. No full email or browser clone is required.

Each accepted commitment has a visible world outcome: a launch page appears, a partner message lands, or a feedback board becomes organized. Completion must look different from merely moving a task card to Done.

### 4.3 Writing constraints

Initial shift brief: at most 60 words before optional detail. Routine message: normally one or two sentences. Debrief: one outcome sentence and one causal observation before expansion.

Characters communicate their needs rather than explaining the curriculum. Teach vocabulary in contextual labels and optional explanations.

Do not use guilt, streak loss, real-time notifications, or forced daily returns as retention mechanisms. Sessions end cleanly; simulated time advances only during play.

## 5. Session structure and player agency

### 5.1 The shift loop

1. **Choose commitments:** inspect one required promise and zero to three optional opportunities. Accept, decline, or reduce scope where offered.
2. **Build:** assign responsibilities, choose procedures and resources, and inspect the forecast.
3. **Run:** observe work, dependencies, costs, and changes in the world.
4. **Respond:** in Practice, intervene or branch the run; in Away, observe the precommitted system.
5. **See consequences:** a short result sequence shows which promises were kept and who benefited.
6. **Choose a next experiment:** improve a metric, accept more work, try a different condition, or continue the story.

Target first shift session: 2–3 minutes building, 2–4 minutes running and inspecting, 1–3 minutes experimenting, and under 1 minute of debrief. These are pacing targets, not forced delays.

### 5.2 Build mode

No timer runs while building. The player can undo configuration changes, compare presets, and inspect capabilities freely. Configuration is saved as a named build.

A contract can be declined before the shift without a penalty. After acceptance, its outcome is tracked. The player cannot erase a missed commitment by deleting it from the UI.

For mid-shift opportunities, the player sets an admission policy before an Away run: decline, accept only when the runtime's conservative capacity estimate fits, or accept specified types within a reserved credit amount. In Practice, the player can decide directly.

A capacity estimate uses observed work and declared upper bounds, never future hidden events. It is labeled an estimate, not a guarantee.

### 5.3 Practice and Away

**Practice:** pause, inspect, change future dispatch policy, or rewind. Live edits create a configuration version and count as interventions; in-flight operations keep their original context and authorization binding. A change cannot retroactively repair an external effect. Rewind creates a new branch and restores the whole simulated world.

**Away:** lock build, commitments, and admission policy. Pausing and inspection are always allowed and free. Any requested intervention converts the run to Practice after a clear in-game choice. No penalties for taking time to think.

Both modes teach. Only intervention-free runs receive the Autonomous completion badge. The game does not lock ordinary campaign progression behind perfect unattended execution.

### 5.4 What decisions are interesting

| Choice | Benefit | Cost or limitation |
|---|---|---|
| One sequential generalist | Low machine cost and simple coordination | Independent work may wait behind other tasks |
| Specialized workers | Concurrent progress, smaller relevant context packets | Higher machine rent; requires assignments and artifact coordination |
| Batch similar inputs | Fewer calls and lower input overhead | Waiting for the batch can miss an early opportunity |
| Act on every update | Fast response | Rework when inputs change repeatedly |
| Wait for a quiet interval | Avoids repeated rendering | Reduces deadline margin |
| Retrieve focused evidence | Smaller packets and less irrelevant material | Additional retrieval/read steps |
| Use a larger model | Handles more authored ambiguity and context | Higher credit cost and latency |
| Ask for clarification | Can resolve information unavailable elsewhere | Must fit the person's availability |
| Accept another commitment | More useful outcomes and story rewards | Consumes shared budget and time |

Do not charge arbitrary premiums for obeying permissions or keeping commitments durable. Fundamental protections are installed. Tradeoffs arise from the work being attempted.

## 6. Construction system

### 6.1 Build board

The board has three types of area: Watchers, Workbenches, and Shared Records. The player places cards into slots and chooses connections through labeled dropdowns or taps. Dragging is optional. No freehand wiring is required.

Prototype limits: two watcher cards, up to two worker cards, one shared journal, and one shared artifact shelf. Later shifts can expose four workers and additional sources. Limits represent the current machine plan and available connectors; do not describe them as universal agent architecture limits.

Each worker has four configurable fields:

1. **Responsibilities:** selected contract types or input categories.
2. **Procedure:** a recipe assembled from allowed steps.
3. **Decision route:** a model or explicit routing rule.
4. **Context rule:** evidence selection and packing priorities.

A task assigned to two workers must have an explicit handoff or fan-out rule. Otherwise configuration validation asks the player to resolve ownership. Independent subtasks may run concurrently; two workers cannot silently claim the same task.

### 6.2 Player verbs

| Verb | Concrete input | Observable effect |
|---|---|---|
| Accept | Tap an optional contract | Adds a promise, deadline, and reward |
| Assign | Tap a worker and select responsibility | Changes which queue receives work |
| Compose | Select a procedure step and choose before/after insertion | Changes execution order or dependency |
| Route | Select a visible input category and model | Changes model calls and cost |
| Pack | Pin, reorder, or summarize evidence categories | Changes exact context packets |
| Reserve | Set credit or capacity reserve | Limits optional work admission |
| Coordinate | Choose serial write or versioned branch-and-merge | Changes artifact ownership and concurrency |
| Run | Run, pause, step, or speed control | Advances the same simulation |
| Investigate | Select a visible symptom | Opens its causal explanation and trace |
| Experiment | Duplicate build or replay snapshot | Creates a comparable run |

### 6.3 Procedure editor

Use a readable list of at most six top-level steps in the prototype. Supported step types:

- Read selected source.
- Decide using model and context rule.
- Execute a permitted tool.
- Wait for an event or time.
- Verify a result.
- Save an intermediate artifact or hand off a subtask.

Named sequence blocks can group a short supported procedure into one top-level card. For example, Prepare Draft expands to read, model decision, render, and save; Await Approval expands to submit and wait; Publish and Verify expands to a decision, publication, and result read. These blocks have no hidden success behavior: their atomic steps, timing, context, and costs remain inspectable and editable one level down. The nine-step launch trace in Section 9 can therefore fit in three top-level cards. Sequence blocks cannot recursively contain other sequence blocks in the prototype.

Steps can have a single condition such as “after publication verified” or “if required evidence is missing.” Do not allow arbitrary nested branching initially. Repeated list processing uses a built-in Batch step with visible batch size and category rule.

Templates are editable starting points. The evaluator accepts any supported procedure achieving the promised outcome. A structurally unsupported recipe gets an explanation before Run, not a mysterious runtime failure.

### 6.4 Correctness foundations versus learning labs

All normal shifts start with a durable task journal, durable timers, stable logical operation IDs, an enforced permission gate, and artifact revision tracking. Their state and cost remain visible. They are not optional upgrades to buy.

Optional 60–90-second Failure Labs let players temporarily remove one protection in a disposable experiment: restart without a journal, omit a constraint from context, retry a non-idempotent write. Labs reveal mechanisms but are not mandatory campaign gates. They never alter the player's saved working build.

External services can lack deduplication or status lookup. Correct handling may then require waiting or escalating an uncertain write. The foundation prevents blind duplicate dispatch; it does not pretend every uncertainty is solvable.

## 7. Screen, animation, and feedback

### 7.1 Main screen

Desktop: top strip with simulated time, Run/Pause, credits and deadline; central build board; compact promise rail on the left; world outcome panel on the right; expandable timeline below. The center must have the largest area.

Mobile at 390 px: sticky controls and nearest deadline; switch between Machine and World; tap a task to open a full-height inspector. Promise cards are horizontally paginated one at a time without requiring precision gestures. All features have button alternatives. Avoid forcing movement across a large canvas.

Body text at least 16 px on mobile; touch targets at least 44 px. Disable selection only on interactive tiles and controls, not readable documents or logs. Keyboard controls include Space for pause, N for next event, Escape for close/back. Support reduced motion and non-color status cues.

### 7.2 State must be visible without logs

| Situation | Required visual |
|---|---|
| Waiting for a person | Task hangs from a hook labeled with person, expected event, and next availability |
| Context item excluded | Tile remains beside the tray with a visible exclusion reason |
| CPU congestion | Queued jobs sit before occupied workbenches; estimated finish updates |
| RAM admission blocked | Program block cannot fit in the memory bar; label says Waiting for RAM |
| Remote inference | Model light runs while local CPU can remain idle |
| Unknown write outcome | One unresolved operation ticket stays attached to the external service |
| Two artifact revisions | Shelf shows both version cards and their writers |
| Approaching deadline | Promise card shows remaining margin, not just a red clock |
| Successful verification | Receipt connects the task to the correct world artifact |

Animation must communicate state changes, not simulate work that is not happening. At high speed, aggregate routine events and pause only on player breakpoints or the first hard violation.

### 7.3 Inspection hierarchy

First click shows: what is happening, what the task is waiting for, and one relevant input/output pair. “Follow cause” moves to the preceding causal event. Detailed trace is a secondary expansion.

Detailed trace includes exact context, selected model, authored decision rule, tool request, permission result, external commit, reply, verification, and durable state. Call explanations are labeled “Simulation explanation,” not hidden real-model reasoning.

The player may see privileged World state for investigation. Label it clearly: “Observer view — Relay has not observed this.” Do not imply the agent knows everything on the screen.

### 7.4 Moment-to-moment rhythm

Show an early useful completion, then introduce a relevant complication, then let the player see the consequence of their design. Avoid stacking three unfamiliar incidents before one understandable success.

If nothing actionable is scheduled for more than five real seconds, offer “Skip to next event.” Skip still processes all intermediate events and costs. No mandatory idle waiting.

### 7.5 Debrief and replay invitation

Show the world outcome first, followed by kept and missed promises, credits, completion times, and interventions. Then offer one factual comparison opportunity derived from the run:

“The page was ready at 18:25. Feedback finished at 18:45. Could a second worker have reached the 18:40 review window?”

Do not claim a suggested build will succeed without evaluating it. Do not assert causation from correlation: label counterfactual claims as comparisons only when a paired replay actually ran.

Replay options: Same conditions, Change conditions, Duplicate build, Continue story. Continuing must be visually equal in prominence to replay; no pressure to perfect every shift.

## 8. First five minutes: create ownership before trouble

### 8.1 Opening: “Take one thing off my plate”

Maya's message: “When Isha sends the logo, put it on the preview page. You can edit the preview freely. Please leave the live page alone.”

Start with an empty worker slot, an installed journal, and two available cards: Inbox Watcher and Worker. The player places them, assigns the preview task, and chooses either a small template procedure or a larger general-purpose procedure. Both can succeed. Only relevant controls are expanded.

The player presses Run. Isha's logo arrives. Relay reads it, updates the preview, and verifies the revision. The preview page visibly improves. Maya replies: “That saved me a task. Can you handle the evening handoff too?”

First visible success target: within 90 real seconds, including construction. No mandatory failure. Do not fill the opening with instructions about all the stations.

### 8.2 First complication: a second version

Isha sends a corrected logo. The player's watcher now matters. A one-time fetch ignores the update; a continuing watcher notices it. The player can inspect or change the wake rule. Both were valid for the first bounded task; the new responsibility requires continuing observation.

The preview is editable and reversible, so this is a low-stakes discovery. Show the two versions side by side. Explain the distinction between “do it once” and “keep this current.”

### 8.3 First ambition

Offer the evening shift with a required launch promise and two optional commitments. Carry the player's working agent forward. They can expand it, rename it, or duplicate it before changing it.

Do not demand that the player replay a known-broken architecture before entering the shift.

## 9. Complete prototype shift: “Everyone is leaving”

### 9.1 Brief and declared conditions

Maya: “Please launch the approved page tonight. Nora would also like a partner message, and I'd love a summary of the feedback before I leave. I can review drafts until 18:40. Take on what you can finish.”

Shift window: 18:00–20:00, all in a fictional local timezone. Starting operating budget: **52 credits**, including the chosen machine rental. Simulated time never tracks the player's real clock.

Forecast visible before acceptance:

- Final artwork expected at 18:08.
- Twelve feedback items expected at 18:12.
- Partner confirmation expected around 18:22.
- Maya accepts review requests submitted by 18:40 and responds 2 simulated minutes later.
- The publication service supports stable operation keys and status lookup.
- New source revisions can occur. No unspecified outage is injected into the baseline fixture.

The baseline is a learning and comparison scenario, not a random punishment generator. Alternate fixtures add their declared condition family.

### 9.2 Commitments

| ID | Promise | Acceptance | Deadline and reward | Completion evidence |
|---|---|---|---|---|
| L | Publish the approved launch page | Required | 19:00; 1 outcome point | Live revision matches approved current release; one publication operation; verified receipt |
| P | Send Nora the partner announcement | Optional | 19:20; 3 points | One message, correct live link and release facts, sent after live verification and partner confirmation |
| F | Prepare a feedback board | Optional | 19:30; 3 points | All 12 items categorized according to their visible evidence; unresolved contradictions marked for follow-up |
| F-early | Make the board available while Maya is present | Bonus on F, not a separate promise | By 18:40; 2 extra points | F completion evidence and timestamp |
| O | Produce a social preview image | Mid-shift opportunity | By 18:50; 2 points | Correct approved artwork transformed into a saved image and verified |

Maximum outcome points: 11. Points are comparable only within the same scenario and seed. They describe useful results, not whether an unsafe action was acceptable.

P is preauthorized only for the supplied template, recipient Nora, and facts copied from the verified live page. An edit outside that scope requires a new approval. Posting to another recipient or using unapproved claims is blocked.

Declining P, F, or O is legitimate. Missing an accepted optional promise is recorded and lowers the promise-keeping result. It does not erase the correctly completed launch. Core completion, all-promises completion, and autonomous completion are separate labels.

### 9.3 Event timeline

| Time | Event | What Relay can observe |
|---|---|---|
| 18:00 | Shift begins; accepted promises recorded | Brief, calendar availability, service capabilities |
| 18:08 | Isha sends final artwork revision 3 | Inbox event with attachment identity |
| 18:12 | Feedback bundle arrives | 12 items, source links, and a `thread_complete` field |
| 18:22 | Nora confirms the announcement | Confirmation event; does not authorize changes beyond template scope |
| 18:30 | Social preview opportunity appears | Request describing deadline, required artwork, and work estimate |
| 18:35 | Social opportunity acceptance closes | Previously accepted work continues toward its 18:50 deadline |
| 18:40 | Maya's review-request window closes | Calendar boundary; earlier queued requests still receive their promised reply |
| 19:00 | Core launch deadline | Evaluator checks world state |
| 19:20 | Partner deadline | Evaluator checks message and content |
| 19:30 | Feedback deadline | Evaluator checks board |
| 20:00 | Shift ends | Final debrief and story outcome |

When all accepted commitments and admitted opportunities are terminal, offer End shift. Do not force the player to watch until 20:00. Machine rental is fixed for this shift, so ending early does not change its accounting.

### 9.4 Baseline procedures and prices

Model profiles and machine plans are defined in Section 12. All tool reads below cost zero credits but consume time. A model call's charge is the listed flat price in the prototype; there is no per-input-unit surcharge.

**Launch L, reference procedure:**

1. Read artwork event/attachment metadata: 0.5 minute.
2. Plan using Deliberate: 3 minutes, 4 credits.
3. Render artwork: 6 CPU-minutes, 1 GB RAM, 2 credits.
4. Write draft: 1 minute, 1 credit.
5. Submit approval request for that revision: 0.5 minute, zero credits.
6. Wait for Maya's response: 2 minutes after request submission, if submitted by 18:40.
7. Decide next action using Deliberate: 3 minutes, 4 credits.
8. Publish: commits after 1 minute, 2 credits for a new logical operation.
9. Verify live revision: 0.5 minute, zero credits.

Total cost: 13 credits. With no contention, artwork arrival at 18:08 produces approval submission at 18:19 and verified publication at 18:25:30.

The second decision can use Swift when the packet contains an explicit matching approval and current artifact state. Deliberate is the easy reference choice, not a required answer. Selecting Swift saves 3 credits and 2 minutes. The evaluator accepts this.

**Partner P, reference procedure:**

1. After Nora's confirmation, read current release draft: 0.5 minute.
2. Prepare template using Swift: 1 minute, 1 credit.
3. Format message: 2 CPU-minutes, 0.5 GB RAM, zero credits.
4. Save draft: 0.5 minute, 1 credit.
5. Wait for verified live publication; if release revision changed, refresh affected facts before continuing.
6. Check template and live facts using Swift: 1 minute, 1 credit.
7. Send: 0.5 minute, 1 credit.
8. Verify recipient and content: 0.5 minute, zero credits.

Total normal cost: 4 credits; 6 minutes of work plus dependency waits. The prepared message is not sent until both dependencies are satisfied.

**Feedback F, two supported reference procedures:**

- Generalist: fetch bundle 0.5 minute; process three batches of four using Deliberate, 3 minutes and 4 credits per batch; one Deliberate reduction call, 3 minutes and 4 credits; save board, 1 minute and 1 credit. Total 13.5 minutes, 17 credits.
- Routed: fetch bundle 0.5 minute; group nine complete threads into three Swift batches, 1 minute and 1 credit each; process the three incomplete threads with their linked evidence in one Deliberate call, 3 minutes and 4 credits; reduce structured outputs using Swift, 1 minute and 1 credit; save, 1 minute and 1 credit. Total 8.5 minutes, 9 credits.

Routing uses the observed `thread_complete` field. It does not use hidden knowledge of which cases are difficult. Other fixtures can omit this field and require a paid triage step, making the routed strategy less universally attractive.

**Social image O:** wait for verified approved artwork; render 12 CPU-minutes at 1 GB RAM for 4 credits; save and verify in 1 minute for 1 credit. Total 13 minutes and 5 credits. A draft is not itself approval to publish to a social account; the requested outcome is a saved image only.

### 9.5 Two viable builds, before optimization

These are feasibility examples calculated from the declared procedures. They are not engine test results or proven optimal solutions. The production team must reproduce them in the actual simulator before signing off the fixture.

**Build A — one generalist, finish one commitment before starting the next**

- Compact machine: 8 credits, one worker.
- L first, then P, then F.
- Deliberate for launch and feedback; Swift for the partner template.
- One worker follows a commitment to completion, including waits. Waiting releases CPU and RAM, but its queue policy does not start another commitment during that wait.
- Decline O for this reference run.

| Work | Start | Finish | Work cost |
|---|---|---|---:|
| L | 18:08 | 18:25:30 | 13 |
| P | 18:25:30 | 18:31:30 | 4 |
| F | 18:31:30 | 18:45 | 17 |
| Machine | Shift rental | — | 8 |
| Total | — | — | **42** |

Outcome: core and all three accepted promises kept; 7 points; misses the early feedback bonus. Ten credits remain. The late feedback board is still useful, but Maya cannot read it before leaving.

**Build B — two workers with routed feedback**

- Team machine: 22 credits, two workers.
- Worker 1 owns L.
- Worker 2 handles F at 18:12, then prepares P at 18:22.
- Feedback uses observed-field routing; P waits for L's verified result before sending.
- Decline O for this reference run.

| Work | Start | Finish | Work cost |
|---|---|---|---:|
| L, worker 1 | 18:08 | 18:25:30 | 13 |
| F, worker 2 | 18:12 | 18:20:30 | 9 |
| P, worker 2 | 18:22 | 18:28 | 4 |
| Machine | Shift rental | — | 22 |
| Total | — | — | **48** |

Outcome: all accepted promises kept and early feedback bonus earned; 9 points. Four credits remain, insufficient for O under this exact build. Maya sees the feedback board before leaving.

Build A is cheaper; Build B produces an earlier useful outcome. Players can improve both. For example, a smaller model for an explicit approval decision releases credits; a different task order changes whether O fits. Do not prevent an economical single-worker solution just to preserve the reference archetypes.

### 9.6 The social opportunity creates a new decision

At 18:30, Build A has enough money for O but must rearrange its work to meet 18:50. Build B has time and a free worker but lacks one credit under its exact reference configuration. A replay can test a cheaper decision route, a different machine, a different commitment set, or a revised schedule.

In Practice, accepting and rescheduling is allowed. In Away, admission policy and predeclared task priorities decide. No invisible player intervention rescues the run.

Two further arithmetic examples show the intended experiment space. Build A can schedule O immediately after P, finishing the image at 18:44:30 and F at 18:58: 47 credits and 9 points. Build B can use Swift for the explicit post-approval check, lowering its original cost to 45; its free worker can run O from 18:30 to 18:43, yielding 50 credits and 11 points. These are supported hypotheses to reproduce in the engine, not mandatory solutions or claims of optimality.

The choice changes useful outcomes. It does not ask players to turn off approvals or gamble with duplicate sends.

### 9.7 Alternate conditions for the prototype

Each condition is a separately selectable fixture with visible forecast, fixed seed, and its own benchmark record. Do not stack all of them on a new player.

| Fixture | Changed condition | Expected design pressure | Required content proof |
|---|---|---|---|
| Quiet evening | Only three complete feedback threads; no incomplete threads; all other timings unchanged | Extra workers may not justify their rent | A compact build completes every accepted promise within budget |
| Early departure | Maya leaves at 18:24; approval requests and F-early deadline both move to 18:24; main task deadlines remain | Prioritize approval-critical work and consider parallel feedback | At least one build achieves core and F-early; late work is still correctly recorded |
| Uncertain publication | First publication commits normally but loses its reply; one timeout at 2 minutes after dispatch | Reconcile external state and keep independent work moving | At least two supported recovery schedules pass without duplicate publication |

Quiet evening F processing is one Swift batch and one Swift reduction, plus fetch and save: 3.5 minutes, 3 credits. A generalist may instead use two Deliberate calls: 7.5 minutes, 9 credits. These are normal selectable routes, not fixture-specific score cheats.

Uncertain publication returns a status lookup in 0.5 minute. The stable key's receipt is available after commit. After successful reconciliation, verify the live revision before unblocking P. A repeat of the same logical key does not incur another publication charge or effect. A fresh key is a different operation and is blocked by the runtime's existing-operation check for the same publication intention.

### 9.8 Completion and failure rules

Core Complete: L correct by its deadline, budget not exceeded, and no hard violation.

All Promises Kept: Core Complete plus every accepted optional commitment correct by its own deadline. Bonuses are not promises and can be missed without changing this label.

Autonomous: All Promises Kept in an Away run with no intervention. Bonus objectives are independently recorded.

Hard violations: unauthorized external action, sending to the wrong recipient, exposing a protected credential, or duplicating a side effect. A blocked proposal is not a violation; it may cause delay. An ordinary missed deadline is a performance failure, not an unauthorized-action event.

Budget reservation prevents new paid work when it would exceed 52 credits. Already reserved operations may finish; free reconciliation and mandatory state persistence remain available. The agent can end with a promise blocked for lack of credits. Do not silently grant an overdraft.

## 10. Full campaign: six shifts with changing responsibilities

The campaign expands only after the first shift passes the enjoyment gates. All shifts reuse the same construction system. Each adds at most two new player-facing control families.

| Shift | Human situation | Core decision | New concept revealed through play | Optional ambition |
|---|---|---|---|---|
| 1. Everyone is leaving | Prepare the launch while the team goes offline | Scope, scheduling, one worker or two | Events, task state, model calls, context, permissions | Partner message, early feedback, social image |
| 2. Plans changed | A partner moves its date; old notes still disagree | Refresh evidence now or defer expensive work until inputs stabilize | Long-term memory, provenance, supersession, retrieval | Reuse preparation for a second audience |
| 3. The noisy evening | Many updates arrive alongside a real blocker | Batch, filter, and decide when a change deserves action | Event coalescing, timers, attention, cancellation | Keep a preview current without interrupting the team |
| 4. Shared workshop | Two people need artifacts built from the same source | Serialize shared edits or branch and merge | CPU, RAM, filesystem versions, sandbox replacement | Produce extra formats before a tight review window |
| 5. A procedure worth keeping | The team repeats a workflow with changed requirements | Reuse and adapt skills; choose specialized models or general handling | Skills, compatibility, context loading, fallback | Handle a new input type without loading every skill |
| 6. The weekend handoff | Maya delegates multiple days and is mostly unreachable | Admission control, replanning, durable waits, selective escalation | Long-term continuity and interaction of all prior layers | Accept one valuable late opportunity without breaking existing promises |

Each shift MUST have at least two passing approaches and at least one optional objective whose attractiveness changes with the forecast. Proof is in headless scenario runs, not designer assertion.

Full campaign duration target: 90–150 minutes for a straightforward route, with optional experiments beyond that. Do not pad duration with compulsory replays or repeated failure demonstrations.

### 10.1 Continuity without a permanent punishment spiral

Successful builds carry forward. Optional successes change small world details: Nora brings a new opportunity, Isha leaves a reusable template, Maya delegates a more complex task. They do not grant essential correctness features.

Missing an optional promise produces a specific response and a visible missed-opportunity record. It must not permanently prevent campaign completion. Core failure can be replayed from the shift start without losing earlier progress.

Each shift has a fixed operating budget. Unspent credits do not accumulate into unlimited future power. This keeps comparisons meaningful and prevents early mistakes from making later shifts unwinnable.

### 10.2 Replay beyond the campaign

Provide a build notebook, run comparison, and condition selector. Notebook entries retain the player's explanation, such as “I batched feedback to reserve the expensive model for exceptions.” Explanation is optional and never graded by text matching.

An optional challenge generator may combine only validated conditions with compatible objectives. It must reject impossible combinations and disclose the forecast family. Fresh randomness without a strategic consequence is not a replay feature.

No daily streak, artificial energy timer, or random reward chest is required.

## 11. Layer-by-layer mechanical requirements

This section tells implementers how the learning content becomes a decision. Do not turn it into an opening lecture or separate minigames.

| Layer | Player control | Mechanism the engine must implement | Failure or tradeoff made visible |
|---|---|---|---|
| LLM | Model per step; fallback rule | Decision from the exact supplied packet and supported capability table | Unsupported ambiguity, slower reasoning, credit use |
| Events | Source, subscription, filters, quiet interval, polling | Delivery distinct from occurrence; durable event records | Missed change, redundant wake-ups, delayed response |
| Scheduling | Task priorities, worker assignments, batching | Ready queues and dependency waits | Work missing an opportunity while another job occupies its worker |
| Working memory | What intermediate state enters the next call | Saved task plan separate from current context | Repeated work when relevant progress is omitted |
| Long-term memory | Retention categories and correction handling | Source, date, subject, supersession | A stale preference or plan influencing a current decision |
| Context | Pin, retrieve, summarize, load skill, read full file | Deterministic packing with visible inclusions and exclusions | Relevant evidence absent despite existing on disk |
| Tools | Select API or browser where supported; choose supported recovery procedure | Independent request, commit, reply, and verification | A result remains uncertain after a timeout |
| Skills | Compose, save, version, and load a reusable recipe | Instructions plus declared dependencies and schemas | An incompatible recipe requires adaptation |
| Filesystem | Shared artifact or separate drafts; persistent location | Versioned writes and explicit merges | Stale overwrite rejected; temporary artifact lost after sandbox replacement |
| CPU | Machine plan and local job concurrency | Actual local work scheduling | Rendering queue versus idle CPU during remote inference |
| RAM | Admission policy and job concurrency | Capacity required before a job starts | Browser jobs waiting for capacity |
| Model selection | Task-type route and evidence-based fallback | Routing from observable fields or a paid triage step | Cheap calls need escalation; larger models can waste budget |
| Persistence | Inspect journal and recovery; vary checkpointed intermediate outputs | Durable commitments, timers, and operation records | Work resumes after restart but unsaved local computation repeats |
| Permissions | Choose task scope within delegated authority | Runtime checks action, recipient, artifact, revision | Unsupported action waits for approval instead of executing |
| Verification | Choose evidence sufficient for objective | World read and comparison | Claiming success without a correct external result does not pass |
| Proactivity | Admission, escalation, digests, and follow-up timing | Rules evaluate observed state and commitments | Helpful independent action versus avoidable interruption |

### 11.1 Durable does not mean every intermediate computation is saved

The task journal always preserves obligations, completed steps, wait conditions, and operation IDs. A long render can still lose unfinished progress when its worker restarts. A player may save intermediate artifacts where the tool supports it. Saving a small result is cheap; saving large intermediate outputs may consume time and storage in later fixtures.

This creates a legitimate recovery choice without offering “forget all your responsibilities” as a viable normal build.

### 11.2 Context selection

Use small, visible context units, explicitly described as a game abstraction rather than real tokens. Each tile has units, source, timestamp, subject, and content.

Packing order: mandatory runtime/tool schema header, player-pinned categories, then selected retrieval and history categories in order. Whole tiles either fit or remain outside with an explanation. If pinned tiles exceed capacity, no call starts; the UI shows the conflict.

Example small-model publication packet: goal 1 unit, current constraint 2, draft identity 2, matching approval 1, short procedure 2 = 8 units. The same model need not receive the full draft to check explicit approval identity, but content preparation requires the appropriate source content.

Available player techniques:

- Include raw source versus authored summary plus file reference.
- Retrieve latest non-superseded fact for the task subject.
- Load one applicable skill instead of every installed skill.
- Keep unresolved obligations while compacting completed conversation.
- Read a referenced file on demand rather than placing it in every call.

A file reference alone does not reveal its contents. A summary has explicit inspectable content and may omit something important. There is no invisible “accuracy minus 10%” modifier.

### 11.3 Memory correction

Memory records retain their original source and time. Corrections point to superseded records; history remains inspectable. Retrieval must distinguish “most recent observed message” from “current authoritative instruction.” An older authoritative deadline may still outrank a newer speculative comment.

Authority is declared in the scenario and observable through sender/source roles. Do not use a hidden correctness label to resolve conflicts for the agent. Unresolved conflicts can require a query or human clarification.

### 11.4 Skills

A saved skill includes an input schema, applicable task types, procedure steps, context requirements, required tools, and output verification. It does not include permissions or hidden model capability boosts.

Skill reuse is rewarding because the player can use a procedure they assembled earlier with a new responsibility. A later incompatible input format should require an understandable edit, not merely purchasing Skill v2.

At least one campaign objective must accept two different player-authored skills. Do not grade recipe names or exact step lists when outcomes are valid.

### 11.5 Escalation and user attention

User availability is a calendar window. A necessary approval is allowed and incurs its actual waiting time, not an arbitrary penalty. A request outside availability waits until the next window unless the scenario permits a specific emergency channel.

Track unnecessary notifications separately: repeated unchanged status, routine results already included in a promised digest, or requests for facts explicitly available in permitted sources. The rule must be visible in the debrief.

Do not treat every question as failure. Some final-shift tasks are designed to require waiting for a person, while others must progress independently. Useful restraint is a valid outcome when the promise explicitly includes escalation as its completion condition.

## 12. Simulation constants and model behavior

### 12.1 Fictional model profiles

| Route | Duration | Credits per call | Capacity | Supported behavior |
|---|---:|---:|---:|---|
| Deterministic step | Tool/local-job duration | Tool charge only | Typed fields | Exact comparison, filtering on explicit fields, formatting, timer registration |
| Swift | 1 minute | 1 | 10 units | Explicit instructions, complete feedback threads, structured reductions, approval identity checks |
| Deliberate | 3 minutes | 4 | 16 units | Authored ambiguity patterns, incomplete threads with supporting evidence, mixed batches |
| Deep | 6 minutes | 9 | 24 units | Authored multi-constraint planning requiring more evidence; not needed for the baseline shift |

These are fictional teaching capabilities. They must not be presented as measured performance of real models. Missing evidence can defeat any model.

In the prototype, remote calls consume no local CPU and 0.1 GB RAM for their active worker connection. They occupy that worker's execution slot until the reply. Other workers may use local CPU meanwhile. Waiting for a person or durable timer releases the worker execution slot entirely.

Full-game prompt caching is optional: if included, an exact unchanged prefix of at least 8 units on the same model is reusable for 30 simulated minutes. It rebates 1 credit on Deliberate or 2 on Deep; Swift remains 1 credit. It does not change capacity, duration, memory, or correctness. Cache is disabled in prototype fixtures and must be explicitly versioned into any later score comparison.

### 12.2 Machine plans

| Plan | Cores | RAM | Worker slots | Fixed shift rent |
|---|---:|---:|---:|---:|
| Compact | 1 | 2 GB | 1 | 8 credits |
| Team | 2 | 4 GB | 2 | 22 credits |
| Workshop | 4 | 8 GB | 4 | 34 credits |

Workshop is unavailable in the initial prototype. Machine rental includes the lightweight journal, timer service, connectors, and ordinary artifact storage for the shift. Their capacity is bounded by fixture content, and they do not compete with worker slots. Later large-artifact fixtures may declare additional charges explicitly.

Each local job uses at most one core. When runnable local jobs exceed cores, share CPU equally and reschedule their completion times when concurrency changes. Local job duration is accumulated CPU work divided by its allocation; do not slow unrelated remote inference when CPU is busy.

RAM is admitted before starting. Jobs that do not fit enter WAITING_RESOURCE. Baseline normal shifts never intentionally crash a job by overcommitting RAM. A Failure Lab can demonstrate such a crash.

Local write/verify operations have the declared wall durations and use 0.1 GB RAM, with negligible CPU in the prototype. Render and formatting CPU/RAM are specified per procedure. Browser jobs in later shifts use 1.5 GB RAM, 1 CPU-minute setup, then 2 minutes of I/O; I/O holds RAM but releases CPU.

### 12.3 Authored decisions, not live AI

The campaign uses deterministic authored model rules. Each rule declares the task type, required visible evidence, supported models, proposed action, explanation, duration, and cost.

Rules may inspect only the current context packet and tool schema. They cannot read hidden world state, future events, the evaluator, or an excluded memory.

Example rule sequence for publication:

1. Current task cancellation present → propose cancel pending work.
2. Draft revision does not match observed approval → propose request matching approval.
3. Required evidence absent → propose a permitted read or clarification according to the installed procedure.
4. Matching approval and current draft present → propose publication with the saved logical operation key.

In a lab, a deliberately naive procedure can propose publication when a constraint was omitted. The gate still protects the world unless the lab explicitly demonstrates the gate's absence in an isolated fixture.

A supported model facing an unresolved ambiguity must seek evidence or expose an unresolved item according to its rule. Some later lab rules can demonstrate a plausible wrong interpretation. Such behavior must be grounded in supplied text and inspectable afterward, not random punishment.

### 12.4 Feedback fixture content requirements

The prototype bundle contains nine complete threads with explicit category evidence and three incomplete threads with linked follow-up evidence. Complete categories are Bug, Feature request, and Question. An incomplete thread can resolve through its linked source or remain Needs follow-up when evidence conflicts.

The content author provides item text, links, observed metadata, expected evidence predicates, and supported model rules. The evaluator checks the resulting board against source evidence, not the route selected. A player can read items individually instead of batching them; the extra calls and timing are the tradeoff.

Swift can reduce already-structured category records correctly. It cannot resolve the incomplete-thread patterns merely because their IDs are known. A deterministic handler can categorize an item only when an observed source field directly supplies the category; do not smuggle semantic understanding into a free script.

### 12.5 Budget and operation accounting

Reserve the full model/tool price before dispatch. Charge at dispatch for a model or local job, including one later interrupted. A restart may therefore require another paid attempt at unfinished computation. External side-effect charges apply once per logical operation accepted by that service; reusing its supported key returns the original receipt without another charge.

If a reservation cannot fit the remaining budget, pause that task as WAITING_BUDGET. Never advance credits by rounding intermediate values. Prototype prices are integers; UI and stored totals must agree.

No passive credit reward is paid during a shift. Outcome points and narrative rewards are computed afterward and cannot finance already-running work.

## 13. Engine rules and persistent state

### 13.1 World versus agent state

World state records what actually happened: live pages, sent messages, service commits, external availability. Agent state records only delivered events, observations, task progress, and stored knowledge.

The evaluator may inspect world state. The decision engine may not. Observer UI can show both, with explicit labels.

### 13.2 Event loop

Use a discrete-event simulation with integer simulated milliseconds. Default 1× playback: one real second advances one simulated minute. Offer 4×, 16×, and Next event. End-shift and skip actions still process all intervening events.

Process equal timestamps in stable phases:

1. External changes and cancellation/restart events.
2. Accepted external operation commits.
3. Replies and delivered notifications.
4. Runtime updates, ready-queue dispatch, and decision starts.
5. Verification completion and durable state writes.
6. Evaluator observations and UI projections.

Within each phase, use a stable sequence number. A remote operation accepted before a worker restart can still commit afterward. A cancellation can block a pending commit only if the specific service supports and has received that cancellation; stopping a local worker alone does not undo the request.

All persistent writes required before an external dispatch complete before that dispatch is enqueued. Phase ordering must not permit a request to leave before its logical operation ID is saved.

### 13.3 Task lifecycle

States: READY, RUNNING, WAITING_EVENT, WAITING_APPROVAL, WAITING_RESOURCE, WAITING_BUDGET, WAITING_RETRY, UNKNOWN_OUTCOME, DONE, FAILED, CANCELLED.

Each task has a goal, owner, revision, deadline, dependencies, current step, saved progress, wait condition, and next wake time. DONE requires objective-appropriate evidence. A model saying “finished” does not satisfy this condition.

Changing a task goal increments its revision. New actions use the current revision. Old queued actions must revalidate before dispatch. If an obsolete action already committed, record the consequence and any explicit corrective work; do not erase it.

Fan-out subtasks receive separate IDs and explicit inputs. A parent joins their required outputs before its dependent step. Artifact writes use expected revisions or an explicit merge; silent overwrites are never a default protection-off shortcut.

### 13.4 External action protocol

1. Save logical intention, payload fingerprint, and operation key.
2. Check permission and artifact/task revision.
3. Reserve resources and dispatch.
4. Record request acceptance if observed.
5. Await reply; on timeout record UNKNOWN_OUTCOME.
6. Use the tool's declared status lookup or supported same-key retry.
7. Verify the externally visible result.
8. Store receipt, complete step, and wake dependents.

A different payload with the same key returns KEY_CONFLICT in the prototype publication service. Revision changes create a new intention only when authorized; they cannot be used to circumvent an unresolved prior operation.

For services lacking both safe retry and lookup, do not auto-repeat a consequential write. Preserve uncertainty and escalate according to the promise. Later scenarios must allow a safe waiting/escalation outcome where certainty is impossible.

### 13.5 Restarts, sleep, and storage

Worker restart clears active local computations, temporary process state, and temporary files. It preserves the shared journal, durable artifacts, timers, and external services. Interrupted local computation restarts from its last supported checkpoint, not necessarily from zero.

Distinguish Temporary, Sandbox-persistent, and Shared durable file storage. Replacing the sandbox clears the first two; restarting only a worker clears the first. A model call already sent may complete but lose its reply; a replayed call is a new paid call unless a fixture explicitly models recoverable provider request IDs.

An idle agent can have zero active workers while watchers and timers remain registered. Show this explicitly at least once. The fiction's always-on responsibility must not be represented as an eternally glowing model.

### 13.6 Replanning

A relevant correction invalidates affected pending steps and creates a decision point. The agent retains valid completed work and updates only the dependent steps. Examples: new artwork invalidates its derived image; a changed partner date moves its timer; a changed recipient invalidates the send authorization.

The player chooses rules governing response: immediate rebuild, wait for a quiet interval, or defer until a specified boundary. The rule cannot ignore a binding deadline or permission change; it can choose when to spend effort on otherwise valid work.

### 13.7 Snapshots and deterministic replay

Snapshot world state, agent state, event queue, accepted remote operations, resource allocations, remaining work, configuration versions, credits, and random-stream positions. Take snapshots at shift start, before side effects, at declared incidents, and on player pause.

Rewind creates an experiment branch and resets both world and agent. It is not a fictional agent ability. Keep immutable versions of files and context packets referenced by prior traces.

Randomness, when enabled, uses independent streams for each external source and incident family. Adding a model call must not rearrange unrelated future events. Identical fixture version, seed, and configuration must produce identical semantic outcomes regardless of playback speed.

### 13.8 Minimum records

| Record | Required content |
|---|---|
| Scenario | Version, seed, forecast, initial world, source capabilities, contracts, events, allowed modules, objectives |
| Build | Workers, assignments, recipes, model routes, context rules, machine, priorities, admission rules |
| Contract | Required/optional, acceptance time, authorized scope, deadline, completion predicate, reward |
| Task | Owner, goal, revision, status, dependencies, step, progress, wait condition, next wake |
| Event | Source, occurrence/delivery time, payload, duplicate identity, causal parent |
| Memory | Subject, content, source, observed time, effective period, authority, supersession |
| Artifact | ID, path, version, content, owner, storage class, approved revision |
| Context packet | Immutable ordered content, units, included/excluded reasons, configuration revision |
| Decision | Packet, model, rule, proposed action, explanation, cost, start/finish |
| Operation | Intention, task/artifact revisions, key, payload fingerprint, dispatch, commit, reply, receipt |
| Approval | Action, recipient if relevant, artifact/version, expiry/revocation |
| Run | Fixture/seed, build, intervention history, credit ledger, traces, snapshots, outcomes |

## 14. Rewards, challenge, and replay evaluation

### 14.1 What progression awards

Award new responsibilities, supported input types, tools, and optional world scenes. Let players reuse a skill or build they created. Cosmetic accents can commemorate a particular achievement but cannot raise model accuracy.

Do not gate a necessary journal or permission control behind experience points. The player gains expressive options, not permission to stop making obvious mistakes.

### 14.2 Result display

Display these separately:

- Core outcome.
- Accepted promises kept/missed.
- Optional outcome points.
- Credits spent.
- Key finish times and deadline margins.
- Necessary requests versus unnecessary notifications.
- Interventions and Autonomous badge.

Never offset a hard violation with enough speed or bonus points. Preserve failed-run traces for learning but exclude violating runs from passing-build comparisons.

### 14.3 Compare builds honestly

Compare runs with the same fixture version and seed. Highlight differences: outcome points, cost, latency, and interventions. Prefer a Pareto-style presentation: one build may be cheaper while another completes more useful work earlier. Do not reduce every advantage to a single opaque score.

If conditions differ, label the comparison as different conditions and do not claim that architecture alone caused the result.

### 14.4 Difficulty progression

Increase difficulty through interacting responsibilities, tighter opportunity windows, changing source facts, incompatible data, and limited resources. Do not increase difficulty primarily through longer text, hidden permissions, random model failure, or more tabs.

At least one mid-campaign challenge should reward doing less: declining an optional task preserves an accepted commitment. At least one should reward ambition: intelligent reuse makes another task affordable.

## 15. Content authoring contract

Every released shift fixture must contain:

1. A concise human brief and visible forecast.
2. Required and optional commitments with explicit authorization boundaries.
3. World artifacts, message content, and source capabilities.
4. Event timeline and any condition-driven events.
5. Decision rules covering every supported input/recipe state.
6. Objective predicates based on external results.
7. At least two passing reference builds, with engine-generated traces.
8. At least one meaningful forecast change that motivates a design change.
9. Hint levels and debrief text grounded in actual causes.
10. A budget, time limits, and evidence that accepted combinations advertised as feasible are feasible.

Unknown rule combinations must fail content validation or produce an explicit unsupported-state diagnostic in development. They must not silently stall a player's campaign.

### 15.1 Hints

Three levels, requested by the player:

- Observe: “The board is waiting while the launch worker is busy.”
- Locate: highlight the worker assignment and upcoming availability window.
- Suggest an experiment: “Try moving feedback to another worker, or processing smaller batches before the review window closes.”

Hints should expose alternatives where they exist. They should not say “select setting B” except in the short initial interaction tutorial.

### 15.2 Objective example

```text
CoreComplete =
  launch.live_revision == required_release_revision
  AND launch.operation_count_for_intention == 1
  AND launch.approval_matches_published_revision
  AND launch.verification_receipt_exists
  AND launch.verified_at <= 19:00
  AND credits_spent <= 52
  AND hard_violations == 0

FeedbackEarlyBonus =
  feedback_contract_was_accepted
  AND feedback.board_matches_source_evidence
  AND feedback.board_saved_at <= fixture.feedback_early_deadline

AllPromisesKept =
  CoreComplete
  AND every accepted optional contract has valid evidence by its deadline
```

Do not require a particular worker count, model name, context policy, or skill name unless it is an explicit scenario constraint disclosed before acceptance. A valid unexpected solution passes.

### 15.3 Boundary rules

Deadlines are inclusive. A review request submitted at exactly the declared cutoff is accepted; one millisecond later is not. Implement acceptance by timestamp comparison rather than a UI availability flag. Actor responses for timely submitted requests still arrive after the availability window closes when the stated response delay requires it.

Opportunity acceptance deadlines must allow at least one feasible route from an advertised state. If a player has already consumed that capacity, the offer may be infeasible for their build; show the known time/cost estimate without promising success.

## 16. Technical architecture and delivery

Keep six modules separate:

1. Simulation core: time, events, world/agent state, jobs, credits, snapshots.
2. Decision engine: authored model rules and typed deterministic handlers.
3. Construction compiler: validates player recipes and produces executable task procedures.
4. Content: fixtures, dialogue, artifacts, rules, and objectives.
5. Presentation: interactive board, world views, animation, audio, inspectors.
6. Persistence: local saves, build notebook, run histories, import/export.

The construction compiler does not execute arbitrary user code. It translates the bounded step vocabulary from Section 6 into validated procedures. The core runs headlessly; UI animation subscribes to its state transitions.

Use one simulation engine for interactive runs, comparisons, and automated validation. Do not fake results in the UI or use a separate success checker based on selected settings.

Save in a browser database. Support export/import of versioned JSON saves, schema validation, and an actionable message for incompatible versions. State explicitly that progress is saved on this device. Cloud sync is outside the prototype.

### 16.1 Performance and accessibility targets

- Input should feel immediate while accelerated simulation runs; offload simulation to a browser worker if necessary.
- A 24-hour fixture with 1,000 events should complete a headless comparison within 2 seconds on the team's declared reference laptop; record that device in QA. This is an engineering target to measure, not a reported benchmark.
- Aggregate routine animation at high speed without removing trace records.
- On mobile, each required task must be completable without horizontal document scrolling or precision dragging.
- Meet the team's WCAG 2.2 AA accessibility target through manual keyboard/screen-reader checks and automated audits. Do not claim certification from automated checks alone.
- Sound, color, and motion must each be dispensable without losing information.

## 17. Verification: correctness and enjoyment

### 17.1 Required simulation tests

1. Identical fixture, seed, and build produce identical semantic outcomes at every playback speed and headless.
2. Context rules cannot access omitted information or hidden evaluator state.
3. A file's existence does not make its content available without retrieval/read.
4. Worker restart preserves obligations and timers, while correctly interrupting unfinished local work.
5. Remote commit survives a lost reply or local worker restart where the tool semantics permit it.
6. Same operation key and payload return one logical result; changed payload produces conflict.
7. An approval for one revision or recipient cannot authorize another.
8. A blocked proposal is distinct from a committed violation.
9. Cancellation blocks future dispatch but does not erase committed world effects.
10. CPU allocation changes local completion times, not remote inference latency.
11. RAM admission queues work and releases capacity when jobs finish.
12. Fan-out and handoff preserve ownership; expected-version writes reject stale updates.
13. Budget reservations prevent overdraft without blocking free reconciliation or journal writes.
14. Replay restores both world and agent, including pending remote operations and credit reservations.
15. Passing depends on objective evidence, not recipe or model identity.
16. The prototype reference schedules and prices reproduce the tables in Section 9 under their declared policies.
17. A player can improve a reference build without losing credit for departing from the intended solution.
18. Model routing uses observed metadata or a paid decision, never a hidden difficulty tag.

### 17.2 Prototype gameplay acceptance

- Player assembles something before the first success.
- First success is possible within 90 seconds without prior agent knowledge.
- Required-only play is supported; accepting additional work is a real choice.
- Two different builds complete all baseline promises, with a measurable tradeoff.
- At least one alternate condition changes an attractive architectural decision.
- A successful player can identify an optional improvement worth testing.
- The machine communicates waits, omitted context, congestion, and uncertainty without requiring a full trace.
- The cast's outcomes are visible in the world, not only in a score table.
- The player can stop after any shift without losing progress.

### 17.3 Formative playtest plan

Recruit eight people: five developers with little agent-building experience and three with practical agent experience. This is a formative sample, not evidence of population retention.

Give each person the opening and baseline shift. Do not explain the agent architecture beforehand. After their first passing run, say: “You can stop here, try another build, or continue.” Do not ask them to replay before measuring voluntary choice.

Observe and record:

| Question | Observable evidence | Provisional gate |
|---|---|---|
| Is the opening understandable? | Time to first self-created success | At least 4 of 5 novices within 2 minutes |
| Is construction expressive? | Player names a choice and its consequence | At least 6 of 8 can identify their own design decision |
| Is watching engaging? | Player predicts a wait, conflict, or outcome before opening logs | At least 5 of 8 make one correct prediction |
| Is replay appealing? | Player chooses another experiment after passing, without prompting | At least 4 of 8 voluntarily replay |
| Does replay involve a new idea? | Player changes scope, scheduling, routing, or worker structure intentionally | At least 3 of the voluntary replayers articulate a hypothesis |
| Is the UI obstructing play? | Time spent searching for a control | No repeated unexplained navigation block over 60 seconds |
| Does learning transfer? | Player explains or repairs one unfamiliar variation | At least 4 of 5 novices demonstrate one correct causal explanation |
| Are advanced players engaged? | Experts discover a tradeoff or propose a valid alternative build | At least 2 of 3, with no unresolved fundamental misconception |

Use gates as revision signals, not proof that the product is addictive. Combine counts with recordings, behavior, and comments. Do not substitute a leading “Was this fun?” question for observation.

### 17.4 Failure responses

If comprehension passes but voluntary replay fails, revise choices, stakes, and optional goals before adding content.

If players replay only to find the mandated setting, the solution space is too narrow. Add alternative procedures or workload choices; do not merely hide the hint.

If players inspect logs constantly, improve visible causality and simplify the main screen.

If one architecture dominates every forecast, adjust workload and service conditions or real resource costs. Do not invent arbitrary penalties for correct designs.

If players enjoy building but dislike waiting, shorten idle playback and add event skipping. Do not inject unrelated incidents merely to occupy time.

If experts exploit information the agent should not have, fix the simulation boundary before tuning scores.

## 18. Production gates and handoff checklist

### Gate A — Construction proof

Build the opening with a watcher, one worker, context tray, preview artifact, and visible verification. Greybox artwork is sufficient. The player must create a working agent and understand one continuing responsibility.

Do not implement the full campaign, elaborate character animation, or all data inspectors at this gate.

### Gate B — One satisfying shift

Implement Everyone is leaving, the two reference builds, editable recipes, optional promises, the social opportunity, Practice/Away, and run comparison. Deliver Quiet evening, Early departure, and Uncertain publication as alternate fixtures.

Exit requires correct engine outcomes and the formative enjoyment gates. A technically correct but unengaging slice returns to design work.

### Gate C — Layer expansion

Add Shifts 2–5 incrementally, each with its human consequence, new decision families, and two passing builds. Recheck navigation and replay after each addition. A new layer must improve the decision space rather than merely add a station to inspect.

### Gate D — Weekend and release preparation

Add the capstone, continuity, accessibility polish, local save recovery, content editing, performance checks, and optional Failure Labs. Test the full campaign with fresh players.

No calendar estimate is mandated here; estimate after Gate A reveals interaction and content-authoring costs.

### Required handoff assets

- Responsive board layouts and world panel states.
- Watcher, worker, context, journal, memory, file, permission, and resource icons with text equivalents.
- Waiting hooks, unresolved operation tickets, versioned artifacts, deadline indicators, and verification receipts.
- Four character portraits and short state-dependent reactions.
- Fixture files, model decision tables, recipe templates, reference builds, and objective predicates.
- Event and artifact content for all prototype contracts.
- Hint hierarchy, glossary, brief/debrief copy, and reduced-motion treatments.
- Engine tests and playtest observation forms.

## 19. Design constraints that must survive implementation

The player owns a strategy, not just a checklist of enabled safeguards.

Every main shift must contain useful success as well as potential failure. Do not make compulsory disaster demonstrations the recurring opening.

Basic correctness is never a power-up. Resource constraints apply to the useful work the agent attempts.

The game must accept valid designs the author did not anticipate. Its bounded recipe system still allows multiple paths to the same objective.

The player can see more than the agent knows. That distinction must remain explicit in UI and code.

An interesting build should continue creating decisions when the workload changes. Changed timestamps alone are not enough.

More text, more layers, and more incidents do not automatically create depth. Prioritize decisions with visible consequences.

The release criterion is not “we covered all the agent terminology.” It is: **players build something they understand, care how it behaves, and voluntarily return to try another design.**
