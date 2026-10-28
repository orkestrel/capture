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

| Name                            | Kind      | Summary                                                                                                                   |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CaptureCommand`                | type      | Names one command the runner executes: a journey, a frame capture, or a stale reading.                                    |
| `CapturePortfolioRoot`          | interface | Supplies a host-authorized physical portfolio root without repeating its states or variants.                              |
| `CaptureHashHandler`            | type      | Digests the exact bytes of one file reading and returns the lowercase hexadecimal digest.                                 |
| `CaptureIntegrityOptions`       | interface | Configures the engine's workspace and separate evidence documents.                                                        |
| `CaptureStageProject`           | interface | Supplies one selected project's expected closing record and bounded input population.                                     |
| `CaptureParsedArguments`        | type      | Carries the typed values and tokens of a strictly parsed capture command line.                                            |
| `CaptureExecutionResult`        | interface | Carries the supervised child outcome without treating a signal as a successful exit.                                      |
| `CaptureExecutionHandler`       | type      | Executes the runner's child after the engine captures its input snapshot.                                                 |
| `CaptureStageOptions`           | interface | Binds a stage transaction to its exact request, projects, reporter, and process boundary.                                 |
| `CaptureFileSnapshot`           | interface | Records one physical file's bytes and native modification readings at a stage boundary.                                   |
| `CaptureProjectSnapshot`        | interface | Preserves one project's declared patterns and sorted expansion before execution.                                          |
| `CaptureSnapshot`               | interface | Holds a stage boundary's input populations and existing output identities.                                                |
| `CaptureProjectResult`          | interface | Reports validated project evidence, retaining empty successful selections explicitly.                                     |
| `CaptureStageResult`            | interface | Reports the successful stage's committed stamps and validated lookup evidence.                                            |
| `CaptureReadOptions`            | interface | Selects a declaration population without requiring current images or passing state lookups.                               |
| `CaptureStaleOptions`           | interface | Selects a freshness population and names the producing variants the host wrapper declares.                                |
| `CaptureCheckOptions`           | interface | Selects required output pairs and attributable extras for a freshness reading.                                            |
| `CaptureReadResult`             | interface | Returns the exact current declaration destinations and their complete-anchor identity.                                    |
| `CaptureCheckResult`            | interface | Reports the exact judged population, every mismatch reason, and conservative test warnings.                               |
| `CaptureLookupOptions`          | interface | Requests a state-to-case resolution before the runner starts any selected project.                                        |
| `CaptureLookupResult`           | interface | Resolves one declaring case and its actual output pairs with their passing evidence.                                      |
| `CaptureRunEvidence`            | interface | Binds a decoded run record to the physical file whose digest authenticated it.                                            |
| `CaptureDirectoryReading`       | interface | Carries one physical-directory ancestry while enumerating logical portfolio paths.                                        |
| `CaptureEvidence`               | interface | Carries accepted registry anchors and separately persisted passing run evidence.                                          |
| `CaptureCollectionEvidence`     | interface | Carries the authenticated external record beside its collection receipt.                                                  |
| `CaptureReceiptInput`           | interface | Supplies a verifier's actual process outcome and exact reporter bytes for registry import.                                |
| `CaptureIntegrityInterface`     | interface | Defines the shared stage transaction, freshness reading, and state resolution engine.                                     |
| `CaptureProject`                | interface | Preserves the wrapper's host declarations for the runner.                                                                 |
| `CaptureRunnerOptions`          | interface | Configures one runner invocation: its command, its workspace, and the command line it reads.                              |
| `CaptureRunnerArguments`        | interface | Carries parsed runner arguments while leaving omitted selectors available to the usage diagnostic.                        |
| `CaptureRunnerInterface`        | interface | Drives selected owners through one journey stage or staged frame captures.                                                |
| `CaptureChange`                 | interface | Classifies one changed Git path against accepted source attribution.                                                      |
| `CaptureChangePlan`             | interface | Holds changed paths and the stable owner selection reduced by ancestry.                                                   |
| `CaptureOwnerOutcome`           | interface | Records one changed owner's exit and whether an execution child started.                                                  |
| `CaptureWriteHandler`           | type      | Writes one chunk of runner output to the stream the host chooses.                                                         |
| `CaptureCLIOptions`             | interface | Configures the executable's workspace and its report and diagnostic writers.                                              |
| `CaptureCLIInterface`           | interface | Runs capture command lines through injected output writers.                                                               |
| `CaptureIntegrityHandler`       | type      | Creates the integrity engine the runner reads and stamps through, from the options it derives.                            |
| `CaptureStagePlan`              | interface | Names one planned stage and the variants it runs in one Vitest process.                                                   |
| `CaptureArgumentsOptions`       | interface | Configures the Vitest argument list one stage spawns with.                                                                |
| `CaptureRequestOptions`         | interface | Configures how a wrapper reads the runner's request for its own Vitest process.                                           |
| `CaptureOutcome`                | interface | Carries one project's owner-bearing passed work count from a finished stage.                                              |
| `CaptureRunPlan`                | interface | Carries everything every stage of one invocation shares.                                                                  |
| `CaptureInvocationOptions`      | interface | Configures one runner invocation's identity, workspace, and output.                                                       |
| `CaptureInvocationInterface`    | interface | Owns one runner invocation's identity, request file, children, and interruption.                                          |
| `CaptureDiscoveryRequest`       | interface | Carries the request the runner publishes for the discovery child that reads its wrapper.                                  |
| `CaptureHostEntry`              | interface | Describes one wrapper project to the runner: its host declarations and, when it has one, its viewport.                    |
| `CaptureHostDescription`        | interface | Carries the description a wrapper writes back to the runner that discovered it.                                           |
| `CaptureDescriptionExpectation` | interface | Names what a description must echo for the runner to accept it.                                                           |
| `CaptureDiscoveryOptions`       | interface | Configures how a wrapper answers the runner's discovery request.                                                          |
| `CaptureDiscoveryRunOptions`    | interface | Configures one discovery: the workspace, the wrapper, the invocation that owns the child, and its bounds.                 |
| `CaptureDiscoveryInterface`     | interface | Reads a consumer's wrapper by running its installed Vitest in discovery mode.                                             |
| `CapturePicture`                | interface | Carries a decoded RGB image for the image checks and the contact sheets.                                                  |
| `CaptureReaderOptions`          | interface | Configures a read-only capture consumer using the wrapper's host declarations.                                            |
| `CaptureProducer`               | interface | Declares the viewport one wrapper project produces beside the project's own name.                                         |
| `CaptureReaderDefaults`         | interface | Supplies the wrapper path, the journey artifact directory, and the request directory a reader command line falls back to. |
| `CaptureReaderSelection`        | interface | Returns a reader's authenticated selection and the same engine for pixel classification.                                  |
| `CaptureArtifactReading`        | interface | Carries a judged run record and the verified text of the journey artifact it names.                                       |
| `CaptureJudgedRecord`           | interface | Names the run record a judged frame's stamp points at and the case that stamped it.                                       |
| `CaptureJudgedFrame`            | interface | Pairs a judged frame with its verified artifact, when one was read, and its coverage issues.                              |
| `CaptureImageReading`           | interface | Records one selected image's real bytes, geometry, and canonical destination.                                             |
| `CaptureCheckFrame`             | interface | Carries one judged frame to a host check: its destination, its decoded pixels, and its artifact.                          |
| `CaptureCheckHandler`           | type      | Reads one judged frame against a host rule and returns the issues it finds, none when it passes.                          |
| `CapturePreflightResult`        | interface | Reports selected image checks without upgrading their engine freshness classifications.                                   |
| `CapturePreflightInterface`     | interface | Reads the selected population's frames and reports their freshness, framing, and coverage.                                |
| `CaptureSheetOptions`           | interface | Carries a contact-sheet output request separately from the population selection.                                          |
| `CaptureSheetCell`              | interface | Holds one contact-sheet cell: a frame's destination, its shrunk picture, and what the sheet reports about it.             |
| `CaptureSheetGroup`             | interface | Holds the cells of one portfolio, owner, and state side by side as one composite picture.                                 |
| `CaptureSheetRow`               | interface | Holds a pair of groups side by side as one composite picture.                                                             |
| `CaptureSheetPage`              | interface | Holds one written sheet: its file name, the rows it stacks, and the composite picture.                                    |
| `CaptureReaderCommand`          | interface | Carries parsed reader arguments and an optional contact-sheet output directory.                                           |
| `CaptureSheetsInterface`        | interface | Composes exactly the authenticated sparse state and output pairs for iteration review.                                    |
| `CaptureRegistryArguments`      | interface | Carries the parsed registry command line: the wrapper, the variants to refresh, and the mode.                             |
| `CaptureRegistrarOptions`       | interface | Configures one registry refresh: its workspace, wrapper default, request directory, and command line.                     |
| `CaptureRegistrarInterface`     | interface | Refreshes the accepted registry from one complete capture-free journey per producing variant.                             |

### Server constants

The runner's names and bounds from [`constants.ts`](../src/server/constants.ts).

| Name                      | Kind  | Summary                                                                                                                                                                                                                         |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPTURE_COMMAND_NAMES`   | const | Names the executable subcommand each runner command answers to.                                                                                                                                                                 |
| `CAPTURE_COMMAND_OPTIONS` | const | Defines each command's frozen options for Node's standard argument parser.                                                                                                                                                      |
| `CAPTURE_EXIT`            | const | Holds the exit status each runner outcome maps to.                                                                                                                                                                              |
| `CAPTURE_STAGES`          | const | Names the selected journey stage and the narrow and remaining frame stages.                                                                                                                                                     |
| `CAPTURE_TAG_OPERATORS`   | const | Lists the words a tag name can never be, because a tag filter reads them as operators.                                                                                                                                          |
| `CAPTURE_OWNER_PREFIX`    | const | Names the tag prefix that marks a case's owner path and each ancestor of it.                                                                                                                                                    |
| `CAPTURE_FLAG`            | const | Names the environment variable that turns frame capture on for a Vitest child.                                                                                                                                                  |
| `CAPTURE_FLAG_VALUE`      | const | Holds the one value of the capture variable that turns frame capture on.                                                                                                                                                        |
| `CAPTURE_VITEST_ENTRY`    | const | Names the repository-relative path of the Vitest entry the runner spawns through Node.                                                                                                                                          |
| `CAPTURE_RUNS_DIRECTORY`  | const | Names the directory beneath a portfolio or request directory that holds one invocation's records.                                                                                                                               |
| `CAPTURE_MINIMUM_IMAGE`   | const | Holds the byte count under which an image is too small to be a real frame.                                                                                                                                                      |
| `CAPTURE_REPORT_LINES`    | const | Names the first word of the line a reader prints, followed by its JSON report.                                                                                                                                                  |
| `CAPTURE_SHEET`           | const | Holds the contact-sheet geometry: how wide a cell shrinks toward, how tall it may grow, the mark that stands in for an unreadable image, the gap between neighbors, and how many cells, rows, and pairs a row and a sheet hold. |
| `CAPTURE_SHEET_FILES`     | const | Names the contact-sheet files: the sheet prefix and digits, and the two index documents.                                                                                                                                        |
| `CAPTURE_REGISTRY_STAGE`  | const | Names the stage each producing variant's complete journey runs in, ahead of the variant's name.                                                                                                                                 |
| `CAPTURE_REGISTRY_LINE`   | const | Names the first word of the line the registry refresh prints, followed by its JSON summary.                                                                                                                                     |
| `CAPTURE_REQUESTS_FLAG`   | const | Names the environment variable that carries the absolute request directory to a Vitest child.                                                                                                                                   |
| `CAPTURE_DISCOVERY`       | const | Holds the discovery exchange's fixed names and bound.                                                                                                                                                                           |
| `CAPTURE_SUBCOMMANDS`     | const | Names the executable's subcommands in the order its usage text lists them.                                                                                                                                                      |
| `CAPTURE_DEFAULTS`        | const | Holds the repository-relative paths the executable falls back to when the command line names none.                                                                                                                              |
| `CAPTURE_USAGE`           | const | Holds the usage text the executable prints when it is given no subcommand or an unknown one.                                                                                                                                    |

