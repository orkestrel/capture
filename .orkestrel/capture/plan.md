# Capture campaign

This file holds the live plan for releasing `@orkestrel/capture` 0.0.1: the goal, the exit criterion, the state, the deferred triggers, and the open chunks of the sequence.

## Goal

Publish `@orkestrel/capture` 0.0.1 production-ready. On 2026-10-28 the user approved this file's exit criterion as the whole meaning of "production-ready" for 0.0.1. Only the user reopens or widens it.

The campaign changes one repository:

| Repository | URL |
| --- | --- |
| `@orkestrel/capture` | https://github.com/orkestrel/capture |

## Exit criterion

The release is accepted when all of the following hold:
- one falsify round rules C1–C12 CONFIRMED;
- loops L1–L4 reach their counts;
- runs R1–R10 pass;
- the release commit is on `main`.

### Claims

- **C1.** At no instant do two invocations hold `.capture-owner` with their own id.
- **C2.** No code path mutates, renames, or removes a marker whose id is not its own, under any error or interleaving.
- **C3.** The marker is written once. No production path writes the marker path except `linkSync` from a `wx` temporary, and its content is byte-identical from link to unlink.
- **C4.** A dead-owner refusal advises deletion only after a re-read following the liveness probe confirms identical content. It names the dead pid, the run id, the marker path, and the child record: its pids and path, its absence, or its read error.
- **C5.** A live-holder refusal never advises deletion unconditionally.
- **C6.** The transient error codes for read, remove, and link are exactly:
  - {EBUSY, EMFILE} on POSIX;
  - {EBUSY, EMFILE, EPERM, EACCES} on Windows.

  On POSIX, a `link` that fails with EPERM, ENOTSUP, EOPNOTSUPP, ENOSYS, or EXDEV refuses at once with the hard-link wording. Exhausting the retries (1,000 ms in 10 ms steps) names the code and never advises deletion.
- **C7.** When child termination is unconfirmed:
  - the marker stays byte-identical;
  - `runs/<id>/survivors.json` is written create-only and names every unconfirmed pid;
  - release throws, naming the pids, the marker, and the record.

  A later release in the same process retries the stop and removes the marker once termination is confirmed.
- **C8.** Confirmed termination removes only the invocation's own marker and leaves no `.capture-owner*` file. A dead claimant's temporary is swept; a live pid's temporary never is.
- **C9.** Every USAGE refusal in every command leaves no run directory and no marker. An exit-1 failure after discovery keeps its run directory.
- **C10.** With the built files set aside, every server test outside the built-fixture users passes, and the built-fixture users refuse, naming `npm run build`.
- **C11.** `src/server/constants.ts` imports nothing. `CAPTURE_PNG_LIMITS.bytes` equals the budget formula over its own `pixels` and `side`.
- **C12.** `README.md` and `guides/capture.md` state exactly C3–C9. They contain no sentence about replacing or rewriting the marker, and they reproduce the child record and the refusal texts as shipped.

### Release bar

A BROKEN verdict on a claim blocks the release. A finding outside the claims blocks only when it shows one of these:
- two owners at once;
- deletion advice while a live holder or a recorded child exists;
- a crash or raw error reaching the operator for a documented input;
- a write outside the workspace;
- loss of registry, manifest, or lookup data.

A reviewer's severity label does not move a finding across this line. Every other finding goes to § Deferred.

### Loops

A `verifier` runs each loop standalone and reports the counts.

- **L1.** The 12-racer, 6-round ownership race, run 10 times in a row: 0 invalid outcomes, 0 "temporarily unavailable" refusals, 0 markers left.
- **L2.** The `tests/fixtures/capture/Survivor.ts` composition, run 30 times standalone: 30/30 with the marker unchanged at `{pid,id}`, the record naming the child, and the release error naming both paths.
- **L3.** `tests/fixtures/capture/DetachedSurvivor.ts` followed by the next claim, run 30 times: 30/30 refusals naming the dead owner, the child pid, and the record path, with the child alive at refusal time.
- **L4.** 100 prepare/release cycles in one process: 0 remove exhaustions.

### Runs

- **R1–R4.** `format:check`, `lint:check`, `check`, `build`.
- **R5.** Two consecutive `npm test` runs on Windows.
- **R6.** One test run on the final tree with every built file set aside (C10).
- **R7.** One `npm test` on Linux on the release commit.
- **R8.** One run of the `integration` project with Vitest 5.0.5 and its browser provider installed.
- **R9.** One `test:distribution -- --mode release` run.
- **R10.** Pack the tarball, install it into a consumer workspace, and run `registry`, one `journey`, and one `preflight`, each exiting 0.

