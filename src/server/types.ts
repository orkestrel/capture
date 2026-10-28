import type {
	CaptureCollectionReceipt,
	CaptureDeclaration,
	CaptureDestination,
	CaptureDigest,
	CaptureFreshness,
	CaptureLookup,
	CaptureReceipt,
	CaptureRegistry,
	CaptureRequest,
	CaptureRun,
	CaptureSelection,
	CaptureStamp,
	CaptureStoredManifest,
	CaptureViewport,
	CaptureWarning,
} from '@src/core'

/**
 * Names one command the runner executes: a journey, a frame capture, or a stale reading.
 *
 * @example
 * ```ts
 * const command: CaptureCommand = 'stale'
 * ```
 */
export type CaptureCommand = CaptureRequest['command'] | 'stale'

/**
 * Supplies a host-authorized physical portfolio root without repeating its states or variants.
 *
 * @example
 * ```ts
 * const root: CapturePortfolioRoot = { portfolio: 'states', directory: 'tmp/captures/states', scoped: true }
 * ```
 */
export interface CapturePortfolioRoot {
	readonly portfolio: string
	readonly directory: string
	readonly scoped: boolean
}

/**
 * Digests the exact bytes of one file reading and returns the lowercase hexadecimal digest.
 *
 * @example
 * ```ts
 * const hash: CaptureHashHandler = (bytes) => computeCaptureHash(bytes)
 * ```
 */
export type CaptureHashHandler = (bytes: Uint8Array) => string

/**
 * Configures the engine's workspace and separate evidence documents.
 *
 * @remarks
 * `root` is the absolute workspace path. Every other path is repository-relative and
 * slash-separated. `directory` is the primary portfolio root and owns its run records.
 * `manifest` holds image stamps, `registry` holds the accepted complete-run registry, and
 * `lookups` holds a lookup journal bound to its predecessor manifest digest. A journey replaces
 * that journal after retaining unaffected receipts but cannot write the manifest. `portfolios`
 * authorizes physical image roots and scoped filename layouts the host supplies, including
 * auxiliary portfolios. `inputs` holds the native patterns for the complete bounded host input
 * population, including lookup membership. `hash` digests the bytes of every file reading.
 * Default: `computeCaptureHash`. The engine infers no portfolio, owner, source pattern, or
 * application path from a product name.
 *
 * @example
 * ```ts
 * const options: CaptureIntegrityOptions = {
 * 	root: process.cwd(),
 * 	directory: 'tmp/captures/states',
 * 	inputs: ['src/**'],
 * 	registry: 'tmp/captures/states/registry.json',
 * 	manifest: 'tmp/captures/states/manifest.json',
 * 	lookups: 'tmp/captures/states/lookups.json',
 * 	portfolios: [{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }],
 * }
 * ```
 */
export interface CaptureIntegrityOptions {
	readonly inputs: readonly string[]
	readonly root: string
	readonly directory: string
	readonly manifest: string
	readonly registry: string
	readonly lookups: string
	readonly portfolios: readonly CapturePortfolioRoot[]
	readonly hash?: CaptureHashHandler
}

/**
 * Supplies one selected project's expected closing record and bounded input population.
 *
 * @remarks
 * `name` is the actual Vitest project name and `variant` is its producing variant, which can
 * differ from a destination's output variant. `record` is the repository-relative path bound to
 * the active request, never a raw direct-run substitute. `inputs` comes from that project's
 * wrapper provide and bounds attribution even on a first capture. Every requested variant
 * requires a project and a closing record, including projects whose selected owner population is
 * inapplicable.
 *
 * @example
 * ```ts
 * const project: CaptureStageProject = {
 * 	name: 'journey:light-390',
 * 	variant: 'light-390',
 * 	record: 'tmp/captures/states/runs/a/narrow/light-390.json',
 * 	inputs: ['src/**'],
 * }
 * ```
 */
export interface CaptureStageProject {
	readonly name: string
	readonly variant: string
	readonly record: string
	readonly inputs: readonly string[]
}

/**
 * Carries the native child close outcome without treating a signal as a successful exit.
 *
 * @remarks
 * The null values mirror the `close` event of a Node child process. `pid` is the id of the child the
 * runner spawned, when it spawned one, and `expired` is present and `true` only when the runner ended
 * the child because its deadline passed.
 *
 * @example
 * ```ts
 * const result: CaptureExecutionResult = { code: 0, signal: null }
 * ```
 */
export interface CaptureExecutionResult {
	readonly code: number | null
	readonly signal: NodeJS.Signals | null
	readonly pid?: number
	readonly expired?: boolean
}

/**
 * Executes the runner's child after the engine captures its input snapshot.
 *
 * @returns The real child close outcome after its output streams close.
 * @remarks
 * The runner retains argv, environment, request-file, log, process, and interruption ownership.
 * This callback starts no alternate runner and is invoked at most once. Throwing, interruption,
 * a signal, or a nonzero exit prevents any evidence commit.
 *
 * @example
 * ```ts
 * const execute: CaptureExecutionHandler = async () => ({ code: 0, signal: null })
 * ```
 */
export type CaptureExecutionHandler = () => Promise<CaptureExecutionResult>

/**
 * Binds a stage transaction to its exact request, projects, reporter, and process boundary.
 *
 * @remarks
 * `report` is the invocation-specific repository-relative Vitest JSON reporter path. Before
 * `execute`, the engine validates paths and snapshots each project's expanded input membership
 * and bytes, existing image identities, records, and reporter. After successful execution, it
 * validates every selected record and reporter result, including empty records, before
 * committing any member. Attributed paths outside a project's initial population refuse, and so
 * do changed attributed bytes or membership. `signal` propagates runner interruption and is
 * checked before execution and commit. A capture commits one manifest replacement. A journey
 * requires empty image entries and publishes passing lookups and full-collection receipts in its
 * separate journal, leaving manifest bytes unchanged.
 *
 * @example
 * ```ts
 * const options: CaptureStageOptions = {
 * 	request,
 * 	projects: [project],
 * 	report: 'tmp/captures/states/runs/a/journey-narrow.json',
 * 	execute: async () => ({ code: 0, signal: null }),
 * }
 * ```
 */
export interface CaptureStageOptions {
	readonly request: CaptureRequest
	readonly projects: readonly CaptureStageProject[]
	readonly report: string
	readonly execute: CaptureExecutionHandler
	readonly signal?: AbortSignal
}