### Server helpers

Leaves from [`helpers.ts`](../src/server/helpers.ts): hashing, digests, registry import, flag reading, the PNG codec, the runner's parsing, and the few reads and writes of the filesystem the runner and the registry refresh make (`resolveCaptureWrapperProject`, `answerCaptureDiscovery`, `readCaptureInputs`, `readCaptureRunning`, `readCaptureRequest`, `writeCaptureDocument`). A helper that refuses an image or a receipt throws a `CaptureError` with the `EVIDENCE` condition.

| Name                           | Kind     | Summary                                                                                                   |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| `computeCaptureHash`           | function | Hashes exact source or image bytes with SHA-256.                                                          |
| `normalizeSlashes`             | function | Normalizes a host path to forward slashes.                                                                |
| `buildCaptureDigest`           | function | Computes the digest of both pattern declarations and expanded path and hash membership.                   |
| `buildCaptureLookupJournal`    | function | Stores each distinct lookup input population once in a manifest-bound journal.                            |
| `readCaptureLookups`           | function | Resolves journal lookup references after verifying each stored input population's digest.                 |
| `computeRegistryDigest`        | function | Computes the registry identity from its authenticated receipts and exact output population.               |
| `buildCaptureRegistry`         | function | Imports complete receipts only after their actual exits and exact report bytes validate.                  |
| `matchesCaptureSignature`      | function | Checks whether bytes open with the eight-byte PNG signature.                                              |
| `predictCaptureByte`           | function | Computes the PNG Paeth predictor used by both image readers.                                              |
| `readCaptureChunks`            | function | Reads PNG compressed-data chunks while refusing truncated or corrupt image bytes.                         |
| `unfilterCaptureRow`           | function | Reconstructs one filtered PNG scanline from its filter byte and the row above.                            |
| `inflateCaptureStream`         | function | Inflates a PNG's compressed stream, refusing one that is corrupt or longer than declared.                 |
| `decodeCapturePicture`         | function | Decodes the eight-bit, non-interlaced PNGs the capture readers consume.                                   |
| `encodeCaptureWord`            | function | Encodes an unsigned 32-bit integer as four big-endian bytes.                                              |
| `encodeCaptureChunk`           | function | Encodes one checked PNG chunk for contact-sheet output.                                                   |
| `encodeCapturePicture`         | function | Encodes an RGB picture using the contact-sheet writer's native PNG format.                                |
| `shrinkCapturePicture`         | function | Scales a picture by a whole-number area average and clips its displayed height.                           |
| `composeCapturePictures`       | function | Composes pictures on the contact-sheet gray background.                                                   |
| `readCaptureRequestOwner`      | function | Reads the process id that a request file, or its temporary sibling, names.                                |
| `resolveCaptureRelative`       | function | Resolves a path to the slash-separated form the evidence documents store, relative to a root.             |
| `escapeCapturePattern`         | function | Escapes every regular-expression metacharacter so a case name matches only itself.                        |
| `buildCaptureFilter`           | function | Builds the tag expression that selects an owner population, and its capture tags for frames.              |
| `resolveCaptureStages`         | function | Plans one selected journey stage or narrow and remaining frame stages.                                    |
| `resolveCaptureVariants`       | function | Resolves selected producing variants in declaration order and requires their projects.                    |
| `buildCaptureChangePlan`       | function | Classifies changed paths through accepted patterns and reduces owners by ancestry.                        |
| `renderCaptureCommand`         | function | Renders an exact owner command with the selected variants and filters in host shell syntax.               |
| `buildCaptureArguments`        | function | Builds the exact Node argument array that spawns one Vitest stage.                                        |
| `readCaptureOptions`           | function | Parses standard option tokens and refuses empty values, terminators, and repeated single options.         |
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
| `resolveCaptureWrapperProject` | function | Resolves one entry of a wrapper's project list to the project it declares.                                |
| `readCaptureEntry`             | function | Reads one wrapper project, as the description file holds it, into its host declarations and viewport.     |
| `resolveCaptureRequests`       | function | Resolves the directory that holds the runner's request files for the process that reads them.             |
| `buildCaptureDiscoveryConfig`  | function | Builds the empty Node configuration a wrapper returns once it has answered a discovery request.           |
| `readCaptureDescription`       | function | Accepts the description a wrapper wrote only when it answers this exchange and no other.                  |
| `answerCaptureDiscovery`       | function | Answers the runner's discovery request from the wrapper, before the wrapper does any other work.          |
| `readCaptureRegistryArguments` | function | Reads the registry command line into the wrapper path, the variants to refresh, and the mode.             |
| `readCaptureInputs`            | function | Reads the bounded input population a project declares, as file paths and content hashes.                  |
| `writeCaptureDocument`         | function | Writes one JSON document atomically, so a reader sees the old bytes or the new and never a part.          |

