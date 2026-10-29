# @orkestrel/capture

> An evidence protocol, integrity engine, and runner that stamp browser journey frames with their source provenance and classify each frame's freshness.

Run owner-selected browser journeys, capture their frames, and check whether the images still match
the sources and passing records that produced them. The host supplies its owners, variants,
portfolios, and paths through a Vitest journey wrapper. Part of the `@orkestrel` line.

## Install

Add the package to your development dependencies:

```sh
npm install -D @orkestrel/capture
```

The manifest declares these peer ranges; install the browser peers when you run browser journeys:

| Peer                         | Range                 | Required by the manifest |
| ---------------------------- | --------------------- | ------------------------ |
| `vitest`                     | `^4.1.12 \|\| ^5.0.5` | Yes                      |
| `vite`                       | `^8.3.5`              | Yes                      |
| `@vitest/browser-playwright` | `^4.1.12 \|\| ^5.0.5` | Optional                 |
| `playwright`                 | `^1.61.0`             | Optional                 |

## Requirements

The CLI workflow requires the following host setup:

- Node.js >= 22.18.0.
- A Git workspace with a commit and locally installed Vitest.
- A Vitest browser provider and its browser runtime for execution stages. The integration proof uses
  `@vitest/browser-playwright` and Chromium.
- An adopted journey wrapper that answers discovery, reads selection requests, and writes the
  declared final records and journey artifacts. Installing capture alone does not add this protocol
  to an existing test suite.

## Quick start

From an adopted workspace, run this sequence. The fictional `pages:mail` owner must be replaced
with an owner your wrapper declares. The default wrapper is `configs/app/vite.journey.config.ts`;
add `--config <file>` to each command if yours lives elsewhere. The `tmp/sheets` destination must
not exist, and its parent must exist.

```sh
npx capture registry
npx capture journey pages:mail
npx capture frames pages:mail
npx capture stale pages:mail
npx capture preflight pages:mail
npx capture sheets pages:mail --output tmp/sheets
```

The registry command bootstraps the accepted complete-run registry without capturing images.
The scoped journey publishes passing lookup evidence. The frames command captures the selected
owners, running the host's `first` variant in the `narrow` stage and the remaining selected variants
in the `rest` stage. Stale checks provenance; preflight also judges images, artifact coverage,
logged errors, and optional host checks. Sheets applies the same judgment and writes indexed PNG
contact sheets. Preflight and sheets report `acceptance: false`; they provide iteration evidence.

## Commands

Every command accepts `--config <file>`. The principal selection and output flags are as follows:

| Command                                          | Flags and behavior                                                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture registry`                               | `--variant <name>` repeats to refresh selected producing variants; `--mode <name>` selects the wrapper's mode. Takes no selector.              |
| `capture journey <selector>`                     | `--variant <name>` repeats; `--case <full name>` selects an exact case. Use `--changed <ref>` instead of the selector, with optional `--plan`. |
| `capture frames <selector>`                      | Journey flags plus `--state <name>` to resolve a state through fresh passing lookup evidence.                                                  |
| `capture stale <selector>`                       | `--variant <name>` repeats; `--case <full name>`, `--state <name>`, and `--portfolio <name>` narrow the freshness reading.                     |
| `capture preflight <selector>`                   | Stale flags plus `--journeys <directory>` for artifacts and `--checks <module>` for the host's `CAPTURE_CHECKS` export.                        |
| `capture sheets <selector> --output <directory>` | Preflight flags plus required `--output <directory>` for a new contained directory outside the selected capture directories.                   |

A selector is `all` or a declared colon-separated owner path. Only `--variant` repeats. Every
flag except `--plan` takes a nonempty value as `--flag value` or `--flag=value`; a value beginning
with a dash needs equals form. The CLI refuses the `--` terminator and repeated single-value flags.

Registry refresh checks inherited manifest and lookup journal schemas before starting a stage.
An unreadable or unsupported document refuses the refresh and names the file to inspect and repair.

For changed selection, `HEAD` includes uncommitted work. The plan prints changed paths and commands
after discovery and starts no execution child. Shared inputs refuse narrowing and print an explicit
complete journey command. Without `--plan`, owners run in stable order until an owner fails.

The CLI uses this exit contract:

| Exit | Meaning                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | Successful work, current sound evidence, or a valid changed-selection plan, including an empty plan.                                                                                                               |
| `1`  | Every failure other than usage: failed or interrupted stages, empty execution workloads, Git, wrapper, or plan-derived owner failures, ownership refusals, stale or unsound evidence, and containment failures.    |
| `64` | Refused usage, including unknown or empty selectors, unknown variants, states, cases, and portfolios, outside path arguments, invalid flags, and changed selections that require an explicit shared-input journey. |

A held ownership marker refuses before argument values are judged. A supplied `--config`,
`--journeys`, `--checks`, or `--output` path that resolves outside the repository is usage (64).
Containment caught on a resolved target at write time remains a failure (1).

Selectors are checked against the wrapper before registry authentication. A runner reports a release
failure without replacing its already decided exit.

## Host integration

Before output initialization or collection, your wrapper calls `answerCaptureDiscovery` with its
parent PID, process arguments, wrapper path, and project declarations. When the hook answers,
return `buildCaptureDiscoveryConfig()` so discovery starts no browser or test. For an execution
child, read `readCaptureRequest` with the same parent, arguments, and wrapper identity plus the
declared owners and variants. The runner passes the request directory through `CAPTURE_REQUESTS`.

Each project's `test.provide` object supplies the following host declarations:

| Declaration           | Meaning                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `variant`, `variants` | The producing variant and the ordered variant declarations. Readers require each variant's `name`, `width`, and `height`.               |
| `first`               | The producing variant to run alone before the other selected frame variants.                                                            |
| `final`               | The exact final case name that persists the run record, including under exact-case selection.                                           |
| `directory`, `record` | The primary evidence directory and the project's declared record path. Stage records bind the request's invocation, stage, and variant. |
| `inputs`              | Bounded native glob patterns for the input snapshot.                                                                                    |
| `portfolios`          | Authorized portfolio roots with their `portfolio`, `directory`, and `scoped` declarations.                                              |
| `uniform`             | Optional owner selectors for mixed-framing checks. Omission checks every scope; an empty list checks none.                              |
| `standalone`          | Optional portfolio roots with no stamping route through this wrapper.                                                                   |

Declare `owner:` tags for owners and their ancestors, and capture tags for the scopes and parts
that produce frames. Projects must agree on shared host declarations. The final case must retain
collected declarations, passing cases, observed states, emitted destinations, and the authenticated
journey artifact. For the protocol shapes and wrapper examples, see the
[Capture guide](https://github.com/orkestrel/capture/blob/main/guides/capture.md).

## Evidence

The host's evidence directory separates these documents:

- `registry.json` pins complete capture-free runs, authenticated reporter bytes, input hashes,
  declarations, and required output pairs.
- `lookups.json` stores passing state-to-case lookups and collection receipts without upgrading
  historical image stamps. Its optional predecessor manifest digest determines whether it applies.
- `manifest.json` binds image stamps to their execution identity, registry, source hashes, and
  image bytes. Failed or interrupted stages publish no evidence from that stage.

Freshness readings retain every reason and select a primary class in this precedence order:
`duplicate`, `orphan`, `missing`, `unstamped`, `stale-shared`, `stale-own`, then `current` when no
finding applies. A passing capture-free journey does not make an older image current.

Serialize capture commands and the host's Vitest work per workspace. Preparation creates the
request directory and checks that it is a directory. An invocation writes `{pid,id}` once to
a unique `.capture-owner.<pid>.<id>.tmp` file with flag `wx`, then claims `.capture-owner`
with `linkSync`. The marker stays byte-identical from that link until its own invocation
unlinks it after confirmed child termination. It stays held between stages. The temporary
is always removed after the claim attempt. A dead pid's leftover claim temporary is swept
best effort; sweep errors are ignored, and a live pid's temporary is never touched.
The marker does not coordinate another request directory or unrelated Vitest processes.

A held marker is parsed as `{pid,id}`, ignoring extra members. EPERM from the pid probe
counts as alive. After the liveness probe the claim re-reads the marker; a vanished or
changed marker retries. Deletion advice for a dead holder requires identical content on
that re-read. A live-holder refusal makes any deletion conditional on confirming that no
capture process or surviving child is running. Empty or malformed markers require
identical reads separated by backoff and ask for inspection. A permanent read error
refuses as unreadable without deletion advice.

Marker reads, links, and removals retry only `EBUSY` and `EMFILE` on POSIX, and those
codes plus `EPERM` and `EACCES` on Windows, with synchronous 10 ms backoff within
1,000 ms. On POSIX, a link failure with `EPERM`, `ENOTSUP`, `EOPNOTSUPP`, `ENOSYS`,
or `EXDEV` refuses immediately with the hard-link requirement. Exhaustion names the
error code and gives no deletion advice. Other temporary-write or link errors refuse
permanently and name the operation and code.

Release awaits signal-driven termination, retracts its request, and stops every child.
It reads its marker and checks its invocation id before acting; an absent or foreign
marker is left alone. Unconfirmed termination keeps the marker byte-identical and the
lease held. Release writes `runs/<id>/survivors.json` with flag `wx`, treats `EEXIST`
as already recorded, and on `ENOENT` creates the run directory and retries once.
Other write errors join the shutdown failure. The record contains the owner pid, run id,
command, every unconfirmed child pid, and the ISO timestamp of the attempt:

```text
{"pid":1234,"id":"RUN_ID","command":"journey","children":[5678],"at":"2026-10-28T00:00:00.000Z"}
```

Release throws STAGE, naming the unconfirmed pids, marker, and record. A later release
in the same process retries the stop. After termination is confirmed, release removes
only its own marker, re-reading and checking its id on every removal retry. A successful
release leaves no claim temporary or marker from that invocation. An exhausted or
permanent removal failure retains the marker and joins the shutdown failure.

A dead-holder refusal reads `runs/<holder id>/survivors.json` once, without retry.
A well-formed record names its pids and path. ENOENT reports absence; other errors report
the code, and malformed content reports EINVAL. The record is advisory; the marker
provides ownership exclusion. A recorded pid is unconfirmed, not a claim that it is alive.
Stop any recorded children and confirm the marker's content before deleting it.

The following messages use `PID`, `RUN_ID`, `PIDS`, `MARKER`, `RECORD`,
`TEMPORARY`, `DIRECTORY`, `CONTENT`, and `CODE` as placeholders for the actual values. `RECORD_STATUS`
is one of the record messages that follows the dead-owner refusal.

```text
Capture ownership process PID is not running; invocation "RUN_ID". RECORD_STATUS Confirm no capture process or surviving child is running and re-read MARKER to confirm it still names pid PID before you delete this file and rerun
Unconfirmed child processes: PIDS; stop them before deleting. Child record: RECORD.
No child record exists at RECORD.
Child record could not be read (CODE): RECORD.
Another runner holds this workspace (process PID); invocation "RUN_ID"; serialize capture commands. If this pid is not a capture run, confirm no capture process or surviving child is running and re-read MARKER to confirm it still names pid PID before deleting
Capture shutdown failed; child termination was not confirmed for process PIDS; ownership marker retained: MARKER; child record: RECORD
Cannot write capture child record (CODE): RECORD
Cannot write capture ownership temporary (CODE): TEMPORARY
Cannot link capture ownership (CODE): MARKER; the store directory must support hard links
Cannot link capture ownership (CODE): MARKER; inspect the filesystem error and rerun
Capture ownership marker is temporarily unavailable (CODE): MARKER; rerun after serializing capture commands
Capture ownership marker is unreadable: MARKER; rerun after inspecting the filesystem error
Capture request directory is unavailable: DIRECTORY
Capture ownership marker is empty; confirm no capture process or surviving child is running and inspect this file: MARKER; its holder cannot be established
Capture ownership marker is malformed; expected { pid: positive integer, id: nonempty string }, received CONTENT; confirm no capture process or surviving child is running and inspect this file: MARKER
Capture shutdown failed
```

Every USAGE refusal (exit 64) removes its invocation's run directory and leaves no marker.
An exit-1 failure after discovery keeps its run directory and logs.

PNG decoding is capped at 20,971,520 pixels, about 19.5% over the largest measured fleet frame,
1170 × 15000; 2880 × 6000 also fits. Each side is capped at 131,072 pixels. The file allowance is
100,820,583 bytes: the maximum RGBA scanlines plus a 20% encoding margin, checked before reading
or joining compressed chunks. Preflight judges full frames one at a time and retains dimensions
and sheet thumbnails. Isolated Node runs on Windows on 2026-10-28 peaked at 276–333 MiB process
RSS for those fleet frames, 438 MiB for stored-deflate RGBA at the pixel boundary, and 456 MiB for
131072 × 160. Thumbnails use an exact box area average over typed arrays. Every pixel in each
displayed block contributes once; partial edge blocks divide by their actual pixel count. The
accumulators hold one output row, and thumbnails clip at 400 pixels tall.

## Package

The typed ESM and CommonJS entry points expose the following APIs:

- `@orkestrel/capture` supplies protocol types, constants, guards, pure comparison helpers, and
  `CaptureError` with its `isCaptureError` guard.
- `@orkestrel/capture/server` supplies `CaptureIntegrity`, `CaptureRunner`, `CaptureInvocation`,
  `CaptureDiscovery`, `CapturePreflight`, `CaptureSheets`, and `CaptureRegistrar`, their factories
  where provided, the `CaptureCLI` dispatcher and `createCaptureCLI` factory, and host integration
  helpers such as `answerCaptureDiscovery` and `readCaptureRequest`.

For every export, method, and behavioral limit, see the
[Capture guide](https://github.com/orkestrel/capture/blob/main/guides/capture.md).

## Development

Install the development dependencies, build the executable, and run the package and consumer proofs:

```sh
npm install
npm run build
npm test
```

The integration proof at `tests/integration.test.ts` runs the built executable through real Vitest
and Chromium as part of `npm test` or with `npm run test:integration`. It requires `npm run build`,
the installed `@vitest/browser-playwright` browser provider, and the Chromium runtime.

For read-only documentation and formatting checks, run the following commands:

```sh
npm run test:guides
npm run format:check
```

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
