Each item is a chunk that reaches green before the next. An item keeps its number for life: a closed
item leaves this file and its number is never reused, so a commit message citing an item by number
stays true.

- **1.** At the next package visit, replace the local random-state update in `CaptureThumbnailSequence` in `tests/setupServer.ts` with direct use of `seededRandom` from `@orkestrel/contract`. Preserve the thumbnail-noise proof’s required value range and deterministic input, and record any changed fixture population. Add no wrapper that merely renames the generator.
- **2.** When a consumer reports a dead-owner refusal with no child record after a clean exit, repair the release-exhaustion residual: when `rmSync` exhausts on the invocation's own marker, the marker stays `{pid,id}`, and the next run refuses it as a dead owner with no record.
- **3.** When a consumer reports a live-holder refusal that names a process that is not a capture run, guard the owner marker against pid reuse, through a pid-plus-start-time stamp or an OS-held lock (a named pipe or a socket). Rule between them in a design round before any repair.
- **4.** When a consumer installs capture on macOS, or a POSIX host other than Linux becomes a gate host, run the live proofs there.
- **5.** When a consumer's verdict round reports a thumbnail or a contact sheet that misreads its frame, refine that thumbnail or sheet.