### Server classes and factories

The integrity engine from [`CaptureIntegrity.ts`](../src/server/CaptureIntegrity.ts) and its factory from [`factories.ts`](../src/server/factories.ts).

| Name                     | Kind     | Summary                                                                                                      |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| `CaptureIntegrity`       | class    | Validates capture transactions, freshness, and state lookup against real filesystem evidence.                |
| `createCaptureIntegrity` | function | Creates the integrity engine bound to an explicit workspace and host portfolio mapping.                      |
| `CaptureRunner`          | class    | Drives selected owners through one journey stage or staged frame captures.                                   |
| `CaptureInvocation`      | class    | Owns one runner invocation's identity, request file, children, and interruption.                             |
| `CaptureDiscovery`       | class    | Reads a consumer's wrapper by running the consumer's installed Vitest in discovery mode.                     |
| `createCaptureDiscovery` | function | Creates the discovery that reads a consumer's wrapper through the consumer's own Vitest.                     |
| `createCaptureRunner`    | function | Creates the runner that drives owner-selected journeys for one command line.                                 |
| `CapturePreflight`       | class    | Reads the selected population's frames and reports their freshness, framing, and coverage.                   |
| `CaptureSheets`          | class    | Composes exactly the authenticated sparse state and output pairs for iteration review.                       |
| `createCapturePreflight` | function | Creates the preflight that judges the selected frames' freshness, framing, and coverage.                     |
| `createCaptureSheets`    | function | Creates the contact-sheet writer for the selected frames.                                                    |
| `CaptureRegistrar`       | class    | Refreshes the accepted registry from one complete capture-free journey per producing variant.                |
| `createCaptureRegistrar` | function | Creates the registry refresh that runs each producing variant's complete journey and publishes the registry. |
| `CaptureCLI`             | class    | Dispatches capture commands and maps usage and evidence refusals to their exit codes.                        |
| `createCaptureCLI`       | function | Creates the executable's command dispatcher over a workspace and injected writers.                           |