/**
 * Records one physical file's bytes and native modification readings at a stage boundary.
 *
 * @remarks
 * `file` is repository-relative and `changed` is the native ctime in milliseconds. Missing files
 * have no row, and duplicate or case-colliding paths refuse before indexing. These readings
 * accompany execution identity and record validation; they do not independently authorize a
 * frame stamp.
 *
 * @example
 * ```ts
 * const snapshot: CaptureFileSnapshot = {
 * 	file: 'tmp/captures/states/pages/mail--inbox.png',
 * 	image: { digest, size: 2048, modified: 1730000000000 },
 * 	changed: 1730000000000,
 * }
 * ```
 */
export interface CaptureFileSnapshot {
	readonly file: string
	readonly image: CaptureStamp['image']
	readonly changed: number
}

/**
 * Preserves one project's declared patterns and sorted expansion before execution.
 *
 * @example
 * ```ts
 * const snapshot: CaptureProjectSnapshot = { project: 'journey:light-390', inputs: digest }
 * ```
 */
export interface CaptureProjectSnapshot {
	readonly project: string
	readonly inputs: CaptureDigest
}

/**
 * Holds a stage boundary's input populations and existing output identities.
 *
 * @remarks
 * `time` is epoch milliseconds for comparing physical file timestamps; monotonic operation
 * durations use `performance.now` separately. Snapshots are engine-owned readings, never a
 * caller-supplied substitute for taking the pre-execution snapshot.
 *
 * @example
 * ```ts
 * const snapshot: CaptureSnapshot = { time: Date.now(), projects: [], files: [] }
 * ```
 */
export interface CaptureSnapshot {
	readonly time: number
	readonly projects: readonly CaptureProjectSnapshot[]
	readonly files: readonly CaptureFileSnapshot[]
}

/**
 * Reports validated project evidence, retaining empty successful selections explicitly.
 *
 * @example
 * ```ts
 * const result: CaptureProjectResult = {
 * 	project: 'journey:light-390',
 * 	variant: 'light-390',
 * 	record: { file: 'tmp/captures/states/runs/a/narrow/light-390.json', digest },
 * 	declarations: [],
 * 	passed: [],
 * }
 * ```
 */
export interface CaptureProjectResult {
	readonly project: string
	readonly variant: string
	readonly record: { readonly file: string; readonly digest: string }
	readonly declarations: readonly CaptureDeclaration[]
	readonly passed: readonly string[]
}

/**
 * Reports the successful stage's committed stamps and validated lookup evidence.
 *
 * @remarks
 * `entries` contains only this stage's image stamps and is empty for a journey. `lookups`
 * contains this stage's passing case evidence. A partial stage never replaces the last-complete
 * registry, and refreshed lookups require full collected-declaration equality with that
 * registry. `duration` is `performance.now` milliseconds spent validating and committing after
 * child completion, excluding child execution. Failed or interrupted stages reject instead of
 * returning a partial success result.
 *
 * @example
 * ```ts
 * const result = await integrity.stamp(options)
 * result.entries.length // image stamps committed by this stage
 * ```
 */
export interface CaptureStageResult {
	readonly request: CaptureRequest
	readonly projects: readonly CaptureProjectResult[]
	readonly entries: readonly CaptureStamp[]
	readonly lookups: readonly CaptureLookup[]
	readonly duration: number
}

/**
 * Selects a declaration population without requiring current images or passing state lookups.
 *
 * @remarks
 * Omitted variants derive from authenticated output mappings, and an explicit empty list
 * refuses. Every supplied selector, state, case, portfolio, and output variant remains a bound.
 *
 * @example
 * ```ts
 * const options: CaptureReadOptions = { selector: 'pages:mail', variants: ['light-390'] }
 * ```
 */
export interface CaptureReadOptions extends CaptureSelection {
	readonly variants?: readonly string[]
	readonly portfolio?: string
}

/**
 * Selects a freshness population and names the producing variants the host wrapper declares.
 *
 * @remarks
 * `declared` applies only when `variants` is omitted: each declared producing variant needs
 * full-collection evidence in the registry, so a missing refresh refuses instead of reading as
 * nothing to check. Auxiliary output variants stay judged through their destinations alone.
 *
 * @example
 * ```ts
 * const options: CaptureStaleOptions = { selector: 'pages:mail', declared: ['light-390', 'dark-1280'] }
 * ```
 */
export interface CaptureStaleOptions extends CaptureReadOptions {
	readonly declared?: readonly string[]
}

/**
 * Selects required output pairs and attributable extras for a freshness reading.
 *
 * @remarks
 * `variants` names output variants, including auxiliary outputs when explicitly selected.
 * `portfolio`, when supplied, restricts the instance's authorized portfolio population. Empty or
 * unknown selectors, variants, portfolios, cases, and states refuse. A scoped reading includes
 * only selected required pairs and attributable extras, and a whole-primary-portfolio reading
 * also reports legacy flat PNGs as orphans.
 *
 * @example
 * ```ts
 * const options: CaptureCheckOptions = { selector: 'pages:mail', variants: ['light-390'] }
 * ```
 */
export interface CaptureCheckOptions extends CaptureSelection {
	readonly variants: readonly string[]
	readonly portfolio?: string
}

/**
 * Returns the exact current declaration destinations and their complete-anchor identity.
 *
 * @example
 * ```ts
 * const { registry, entries } = await integrity.read({ selector: 'pages:mail' })
 * ```
 */
export interface CaptureReadResult {
	readonly registry: string
	readonly entries: readonly CaptureDestination[]
}

/**
 * Reports the exact judged population, every mismatch reason, and conservative test warnings.
 *
 * @remarks
 * `required` supplies canonical selected paths to preflight and contact-sheet consumers.
 * `entries` includes physical extras and uses duplicate, orphan, missing, unstamped,
 * stale-shared, stale-own, current precedence. Changed test inputs produce warnings and
 * invalidate dependent lookups without changing a frame's pixel classification. `duration` is the
 * measured `performance.now` wall in milliseconds for this selection. The executable derives exit
 * 1 from any noncurrent entry, exit 0 otherwise, and exit 64 from invalid usage or schema.
 * Missing required registry evidence never produces success.
 *
 * @example
 * ```ts
 * const result = await integrity.check({ selector: 'pages:mail' })
 * result.entries.every((entry) => entry.status === 'current')
 * ```
 */
export interface CaptureCheckResult {
	readonly required: readonly CaptureDestination[]
	readonly entries: readonly CaptureFreshness[]
	readonly warnings: readonly CaptureWarning[]
	readonly duration: number
}