## State

- The exit criterion is met at `025a8e2`. That commit and its fix-round predecessors (`3ca9839`, `951c7ba`, `d59644d`) carry the hardening rounds, X6, and the X7 repairs.
- **Claims:** C1–C8 and C10–C12 are CONFIRMED. C9, and the blocking finding O1, are repaired and proved by mutation.
- **Loops:** L1 10/10, L2 30/30, L3 30/30, L4 100 cycles with 0 remove exhaustions and 0 markers left.
- **Runs, all on `025a8e2`:**
  - R1–R5: the fresh-clone release run passes format, lint, check, build, and two full `npm test` runs (1,857 passed).
  - R6: with the build set aside, every failure names `npm run build`; 965 tests pass.
  - R7: Linux passes every step: `test:src` 1,128/1,128, distribution 16/16, the race 5/5, no leftover processes.
  - R8: the integration proof passes on Vitest 5.0.5.
  - R9: the release-mode distribution proof passes 16/16.
  - R10: the packed tarball, installed with Vitest 5.0.5, runs `registry`, `journey`, `frames`, and `preflight`, each exiting 0.
- The fresh-clone and Linux runs exposed defects in the test harness that a working checkout hides: a type-resolved `dist` import, scratch parents under the ignored `tmp/`, a status read racing its write, a Windows-only tree kill, and a stale peer literal. Each is repaired in the commits above.
- 0.0.1 is published from `025a8e2` (2026-10-29). `main` is pushed at `69541b9`, `candidate/0.0.1` is deleted, and the guide is mirrored into the scaffold catalog in scaffold 0.0.109.
- Next action: adopt scaffold 0.0.110 and its toolchain (Vitest 5.0.5, TypeScript 7.0.2), then open the 0.0.2 campaign from § Deferred.

## Deferred

These go to 0.0.2. Reopen one when its trigger fires. Every entry is owned by the 0.0.2 hardening campaign (`orkestrel-harden`, which opens its own `plan.md` claims from this list) unless the entry names another owner.