## Methods

#### `CaptureIntegrityInterface`

| Name      | Summary                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| `read`    | Reads current full-collection evidence and selects exact declaration destinations.       |
| `stamp`   | Validates an executed stage before atomically publishing its authorized evidence.        |
| `check`   | Checks the explicitly selected output population without changing evidence or images.    |
| `lookup`  | Resolves an explicitly requested state through fresh registry and passing case evidence. |
| `changed` | Classifies changes since a Git merge-base through the accepted registry.                 |

#### `CaptureDiscoveryInterface`

| Name       | Summary                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| `describe` | Publishes the discovery request, runs the wrapper's Vitest as a bounded child, and reads back its description. |

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

| Name       | Summary                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------- |
| `attach`   | Installs the interrupt handler on the process.                                                |
| `release`  | Waits for any interrupt termination to finish, then removes the interrupt handler.            |
| `prepare`  | Creates the report directory and removes request files that name a process no longer running. |
| `holders`  | Lists the other live processes that hold a request file in the request directory.             |
| `publish`  | Writes the stage or discovery request atomically, so no reader sees a partial file.           |
| `retract`  | Removes this process's request file and its temporary sibling.                                |
| `launched` | Reports whether a child with this log path has been spawned by this invocation.               |
| `spawn`    | Spawns the Vitest child and tees its output to the host streams and the log.                  |