/**
 * Requests a state-to-case resolution before the runner starts any selected project.
 *
 * @remarks
 * `variants` names producing journey variants, retaining the caller's exact selection. Registry
 * mappings determine output variants, and suffix substitution is forbidden. An explicit `case`
 * must equal the resolved full declaring name. Missing or stale evidence refuses with the
 * explicit capture-free owner or exact-case refresh command. Resolving a state starts no
 * process, repairs no evidence, and widens no selection.
 *
 * @example
 * ```ts
 * const options: CaptureLookupOptions = { selector: 'pages:mail', state: 'inbox', variants: ['light-390'] }
 * ```
 */
export interface CaptureLookupOptions extends CaptureSelection {
	readonly state: string
	readonly variants: readonly string[]
	readonly portfolio?: string
}

/**
 * Resolves one declaring case and its actual output pairs with their passing evidence.
 *
 * @remarks
 * `case` must agree across applicable requested producing variants, and ambiguity refuses.
 * `entries` retains each output variant and producing project without replacing the requested
 * variant list. Inapplicable projects remain in the runner's selected stage. Every entry must
 * agree with the selector, registry, lookup, and any relevant manifest stamp. An empty
 * applicable population refuses.
 *
 * @example
 * ```ts
 * const result = await integrity.lookup(options)
 * result.case // the declaring case's full name
 * ```
 */
export interface CaptureLookupResult {
	readonly case: string
	readonly entries: readonly CaptureDestination[]
	readonly lookups: readonly CaptureLookup[]
}

/**
 * Binds a decoded run record to the physical file whose digest authenticated it.
 *
 * @example
 * ```ts
 * const evidence: CaptureRunEvidence = { file: snapshot, run }
 * ```
 */
export interface CaptureRunEvidence {
	readonly file: CaptureFileSnapshot
	readonly run: CaptureRun
}

/**
 * Carries one physical-directory ancestry while enumerating logical portfolio paths.
 *
 * @example
 * ```ts
 * const reading: CaptureDirectoryReading = { directory: 'tmp/captures/states/pages', ancestors: [] }
 * ```
 */
export interface CaptureDirectoryReading {
	readonly directory: string
	readonly ancestors: readonly string[]
}

/**
 * Carries accepted registry anchors and separately persisted passing run evidence.
 *
 * @example
 * ```ts
 * const evidence: CaptureEvidence = { registry, collections: [], lookups: [], runs: [] }
 * ```
 */
export interface CaptureEvidence {
	readonly registry: CaptureRegistry
	readonly collections: readonly CaptureCollectionReceipt[]
	readonly manifest?: CaptureStoredManifest
	readonly lookups: readonly CaptureLookup[]
	readonly runs: readonly CaptureRunEvidence[]
}

/**
 * Carries the authenticated external record beside its collection receipt.
 *
 * @example
 * ```ts
 * const evidence: CaptureCollectionEvidence = { file: snapshot, run, receipt }
 * ```
 */
export interface CaptureCollectionEvidence extends CaptureRunEvidence {
	readonly receipt: CaptureCollectionReceipt
}

/**
 * Supplies a verifier's actual process outcome and exact reporter bytes for registry import.
 *
 * @example
 * ```ts
 * const input: CaptureReceiptInput = { receipt, report: text, outcome: { code: 0, signal: null }, capped: false }
 * ```
 */
export interface CaptureReceiptInput {
	readonly receipt: CaptureReceipt
	readonly report: string
	readonly outcome: CaptureExecutionResult
	readonly capped: boolean
}

/**
 * Defines the shared stage transaction, freshness reading, and state resolution engine.
 *
 * @example
 * ```ts
 * const integrity: CaptureIntegrityInterface = createCaptureIntegrity(options)
 * ```
 */
export interface CaptureIntegrityInterface {
	/**
	 * Reads current full-collection evidence and selects exact declaration destinations.
	 *
	 * @param options - The explicit selection; omitted variants derive from authenticated mappings
	 * @returns The accepted registry identity and exactly selected destinations
	 * @throws Thrown with explicit preparation when declarations lack current authenticated evidence.
	 *
	 * @example
	 * ```ts
	 * const { entries } = await integrity.read({ selector: 'pages:mail' })
	 * ```
	 */
	read(options: CaptureReadOptions): Promise<CaptureReadResult>

	/**
	 * Validates an executed stage before atomically publishing its authorized evidence.
	 *
	 * @param options - The exact stage and the runner-owned child execution callback
	 * @returns The committed stage evidence after every selected sibling validates
	 * @throws Thrown when execution, identity, records, reporter results, paths, inputs, registry
	 * evidence, projection, or atomic publication fails. Precommit failures preserve prior
	 * manifest bytes, and journey requests publish no image stamps.
	 *
	 * @example
	 * ```ts
	 * const result = await integrity.stamp(stage)
	 * ```
	 */
	stamp(options: CaptureStageOptions): Promise<CaptureStageResult>

	/**
	 * Checks the explicitly selected output population without changing evidence or images.
	 *
	 * @param selection - The selected owners, optional output variants, state, and portfolio, and
	 * the wrapper's declared producing variants. Default variants: every output variant of the
	 * selected registry destinations.
	 * @returns Freshness classifications and warnings for the selected population
	 * @throws Thrown when required evidence, schema, containment, or selection is invalid, or when
	 * variants are omitted and a declared producing variant has no registry evidence.
	 *
	 * @example
	 * ```ts
	 * const result = await integrity.check({ selector: 'pages:mail' })
	 * ```
	 */
	check(selection: CaptureStaleOptions): Promise<CaptureCheckResult>

	/**
	 * Resolves an explicitly requested state through fresh registry and passing case evidence.
	 *
	 * @param options - The original selector, producing variants, state, and optional exact case
	 * @returns The agreed declaring case, output mappings, and validated lookup receipts
	 * @throws Thrown when evidence is missing, stale, ambiguous, or disagrees with the selection.
	 *
	 * @example
	 * ```ts
	 * const { case: name } = await integrity.lookup({ selector: 'pages:mail', state: 'inbox', variants: ['light-390'] })
	 * ```
	 */
	lookup(options: CaptureLookupOptions): Promise<CaptureLookupResult>
}

