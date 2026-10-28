# Capture

> An evidence protocol, integrity engine, and runner that stamp browser journey frames with their source provenance and classify each frame's freshness.

A browser application that proves its screens through journeys also emits frames: one image per state and output variant. This package is the evidence behind those frames. Its core declares the protocol a journey writes and a reader checks: the request a runner hands to Vitest, the closing record a variant writes, the receipt and registry that pin a complete run, the stamp and manifest that bind each image to the sources and the commit that produced it, and the freshness classes a reader reports. Its guards validate each document total over hostile input, its helpers hold the pure rules that compare them, and its failures carry a condition the executable maps to an exit code. Its server face declares the engine, runner, preflight, and contact-sheet contracts the later modules implement.

The package names no product group, title, variant, or path. A host supplies every one of them as data: its portfolios, its owners, its variants, its closing case, its first-stage variant, and its input patterns.

```ts
import {
	matchesCaptureSelector,
	readCaptureDirty,
	resolveCaptureStatus,
	isCapturePath,
} from '@orkestrel/capture'

matchesCaptureSelector('pages:mail', 'pages') // true
matchesCaptureSelector('pages:mailbox', 'pages:mail') // false
resolveCaptureStatus(['stale-own', 'missing']) // 'missing'
readCaptureDirty('R  src/new.ts\0src/old.ts\0') // ['src/new.ts', 'src/old.ts']
isCapturePath('../escape.png') // false
```

## Surface

### Types

Protocol shapes from [`types.ts`](../src/core/types.ts).

| Name                       | Kind      | Summary                                                                                       |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| `CaptureErrorCode`         | type      | Names one condition axis a capture failure carries.                                           |
| `CaptureErrorContext`      | type      | Carries structured facts about a capture failure beside its message.                          |
| `CaptureErrorOptions`      | interface | Configures one capture failure's condition, optional context, and optional cause.             |
| `CaptureSelection`         | interface | Carries the selection fields a request and a parking check read.                              |
| `CaptureIdentity`          | interface | Identifies one runner invocation's producing stage and configuration.                         |
| `CaptureRequest`           | interface | Carries a runner request through Vitest's provided-context protocol.                          |
| `CaptureSources`           | interface | Attributes product ownership and behavioral inputs separately.                                |
| `CaptureDigest`            | interface | Records declared patterns, expanded file hashes, and their combined digest.                   |
| `CaptureDestination`       | interface | Identifies one required output pair and its declaring case.                                   |
| `CaptureDeclaration`       | interface | Preserves a collected case's full behavioral declaration.                                     |
| `CaptureEntry`             | interface | Records an emitted destination and its producing case duration.                               |
| `CaptureArtifact`          | interface | Names the journey artifact a closing case wrote and the SHA-256 of its bytes.                 |
| `CaptureRun`               | interface | Records collected declarations, successful observations, and emitted output separately.       |
| `CaptureReceipt`           | interface | Binds a complete registry reading to its report and input hashes.                             |
| `CaptureRegistry`          | interface | Collects validated registry receipts and their required output pairs.                         |
| `CaptureLookup`            | interface | Binds a state-to-case lookup to its registry, inputs, and passing run.                        |
| `CaptureStamp`             | interface | Stamps one emitted frame with execution, source, image, and registry provenance.              |
| `CaptureManifest`          | interface | Holds the registry, frame stamps, and validated case lookups in one document.                 |
| `CaptureStatus`            | type      | Names the primary freshness classification of a required or discovered frame.                 |
| `CaptureFreshness`         | interface | Reports a frame's freshness classification and every supporting reason.                       |
| `CaptureWarning`           | interface | Identifies changed behavioral inputs and conservatively affected cases.                       |
| `CaptureCollectionReceipt` | interface | Binds a successful full collection to the unchanged complete anchor and exact evidence bytes. |
| `CaptureStoredManifest`    | interface | Extends the image manifest with independently authenticated collection evidence.              |
| `CaptureLookupJournal`     | interface | Binds capture-free lookup publication to the exact manifest it supplements.                   |
| `CaptureViewport`          | interface | Declares a host viewport's name and pixel geometry without inferring it from a file name.     |
| `CaptureBox`               | interface | Describes a logged viewport box a journey artifact records for pixel sampling.                |
| `CaptureAssertion`         | interface | Carries the owner-bearing projection of a Vitest JSON assertion.                              |
| `CaptureReport`            | interface | Holds validated reporter assertions without copying Vitest's unrelated wire members.          |

### Constants

From [`constants.ts`](../src/core/constants.ts).

| Name                        | Kind  | Summary                                                                                       |
| --------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `CAPTURE_ERROR_CODES`       | const | Lists the condition axes a capture failure carries, in the order the executable reports them. |
| `CAPTURE_ERROR_BRAND`       | const | Keys the global brand a capture error carries, so a duplicate installation recognizes it.     |
| `CAPTURE_STATUS_PRECEDENCE` | const | Lists the non-current freshness classifications from highest precedence to lowest.            |
| `CAPTURE_REQUEST_PREFIX`    | const | Names the file prefix of a runner request, completed by the runner's process id and `.json`.  |
| `CAPTURE_VERSION`           | const | Holds the protocol version every request, record, receipt, registry, and manifest declares.   |
| `CAPTURE_PNG_SIGNATURE`     | const | Holds the eight bytes every PNG file opens with.                                              |
| `CAPTURE_REGISTRY_FILE`     | const | Names the default accepted complete-run registry file inside a portfolio directory.           |
| `CAPTURE_MANIFEST_FILE`     | const | Names the default image-stamp manifest file inside a portfolio directory.                     |
| `CAPTURE_LOOKUPS_FILE`      | const | Names the default lookup journal file inside a portfolio directory.                           |

### Errors

From [`errors.ts`](../src/core/errors.ts). The executable maps a `USAGE` condition to exit 64 and every other condition to exit 1.