#### `CaptureSheetsInterface`

| Name      | Summary                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `execute` | Reads selected physical images, writes complete indexed sheets, and retains all refusals. |

#### `CaptureRegistrarInterface`

| Name      | Summary                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------- |
| `execute` | Runs each producing variant's complete journey, imports the receipts, and publishes the registry. |

#### `CaptureCLIInterface`

| Name      | Summary                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `execute` | Returns 0 for passed work, 1 for failed evidence, or 64 for refused usage. |

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

The engine reads each file once per pass through a memo it discards when the pass ends, so a source hashed before the child, in the record pass, and in the final check costs three readings, never one per destination. Evidence reading also memoizes validated physical paths for that pass. The record pass and final check each validate an identical own/shared/tests pattern triple once against its pre-stage input population. Physical-image comparisons read each path's identity once per pass. The final check rereads disk with fresh memos, so a file changed between passes refuses the stage.

**Lookup journal.** `lookups.json` holds `version`, an optional predecessor `manifest` digest, an `inputs` table, `lookups`, and optional `collections`. Each table key is the digest from `buildCaptureDigest([], files)`, where `files` is the stored path-to-hash map. Each lookup's `inputs` field names a table key, so lookups that share the same input population store that map once. The engine verifies each table map's digest before expanding the active journal. A missing reference refuses with `Lookup names an unknown inputs digest` and the digest; an altered map refuses with `Lookup input digest differs from its map`. Malformed schemas, duplicate lookup identities, missing or changed run records, unauthorized runner records, registry declaration disagreements, and mismatches with passing declarations retain their refusals. Stale input hashes still refuse state resolution. Journal publication uses the same atomic rename, and the predecessor manifest digest still determines whether the journal applies. Image manifests and returned lookup results retain expanded input maps.

### Runner

The request protocol, the stage order, and the process supervision. `createCaptureRunner` binds one command (`journey`, `capture`, or `stale`), a workspace root, the wrapper's default path, the request directory, and the command line after the entry name. The runner never loads the wrapper itself, so the package imports neither Vite nor Vitest: it discovers the wrapper through the consumer's own Vitest, as the Discovery paragraph below describes. It reads every name it uses from the wrapper's provided values: `variant` and `variants`, `first`, `closing`, `portfolios`, `standalone`, `directory`, `record`, and `inputs`, and the project tags that carry `owner:` paths. It validates uniqueness, tag syntax, references, and containment before it spawns anything.

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

**Journey stage.** A journey runs all selected variants in declaration order in one execution child with `--bail=1`, under the stage name `selected`. Its stage line names every selected variant, its request carries that same list, and one stamping transaction validates all selected records before publishing lookup and collection receipts. Records remain keyed by run, stage, and variant at `<directory>/runs/<id>/selected/<variant>.json`. A failed, bailed, or interrupted child publishes no evidence from that stage. An invocation with no applicable work exits 1.

**Frame stages.** `frames` keeps the `first` variant alone in `narrow`, then every other selected variant together in `rest`, so narrow frames can be inspected first. Omitting the first variant runs only `rest`; the runner adds no unselected variant. A failed stage stops later stages. An inapplicable narrow stage prints why the rest stage carries the selector and continues. A `STAGES` JSON line names the stages run, passed, failed, and not run, with the reason, followed by an exact `NEXT` command.