/**
 * Preserves the wrapper's host declarations for the runner.
 *
 * @remarks
 * `name` is the Vitest project label the runner passes to `--project`, `variant` is the one
 * producing variant that project runs, and `variants` lists every variant the wrapper declares.
 * `directory` is the absolute primary portfolio root and `record` the run record template.
 * `inputs` bounds attribution. `closing` is the full name of the case that closes a variant's
 * run, `first` is the variant the runner stages alone before the rest, and `portfolios`
 * authorizes every physical root a selector may reach through the primary registry. `standalone`
 * lists the roots that keep their own registry, manifest, and lookups beside their directory and
 * have no stamping route; a selector or `--portfolio` that names one reads through that root
 * alone. The runner validates uniqueness, tag syntax, references, and containment of every one
 * of them.
 *
 * @example
 * ```ts
 * const project: CaptureProject = {
 * 	name: 'journey:light-390',
 * 	variant: 'light-390',
 * 	tags: ['owner:pages:mail'],
 * 	variants: ['light-390'],
 * 	directory: `${process.cwd()}/tmp/captures/states`,
 * 	record: 'tmp/captures/states/runs/a/light-390.json',
 * 	inputs: ['src/**'],
 * 	closing: 'showcase journeys places every registered state and writes the variant artifact',
 * 	first: 'light-390',
 * 	portfolios: [{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }],
 * 	standalone: [],
 * }
 * ```
 */
export interface CaptureProject {
	readonly name: string
	readonly variant: string
	readonly tags: readonly string[]
	readonly variants: readonly string[]
	readonly directory: string
	readonly record: string
	readonly inputs: readonly string[]
	readonly closing: string
	readonly first: string
	readonly portfolios: readonly CapturePortfolioRoot[]
	readonly standalone: readonly CapturePortfolioRoot[]
}

/**
 * Writes one chunk of runner output to the stream the host chooses.
 *
 * @remarks The default writers are `process.stdout` and `process.stderr`.
 *
 * @example
 * ```ts
 * const write: CaptureWriteHandler = (text) => process.stdout.write(text)
 * ```
 */
export type CaptureWriteHandler = (text: string) => unknown

/**
 * Creates the integrity engine the runner reads and stamps through, from the options it derives.
 *
 * @remarks The default constructs the package's own engine.
 *
 * @example
 * ```ts
 * const handler: CaptureIntegrityHandler = (options) => createCaptureIntegrity(options)
 * ```
 */
export type CaptureIntegrityHandler = (
	options: CaptureIntegrityOptions,
) => CaptureIntegrityInterface

/**
 * Names one planned stage and the variants it runs in one Vitest process.
 *
 * @example
 * ```ts
 * const stage: CaptureStagePlan = { name: 'narrow', variants: ['light-390'] }
 * ```
 */
export interface CaptureStagePlan {
	readonly name: string
	readonly variants: readonly string[]
}

/**
 * Configures the Vitest argument list one stage spawns with.
 *
 * @remarks
 * `entry` is the absolute Vitest entry and `config` the absolute wrapper path. `report` is the
 * absolute JSON reporter path and `projects` the Vitest project labels the stage runs. `filter`
 * is the tag expression. An exact `case` adds the anchored name pattern for that case and the
 * `closing` case, so the closing case still writes the run record. A `mode` adds Vitest's `--mode`
 * flag, which the registry command forwards so a wrapper can select another registry.
 *
 * @example
 * ```ts
 * const options: CaptureArgumentsOptions = {
 * 	entry: '/repo/node_modules/vitest/vitest.mjs',
 * 	config: '/repo/configs/vite.journey.config.ts',
 * 	report: '/repo/tmp/units/runs/a/journey-narrow.json',
 * 	projects: ['journey:light-390'],
 * 	filter: 'owner:pages:mail',
 * 	closing: 'closes the run',
 * }
 * ```
 */
export interface CaptureArgumentsOptions {
	readonly entry: string
	readonly config: string
	readonly report: string
	readonly projects: readonly string[]
	readonly filter: string
	readonly case?: string
	readonly closing: string
	readonly mode?: string
}

/**
 * Configures how a wrapper reads the runner's request for its own Vitest process.
 *
 * @remarks
 * `ppid` is the wrapper process's parent id, which names the request file the runner wrote.
 * `argv` is the wrapper process's own arguments after its executable, which the request records
 * exactly. `directory` is the directory that holds request files, absolute or relative to the
 * working directory. The runner names the directory it publishes to in the child's environment, so
 * a wrapper that omits `directory` reads the runner's own and never has to repeat it; a wrapper
 * that names one declares it, and it must be the runner's. With neither, the directory is
 * `CAPTURE_DEFAULTS.requests`. `config` is the repository-relative, slash-separated path of the
 * wrapper the request must name. `owners` lists every owner path the wrapper declares and
 * `variants` every variant name it declares.
 *
 * @example
 * ```ts
 * const options: CaptureRequestOptions = {
 * 	ppid: process.ppid,
 * 	argv: process.argv.slice(1),
 * 	config: 'configs/vite.journey.config.ts',
 * 	owners: ['pages:mail'],
 * 	variants: ['light-390'],
 * }
 * ```
 */
export interface CaptureRequestOptions {
	readonly ppid: number
	readonly argv: readonly string[]
	readonly directory?: string
	readonly config: string
	readonly owners: readonly string[]
	readonly variants: readonly string[]
}

/**
 * Carries the request the runner publishes for the discovery child that reads its wrapper.
 *
 * @remarks
 * `phase` is always `discover`, which is what tells a wrapper this is no execution request. `nonce`
 * is the challenge the wrapper must echo in its answer, `pid` the runner's process id, `config` the
 * repository-relative wrapper path, and `args` the exact arguments the discovery child was spawned
 * with. The file has the name and location of an execution request, so one lease covers both.
 *
 * @example
 * ```ts
 * const request: CaptureDiscoveryRequest = {
 * 	version: 1,
 * 	phase: 'discover',
 * 	id: 'run-1',
 * 	nonce: 'a1b2',
 * 	config: 'configs/vite.journey.config.ts',
 * 	pid: 4242,
 * 	args: ['/repo/node_modules/vitest/vitest.mjs', 'list', '--filesOnly'],
 * }
 * ```
 */
export interface CaptureDiscoveryRequest {
	readonly version: 1
	readonly phase: 'discover'
	readonly id: string
	readonly nonce: string
	readonly config: string
	readonly pid: number
	readonly args: readonly string[]
}

/**
 * Describes one wrapper project to the runner: its host declarations and, when it has one, its viewport.
 *
 * @remarks
 * The viewport is the geometry of the project's producing variant. A runner command needs none; a
 * reader refuses a project that declares none.
 *
 * @example
 * ```ts
 * const entry: CaptureHostEntry = { project, viewport: { name: 'light-390', width: 390, height: 844 } }
 * ```
 */