| Name             | Kind     | Summary                                                    |
| ---------------- | -------- | ---------------------------------------------------------- |
| `CaptureError`   | class    | Reports one capture failure under a stable condition axis. |
| `isCaptureError` | function | Checks whether an unknown value is a capture error.        |

### Validators

Total guards from [`validators.ts`](../src/core/validators.ts). Each returns `false` for a value that throws on read, a cycle, or a non-record, and never throws.

| Name                      | Kind     | Summary                                                                                          |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `isCapturePath`           | function | Checks whether a serialized path stays within the portable relative-path vocabulary.             |
| `isCapturePattern`        | function | Checks whether a native glob declaration uses relative portable path segments.                   |
| `isCaptureSegment`        | function | Checks whether a protocol identity can occupy one portable path segment.                         |
| `isCaptureSelector`       | function | Checks whether an owner selector uses canonical colon-separated segments.                        |
| `isCaptureHash`           | function | Checks whether a value is a SHA-256 hexadecimal digest.                                          |
| `isCaptureHashes`         | function | Checks whether a file-hash map has portable keys and valid digests.                              |
| `isCaptureSources`        | function | Checks whether source attribution separates own, shared, and behavioral patterns.                |
| `isCaptureIdentity`       | function | Checks whether an execution identity carries its required authorization fields.                  |
| `isCaptureRequest`        | function | Checks whether a request has the supported version and complete execution identity.              |
| `isCaptureDeclaration`    | function | Checks whether a collected declaration preserves its full owner and state population.            |
| `isCaptureDestination`    | function | Checks whether a destination supplies canonical identity and source attribution fields.          |
| `isCaptureEntry`          | function | Checks whether an emitted entry includes a finite nonnegative case duration.                     |
| `isCaptureArtifact`       | function | Checks whether a record names its journey artifact by portable path and SHA-256 digest.          |
| `isCaptureRun`            | function | Checks whether a closing record preserves declarations, observations, and output separately.     |
| `isCaptureDigest`         | function | Checks whether a shared-source digest retains both patterns and expanded file hashes.            |
| `isCaptureReceipt`        | function | Checks whether a complete-run receipt binds the report, inputs, and declaration registry.        |
| `isCaptureRegistry`       | function | Checks whether a registry document retains its receipts and required output pairs.               |
| `isCaptureLookup`         | function | Checks whether a lookup binds a passing case to its full run record and input hashes.            |
| `isCaptureLookupJournal`  | function | Checks the separate lookup journal and its optional predecessor manifest digest.                 |
| `isCaptureStamp`          | function | Checks whether a stamp binds an emitted image to source and execution provenance.                |
| `isCaptureManifest`       | function | Checks whether an inherited manifest has the supported schema without discarding malformed rows. |
| `isCaptureCollection`     | function | Checks whether collection evidence pins complete input membership and both external artifacts.   |
| `isCaptureStoredManifest` | function | Checks optional collection metadata without upgrading historical image evidence.                 |
| `isCaptureGeometry`       | function | Checks the host's declared viewport without deriving geometry from an output name.               |
| `isCaptureBox`            | function | Checks a journey artifact's recorded sampling box.                                               |

### Helpers

Pure leaves from [`helpers.ts`](../src/core/helpers.ts). A helper that refuses a document throws a `CaptureError` with the `EVIDENCE` condition.

| Name                         | Kind     | Summary                                                                                          |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `describeCaptureError`       | function | Describes a caught failure as one reportable line.                                               |
| `collectCaptureDuplicates`   | function | Finds repeated identities before a keyed collection could discard them.                          |
| `requireCaptureUnique`       | function | Refuses duplicate declarations or portable storage-key collisions before indexing.               |
| `matchesCaptureMembers`      | function | Compares complete populations without erasing duplicates.                                        |
| `matchesCaptureSelector`     | function | Compares an owner with an explicit selector at colon boundaries.                                 |
| `resolveCaptureOwner`        | function | Builds the canonical owner from a destination's registry identity.                               |
| `resolveCaptureKey`          | function | Builds a manifest identity independently of the physical image path.                             |
| `describeCaptureDestination` | function | Serializes a destination's identity and attribution in a deterministic field order.              |
| `describeCaptureIdentity`    | function | Serializes only the registry's execution and output identity, independent of input revisions.    |
| `describeCaptureDeclaration` | function | Serializes a complete behavioral declaration without dropping eligibility or states.             |
| `describeCaptureRequest`     | function | Serializes every request field, retaining the exact argv order.                                  |
| `collectCaptureChanges`      | function | Names every changed, added, or removed file in hash populations.                                 |
| `resolveLookupKey`           | function | Builds the stable case identity used to merge separate lookup receipts.                          |
| `readCaptureReport`          | function | Reads successful Vitest JSON output and validates every owner-bearing assertion.                 |
| `validateCaptureRun`         | function | Validates declaration, reporter, observation, completeness, and output-projection agreement.     |
| `resolveCaptureStatus`       | function | Chooses the primary classification while retaining all findings separately.                      |
| `readCaptureDirty`           | function | Reads Git's NUL-delimited porcelain paths without treating spaces or quoted names as separators. |
| `validateCaptureReceipt`     | function | Validates a complete receipt against full reporter declarations and eligible output coverage.    |

### Server types

Engine, runner, preflight, and contact-sheet contracts from [`types.ts`](../src/server/types.ts).

