# Campaign: process, capture, and test quality and performance

## Goal

Raise `@orkestrel/process`, then `@orkestrel/capture`, then `@orkestrel/test` to their best measured quality and performance. Cut the time a capture run and the `orkestrel-journey` gate take. Move into capture's source and test's source the machinery a consumer (veneer) carries by hand, and shrink a consumer's capture configuration to one factory call.

## Exit criterion

- Each package's units below are landed, reviewed, and released in the order process, test, capture, then scaffold.
- The scale instrument reads each performance gain against an identical-sides calibration.
- The journey gate runs one complete suite execution fewer, with registry authenticity unchanged.
- Veneer's adoption is planned as its own unit.

## Repositories

| Repository | URL |
| --- | --- |
| `@orkestrel/process` | https://github.com/orkestrel/process |
| `@orkestrel/capture` | https://github.com/orkestrel/capture |
| `@orkestrel/test` | https://github.com/orkestrel/test |
| `@orkestrel/scaffold` | https://github.com/orkestrel/scaffold |
| veneer (consumer, read and run never) | https://github.com/orkestrel/veneer |

## Governing skills

- `orkestrel-harden` for each package unit.
- `orkestrel-align` for the cross-package wiring (the reporter plugin, the wrapper factory, the record helpers).
- `orkestrel-falsify` for each review the size gate names.
- `orkestrel-publish` for the releases.

## Rulings

- **The user, 2026-11-15:**
  - Run small first, grow a run only after a gain is measured, and never run veneer's tests.
  - The journey gate drops `npm run test:journey` once `capture registry` collects the whole suite.
  - The gate accepts a portfolio whose `capture stale all` reads every frame current, in place of a fresh `capture frames all`.
  - `capture frames` single-stage: measure by mutation on the scale fixture, then the user decides.
  - Capture and test drop Vitest 4 from their peer ranges if the progress plugin's hook-order pin fails on Vitest 4.1.12.
  - Capture uses test's progress reporter by import; test's `./reporter` subpath goes.
- **The Orchestrator, 2026-11-15, after a design consultation:**
  - **Reporter.** `@orkestrel/test` owns `createProgressPlugin`, a Vitest plugin whose `configureVitest` hook adds one `ProgressReporter`. It is the only route that survives capture's `--reporter=dot --reporter=json` flags; an instance in `test.reporters` or a Vite `config` hook is dropped. Capture takes test as a non-optional peer, `~0.0.N`, and its wrapper factory mounts the plugin; the progress file is observation, never evidence.
  - **Consumer.** Capture adds `buildCaptureWrapper(options)`, a helper beside `answerCaptureDiscovery` that returns plain config, plus core record helpers. These include `buildCaptureRun`, the writer twin of `validateCaptureRun`, with one definition of a valid record. Product rules stay injected resolvers.
  - **Test portfolio.** Test adds a portfolio `scope`, a one-state projection, and the `observed` list.
  - **Bindings.** A preallocated typed array written once per index, in index order, as the input a byte API needs, is a platform-API write under scaffold `.claude/rules/typescript.md` § Bindings Exemptions; the scaffold unit adds that line.
  - **Refused:**
    - in-process Vitest, because it gives up the wrapper challenge and the tree kill;
    - a host-description cache, because it gives up the wrapper challenge;
    - a hand-built glob matcher beside `path.matchesGlob`;
    - a content-addressed image cache;
    - worker threads, until the scale instrument shows a residue.
  - **Advisories with no unit.** These process costs stay as they are:
    - the copy the Duplex contract requires;
    - `Process.lines` beside `readline`;
    - about 0.2 ms per spawn.

- **Round two, the user, 2026-11-15 and 2026-11-16:**
  - `capture frames` keeps one stage per variant.
  - At veneer's adoption, its gate and one `capture -- all` run on a veneer host, and their reports are kept.
  - Capture navigation runs under reduced motion, and one declared journey per transition kind stays under default motion.
  - Test 0.0.42 ships without the clip route when a probe or its review shows the route writing other bytes than the element path.
  - Capture 0.0.10 ships with the faster shrink, after as many rounds as its review needs, with no fallback to 0.0.9's shrink.
  - When a fix keeps finding the next incremental issue, zoom out and fix the cause upstream.
- **Round two, the consultant, 2026-11-16:**
  - The pixel sums read caller-bounded flat samples, refuse an infinite count, and promise exactness only where every computed number is a safe integer (`baa5ce3`, `cbc5c24`).
  - The runner maps each refusal's condition, carried in `CaptureError.code`, to the command that clears it, through `CAPTURE_RECOVERIES` and `CAPTURE_STATUS_RECOVERIES`, and prints no fallback command (`3cc67ce`).

## State

- **Released:**
  - process 0.0.21 (`bd6da48`);
  - test 0.0.41 (`69103f2`) and test 0.0.42 (`374c39e`), without the clip route;
  - capture 0.0.9 (`681daf1`) and capture 0.0.10 (`7a9c90f`).
- **Capture 0.0.10 holds:**
  - the manifest table and document version 2 (`cdd08ac`, `5b339d0`, `2c54c5e`);
  - the producer map (`d23beb0`);
  - the shrink and decode loops (`1f2a376`);
  - the `SHEETS` line that carries every `READER` member (`4a827c3`, `97a71a1`);
  - the pixel-sum contract (`baa5ce3`);
  - the family audit's root causes (`29e2a11`, `5a05489`);
  - the recovery model, proven by a generated closure test of 546 cells (`3cc67ce`, `270c710`, `d98093e`, `560e470`).
- **On main, unpublished:**
  - the process advisories (`194ca8f`, `43b7066`);
  - scaffold's born journey (`d489681`) and the round-two skill guidance (`7b69063`, `d99779b`).
- **Next:** release scaffold 0.0.138, pinned to capture `^0.0.10` and test `^0.0.42`.

## Sequence

1. **Scaffold 0.0.138.** Pin capture `^0.0.10` and test `^0.0.42`, refresh the capture, process, and test guide mirrors, and release.
2. **Capture closure cost.** The 56 interrupt and failed-child cells of `CaptureRunner recovery closure` run serially, because an emitted interrupt reaches every runner in one test process. Split them across test files, so separate Vitest workers isolate their signals and environment, and read the closure's contended time before and after.
3. **Veneer adoption.** In order:
   - the one Tab walk per census row;
   - reduced-motion capture navigation;
   - dropping the explicit pointer park before each placement.

   It deletes its duplicated capture and journey machinery, and its journey configuration shrinks to the factory call. Its gate and one `capture -- all` run on a veneer host, per the user's round-two ruling.

## Deferred

- **The chunk walk's cost on a PNG split into one-byte IDAT chunks.** Owner: capture. Reopen it when a frame a consumer writes carries more than one IDAT chunk per row.
- **A review of the closure's selector and flags beyond the command name.** Owner: capture. Reopen it when a rendering defect escapes the row tests.