export interface CaptureHostEntry {
	readonly project: CaptureProject
	readonly viewport?: CaptureViewport
}

/**
 * Carries the description a wrapper writes back to the runner that discovered it.
 *
 * @remarks
 * `id`, `nonce`, and `config` echo the request. `parent` is the runner's process id the wrapper read
 * as its own parent and `pid` the wrapper process's own id, so the runner can tie the answer to the
 * child it spawned. `projects` lists one entry per wrapper project in declaration order.
 *
 * @example
 * ```ts
 * const description: CaptureHostDescription = {
 * 	version: 1,
 * 	id: 'run-1',
 * 	nonce: 'a1b2',
 * 	config: 'configs/vite.journey.config.ts',
 * 	parent: 4242,
 * 	pid: 4343,
 * 	projects: [{ project }],
 * }
 * ```
 */
export interface CaptureHostDescription {
	readonly version: 1
	readonly id: string
	readonly nonce: string
	readonly config: string
	readonly parent: number
	readonly pid: number
	readonly projects: readonly CaptureHostEntry[]
}

/**
 * Names what a description must echo for the runner to accept it.
 *
 * @remarks
 * `id`, `nonce`, and `config` are the request's own. `parent` is the runner's process id and `pid`
 * the discovery child's, which the runner read from the spawn.
 *
 * @example
 * ```ts
 * const expected: CaptureDescriptionExpectation = {
 * 	id: 'run-1',
 * 	nonce: 'a1b2',
 * 	config: 'configs/vite.journey.config.ts',
 * 	parent: process.pid,
 * 	pid: 4343,
 * }
 * ```
 */
export interface CaptureDescriptionExpectation {
	readonly id: string
	readonly nonce: string
	readonly config: string
	readonly parent: number
	readonly pid: number | undefined
}

/**
 * Configures how a wrapper answers the runner's discovery request.
 *
 * @remarks
 * `ppid`, `argv`, `directory`, and `config` are the ones `CaptureRequestOptions` names. `projects`
 * is the wrapper's own `test.projects` list, each entry an inline project, a promise of one, or a
 * factory, which the answer resolves the way Vitest does.
 *
 * @example
 * ```ts
 * const options: CaptureDiscoveryOptions = {
 * 	ppid: process.ppid,
 * 	argv: process.argv.slice(1),
 * 	config: 'configs/vite.journey.config.ts',
 * 	projects,
 * }
 * ```
 */
export interface CaptureDiscoveryOptions {
	readonly ppid: number
	readonly argv: readonly string[]
	readonly directory?: string
	readonly config: string
	readonly projects: readonly unknown[]
}

/**
 * Configures one discovery: the workspace, the wrapper, the invocation that owns the child, and its bounds.
 *
 * @remarks
 * `root` is the absolute workspace path and `config` the absolute wrapper path. `invocation` owns
 * the request file, the child, and its interruption. `mode` is Vitest's `--mode` value when the
 * command forwards one. `deadline` bounds the child in milliseconds; default:
 * `CAPTURE_DISCOVERY.deadline`.
 *
 * @example
 * ```ts
 * const options: CaptureDiscoveryRunOptions = { root: process.cwd(), config, invocation }
 * ```
 */
export interface CaptureDiscoveryRunOptions {
	readonly root: string
	readonly config: string
	readonly invocation: CaptureInvocationInterface
	readonly mode?: string
	readonly deadline?: number
}

/**
 * Reads a consumer's wrapper by running its installed Vitest in discovery mode.
 *
 * @example
 * ```ts
 * const discovery: CaptureDiscoveryInterface = createCaptureDiscovery(options)
 * ```
 */
export interface CaptureDiscoveryInterface {
	/**
	 * Publishes the discovery request, runs the wrapper's Vitest as a bounded child, and reads back its description.
	 *
	 * @returns The validated host description, accepted only after the exchange and the child's exit both succeeded
	 * @throws Thrown as a `USAGE` capture error for a wrapper outside the workspace, and as a `HOST`
	 * capture error for a missing Vitest, an interrupted, failed, or expired child, and a missing,
	 * replayed, mismatched, or malformed description.
	 *
	 * @example
	 * ```ts
	 * const { projects } = await discovery.describe()
	 * ```
	 */
	describe(): Promise<CaptureHostDescription>
}

/**
 * Carries one project's owner-bearing passed work count from a finished stage.
 *
 * @example
 * ```ts
 * const outcome: CaptureOutcome = { project: 'journey:light-390', variant: 'light-390', count: 3 }
 * ```
 */
export interface CaptureOutcome {
	readonly project: string
	readonly variant: string
	readonly count: number
}

/**
 * Carries everything every stage of one invocation shares.
 *
 * @remarks
 * `directory` is the repository-relative primary portfolio root, `config` the repository-relative
 * wrapper path, and `closing` the full name of the case that closes a variant's run. `filter` is
 * the tag expression. `case` and `state` appear only when the command line named them, and `case`
 * holds the resolved declaring case once a state selects one. `command` is the request command
 * every stage records.
 *
 * @example
 * ```ts
 * const plan: CaptureRunPlan = {
 * 	command: 'journey',
 * 	projects: [project],
 * 	selector: 'pages:mail',
 * 	filter: 'owner:pages:mail',
 * 	closing: 'closes the run',
 * 	directory: 'tmp/captures/states',
 * 	config: 'configs/vite.journey.config.ts',
 * }
 * ```
 */
export interface CaptureRunPlan {
	readonly command: CaptureRequest['command']
	readonly projects: readonly CaptureProject[]
	readonly selector: string
	readonly filter: string
	readonly case?: string
	readonly state?: string
	readonly closing: string
	readonly directory: string
	readonly config: string
}

/**
 * Configures one runner invocation's identity, workspace, and output.
 *
 * @remarks
 * `root` is the absolute workspace path. `requests` is the repository-relative directory that
 * holds the request file and the invocation's reports and logs. `stdout` and `stderr` receive the
 * runner's own lines and each child's output.
 *
 * @example
 * ```ts
 * const options: CaptureInvocationOptions = {
 * 	command: 'journey',
 * 	root: process.cwd(),
 * 	requests: 'tmp/units',
 * 	stdout: (text) => process.stdout.write(text),
 * 	stderr: (text) => process.stderr.write(text),
 * }
 * ```
 */
export interface CaptureInvocationOptions {
	readonly command: CaptureCommand
	readonly root: string
	readonly requests: string
	readonly stdout: CaptureWriteHandler
	readonly stderr: CaptureWriteHandler
}