| Name                         | Kind      | Summary                                                                                                       |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `CaptureCommand`             | type      | Names one command the runner executes: a journey, a frame capture, or a stale reading.                        |
| `CapturePortfolioRoot`       | interface | Supplies a host-authorized physical portfolio root without repeating its states or variants.                  |
| `CaptureHashHandler`         | type      | Digests the exact bytes of one file reading and returns the lowercase hexadecimal digest.                     |
| `CaptureIntegrityOptions`    | interface | Configures the engine's workspace and separate evidence documents.                                            |
| `CaptureStageProject`        | interface | Supplies one selected project's expected closing record and bounded input population.                         |
| `CaptureExecutionResult`     | interface | Carries the native child close outcome without treating a signal as a successful exit.                        |
| `CaptureExecutionHandler`    | type      | Executes the runner's child after the engine captures its input snapshot.                                     |
| `CaptureStageOptions`        | interface | Binds a stage transaction to its exact request, projects, reporter, and process boundary.                     |
| `CaptureFileSnapshot`        | interface | Records one physical file's bytes and native modification readings at a stage boundary.                       |
| `CaptureProjectSnapshot`     | interface | Preserves one project's declared patterns and sorted expansion before execution.                              |
| `CaptureSnapshot`            | interface | Holds a stage boundary's input populations and existing output identities.                                    |
| `CaptureProjectResult`       | interface | Reports validated project evidence, retaining empty successful selections explicitly.                         |
| `CaptureStageResult`         | interface | Reports the successful stage's committed stamps and validated lookup evidence.                                |
| `CaptureReadOptions`         | interface | Selects a declaration population without requiring current images or passing state lookups.                   |
| `CaptureStaleOptions`        | interface | Selects a freshness population and names the producing variants the host wrapper declares.                    |
| `CaptureCheckOptions`        | interface | Selects required output pairs and attributable extras for a freshness reading.                                |
| `CaptureReadResult`          | interface | Returns the exact current declaration destinations and their complete-anchor identity.                        |
| `CaptureCheckResult`         | interface | Reports the exact judged population, every mismatch reason, and conservative test warnings.                   |
| `CaptureLookupOptions`       | interface | Requests a state-to-case resolution before the runner starts any selected project.                            |
| `CaptureLookupResult`        | interface | Resolves one declaring case and its actual output pairs with their passing evidence.                          |
| `CaptureRunEvidence`         | interface | Binds a decoded run record to the physical file whose digest authenticated it.                                |
| `CaptureDirectoryReading`    | interface | Carries one physical-directory ancestry while enumerating logical portfolio paths.                            |
| `CaptureEvidence`            | interface | Carries accepted registry anchors and separately persisted passing run evidence.                              |
| `CaptureCollectionEvidence`  | interface | Carries the authenticated external record beside its collection receipt.                                      |
| `CaptureReceiptInput`        | interface | Supplies a verifier's actual process outcome and exact reporter bytes for registry import.                    |
| `CaptureIntegrityInterface`  | interface | Defines the shared stage transaction, freshness reading, and state resolution engine.                         |
| `CaptureProject`             | interface | Preserves the wrapper's host declarations for the runner.                                                     |
| `CaptureRunnerOptions`       | interface | Configures one runner invocation: its command, its workspace, and the command line it reads.                  |
| `CaptureRunnerArguments`     | interface | Carries parsed runner arguments while leaving omitted selectors available to the usage diagnostic.            |
| `CaptureRunnerInterface`     | interface | Drives owner-selected journeys through narrow and remaining variant stages.                                   |
| `CaptureWriteHandler`        | type      | Writes one chunk of runner output to the stream the host chooses.                                             |
| `CaptureIntegrityHandler`    | type      | Creates the integrity engine the runner reads and stamps through, from the options it derives.                |
| `CaptureStagePlan`           | interface | Names one planned stage and the variants it runs in one Vitest process.                                       |
| `CaptureArgumentsOptions`    | interface | Configures the Vitest argument list one stage spawns with.                                                    |
| `CaptureRequestOptions`      | interface | Configures how a wrapper reads the runner's request for its own Vitest process.                               |
| `CaptureOutcome`             | interface | Carries one project's owner-bearing passed work count from a finished stage.                                  |
| `CaptureRunPlan`             | interface | Carries everything every stage of one invocation shares.                                                      |
| `CaptureInvocationOptions`   | interface | Configures one runner invocation's identity, workspace, and output.                                           |
| `CaptureInvocationInterface` | interface | Owns one runner invocation's identity, request file, children, and interruption.                              |
| `CapturePicture`             | interface | Carries a decoded RGB image for the image checks and the contact sheets.                                      |
| `CaptureReaderOptions`       | interface | Configures a read-only capture consumer using the wrapper's host declarations.                                |
| `CaptureProducer`            | interface | Declares the viewport one wrapper project produces beside the project's own name.                             |
| `CaptureReaderDefaults`      | interface | Supplies the wrapper path and the journey artifact directory a reader command line falls back to.             |
| `CaptureReaderSelection`     | interface | Returns a reader's authenticated selection and the same engine for pixel classification.                      |
| `CaptureArtifactReading`     | interface | Carries a judged run record and the verified text of the journey artifact it names.                           |
| `CaptureJudgedRecord`        | interface | Names the run record a judged frame's stamp points at and the case that stamped it.                           |
| `CaptureJudgedFrame`         | interface | Pairs a judged frame with its verified artifact, when one was read, and its coverage issues.                  |
| `CaptureImageReading`        | interface | Records one selected image's real bytes, geometry, and canonical destination.                                 |
| `CaptureCheckFrame`          | interface | Carries one judged frame to a host check: its destination, its decoded pixels, and its artifact.              |
| `CaptureCheckHandler`        | type      | Reads one judged frame against a host rule and returns the issues it finds, none when it passes.              |
| `CapturePreflightResult`     | interface | Reports selected image checks without upgrading their engine freshness classifications.                       |
| `CapturePreflightInterface`  | interface | Reads the selected population's frames and reports their freshness, framing, and coverage.                    |
| `CaptureSheetOptions`        | interface | Carries a contact-sheet output request separately from the population selection.                              |
| `CaptureSheetCell`           | interface | Holds one contact-sheet cell: a frame's destination, its shrunk picture, and what the sheet reports about it. |
| `CaptureSheetGroup`          | interface | Holds the cells of one portfolio, owner, and state side by side as one composite picture.                     |
| `CaptureSheetRow`            | interface | Holds a pair of groups side by side as one composite picture.                                                 |
| `CaptureSheetPage`           | interface | Holds one written sheet: its file name, the rows it stacks, and the composite picture.                        |
| `CaptureReaderCommand`       | interface | Carries parsed reader arguments and an optional contact-sheet output directory.                               |
| `CaptureSheetsInterface`     | interface | Composes exactly the authenticated sparse state and output pairs for iteration review.                        |
| `CaptureRegistryArguments`   | interface | Carries the parsed registry command line: the wrapper, the variants to refresh, and the mode.                 |
| `CaptureRegistrarOptions`    | interface | Configures one registry refresh: its workspace, wrapper default, request directory, and command line.         |
| `CaptureRegistrarInterface`  | interface | Refreshes the accepted registry from one complete capture-free journey per producing variant.                 |