**Changed selection.** For journey or frames, use `--changed <ref>` instead of a selector. The flag takes exactly one Git ref and cannot accompany a positional selector. `HEAD` selects uncommitted work. The engine authenticates the accepted registry, resolves the ref's merge-base with HEAD, reads `git diff --name-only --no-renames -z <merge-base> --`, and adds `git ls-files --others --exclude-standard -z`. Renames contribute both paths; deleted paths and names containing spaces remain intact. Every Git read uses `executeSync` with a 30-second deadline and a 64 MiB output limit; failed or truncated reads are refused before any NUL-separated names are consumed. An unknown ref exits 64 with Git's diagnostic. A missing registry prints `Missing accepted registry; run the explicit complete-registry refresh` and the exact registry command.

Each path gets exactly one class through the registry's native glob patterns. `own` matches a destination's own sources and names every matching owner. `shared` matches any shared or test pattern and names every destination owner; it takes precedence when a path also matches own sources. `outside` matches no source pattern and names no owner. The selected owners come from own paths, sorted and reduced by colon-delimited ancestry, so selecting a page drops its selected sections.

**Plan.** Add `--plan` to `--changed` to print a `CHANGE` JSON line per path, then `COMMAND` lines containing the exact per-owner commands. The plan uses the read-only discovery child to learn the wrapper declarations and starts no execution child. It exits 0 for a runnable or empty plan and 64 for a refused plan. A `SUMMARY` JSON line says what ran, passed, failed, and did not run, with the reason; `NEXT` lines give the commands to execute. For a mail source change, the plan includes these lines:

```text
CHANGE {"path":"src/mail/view.ts","classification":"own","owners":["pages:mail"]}
COMMAND capture journey pages:mail --config configs/app/vite.journey.config.ts
SUMMARY {"run":[],"passed":[],"failed":[],"notrun":["pages:mail"],"reason":"--plan starts no execution child"}
NEXT capture journey pages:mail --config configs/app/vite.journey.config.ts
```

Any shared path refuses the whole changed run with exit 64, listing those paths and explaining that every destination reads them, so they cannot be narrowed. The output includes per-owner commands for own changes and `capture journey all` with the effective wrapper and variant flags for the shared proof. No owner starts automatically. Without own or shared paths, an execution exits 1 with `No journey input changed` and lists the outside paths.

Without `--plan`, the runner executes each reduced owner through the ordinary single-selector path in stable order and stops at the first red owner. Every owner gets a distinct run ID, so its stage records remain available. The final `SUMMARY` names owners run, passed, failed, and not run, gives the stopping reason, and prints the exact commands for failed and unrun owners. `--variant`, `--case`, and the frames-only `--state` retain their ordinary meanings; a command printed for the shared proof carries no case or state narrowing. The changed flags never enter the request protocol.

### Choosing what to run

Climb from the smallest applicable selection to the gate:

- One case on one variant: `capture journey pages:mail --case 'mail shows the inbox' --variant light-390`.
- The changed set: inspect `capture journey --changed HEAD --plan`, then run `capture journey --changed HEAD`. For frames, use `capture frames --changed HEAD --plan`, then `capture frames --changed HEAD`.
- A section or page: `capture journey pages:mail:inbox` or `capture journey pages:mail`.
- A group: `capture journey pages`.
- The gate: `capture journey all`.

Use only owner and case names the wrapper declares. Follow a refusal's exact next commands before widening a selection.

### Runner selection and process protocol

**Selection.** A selector is `all` or an owner path the wrapper's tags declare; each segment is checked, and the refusal names the first unknown one, labelled `scope` at the first depth and `owner` below it. A journey filters on `owner:<selector>`. A capture also intersects the capture tag, which is the selector's scope and part, and `all` unions every declared scope. `--case` selects one case by its exact full name, and the runner passes the anchored pattern for that case and the closing case with every regular-expression metacharacter quoted. `--state` asks the engine for the declaring case and refuses, before any process starts, when the engine's evidence is missing, stale, or ambiguous.

**Discovery.** Before it plans anything, the runner publishes an atomic request whose phase is `discover` and spawns the consumer's installed Vitest entry directly (`process.execPath` with `node_modules/vitest/vitest.mjs`) as `list --filesOnly --config <wrapper> --configLoader runner`, with the capture variable set so a wrapper's destructive no-capture initialization never runs. The wrapper calls `answerCaptureDiscovery` before it does any other work, writes its description atomically beside the invocation's logs, and returns `buildCaptureDiscoveryConfig()`, an empty Node configuration, so Vitest sets up no browser, initializes no output, and collects no test. The runner accepts the description only after the child exited zero and every echo in it matches the exchange: the invocation, a fresh challenge, the wrapper, the runner as the wrapper's parent, and the spawned child as its writer. A wrapper that never answers, answers another exchange, writes an unreadable or empty description, exits nonzero, or outlives the deadline (`CAPTURE_DISCOVERY.deadline`, replaceable through the `deadline` option) is refused as a `HOST` condition, and a request from another parent, with other arguments, version, identity, or wrapper, is refused by the wrapper. A syntax error in the command line refuses before any child; an unknown selector or variant refuses after discovery and before any execution child.

