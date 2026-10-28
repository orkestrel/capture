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
- A Vitest browser provider and its browser runtime for execution stages. The consumer study uses
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

For changed selection, `HEAD` includes uncommitted work. The plan prints changed paths and commands
after discovery and starts no execution child. Shared inputs refuse narrowing and print an explicit
complete journey command. Without `--plan`, owners run in stable order until an owner fails.

The CLI uses this exit contract:

| Exit | Meaning                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Successful work, current sound evidence, or a valid changed-selection plan, including an empty plan.                                                                                                            |
| `1`  | Every failure other than usage: failed or interrupted stages, empty execution workloads, Git, wrapper, or plan-derived owner failures, ownership refusals, stale or unsound evidence, and containment failures. |
| `64` | Refused usage, including unknown or empty selectors, unknown variants under every command, invalid flags, and changed selections that require an explicit shared-input journey.                                 |

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

Serialize capture commands and the host's Vitest work per workspace. An invocation exclusively
claims `.capture-owner` by hard-linking a complete unique temporary file in the request directory,
including between its stages. A live holder refuses overlap and names the pid. If that pid belongs
to something other than a capture run, inspect the marker and remove it only after confirming no
capture run owns the directory. A later invocation reclaims a dead holder by renaming and verifying
the stale marker; retained `.capture-owner.reclaim-*` fences protect replacement markers from
delayed contenders. Release removes only its own invocation's marker. Empty, unreadable, or
malformed markers refuse with a diagnostic. Use one request directory per workspace; the marker
does not coordinate another directory or unrelated Vitest processes.

PNG decoding is capped at 20,971,520 pixels, about 19.5% over the largest measured fleet frame,
1170 × 15000; 2880 × 6000 also fits. Each side is capped at 131,072 pixels, and files at 600 MiB
before reading. Preflight judges full frames one at a time and retains dimensions and sheet
thumbnails. An isolated Node RGBA decode on Windows on 2026-10-28 peaked at 325–333 MiB process
RSS for those fleet sizes and 434 MiB at the pixel boundary.

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
npm run test:studies
```

The `studies` project runs the built executable through real Vitest and Chromium. It requires the
browser dependencies and installed browser runtime; `prepublishOnly` runs it after `npm test`.
For read-only documentation and formatting checks, run the following commands:

```sh
npm run test:guides
npm run format:check
```

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