### Server constants

The runner's names and bounds from [`constants.ts`](../src/server/constants.ts).

| Name                     | Kind  | Summary                                                                                                                                                                                                                         |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPTURE_COMMAND_NAMES`  | const | Names the executable subcommand each runner command answers to.                                                                                                                                                                 |
| `CAPTURE_EXIT`           | const | Holds the exit status each runner outcome maps to.                                                                                                                                                                              |
| `CAPTURE_STAGES`         | const | Names the two stages a runner invocation plans: the first variant alone, then the rest together.                                                                                                                                |
| `CAPTURE_OPTION_FLAGS`   | const | Lists the command-line flags the runner reads, each followed by exactly one value.                                                                                                                                              |
| `CAPTURE_TAG_OPERATORS`  | const | Lists the words a tag name can never be, because a tag filter reads them as operators.                                                                                                                                          |
| `CAPTURE_OWNER_PREFIX`   | const | Names the tag prefix that marks a case's owner path and each ancestor of it.                                                                                                                                                    |
| `CAPTURE_FLAG`           | const | Names the environment variable that turns frame capture on for a Vitest child.                                                                                                                                                  |
| `CAPTURE_FLAG_VALUE`     | const | Holds the one value of the capture variable that turns frame capture on.                                                                                                                                                        |
| `CAPTURE_VITEST_ENTRY`   | const | Names the repository-relative path of the Vitest entry the runner spawns through Node.                                                                                                                                          |
| `CAPTURE_RUNS_DIRECTORY` | const | Names the directory beneath a portfolio or request directory that holds one invocation's records.                                                                                                                               |
| `CAPTURE_READER_FLAGS`   | const | Lists the command-line flags a reader reads, each followed by exactly one value.                                                                                                                                                |
| `CAPTURE_MINIMUM_IMAGE`  | const | Holds the byte count under which an image is too small to be a real frame.                                                                                                                                                      |
| `CAPTURE_REPORT_LINES`   | const | Names the first word of the line a reader prints, followed by its JSON report.                                                                                                                                                  |
| `CAPTURE_SHEET`          | const | Holds the contact-sheet geometry: how wide a cell shrinks toward, how tall it may grow, the mark that stands in for an unreadable image, the gap between neighbors, and how many cells, rows, and pairs a row and a sheet hold. |
| `CAPTURE_SHEET_FILES`    | const | Names the contact-sheet files: the sheet prefix and digits, and the two index documents.                                                                                                                                        |
| `CAPTURE_REGISTRY_FLAGS` | const | Lists the command-line flags the registry refresh reads, each followed by exactly one value.                                                                                                                                    |
| `CAPTURE_REGISTRY_STAGE` | const | Names the stage each producing variant's complete journey runs in, ahead of the variant's name.                                                                                                                                 |
| `CAPTURE_REGISTRY_LINE`  | const | Names the first word of the line the registry refresh prints, followed by its JSON summary.                                                                                                                                     |
| `CAPTURE_SUBCOMMANDS`    | const | Names the executable's subcommands in the order its usage text lists them.                                                                                                                                                      |
| `CAPTURE_DEFAULTS`       | const | Holds the repository-relative paths the executable falls back to when the command line names none.                                                                                                                              |
| `CAPTURE_USAGE`          | const | Holds the usage text the executable prints when it is given no subcommand or an unknown one.                                                                                                                                    |

### Server helpers

Leaves from [`helpers.ts`](../src/server/helpers.ts): hashing, digests, registry import, flag reading, the PNG codec, the runner's parsing, and the few reads and writes of the filesystem the runner and the registry refresh make (`loadCaptureProjects`, `readCaptureInputs`, `readCaptureRunning`, `readCaptureRequest`, `writeCaptureDocument`). A helper that refuses an image or a receipt throws a `CaptureError` with the `EVIDENCE` condition.

| Name                           | Kind     | Summary                                                                                                   |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| `computeCaptureHash`           | function | Hashes exact source or image bytes with SHA-256.                                                          |
| `normalizeSlashes`             | function | Normalizes a host path to forward slashes.                                                                |
| `readFlag`                     | function | Reads the value that follows a flag.                                                                      |
| `readFlags`                    | function | Reads every value that follows a repeatable flag.                                                         |
| `buildCaptureDigest`           | function | Computes the digest of both pattern declarations and expanded path and hash membership.                   |
| `computeRegistryDigest`        | function | Computes the registry identity from its authenticated receipts and exact output population.               |
| `buildCaptureRegistry`         | function | Imports complete receipts only after their actual exits and exact report bytes validate.                  |
| `matchesCaptureSignature`      | function | Checks whether bytes open with the eight-byte PNG signature.                                              |
| `predictCaptureByte`           | function | Computes the PNG Paeth predictor used by both image readers.                                              |
| `readCaptureChunks`            | function | Reads PNG compressed-data chunks while refusing truncated or corrupt image bytes.                         |
| `unfilterCaptureRow`           | function | Reconstructs one filtered PNG scanline from its filter byte and the row above.                            |
| `inflateCaptureStream`         | function | Inflates a PNG's compressed stream, refusing one that is corrupt or longer than declared.                 |
| `decodeCapturePicture`         | function | Decodes the RGB or RGBA, eight-bit, non-interlaced PNGs the capture readers consume.                      |
| `encodeCaptureWord`            | function | Encodes an unsigned 32-bit integer as four big-endian bytes.                                              |
| `encodeCaptureChunk`           | function | Encodes one checked PNG chunk for contact-sheet output.                                                   |
| `encodeCapturePicture`         | function | Encodes an RGB picture using the contact-sheet writer's native PNG format.                                |
| `shrinkCapturePicture`         | function | Scales a picture by a whole-number area average and clips its displayed height.                           |
| `composeCapturePictures`       | function | Composes pictures on the contact-sheet gray background.                                                   |
| `readCaptureRequestOwner`      | function | Reads the process id that a request file, or its temporary sibling, names.                                |
| `resolveCaptureRelative`       | function | Resolves a path to the slash-separated form the evidence documents store, relative to a root.             |
| `escapeCapturePattern`         | function | Escapes every regular-expression metacharacter so a case name matches only itself.                        |
| `buildCaptureFilter`           | function | Builds the tag expression that selects an owner population, and its capture tags for frames.              |
| `resolveCaptureStages`         | function | Plans the stages of one invocation: the first variant alone, then every other variant together.           |
| `buildCaptureArguments`        | function | Builds the exact Node argument array that spawns one Vitest stage.                                        |
| `readCaptureArguments`         | function | Reads the runner's command line into one selector, its flags, and the resolved wrapper path.              |
| `readCapturePortfolios`        | function | Reads the physical portfolio roots a wrapper declares and refuses a malformed or repeated root.           |
| `readCaptureProject`           | function | Reads one wrapper project's host declarations from its Vitest test configuration.                         |
| `describeCapturePortfolios`    | function | Describes a project's portfolio roots as comparable lines, primary roots apart from standalone ones.      |
| `requireCaptureProjects`       | function | Refuses a wrapper project set whose members repeat or disagree on a host declaration.                     |
| `describeCaptureSelectorFault` | function | Describes why a selector names nothing the wrapper declares, naming the first unknown segment.            |
| `buildCaptureRequestRefusal`   | function | Builds the refusal a wrapper raises for a request file it cannot accept as its parent's.                  |
| `readCaptureRequest`           | function | Reads and validates the request the runner wrote for the wrapper process that is its child.               |
| `readCaptureReaderArguments`   | function | Reads a reader's command line into its selection, its flags, and the resolved paths.                      |
| `readCaptureViewport`          | function | Reads the viewport a wrapper project's producing variant declares.                                        |
| `buildCaptureIntegrityOptions` | function | Derives the integrity engine's options from a wrapper project's host declarations.                        |
| `collectCaptureFraming`        | function | Reports a portfolio, owner, and viewport whose frames mix cropped, viewport-sized, and page-sized images. |
| `collectCaptureIdentical`      | function | Groups the selected images whose bytes are identical.                                                     |
| `collectCaptureErrors`         | function | Finds the journey artifact lines that report an uncaught, unhandled, or logged error.                     |
| `readCaptureRunning`           | function | Checks whether a process with this id is running, counting one the caller may not signal.                 |
| `readCaptureWrapperProject`    | function | Resolves one entry of a wrapper's project list and reads its host declarations.                           |
| `loadCaptureProjects`          | function | Loads the wrapper in this process and reads every project's host declarations.                            |
| `readCaptureRegistryArguments` | function | Reads the registry command line into the wrapper path, the variants to refresh, and the mode.             |
| `readCaptureInputs`            | function | Reads the bounded input population a project declares, as file paths and content hashes.                  |
| `writeCaptureDocument`         | function | Writes one JSON document atomically, so a reader sees the old bytes or the new and never a part.          |

### Server classes and factories

The integrity engine from [`CaptureIntegrity.ts`](../src/server/CaptureIntegrity.ts) and its factory from [`factories.ts`](../src/server/factories.ts).

| Name                     | Kind     | Summary                                                                                                      |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| `CaptureIntegrity`       | class    | Validates capture transactions, freshness, and state lookup against real filesystem evidence.                |
| `createCaptureIntegrity` | function | Creates the integrity engine bound to an explicit workspace and host portfolio mapping.                      |
| `CaptureRunner`          | class    | Drives owner-selected journeys through narrow and remaining variant stages.                                  |
| `CaptureInvocation`      | class    | Owns one runner invocation's identity, request file, children, and interruption.                             |
| `createCaptureRunner`    | function | Creates the runner that drives owner-selected journeys for one command line.                                 |
| `CapturePreflight`       | class    | Reads the selected population's frames and reports their freshness, framing, and coverage.                   |
| `CaptureSheets`          | class    | Composes exactly the authenticated sparse state and output pairs for iteration review.                       |
| `createCapturePreflight` | function | Creates the preflight that judges the selected frames' freshness, framing, and coverage.                     |
| `createCaptureSheets`    | function | Creates the contact-sheet writer for the selected frames.                                                    |
| `CaptureRegistrar`       | class    | Refreshes the accepted registry from one complete capture-free journey per producing variant.                |
| `createCaptureRegistrar` | function | Creates the registry refresh that runs each producing variant's complete journey and publishes the registry. |

## Methods

#### `CaptureIntegrityInterface`

| Name     | Summary                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| `read`   | Reads current full-collection evidence and selects exact declaration destinations.       |
| `stamp`  | Validates an executed stage before atomically publishing its authorized evidence.        |
| `check`  | Checks the explicitly selected output population without changing evidence or images.    |
| `lookup` | Resolves an explicitly requested state through fresh registry and passing case evidence. |

#### `CapturePreflightInterface`

| Name      | Summary                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `read`    | Reads the authenticated selection and the host's declared viewports.                |
| `check`   | Judges every selected frame and returns the framing, freshness, images, and issues. |
| `execute` | Executes the check and prints its report.                                           |

#### `CaptureRunnerInterface`

| Name      | Summary                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `execute` | Executes the command line without widening its owner or variant selection. |

#### `CaptureInvocationInterface`

| Name          | Summary                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| `id`          | Holds the invocation identity, which names its report directory and its request records.      |
| `request`     | Holds the absolute path of the request file this process names.                               |
| `directory`   | Holds the absolute directory that holds this invocation's reports and logs.                   |
| `signal`      | Holds the signal that aborts when the invocation is interrupted.                              |
| `interrupted` | Holds whether an interrupt has arrived.                                                       |
| `attach`      | Installs the interrupt handler on the process.                                                |
| `release`     | Waits for any interrupt termination to finish, then removes the interrupt handler.            |
| `prepare`     | Creates the report directory and removes request files that name a process no longer running. |
| `holders`     | Lists the other live processes that hold a request file in the request directory.             |
| `publish`     | Writes the stage request atomically, so no reader sees a partial file.                        |
| `retract`     | Removes this process's request file and its temporary sibling.                                |
| `launched`    | Reports whether a child with this log path has been spawned by this invocation.               |
| `spawn`       | Spawns the Vitest child and tees its output to the host streams and the log.                  |

#### `CaptureSheetsInterface`

| Name      | Summary                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `execute` | Reads selected physical images, writes complete indexed sheets, and retains all refusals. |

#### `CaptureRegistrarInterface`

| Name      | Summary                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------- |
| `execute` | Runs each producing variant's complete journey, imports the receipts, and publishes the registry. |

## Server modules

Each section below is filled by the unit that lands its module.

### Integrity

The stage transaction, the freshness reading, and the state resolution engine. `createCaptureIntegrity` binds an engine to a workspace root, the evidence documents it reads and writes, the bounded input patterns, and the authorized portfolio roots. The engine infers no portfolio, owner, source pattern, or application path from a name; the host supplies each one.

```ts
import { createCaptureIntegrity } from '@orkestrel/capture/server'