````ts
import { answerCaptureDiscovery, buildCaptureDiscoveryConfig } from '@orkestrel/capture/server'

const projects = [/* the wrapper's own test.projects */]
const answered = await answerCaptureDiscovery({
	ppid: process.ppid,
	argv: process.argv.slice(1),
	config: 'configs/app/vite.journey.config.ts',
	projects,
})
export default answered ? buildCaptureDiscoveryConfig() : { test: { projects } }
```n
**Request directory.** The one default is `CAPTURE_DEFAULTS.requests`. The runner hands the directory it publishes to every child it spawns in `CAPTURE_REQUESTS`, and `readCaptureRequest` and `answerCaptureDiscovery` read it from there when the wrapper names no `directory` of its own, so a consumer never repeats a constant it could mismatch. A wrapper that does name one declares it, and it must be the runner's.

**Request.** Before each stage the runner writes `journey-selection-<pid>.json` in the request directory, named by its own process id, through a temporary sibling and a rename, and removes both in a `finally` block. Before it writes, it removes every request file named for a process that is no longer running, and never one that is. The wrapper reads the file back through `readCaptureRequest`, which accepts only the file its parent's id names, only a record whose `pid` matches, and only arguments equal to its own process's.

```ts
import { readCaptureRequest } from '@orkestrel/capture/server'

const request = readCaptureRequest({
	ppid: process.ppid,
	argv: process.argv.slice(1),
	config: 'configs/app/vite.journey.config.ts',
	owners: ['pages:mail'],
	variants: ['light-390'],
})
request?.selector // 'pages:mail' when a runner is the parent, otherwise undefined
````

**Processes.** The runner spawns `process.execPath` with the installed `node_modules/vitest/vitest.mjs`, an argument array, and no shell. The child inherits the environment with every case-folded `capture` name removed and `CAPTURE_REQUESTS` set to the request directory, and a `capture` command, like discovery, sets exactly one `CAPTURE=1`. Each stage writes its own log and JSON report under `<requests>/runs/<id>/`, and the child's output is teed to the host's streams and the log. Each child runs through `@orkestrel/process` `createSession` with stdin closed immediately. Its byte output is decoded with `StringDecoder`, preserving split UTF-8, carriage returns, and missing final newlines, and the decoder is flushed at termination. A writer or log failure, or a session whose output did not drain before its observation bound, refuses the stage. An interrupt aborts the stage's signal and ends each child's tree: Windows tree termination, or POSIX `SIGTERM` followed by `SIGKILL` after a 250 ms grace. A pre-aborted invocation launches no child. The invocation then removes its request and releases its handlers.

**Limits.** An external Ctrl+C on win32 reaches the runner only through a console-capable terminal, and Node exposes no console-mode API, so that reading is recorded by hand rather than proved here. The external process-group signal on a POSIX host is a case gated on the mechanism that makes it applicable, and it has not run on a POSIX host yet.

Discovery uses `@orkestrel/timeout` `createTimeout`, linked to the invocation's signal. Expiry is read from the armed signal before cleanup, so clearing the handle or receiving a later interrupt cannot erase it. An expired discovery is a `HOST` refusal; interruption remains a `STAGE` refusal and retains precedence if both are present when discovery settles. Neither a deadline nor a writer failure sets the invocation's interrupted state.

Atomic evidence writes use an exclusive temporary sibling and `writeFileSync` with `flush: true`, then check cancellation before renaming. Integrity publication also rechecks containment of both paths before the rename. A refused write preserves the prior document and cleans its temporary sibling.

### Preflight and sheets

The image checks and the contact sheets over the authenticated selection. `createCapturePreflight` binds a workspace root, the wrapper's absolute path, a selection, and the absolute directory of the journey artifacts. It discovers the wrapper through the consumer's Vitest the way the runner does, with a `requests` option for the request directory and a `deadline` option for the child, and reads each project's `variant`, its `variants` with their pixel geometry, and the portfolio roots it provides, so it names no portfolio, owner, variant, or path itself. `createCaptureSheets` takes the same reader options and a new output directory.

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

The command that bootstraps or replaces the accepted registry. The stage transaction refuses to run until a registry exists, so the refresh cannot stamp through the engine: it imports complete runs instead. `createCaptureRegistrar` takes the same options as the runner minus the command, and `execute` reads the wrapper through the same `CaptureDiscovery` the runner uses, forwarding `--mode` to it, takes the same invocation entity, request file, and Vitest child, and runs one stage per producing variant with the `all` selector, the `journey` command, and no capture variable.

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