/**
 * Owns one runner invocation's identity, request file, children, and interruption.
 *
 * @example
 * ```ts
 * const invocation: CaptureInvocationInterface = new CaptureInvocation(options)
 * ```
 */
export interface CaptureInvocationInterface {
	/** Holds the invocation identity, which names its report directory and its request records. */
	readonly id: string

	/** Holds the absolute path of the request file this process names. */
	readonly request: string

	/** Holds the absolute directory that holds this invocation's reports and logs. */
	readonly directory: string

	/** Holds the signal that aborts when the invocation is interrupted. */
	readonly signal: AbortSignal

	/** Holds whether an interrupt has arrived. */
	readonly interrupted: boolean

	/**
	 * Installs the interrupt handler on the process.
	 *
	 * @example
	 * ```ts
	 * invocation.attach()
	 * ```
	 */
	attach(): void

	/**
	 * Waits for any interrupt termination to finish, then removes the interrupt handler.
	 *
	 * @returns Nothing once the children are gone and the handler is removed
	 *
	 * @example
	 * ```ts
	 * await invocation.release()
	 * ```
	 */
	release(): Promise<void>

	/**
	 * Creates the report directory and removes request files that name a process no longer running.
	 *
	 * @remarks A request file under a live process id is never touched, this process's own included.
	 *
	 * @example
	 * ```ts
	 * invocation.prepare()
	 * ```
	 */
	prepare(): void

	/**
	 * Lists the other live processes that hold a request file in the request directory.
	 *
	 * @returns The distinct process ids, none of them this process's own, in directory order
	 *
	 * @example
	 * ```ts
	 * invocation.holders() // [] when no other runner is mid-stage
	 * ```
	 */
	holders(): readonly number[]

	/**
	 * Writes the stage or discovery request atomically, so no reader sees a partial file.
	 *
	 * @param request - The stage request, or the discovery request that precedes the stages
	 *
	 * @example
	 * ```ts
	 * invocation.publish(request)
	 * ```
	 */
	publish(request: CaptureRequest | CaptureDiscoveryRequest): void

	/**
	 * Removes this process's request file and its temporary sibling.
	 *
	 * @example
	 * ```ts
	 * invocation.retract()
	 * ```
	 */
	retract(): void

	/**
	 * Reports whether a child with this log path has been spawned by this invocation.
	 *
	 * @param log - The absolute log path the spawn was given
	 * @returns True if the spawn began; false otherwise
	 *
	 * @example
	 * ```ts
	 * invocation.launched(log) // false before the spawn
	 * ```
	 */
	launched(log: string): boolean

	/**
	 * Spawns the Vitest child and tees its output to the host streams and the log.
	 *
	 * @param args - The Node argument array, starting with the Vitest entry
	 * @param log - The absolute path of the file that receives the child's output
	 * @param capture - If `true`, sets the capture variable in the child; if `false`, removes it
	 * @param deadline - Milliseconds after which the runner ends the child's process tree; default: unbounded
	 * @returns The native close outcome of the child, its process id, and whether the deadline ended it
	 *
	 * @example
	 * ```ts
	 * const { code } = await invocation.spawn(args, log, true)
	 * ```
	 */
	spawn(
		args: readonly string[],
		log: string,
		capture: boolean,
		deadline?: number,
	): Promise<CaptureExecutionResult>
}

/**
 * Configures one runner invocation: its command, its workspace, and the command line it reads.
 *
 * @remarks
 * `root` is the absolute workspace path. `config` is the repository-relative wrapper default,
 * used when the command line names no `--config`. `requests` is the repository-relative
 * directory that holds the runner's request file. The runner hands it to every child it spawns in
 * the `CAPTURE_REQUESTS` variable, so a wrapper that names no directory of its own reads the same
 * one. `argv` is the command line after the entry name. `stdout` and `stderr` receive the
 * runner's own lines and each child's output; default: the process streams. `integrity` creates
 * the engine from the options the runner derives from the wrapper; default: the package's own
 * engine. `deadline` bounds the discovery child in milliseconds; default:
 * `CAPTURE_DISCOVERY.deadline`.
 *
 * @example
 * ```ts
 * const options: CaptureRunnerOptions = {
 * 	command: 'journey',
 * 	root: process.cwd(),
 * 	config: 'configs/app/vite.journey.config.ts',
 * 	requests: 'tmp/units',
 * 	argv: ['pages:mail', '--variant', 'light-390'],
 * }
 * ```
 */
export interface CaptureRunnerOptions {
	readonly command: CaptureCommand
	readonly root: string
	readonly config: string
	readonly requests: string
	readonly argv: readonly string[]
	readonly stdout?: CaptureWriteHandler
	readonly stderr?: CaptureWriteHandler
	readonly integrity?: CaptureIntegrityHandler
	readonly deadline?: number
}

/**
 * Carries parsed runner arguments while leaving omitted selectors available to the usage diagnostic.
 *
 * @example
 * ```ts
 * const parsed: CaptureRunnerArguments = { config: '/repo/configs/vite.journey.config.ts', variants: [] }
 * ```
 */
export interface CaptureRunnerArguments {
	readonly selector?: string
	readonly config: string
	readonly variants: readonly string[]
	readonly case?: string
	readonly state?: string
	readonly portfolio?: string
}

/**
 * Drives owner-selected journeys through narrow and remaining variant stages.
 *
 * @example
 * ```ts
 * const runner: CaptureRunnerInterface = createCaptureRunner(options)
 * const exit = await runner.execute()
 * ```
 */
export interface CaptureRunnerInterface {
	/**
	 * Executes the command line without widening its owner or variant selection.
	 *
	 * @returns Exit 0 for passed work, 1 for failure or no work, or 64 for refused usage
	 *
	 * @example
	 * ```ts
	 * const exit = await runner.execute() // 0
	 * ```
	 */
	execute(): Promise<number>
}

/**
 * Carries a decoded RGB image for the image checks and the contact sheets.
 *
 * @example
 * ```ts
 * const picture: CapturePicture = { width: 1, height: 1, pixels: Uint8Array.from([255, 255, 255]) }
 * ```
 */
export interface CapturePicture {
	readonly width: number
	readonly height: number
	readonly pixels: Uint8Array
}