const integrity = createCaptureIntegrity({
	root: process.cwd(),
	directory: 'tmp/captures/states',
	inputs: ['src/**'],
	registry: 'tmp/captures/states/registry.json',
	manifest: 'tmp/captures/states/manifest.json',
	lookups: 'tmp/captures/states/lookups.json',
	portfolios: [{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }],
})
const result = await integrity.check({ selector: 'pages:mail' })
result.entries.map((entry) => entry.status) // one classification per selected frame
```

`stamp` is the only method that writes. It snapshots the bounded inputs, runs the runner's child once, and validates every selected closing record against the reporter before it replaces the manifest in one atomic rename; a failure before that rename leaves the prior manifest bytes untouched, and a journey publishes lookups and full-collection receipts in the separate journal instead. `check` classifies each selected frame as `duplicate`, `orphan`, `missing`, `unstamped`, `stale-shared`, `stale-own`, or `current`, and keeps every finding that justified the class. `read` and `lookup` start no process: they resolve a selection or a state from evidence, and a refusal names the explicit refresh command to run.

Every refusal is a `CaptureError`. A selector, variant, case, state, or portfolio the host does not declare is `SELECTION`; a wrapper or option fault is `HOST`; a stage that did not complete or whose inputs moved is `STAGE`; a record, report, registry, or manifest that fails its protocol is `EVIDENCE`; and a path that leaves the integrity root or an authorized portfolio root is `CONTAINMENT`.

The engine reads each file once per pass through a memo it discards when the pass ends, so a source hashed before the child, in the record pass, and in the final check costs three readings, never one per destination. The final check rereads disk with a fresh memo, so a file changed between passes refuses the stage.

### Runner

The request protocol, the stage order, and the process supervision. `createCaptureRunner` binds one command (`journey`, `capture`, or `stale`), a workspace root, the wrapper's default path, the request directory, and the command line after the entry name. The runner loads the wrapper in process through Vite's `loadConfigFromFile` with the capture variable set for the inspection and the inherited value restored, so the wrapper's destructive no-capture initialization never runs. It reads every name it uses from the wrapper's provided values: `variant` and `variants`, `first`, `closing`, `portfolios`, `standalone`, `directory`, `record`, and `inputs`, and the project tags that carry `owner:` paths. It validates uniqueness, tag syntax, references, and containment before it spawns anything.

```ts
import { createCaptureRunner } from '@orkestrel/capture/server'

