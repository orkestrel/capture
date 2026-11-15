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

## State

- **process `72a61b6`.** U1 to U5 land:
  - the environment merge folds names by case on every host;
  - the stderr tail walk drops from 2.81 ms to 0.004 ms at 64 KiB;
  - a zombie reads as ended through two `/proc` readings;
  - an aborted signal spawns nothing and carries its reason;
  - POSIX stop and timeout end the child's own group after the root exits, and a 300 ms timeout with a pipe-holding grandchild settles in 320 ms, against 5,329 ms before.

  Ten readers and constants join the server surface; capture is their first consumer. Under review.
- **capture `9fbb96b`, `0fac494`.** The integrity check memoizes each pattern list's matched subset through `path.matchesGlob`. A stage at veneer's population reads 611 ms against 2,320 ms (−73.65%, bar 5.45%).
- **In flight:**
  - capture: the record helpers, the scale instrument, and the pixel loops;
  - test: the progress plugin with the subpath removal, the progress-path and count fixes with the guide command's build dependency, and the portfolio additions with the one-walk `measureContent` and the `verifyFrame` boundary.
- **Next:** accept each in-flight unit, then dispatch the capture progress wiring and the wrapper factory, the whole-suite registry stage, the process follow-ups in capture, and the frame-wait design round.

## Sequence

1. **Process.** Review `72a61b6`, then release.
2. **Test:**
   - the progress plugin and the subpath removal;
   - the progress path, the progress counts, and the guide command;
   - the portfolio additions, the measure walk, and the frame boundary;
   - a design round on the frame waits (66.7 ms per frame, byte-identical without them in 9 of 9 probes), the bare-name resolver, mutation-woken waits, and a DevTools screenshot path;
   - the viewport-frame option.

   Then release.
3. **Capture:**
   - the record helpers;
   - the scale instrument, which reproduces the 63.4 s six-command pass at veneer's population;
   - the pixel loops as typed-array row loops, byte-identical;
   - the process follow-ups: drop the environment scrub, and replace `readCaptureRunning` with process's reader;
   - the progress wiring, `capture progress`, and the peer on test;
   - the wrapper factory and the frame enumerator;
   - the whole-suite registry stage;
   - the single-stage `frames` measurement;
   - the ownership findings the 0.0.1 acceptance round (X7) left below its bar:
     - O2: the `finally` removal of the claim temporary is unguarded against a host fault;
     - O3: the shutdown message names the record path when no record was written;
     - O4: the record path is built from the marker's unchecked id, and the record's child list is uncapped;
     - O5: exhaustion from marker churn reads `(contention)` in place of an error code;
     - O6: the request-file sweep is unguarded against a directory that carries a request file's name.

   Then release, at the fleet's Node range.
4. **Scaffold:**
   - constants, the born journey template that calls the factory, and the journey skill (the gate drops `test:journey` and accepts stale-current portfolios);
   - `ROADMAP.md` items 168 and 169;
   - the bindings line;
   - the guide mirrors.

   Then release.
5. **Veneer adoption.** It deletes its duplicated capture and journey machinery, and its journey configuration shrinks to the factory call.