- `capture journey <selector>` calls `createCaptureRunner` with the `journey` command and reads `--variant` (repeats), `--case`, and `--config`. Replace the selector with `--changed <ref>` and optionally add `--plan`.
- `capture frames <selector>` calls `createCaptureRunner` with the `capture` command and reads `--variant` (repeats), `--case`, `--state`, and `--config`. Replace the selector with `--changed <ref>` and optionally add `--plan`.
- `capture stale <selector>` calls `createCaptureRunner` with the `stale` command and reads `--variant` (repeats), `--case`, `--state`, `--portfolio`, and `--config`.
- `capture preflight <selector>` calls `createCapturePreflight` and reads `--variant` (repeats), `--state`, `--case`, `--portfolio`, `--config`, `--journeys`, and `--checks`.
- `capture sheets <selector> --output <directory>` calls `createCaptureSheets` with the preflight's flags and a required `--output`.
- `capture registry` calls `createCaptureRegistrar` and reads `--variant` (repeats), `--mode`, and `--config`.

`frames` runs the request command `capture`, because `capture capture` would stutter. Node's `node:util` `parseArgs` reads one frozen option table per command. Every flag except the valueless `--plan` takes one nonempty value, either `--flag value` or `--flag=value`. A value beginning with `-` must use equals form, such as `--case=-draft`. Only `--variant` repeats; a repeated boolean, a repeated single-value option (including mixed forms), an empty value, an unknown or command-inappropriate option, and the `--` terminator are refused. Runner flags may precede or follow the selector; preflight and sheets retain a leading selector; registry takes no positional arguments. Parser refusals carry `USAGE`, the parser diagnostic, and the command's usage text. The executable falls back to `CAPTURE_DEFAULTS` when the command line names none: the wrapper `configs/app/vite.journey.config.ts`, the request directory `tmp/capture`, and the journey artifact directory `tmp/journey`. The request directory reaches the wrapper through `CAPTURE_REQUESTS`, so the wrapper repeats nothing.

The bin entry declares nothing: it calls `createCaptureCLI().execute(process.argv.slice(2))` and assigns the returned code to `process.exitCode`. `CaptureCLI` takes optional `root`, `stdout`, and `stderr` options (`CaptureCLIOptions`) and exposes `execute(argv): Promise<number>`; every command's report and refusal uses those writers, so a host can drive the whole executable in process.

**Exit.** 0 when the work passed, 1 when a stage failed, the selection held no work, a reading found a stale or unsound frame, or the evidence refused, and 64 when the command line was refused. Every refusal prints on the error stream and teaches: it names the subject, the flag or value that was wrong, and the usage line, and the executable prints the whole usage text beside an unknown or missing command. The preflight takes no `--output`, which belongs to the sheets, and the sheets require one.

**Limits.** The subcommand names are a decision for the user to confirm. The interrupt behaviour was read on 2026-10-28: a real console Ctrl+C on Windows and a process-group SIGINT through the built executable on Linux each ended the stage tree, started no later stage, removed the request, and left the manifest bytes unchanged.

## Tests

- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts)
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts)
- [`tests/src/core/errors.test.ts`](../tests/src/core/errors.test.ts)
- [`tests/src/core/index.test.ts`](../tests/src/core/index.test.ts)
- [`tests/src/server/CaptureIntegrity.test.ts`](../tests/src/server/CaptureIntegrity.test.ts)
- [`tests/src/server/CaptureRunner.test.ts`](../tests/src/server/CaptureRunner.test.ts)
- [`tests/src/server/CaptureInvocation.test.ts`](../tests/src/server/CaptureInvocation.test.ts)
- [`tests/src/server/CaptureDiscovery.test.ts`](../tests/src/server/CaptureDiscovery.test.ts)
- [`tests/src/server/CapturePreflight.test.ts`](../tests/src/server/CapturePreflight.test.ts)
- [`tests/src/server/CaptureSheets.test.ts`](../tests/src/server/CaptureSheets.test.ts)
- [`tests/src/server/CaptureRegistrar.test.ts`](../tests/src/server/CaptureRegistrar.test.ts)
- [`tests/src/server/integration.test.ts`](../tests/src/server/integration.test.ts)
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts)
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts)
- [`tests/src/server/index.test.ts`](../tests/src/server/index.test.ts)
- [`tests/src/bin/main.test.ts`](../tests/src/bin/main.test.ts)
- [`tests/src/bin/integration.test.ts`](../tests/src/bin/integration.test.ts)
- [`tests/distribution.test.ts`](../tests/distribution.test.ts)
- [`tests/setupServer.test.ts`](../tests/setupServer.test.ts)
- [`tests/setup.test.ts`](../tests/setup.test.ts)