const runner = createCaptureRunner({
	command: 'journey',
	root: process.cwd(),
	config: 'configs/app/vite.journey.config.ts',
	requests: 'tmp/units',
	argv: ['pages:mail', '--variant', 'light-390'],
})
const exit = await runner.execute() // 0 when every stage passed and work ran
```

The exit is 0 when every stage is green and work ran, 1 for a failed stage, an interrupt, or an empty workload, and 64 for a refused command line or selection. The runner branches on the `USAGE` condition of a `CaptureError`, never on message text. Every refusal that precedes a spawn is `USAGE`; a wrapper fault is `HOST`; a stage that failed or was interrupted is `STAGE`.

**Stages.** The `first` variant runs alone in the `narrow` stage, and every other selected variant shares the `rest` stage in declaration order. A selection that omits the first variant runs in the `rest` stage alone, and the runner adds no variant the caller did not select. The runner stops at the first stage that fails and runs one Vitest process at a time. When the first stage finds no applicable work it prints that the rest stage carries the selector and continues. An invocation in which no requested project held applicable work exits 1.

**Selection.** A selector is `all` or an owner path the wrapper's tags declare; each segment is checked, and the refusal names the first unknown one, labelled `scope` at the first depth and `owner` below it. A journey filters on `owner:<selector>`. A capture also intersects the capture tag, which is the selector's scope and part, and `all` unions every declared scope. `--case` selects one case by its exact full name, and the runner passes the anchored pattern for that case and the closing case with every regular-expression metacharacter quoted. `--state` asks the engine for the declaring case and refuses, before any process starts, when the engine's evidence is missing, stale, or ambiguous.

**Request.** Before each stage the runner writes `journey-selection-<pid>.json` in the request directory, named by its own process id, through a temporary sibling and a rename, and removes both in a `finally` block. Before it writes, it removes every request file named for a process that is no longer running, and never one that is. The wrapper reads the file back through `readCaptureRequest`, which accepts only the file its parent's id names, only a record whose `pid` matches, and only arguments equal to its own process's.

```ts
import { readCaptureRequest } from '@orkestrel/capture/server'

