Each item is a chunk that reaches green before the next. An item keeps its number for life: a closed
item leaves this file and its number is never reused, so a commit message citing an item by number
stays true.

- **1.** At the next package visit, replace the local random-state update in `CaptureThumbnailSequence` in `tests/setupServer.ts` with direct use of `seededRandom` from `@orkestrel/contract`. Preserve the thumbnail-noise proof’s required value range and deterministic input, and record any changed fixture population. Add no wrapper that merely renames the generator.