/**
 * Configures a read-only capture consumer using the wrapper's host declarations.
 *
 * @remarks
 * `root` is the absolute workspace and `config` the absolute wrapper path. `selection` bounds the
 * population, and `journeys` is the absolute directory of journey artifacts. `checks`, when
 * supplied, is the path of a module, absolute or relative to `root`, that exports the host's
 * `CAPTURE_CHECKS` list of frame readers. The reader loads it through the runtime's own module
 * loader by the module's file URL, so a TypeScript module needs a Node that strips types.
 * `requests` is the repository-relative directory that holds the discovery request; default:
 * `CAPTURE_DEFAULTS.requests`.
 * `deadline` bounds the discovery child in milliseconds; default: `CAPTURE_DISCOVERY.deadline`.
 * `stdout` receives the report line and `stderr` each refusal; default: the process streams.
 *
 * @example
 * ```ts
 * const reader: CaptureReaderOptions = {
 * 	root: process.cwd(),
 * 	config: `${process.cwd()}/configs/app/vite.journey.config.ts`,
 * 	selection: { selector: 'pages:mail' },
 * 	journeys: `${process.cwd()}/tmp/journey`,
 * 	checks: 'tests/setupCapture.ts',
 * }
 * ```
 */
export interface CaptureReaderOptions {
	readonly root: string
	readonly config: string
	readonly selection: CaptureReadOptions
	readonly journeys: string
	readonly checks?: string
	readonly requests?: string
	readonly deadline?: number
	readonly stdout?: CaptureWriteHandler
	readonly stderr?: CaptureWriteHandler
}

/**
 * Declares the viewport one wrapper project produces beside the project's own name.
 *
 * @remarks
 * `project` is the Vitest project label, which a destination names as its producer. The geometry
 * is the viewport the wrapper declares for that project's producing variant, never one derived from
 * an output name.
 *
 * @example
 * ```ts
 * const producer: CaptureProducer = { project: 'journey:light-390', name: 'light-390', width: 390, height: 844 }
 * ```
 */
export interface CaptureProducer extends CaptureViewport {
	readonly project: string
}

/**
 * Supplies the wrapper path, the journey artifact directory, and the request directory a reader command line falls back to.
 *
 * @remarks
 * All are repository-relative; the command line's `--config` and `--journeys` replace the first two.
 * An omitted `requests` is `CAPTURE_DEFAULTS.requests`.
 *
 * @example
 * ```ts
 * const defaults: CaptureReaderDefaults = { config: 'configs/app/vite.journey.config.ts', journeys: 'tmp/journey' }
 * ```
 */
export interface CaptureReaderDefaults {
	readonly config: string
	readonly journeys: string
	readonly requests?: string
}

/**
 * Returns a reader's authenticated selection and the same engine for pixel classification.
 *
 * @remarks `directory` is the host's primary run directory, which holds the stamped run records.
 *
 * @example
 * ```ts
 * const { population, variants } = await preflight.read()
 * ```
 */
export interface CaptureReaderSelection {
	readonly integrity: CaptureIntegrityInterface
	readonly population: CaptureReadResult
	readonly variants: readonly CaptureProducer[]
	readonly directory: string
}

/**
 * Carries a judged run record and the verified text of the journey artifact it names.
 *
 * @example
 * ```ts
 * const reading: CaptureArtifactReading = { record, run, file, text }
 * ```
 */
export interface CaptureArtifactReading {
	readonly record: string
	readonly run: CaptureRun
	readonly file: string
	readonly text: string
}

/**
 * Names the run record a judged frame's stamp points at and the case that stamped it.
 *
 * @example
 * ```ts
 * const judged: CaptureJudgedRecord = { record: 'tmp/captures/states/runs/a/narrow/light-390.json', case: 'mail shows the inbox' }
 * ```
 */
export interface CaptureJudgedRecord {
	readonly record: string
	readonly case: string
}

/**
 * Pairs a judged frame with its verified artifact, when one was read, and its coverage issues.
 *
 * @example
 * ```ts
 * const frame: CaptureJudgedFrame = { entry, artifact: undefined, issues: [] }
 * ```
 */
export interface CaptureJudgedFrame {
	readonly entry: CaptureDestination
	readonly artifact: CaptureArtifactReading | undefined
	readonly issues: readonly string[]
}

/**
 * Records one selected image's real bytes, geometry, and canonical destination.
 *
 * @example
 * ```ts
 * const reading: CaptureImageReading = { entry, picture, digest, size: 2048 }
 * ```
 */
export interface CaptureImageReading {
	readonly entry: CaptureDestination
	readonly picture: CapturePicture
	readonly digest: string
	readonly size: number
}

/**
 * Carries one judged frame to a host check: its destination, its decoded pixels, and its artifact.
 *
 * @remarks
 * `picture` is `undefined` when the frame's image could not be read, and `artifact` is `undefined`
 * when no verified journey artifact covers the frame. A check that needs either decides what an
 * absent one means; the reader already reports an unreadable image and an uncovered record.
 *
 * @example
 * ```ts
 * const frame: CaptureCheckFrame = { entry, picture, artifact: undefined }
 * ```
 */
export interface CaptureCheckFrame {
	readonly entry: CaptureDestination
	readonly picture: CapturePicture | undefined
	readonly artifact: CaptureArtifactReading | undefined
}

/**
 * Reads one judged frame against a host rule and returns the issues it finds, none when it passes.
 *
 * @example
 * ```ts
 * const check: CaptureCheckHandler = (frame) => (frame.picture.width < 100 ? ['frame is too narrow'] : [])
 * ```
 */
export type CaptureCheckHandler = (frame: CaptureCheckFrame) => readonly string[]

/**
 * Reports selected image checks without upgrading their engine freshness classifications.
 *
 * @remarks
 * `framing` reports dimension mixtures without inferring intended or actual capture mode.
 * `directory` names the host's primary run directory, which holds the stamped run records.
 *
 * @example
 * ```ts
 * const result = await preflight.check()
 * result.issues // readonly string[]
 * ```
 */
export interface CapturePreflightResult {
	readonly framing: readonly string[]
	readonly variants: readonly CaptureProducer[]
	readonly directory: string
	readonly selection: CaptureReadResult
	readonly freshness: CaptureCheckResult
	readonly images: readonly CaptureImageReading[]
	readonly issues: readonly string[]
}

/**
 * Reads the selected population's frames and reports their freshness, framing, and coverage.
 *
 * @example
 * ```ts
 * const preflight: CapturePreflightInterface = createCapturePreflight(reader)
 * ```
 */
export interface CapturePreflightInterface {
	/**
	 * Reads the authenticated selection and the host's declared viewports.
	 *
	 * @returns The engine, the selected destinations, the viewports, and the primary run directory
	 * @throws Thrown when the wrapper, the registry, or the selection is invalid.
	 *
	 * @example
	 * ```ts
	 * const { population } = await preflight.read()
	 * ```
	 */
	read(): Promise<CaptureReaderSelection>