const request = readCaptureRequest({
	ppid: process.ppid,
	argv: process.argv.slice(1),
	directory: '/workspace/tmp/units',
	config: 'configs/app/vite.journey.config.ts',
	owners: ['pages:mail'],
	variants: ['light-390'],
})
request?.selector // 'pages:mail' when a runner is the parent, otherwise undefined
```

**Processes.** The runner spawns `process.execPath` with the installed `node_modules/vitest/vitest.mjs`, an argument array, and no shell. The child inherits the environment with every case-folded `capture` name removed, and a `capture` command sets exactly one `CAPTURE=1`. Each stage writes its own log and JSON report under `<requests>/runs/<id>/`, and the child's output is teed to the host's streams and the log. An interrupt aborts the stage's signal and ends each child's process tree: `killTree` on win32, which has no signal a process group can receive, and `killProcess` on every other host, which signals the detached group. The invocation then removes its request and releases its handlers.

**Limits.** An external Ctrl+C on win32 reaches the runner only through a console-capable terminal, and Node exposes no console-mode API, so that reading is recorded by hand rather than proved here. The external process-group signal on a POSIX host is a case gated on the mechanism that makes it applicable, and it has not run on a POSIX host yet.

### Preflight and sheets

The image checks and the contact sheets over the authenticated selection. `createCapturePreflight` binds a workspace root, the wrapper's absolute path, a selection, and the absolute directory of the journey artifacts. It loads the wrapper in process the way the runner does and reads each project's `variant`, its `variants` with their pixel geometry, and the portfolio roots it provides, so it names no portfolio, owner, variant, or path itself. `createCaptureSheets` takes the same reader options and a new output directory.

```ts
import { createCapturePreflight, createCaptureSheets } from '@orkestrel/capture/server'

const reader = {
	root: process.cwd(),
	config: `${process.cwd()}/configs/app/vite.journey.config.ts`,
	selection: { selector: 'pages:mail', variants: ['light-390'] },
	journeys: `${process.cwd()}/tmp/journey`,
}
const exit = await createCapturePreflight(reader).execute() // 0 when every frame is current and sound
await createCaptureSheets({ reader, output: `${process.cwd()}/tmp/sheets` }).execute()
```

**Preflight.** `execute` prints one `READER` line of JSON and returns 0 when every selected frame is current and no issue was found, 1 for any defect, and 64 for a refused selection, wrapper, or checks module; it reports a refusal on the error writer and prints no report. The report carries the selection, the freshness the engine classified, the framing observations, every issue, the groups of byte-identical images, the size of each image, and `acceptance: false`: a passing preflight is iteration evidence and never assembled-portfolio acceptance. The preflight upgrades no freshness classification, and it widens no selection.

**Images.** Each selected destination is read from disk, refused below 4,000 bytes, and decoded. A frame whose image cannot be read stays in the report as an issue and, in the sheets, as a red mark indexed `missing`. The framing reading groups the decoded frames by portfolio, owner, and declared viewport width, and names a group whose frames mix cropped, viewport-sized, and page-sized images. It reads only a frame at its own producing variant, and it never decides which framing was intended.

**Artifacts.** The reader judges each frame by the run record its own stamp names, never by a variant's latest file. It reads that record, requires the journey artifact the record names to sit inside the journeys directory and to match the record's digest, and then requires the record to cover the frame, the artifact to bind the record with a `record=` line, and the artifact to show the stamping case with a `case-ran=` line. It also reports every artifact line that logs an uncaught, unhandled, or error entry. A frame with no stamp is an issue, never a guess. A standalone portfolio root the wrapper declares has no stamping route, so a selection that names one reads that root alone and reports its frames as unstamped.

**Host checks.** Rules that belong to one product do not belong to the package. The `checks` option names a module, absolute or relative to the root, and the reader loads it with a dynamic `import()` of its file URL. The module exports `CAPTURE_CHECKS`, a list of readers from a frame to its findings, and the reader hands each one the frame's destination, its decoded picture, and its verified artifact. The picture is `undefined` when the image could not be read and the artifact is `undefined` when none covers the frame, so a check decides what an absent one means. Every finding joins the report's issues.

```ts
import type { CaptureCheckFrame } from '@orkestrel/capture/server'

export const CAPTURE_CHECKS = [
	(frame: CaptureCheckFrame): readonly string[] =>
		frame.picture !== undefined && frame.picture.width < 100
			? [`Frame is too narrow: ${frame.entry.file}`]
			: [],
]
```

A module that cannot be loaded, exports no list of functions, or holds a reader that returns something other than a list of strings refuses the run as a `HOST` condition before a report prints.

**Sheets.** `execute` reads the selection through the preflight, so it judges the same population and keeps its refusals. It requires an output directory that does not exist, lies inside the workspace, has an existing parent, and lies outside every selected capture directory, and it refuses otherwise with exit 64 before writing anything. It shrinks each frame by a whole factor toward 320 pixels wide, clips it at 400 pixels tall, places a state's variants side by side, pairs two states per row, and stacks four rows per sheet. It writes `sheet-001.png` and onward, an `index.json` of every cell with its source and displayed size, its freshness, and the framing observations, and an `index.md` that links each frame. It prints the index as one `SHEETS` line and returns the same exit status the preflight would.

### Registry refresh

The command that bootstraps or replaces the accepted registry. The stage transaction refuses to run until a registry exists, so the refresh cannot stamp through the engine: it imports complete runs instead. `createCaptureRegistrar` takes the same options as the runner minus the command, and `execute` reads the wrapper through `loadCaptureProjects`, the loader the runner uses, takes the same invocation entity, request file, and Vitest child, and runs one stage per producing variant with the `all` selector, the `journey` command, and no capture variable.

```ts
import { createCaptureRegistrar } from '@orkestrel/capture/server'

