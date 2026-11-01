# ADR-0005: Scripted features and a machine-addressable command layer

- Status: proposed
- Date: 2026-11-01

## Context

Some geometry is faster to describe than to draw: repetitive patterns, dimension-driven
profiles, imported coordinates, and anything an AI can generate. Clicking every line and
constraint is also a poor fit for producing demo parts and videos repeatedly.

The document is plain JSON and rebuilds deterministically. UI mutations are currently
spread through React handlers, so there is no stable machine API. Two needs follow:

1. an escape hatch that lets a user inspect, edit or replace the code behind a sketch or
   feature; and
2. a single interface that the UI, a headless runner and an AI client can all use, without
   driving the DOM or the kernel directly.

## Decision

1. **One command/query layer.** `core/commands` is the only way to mutate or inspect a
   document. The UI, a headless runner and an AI bridge use the same serializable,
   versioned commands and queries. A command returns the new `Doc` plus solver, regions,
   diagnostics and events; ids and undo transactions are deterministic. Ephemeral UI state
   (selection, active feature, camera) is exposed through queries and explicit view
   commands, not scraped from the DOM.

2. **Generated code, applied once.** Every sketch/extrude exposes canonical builder code
   generated from its current JSON (stable ids/names, mm, degrees). Editing and applying it
   replaces that feature as one undo entry. For a normal feature the JSON remains the
   runtime source of truth; the code is a reversible escape hatch. The last applied source
   may be stored as metadata so it can be reopened, but it is not executed on rebuild and
   is marked stale if the feature is edited by hand.

3. **Scripted features are explicit.** A distinct `script` feature stores versioned source
   plus inputs and derives its output on every rebuild. Its source is the source of truth;
   the derived geometry is read-only and is edited only by editing the source. This avoids
   a dual source of truth.

4. **Code runs isolated and deterministically.** No DOM, kernel, network, filesystem, wall
   clock, or nondeterministic randomness. The runtime is a worker or sandboxed iframe with
   time and memory limits. A failed script is a feature diagnostic: skip it, keep the last
   good body, and name the failure. Identifiers are derived from the source hash and call
   order, never from randomness. A stronger sandbox (for example QuickJS WASM) is a
   separate dependency decision; do not run user or AI code on the main thread.

5. **AI uses commands, not pixels.** An opt-in local-only bridge (MCP or loopback HTTP)
   and a development `window.cad` expose query/apply/run. A client never receives a `Shape`
   or an OCCT handle, and every action is undoable. A capability manifest and examples
   ground the model in what the app actually supports.

6. **The code editor is a stage mode.** It opens from the feature's `code` action the same
   way the sketch editor opens from a sketch step. It is not a permanent sidebar. It follows
   the interaction contract's action vocabulary: a summary plus quiet `cancel` and primary
   `apply`, and invalid code never commits.

## Alternatives considered

1. **Raw JSON editing only.** Safe and dependency-free, but poor for complicated sketches
   and for AI generation. Keep JSON as the low-level representation, not the main UX.
2. **Arbitrary JavaScript in the main thread.** Quick to build, but it can mutate the UI,
   read storage, block the tab and break determinism. Rejected.
3. **A separate CAD DSL before the command API.** It would duplicate the UI/automation
   surface and force AI to learn two schemas. Rejected; define the commands first, then a
   thin builder syntax over them.
4. **Store generated code for every feature and execute it on rebuild.** This creates two
   sources of truth and makes every rebuild depend on a parser/sandbox. Rejected; generated
   code is applied once unless the feature is explicitly a `script` feature.
5. **Drive the UI with Playwright/MCP only.** Useful for end-to-end tests, but unstable for
   AI (coordinates, timing, layout) and not useful for headless batch demos. Rejected as
   the primary API.

## Consequences

- `core/commands` becomes the undo/transaction boundary; React handlers shrink to dispatch
  plus ephemeral UI state.
- The document schema gains optional applied-source metadata and a `script` feature; both
  require `schemaVersion` bumps and migrations. Old files must keep opening.
- Code/replace needs an id-preserving diff. If a replaced sketch changes curve ids,
  downstream extrude region references must be remapped or fall back to auto with a
  visible diagnostic.
- A code editor, parser/runtime and sandbox are new surface area. Tests must cover
  determinism, timeouts, invalid code, and round-tripping existing fixtures.
- The AI bridge is a security boundary: local-only, opt-in, no kernel/DOM access, no
  network from scripts, and every action undoable.

## Open questions

- Sandbox: worker/iframe with frozen globals, or QuickJS WASM (dependency size).
- Builder syntax: a restricted JS/TS subset, or a small expression/loop DSL over JSON
  commands.
- How much ephemeral UI state (selection, active feature, camera) should queries expose?
- Do normal features store their last applied source, or regenerate it on demand?
- Is the AI bridge MCP, loopback HTTP, or both?