	/**
	 * Judges every selected frame and returns the framing, freshness, images, and issues.
	 *
	 * @returns The preflight reading without upgrading any freshness classification
	 * @throws Thrown when the selection or an artifact cannot be read.
	 *
	 * @example
	 * ```ts
	 * const result = await preflight.check()
	 * ```
	 */
	check(): Promise<CapturePreflightResult>

	/**
	 * Executes the check and prints its report.
	 *
	 * @returns Exit 0 for current frames without defects, 1 for any defect, or 64 for refused usage
	 *
	 * @example
	 * ```ts
	 * const exit = await preflight.execute() // 0
	 * ```
	 */
	execute(): Promise<number>
}

/**
 * Carries a contact-sheet output request separately from the population selection.
 *
 * @example
 * ```ts
 * const options: CaptureSheetOptions = { reader, output: '/repo/tmp/sheets' }
 * ```
 */
export interface CaptureSheetOptions {
	readonly reader: CaptureReaderOptions
	readonly output: string
}

/**
 * Holds one contact-sheet cell: a frame's destination, its shrunk picture, and what the sheet reports about it.
 *
 * @remarks
 * `source` is the decoded image's size, `undefined` when the image could not be read, and `factor`
 * is the whole-number reduction applied. `clipped` is true when the shrunk picture was cut at the
 * sheet's height limit.
 *
 * @example
 * ```ts
 * const cell: CaptureSheetCell = { entry, picture, source: undefined, factor: 1, clipped: false, freshness: undefined }
 * ```
 */
export interface CaptureSheetCell {
	readonly entry: CaptureDestination
	readonly picture: CapturePicture
	readonly source:
		| { readonly width: number; readonly height: number; readonly bytes: number }
		| undefined
	readonly factor: number
	readonly clipped: boolean
	readonly freshness: CaptureFreshness | undefined
}

/**
 * Holds the cells of one portfolio, owner, and state side by side as one composite picture.
 *
 * @example
 * ```ts
 * const group: CaptureSheetGroup = { identity: '["states","pages:mail","mail-screen"]', cells: [], picture }
 * ```
 */
export interface CaptureSheetGroup {
	readonly identity: string
	readonly cells: readonly CaptureSheetCell[]
	readonly picture: CapturePicture
}

/**
 * Holds a pair of groups side by side as one composite picture.
 *
 * @example
 * ```ts
 * const row: CaptureSheetRow = { groups: [], picture }
 * ```
 */
export interface CaptureSheetRow {
	readonly groups: readonly CaptureSheetGroup[]
	readonly picture: CapturePicture
}

/**
 * Holds one written sheet: its file name, the rows it stacks, and the composite picture.
 *
 * @example
 * ```ts
 * const page: CaptureSheetPage = { file: 'sheet-001.png', rows: [], picture }
 * ```
 */
export interface CaptureSheetPage {
	readonly file: string
	readonly rows: readonly CaptureSheetRow[]
	readonly picture: CapturePicture
}

/**
 * Carries parsed reader arguments and an optional contact-sheet output directory.
 *
 * @example
 * ```ts
 * const command: CaptureReaderCommand = { reader, output: '/repo/tmp/sheets' }
 * ```
 */
export interface CaptureReaderCommand {
	readonly reader: CaptureReaderOptions
	readonly output?: string
}

/**
 * Composes exactly the authenticated sparse state and output pairs for iteration review.
 *
 * @remarks Sheets remain preflight artifacts, never assembled-portfolio acceptance.
 *
 * @example
 * ```ts
 * const sheets: CaptureSheetsInterface = createCaptureSheets(options)
 * ```
 */
export interface CaptureSheetsInterface {
	/**
	 * Reads selected physical images, writes complete indexed sheets, and retains all refusals.
	 *
	 * @returns Exit 0 for current selected images without preflight defects, 1 for any defect, or 64 for refused usage, including an output directory that is not new, contained, and outside the selected capture directories
	 *
	 * @example
	 * ```ts
	 * const exit = await sheets.execute() // 0
	 * ```
	 */
	execute(): Promise<number>
}

/**
 * Carries the parsed registry command line: the wrapper, the variants to refresh, and the mode.
 *
 * @remarks `config` is absolute. An empty `variants` list refreshes every declared producing variant.
 *
 * @example
 * ```ts
 * const parsed: CaptureRegistryArguments = { config: '/repo/configs/vite.journey.config.ts', variants: [] }
 * ```
 */
export interface CaptureRegistryArguments {
	readonly config: string
	readonly variants: readonly string[]
	readonly mode?: string
}

/**
 * Configures one registry refresh: its workspace, wrapper default, request directory, and command line.
 *
 * @remarks
 * `root` is the absolute workspace path. `config` is the repository-relative wrapper default, used
 * when the command line names no `--config`. `requests` is the repository-relative directory that
 * holds the request file the wrapper reads back. `argv` is the command line after the subcommand.
 * `stdout` and `stderr` receive the refresh's own lines and each child's output; default: the
 * process streams. `deadline` bounds the discovery child in milliseconds; default:
 * `CAPTURE_DISCOVERY.deadline`.
 *
 * @example
 * ```ts
 * const options: CaptureRegistrarOptions = {
 * 	root: process.cwd(),
 * 	config: 'configs/app/vite.journey.config.ts',
 * 	requests: 'tmp/capture',
 * 	argv: ['--variant', 'light-390'],
 * }
 * ```
 */
export interface CaptureRegistrarOptions {
	readonly root: string
	readonly config: string
	readonly requests: string
	readonly argv: readonly string[]
	readonly stdout?: CaptureWriteHandler
	readonly stderr?: CaptureWriteHandler
	readonly deadline?: number
}

/**
 * Refreshes the accepted registry from one complete capture-free journey per producing variant.
 *
 * @example
 * ```ts
 * const registrar: CaptureRegistrarInterface = createCaptureRegistrar(options)
 * const exit = await registrar.execute()
 * ```
 */
export interface CaptureRegistrarInterface {
	/**
	 * Runs each producing variant's complete journey, imports the receipts, and publishes the registry.
	 *
	 * @returns Exit 0 for a published registry, 1 for a refused, failed, or interrupted refresh, or 64 for refused usage
	 *
	 * @example
	 * ```ts
	 * const exit = await registrar.execute() // 0
	 * ```
	 */
	execute(): Promise<number>
}