- **Release-exhaustion residual.** If `rmSync` exhausts on the invocation's own marker, the marker is left `{pid,id}` and the next run refuses it as a dead owner with no record. Trigger: a consumer reports a dead-owner refusal with no child record after a clean exit.
- **Pid reuse.** A reused pid can make a dead holder read as alive. Trigger: a consumer reports a live-holder refusal naming a process that is not a capture run.
- **An OS-held lock** (named pipe or socket) in place of the marker, or a pid-plus-start-time stamp. Owner: a design question the 0.0.2 campaign opens before any repair. Trigger: either entry above fires.
- **Live macOS runs, and POSIX live proofs beyond the Linux gate.** Trigger: a consumer installs capture on macOS, or a POSIX host becomes a gate host.
- **Vitest 5 coverage beyond R8.** Owner: capture's scaffold 0.0.110 adoption unit. Trigger: that unit moves capture's own toolchain to Vitest 5.0.5.
- **Wording and logs.** Refusal wording polish, and a `pid=` line in run logs. Trigger: the 0.0.2 campaign opens.
- **Visual refinements.** Thumbnails and sheets. Trigger: a consumer's verdict round reports a thumbnail or sheet that misreads its frame.
- **Duplicate test helpers.** The tests re-implement `captureError` and other helpers that installed packages export (the debrief's artifact audit). Owner: capture's scaffold 0.0.110 adoption unit. Trigger: that unit opens.
- **Review findings below the release bar,** including every low and housekeeping finding raised from 2026-10-28 on. Trigger: the 0.0.2 campaign opens.
- **X7 falsify, outside the claims and below the bar.** Trigger: the 0.0.2 campaign opens.
  - **O2.** The `finally` removal of the claim temporary is unguarded against a host fault.
  - **O3.** The shutdown message names the record path even when no record was written. The record-write code reaches only the aggregate cause.
  - **O4.** The record path is built from the marker's unchecked id, read-only, and the record's child list is uncapped.
  - **O5.** Exhaustion caused by marker churn says `(contention)` instead of an error code.
  - **O6.** After a successful claim, the request-file sweep is unguarded against a directory with a request file's name.

## Sequence

### X6: write-once marker, child record in the run directory

The `astra` role implements X6 under the user's 2026-10-28 design ruling. The unit owns:
- `src/server/CaptureInvocation.ts`, `src/server/types.ts`, and `src/server/constants.ts`;
- the invocation tests and the `Survivor.ts` and `DetachedSurvivor.ts` fixtures;
- the rename case table in `tests/setupServer.ts`;
- the ownership paragraphs of `README.md` and `guides/capture.md`.

**Claim (`prepare()`):**
1. Create the request directory with `mkdirSync(requests, { recursive: true })`, as the claim already does. It must then stat as a directory; otherwise the claim refuses permanently.
2. Sweep `.capture-owner.<pid>.<id>.tmp` files whose pid is dead with `rmSync(force)`. This is best effort: errors are ignored, never thrown. A live pid's temporary is never touched.
3. `writeFileSync(temp, {pid,id}, { flag: 'wx' })`. Any error refuses permanently, naming the operation and the code.
4. `linkSync(temp, lock)`:
   - success means the invocation owns the store;
   - EEXIST takes the held path;
   - transient codes follow C6;
   - on POSIX, the hard-link codes refuse with the hard-link wording;
   - any other code refuses, naming the operation and the code.
5. Held path: `readFileSync(lock)`.
   - ENOENT means the holder released: wait one backoff step, then return to step 4.
   - Transient codes wait one backoff step and read again.
   - Any other code refuses as unreadable, with no deletion advice.
6. Parse `{pid,id}`, ignoring extra members. Probe the pid with `process.kill(pid, 0)`; EPERM counts as alive.
7. Re-read with step 5's classes. If the content differs, return to step 4. If it is the same, refuse per C4 or C5.
8. Always `rmSync(temp, force)`.

**Release:**
1. Await any signal-driven termination, retract the request, and stop every child. The children whose stop is unconfirmed form the unconfirmed set.
2. When leased, read the marker with step 5's classes; ENOENT means there is nothing to remove. When its id is not the invocation's own, return without touching it.
3. When the unconfirmed set is non-empty:
   - Write `runs/<id>/survivors.json` with `{pid,id,command,children,at}` and flag `wx`.
     - EEXIST counts as already recorded.
     - On ENOENT, create the run directory and retry once.
     - Any other code is listed in the shutdown failure.
   - Leave the marker untouched, and keep the lease so a later release retries the stop.
   - Throw STAGE, naming the pids, the marker, and the record path.
4. When the unconfirmed set is empty, remove the invocation's own marker. Re-read it and check its id on every retry, with transient codes per C6. ENOENT means done. Any other code is listed in the shutdown failure, and the marker stays.

**Refusal read of the record** (dead holder only): one read of `runs/<holder id>/survivors.json`, with no retry.
- Well-formed: name the pids and the path.
- ENOENT: state that no child record exists at the path.
- Any other code, or malformed content: state that the record at the path could not be read, with the code.

The record is advisory; the marker is the safety property.

**Remove:**
- the marker-replace path and its in-place fallback;
- `CaptureOwnershipHost.rename` and `CaptureOwnership.children`;
- the replace-guard and rename-retry tests;
- every README or guide sentence about rewriting the marker.

**Add:** `CAPTURE_SURVIVORS_FILE`, one create-only write, and one advisory read.

**The fixture composition:**
- `Survivor.ts` drives production `release()` with `terminate` returning false over a real session.
- `DetachedSurvivor.ts` writes the advisory record by hand into the run directory that production created, because a supervised Windows child dies with its owner.

**Stop line:** stop and report to the Orchestrator when a step on the marker path or the survivor-record path needs a file operation not named here, or when a C1 check fails.

**Out of scope:** operations outside those two paths keep their current behavior and do not trip the stop line:
- request publication and retraction;
- child session management;
- run-directory creation at the first spawn;
- usage-refusal cleanup;
- registry, manifest, and lookup publication.

This scope was clarified on 2026-10-28 after X6's first dispatch stopped on the request-directory creation.

### X7: acceptance

1. A `verifier` runs L1–L4 and R1–R6.
2. One falsify round audits C1–C12. When a claim is BROKEN, the `astra` role repairs only that claim, and only the touched projects rerun.
3. One commit on `main` by explicit paths.
4. R7–R10 run on that commit.
5. With the user's go-ahead: push, publish 0.0.1, and mirror the guide into the scaffold catalog.