const registrar = createCaptureRegistrar({
	root: process.cwd(),
	config: 'configs/app/vite.journey.config.ts',
	requests: 'tmp/capture',
	argv: ['--variant', 'dark-390'],
})
const exit = await registrar.execute() // 0 when the registry was published
```

**Flags.** `--variant` repeats and names the producing variants to refresh; without it every variant the wrapper declares is refreshed. `--config` replaces the wrapper. `--mode` is forwarded to the wrapper's Vitest process as `--mode <name>` and recorded in the request, so a wrapper that selects another registry by mode is refreshed by naming it. The command takes no selector, and every flag takes one value.

**Stages.** The stage for a variant is named `registry-<variant>`, so each variant's records sit under `<directory>/runs/<id>/registry-<variant>/`. The command takes the project's declared input population and its content hashes before the child starts and again after, and refuses when they differ. It then reads the reporter and the closing record, requires the record to carry the stage's own request, to fall between the start of the refresh and the end of the reporter, to agree with every collected declaration, and to be complete, and builds one receipt from them: the variant, the record's time, the reporter's path and digest, the input hashes, and the record's declarations and registry.

**Publication.** `buildCaptureRegistry` imports the receipts only after each exit is zero and each reporter digest still equals its receipt. The registry is written to a candidate beside `registry.json`, read back through the integrity engine pointed at the candidate, and only then renamed over the target, so a registry the engine would refuse never replaces a good one and the old bytes survive a failed or interrupted refresh. The command prints one `REGISTRY` line of JSON: the file, the digest, the variants in the registry, the variants this run refreshed, and the entry count.

**Partial refresh.** With `--variant`, the receipts the existing registry holds for the other declared variants are kept: each is read again with its reporter bytes and imported beside the new ones before any journey runs, so a reporter that changed since it was recorded refuses the run first. An existing registry the package cannot read refuses a partial refresh and names the full refresh that replaces it. A receipt for a variant the wrapper no longer declares is dropped.

**Lease.** The refresh refuses, with exit 1 and the process ids named, while another live process holds a request file in the request directory, and it removes the files of processes that are gone. The request file is the only lease the runner takes, and a runner that is between two stages holds none, so a refresh started in that gap is not refused: serialize the host's Vitest work as well.

**Exit.** 0 for a published registry, 1 for a refused lease, a failed or interrupted stage, an altered or incomplete record, or a registry the engine refused, and 64 for a refused command line, an unknown variant, or a wrapper outside the workspace. A refresh writes no frame, and it widens no scoped run: it is a named command, never a tail of `journey`.

### Executable

The `capture` executable is one entry that dispatches six subcommands, each a thin call into a server factory. It declares nothing itself.

- `capture journey <selector>` calls `createCaptureRunner` with the `journey` command and reads `--variant` (repeats), `--case`, and `--config`.
- `capture frames <selector>` calls `createCaptureRunner` with the `capture` command and reads `--variant` (repeats), `--case`, `--state`, and `--config`.
- `capture stale <selector>` calls `createCaptureRunner` with the `stale` command and reads `--variant` (repeats), `--case`, `--state`, `--portfolio`, and `--config`.
- `capture preflight <selector>` calls `createCapturePreflight` and reads `--variant` (repeats), `--state`, `--case`, `--portfolio`, `--config`, `--journeys`, and `--checks`.
- `capture sheets <selector> --output <directory>` calls `createCaptureSheets` with the preflight's flags and a required `--output`.
- `capture registry` calls `createCaptureRegistrar` and reads `--variant` (repeats), `--mode`, and `--config`.

`frames` runs the request command `capture`, because `capture capture` would stutter. A flag takes exactly one value, only `--variant` repeats, and an unknown, repeated, misplaced, or valueless flag is refused. The executable falls back to `CAPTURE_DEFAULTS` when the command line names none: the wrapper `configs/app/vite.journey.config.ts`, the request directory `tmp/capture`, and the journey artifact directory `tmp/journey`. The wrapper must pass the same request directory to `readCaptureRequest`.

**Exit.** 0 when the work passed, 1 when a stage failed, the selection held no work, a reading found a stale or unsound frame, or the evidence refused, and 64 when the command line was refused. Every refusal prints on the error stream and teaches: it names the subject, the flag or value that was wrong, and the usage line, and the executable prints the whole usage text beside an unknown or missing command. The preflight takes no `--output`, which belongs to the sheets, and the sheets require one.

**Limits.** The subcommand names are a decision for the user to confirm. The external Ctrl+C on win32 and the process-group signal on a POSIX host are the runner's recorded limits and apply unchanged to the executable.

## Tests

- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts)
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts)
- [`tests/src/core/errors.test.ts`](../tests/src/core/errors.test.ts)
- [`tests/src/core/index.test.ts`](../tests/src/core/index.test.ts)
- [`tests/src/server/CaptureIntegrity.test.ts`](../tests/src/server/CaptureIntegrity.test.ts)
- [`tests/src/server/CaptureRunner.test.ts`](../tests/src/server/CaptureRunner.test.ts)
- [`tests/src/server/CaptureInvocation.test.ts`](../tests/src/server/CaptureInvocation.test.ts)
- [`tests/src/server/CapturePreflight.test.ts`](../tests/src/server/CapturePreflight.test.ts)
- [`tests/src/server/CaptureSheets.test.ts`](../tests/src/server/CaptureSheets.test.ts)
- [`tests/src/server/CaptureRegistrar.test.ts`](../tests/src/server/CaptureRegistrar.test.ts)
- [`tests/src/server/integration.test.ts`](../tests/src/server/integration.test.ts)
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts)
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts)
- [`tests/src/server/index.test.ts`](../tests/src/server/index.test.ts)
- [`tests/src/bin/main.test.ts`](../tests/src/bin/main.test.ts)
- [`tests/distribution.test.ts`](../tests/distribution.test.ts)
- [`tests/setupServer.test.ts`](../tests/setupServer.test.ts)
- [`tests/setup.test.ts`](../tests/setup.test.ts)
