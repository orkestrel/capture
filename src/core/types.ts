import type { CAPTURE_ERROR_CODES, CAPTURE_STATUS_PRECEDENCE } from './constants.js'

/**
 * Names one condition axis a capture failure carries.
 *
 * @example
 * ```ts
 * const code: CaptureErrorCode = 'USAGE'
 * ```
 */
export type CaptureErrorCode = (typeof CAPTURE_ERROR_CODES)[number]

/**
 * Carries structured facts about a capture failure beside its message.
 *
 * @example
 * ```ts
 * const context: CaptureErrorContext = { selector: 'pages:mail', variant: 'light-390' }
 * ```
 */
export type CaptureErrorContext = Readonly<Record<string, unknown>>

/**
 * Configures one capture failure's condition, optional context, and optional cause.
 *
 * @example
 * ```ts
 * const options: CaptureErrorOptions = { code: 'SELECTION', context: { selector: 'pages:mail' } }
 * ```
 */
export interface CaptureErrorOptions {
	readonly code: CaptureErrorCode
	readonly context?: CaptureErrorContext
	readonly cause?: unknown
}

/**
 * Carries the selection fields a request and a parking check read.
 *
 * @example
 * ```ts
 * const selection: CaptureSelection = { selector: 'pages:mail', state: 'inbox' }
 * ```
 */
export interface CaptureSelection {
	readonly selector: string
	readonly case?: string
	readonly state?: string
}

/**
 * Identifies one runner invocation's producing stage and configuration.
 *
 * @example
 * ```ts
 * const identity: CaptureIdentity = {
 * 	id: 'run-1',
 * 	stage: 'selected',
 * 	pid: 4242,
 * 	config: 'configs/app/vite.journey.config.ts',
 * }
 * ```
 */
export interface CaptureIdentity {
	readonly id: string
	readonly stage: string
	readonly pid: number
	readonly config: string
}

/**
 * Carries a runner request through Vitest's provided-context protocol.
 *
 * @remarks Journey selections use the selected stage; frame captures use narrow and rest stages.
 * A registry refresh runs every selected variant in one registry stage. Records are keyed by id,
 * stage, and variant.
 * `mode` carries the selected Vitest mode when the command line names one.
 *
 * @example
 * ```ts
 * const request: unknown = JSON.parse(text)
 * if (isCaptureRequest(request)) request.variants // readonly string[]
 * ```
 */
export interface CaptureRequest extends CaptureSelection, CaptureIdentity {
	readonly version: 1
	readonly command: 'journey' | 'capture'
	readonly mode?: string
	readonly variants: readonly string[]
	readonly args: readonly string[]
}

/**
 * Attributes product ownership and behavioral inputs separately.
 *
 * @example
 * ```ts
 * const sources: CaptureSources = { own: ['src/mail/**'], shared: ['src/core/**'], tests: [] }
 * ```
 */
export interface CaptureSources {
	readonly own: readonly string[]
	readonly shared: readonly string[]
	readonly tests: readonly string[]
}

/**
 * Records declared patterns, expanded file hashes, and their combined digest.
 *
 * @example
 * ```ts
 * const digest: unknown = JSON.parse(text)
 * if (isCaptureDigest(digest)) digest.patterns // readonly string[]
 * ```
 */
export interface CaptureDigest {
	readonly patterns: readonly string[]
	readonly files: Readonly<Record<string, string>>
	readonly digest: string
}

/**
 * Identifies one required output pair and its declaring case.
 *
 * @example
 * ```ts
 * const destination: unknown = JSON.parse(text)
 * if (isCaptureDestination(destination)) destination.file // 'tmp/captures/states/pages/mail--inbox.png'
 * ```
 */
export interface CaptureDestination {
	readonly portfolio: string
	readonly state: string
	readonly scope: string
	readonly part: string
	readonly section?: string
	readonly variant: string
	readonly project: string
	readonly file: string
	readonly case: string
	readonly sources: CaptureSources
}

/**
 * Preserves a collected case's full behavioral declaration.
 *
 * @example
 * ```ts
 * const declaration: CaptureDeclaration = {
 * 	case: 'mail shows the inbox',
 * 	owner: 'pages:mail',
 * 	variant: 'light-390',
 * 	eligible: true,
 * 	states: ['inbox'],
 * }
 * ```
 */
export interface CaptureDeclaration {
	readonly case: string
	readonly owner: string
	readonly variant: string
	readonly eligible: boolean
	readonly states: readonly string[]
}

/**
 * Records an emitted destination and its producing case duration.
 *
 * @example
 * ```ts
 * const entry: unknown = JSON.parse(text)
 * if (isCaptureEntry(entry)) entry.duration // milliseconds
 * ```
 */
export interface CaptureEntry extends CaptureDestination {
	readonly duration: number
}

/**
 * Names the journey artifact a final case wrote and the SHA-256 of its bytes.
 *
 * @example
 * ```ts
 * const artifact: CaptureArtifact = { file: 'tmp/captures/states/runs/a/light-390.txt', digest }
 * ```
 */
export interface CaptureArtifact {
	readonly file: string
	readonly digest: string
}

/**
 * Carries the run records a journey artifact binds and the cases it shows ran.
 *
 * @example
 * ```ts
 * const lines: CaptureArtifactLines = {
 * 	records: ['tmp/captures/states/runs/run-1/selected/light-390.json'],
 * 	cases: ['mail opens the inbox'],
 * }
 * ```
 */
export interface CaptureArtifactLines {
	readonly records: readonly string[]
	readonly cases: readonly string[]
}

/**
 * Records collected declarations, successful observations, and emitted output separately.
 *
 * @example
 * ```ts
 * const run: unknown = JSON.parse(text)
 * if (isCaptureRun(run)) run.passed // readonly string[]
 * ```
 */
export interface CaptureRun {
	readonly version: number
	readonly identity?: CaptureIdentity
	readonly request?: CaptureRequest
	readonly variant: string
	readonly time: string
	readonly complete: boolean
	readonly reference: boolean
	readonly artifact?: CaptureArtifact
	readonly declarations: readonly CaptureDeclaration[]
	readonly registry: readonly CaptureDestination[]
	readonly passed: readonly string[]
	readonly observed: readonly string[]
	readonly entries: readonly CaptureEntry[]
}

/**
 * Binds a complete registry reading to its report and input hashes.
 *
 * @example
 * ```ts
 * const receipt: unknown = JSON.parse(text)
 * if (isCaptureReceipt(receipt)) receipt.report.digest // SHA-256 of the reporter bytes
 * ```
 */
export interface CaptureReceipt {
	readonly version: number
	readonly variant: string
	readonly time: string
	readonly report: { readonly file: string; readonly digest: string }
	readonly inputs: Readonly<Record<string, string>>
	readonly declarations: readonly CaptureDeclaration[]
	readonly registry: readonly CaptureDestination[]
	readonly complete: boolean
}

/**
 * Collects validated registry receipts and their required output pairs.
 *
 * @example
 * ```ts
 * const registry: unknown = JSON.parse(text)
 * if (isCaptureRegistry(registry)) registry.digest // the registry identity
 * ```
 */
export interface CaptureRegistry {
	readonly version: number
	readonly receipts: readonly CaptureReceipt[]
	readonly entries: readonly CaptureDestination[]
	readonly digest: string
}

/**
 * Binds a state-to-case lookup to its registry, inputs, and passing run.
 *
 * @example
 * ```ts
 * const lookup: unknown = JSON.parse(text)
 * if (isCaptureLookup(lookup)) lookup.case // the declaring case's full name
 * ```
 */
export interface CaptureLookup {
	readonly registry: string
	readonly variant: string
	readonly case: string
	readonly owner: string
	readonly states: readonly string[]
	readonly inputs: Readonly<Record<string, string>>
	readonly run: { readonly file: string; readonly digest: string }
}

/**
 * Stamps one emitted frame with execution, source, image, and registry provenance.
 *
 * @example
 * ```ts
 * const stamp: unknown = JSON.parse(text)
 * if (isCaptureStamp(stamp)) stamp.image.digest // SHA-256 of the PNG bytes
 * ```
 */
export interface CaptureStamp extends CaptureEntry {
	readonly identity: CaptureIdentity
	readonly time: string
	readonly commit: string
	readonly dirty: readonly string[]
	readonly own: Readonly<Record<string, string>>
	readonly shared: CaptureDigest
	readonly tests: Readonly<Record<string, string>>
	readonly image: { readonly digest: string; readonly size: number; readonly modified: number }
	readonly registry: string
}

/**
 * Holds the registry, frame stamps, and validated case lookups in one document.
 *
 * @example
 * ```ts
 * const manifest: unknown = JSON.parse(text)
 * if (isCaptureManifest(manifest)) Object.keys(manifest.entries) // stamped image keys
 * ```
 */
export interface CaptureManifest {
	readonly version: number
	readonly registry: CaptureRegistry
	readonly entries: Readonly<Record<string, CaptureStamp>>
	readonly lookups: readonly CaptureLookup[]
}

/**
 * Names the primary freshness classification of a required or discovered frame.
 *
 * @example
 * ```ts
 * const status: CaptureStatus = 'stale-own'
 * ```
 */
export type CaptureStatus = 'current' | (typeof CAPTURE_STATUS_PRECEDENCE)[number]

/**
 * Reports a frame's freshness classification and every supporting reason.
 *
 * @example
 * ```ts
 * const freshness: CaptureFreshness = {
 * 	file: 'tmp/captures/states/pages/mail--inbox.png',
 * 	state: 'inbox',
 * 	variant: 'light-390',
 * 	status: 'missing',
 * 	reasons: ['no image at the required path'],
 * }
 * ```
 */
export interface CaptureFreshness {
	readonly file: string
	readonly state: string
	readonly variant: string
	readonly status: CaptureStatus
	readonly reasons: readonly string[]
}

/**
 * Identifies changed behavioral inputs and conservatively affected cases.
 *
 * @example
 * ```ts
 * const warning: CaptureWarning = { files: ['tests/setup.ts'], cases: ['mail shows the inbox'] }
 * ```
 */
export interface CaptureWarning {
	readonly files: readonly string[]
	readonly cases: readonly string[]
}

/**
 * Binds a successful full collection to the unchanged complete anchor and exact evidence bytes.
 *
 * @remarks
 * This is declaration evidence, not a complete-run receipt or a per-state passing claim. Inputs
 * preserve the full host pattern declaration and expansion. Even a project with no passing
 * selected case can provide a validated full collection. Report and run bytes are pinned
 * separately.
 *
 * @example
 * ```ts
 * const collection: unknown = JSON.parse(text)
 * if (isCaptureCollection(collection)) collection.run.digest // SHA-256 of the run record
 * ```
 */
export interface CaptureCollectionReceipt {
	readonly project: string
	readonly registry: string
	readonly variant: string
	readonly inputs: CaptureDigest
	readonly run: { readonly file: string; readonly digest: string }
	readonly report: { readonly file: string; readonly digest: string }
}

/**
 * Extends the image manifest with independently authenticated collection evidence.
 *
 * @remarks Absence means no collection attestation; historical lookups supply none implicitly.
 *
 * @example
 * ```ts
 * const manifest: unknown = JSON.parse(text)
 * if (isCaptureStoredManifest(manifest)) manifest.collections // readonly receipts or undefined
 * ```
 */
export interface CaptureStoredManifest extends CaptureManifest {
	readonly collections?: readonly CaptureCollectionReceipt[]
}

/**
 * Binds capture-free lookup publication to the exact manifest it supplements.
 *
 * @remarks
 * A successful capture merges the journal and changes the manifest digest, retiring this journal
 * logically without a second filesystem mutation in the capture transaction. The `inputs` table
 * stores each distinct path-to-hash map under its digest; every lookup names that digest in its
 * `inputs` field. Expanded lookup results and image manifests retain their input maps.
 *
 * @example
 * ```ts
 * const journal: CaptureLookupJournal = { version: 1, inputs: {}, lookups: [] }
 * ```
 */
export interface CaptureLookupJournal {
	readonly collections?: readonly CaptureCollectionReceipt[]
	readonly version: 1
	readonly manifest?: string
	readonly inputs: Readonly<Record<string, Readonly<Record<string, string>>>>
	readonly lookups: ReadonlyArray<Omit<CaptureLookup, 'inputs'> & { readonly inputs: string }>
}

/**
 * Declares a host viewport's name and pixel geometry without inferring it from a file name.
 *
 * @example
 * ```ts
 * const viewport: CaptureViewport = { name: 'light-390', width: 390, height: 844 }
 * ```
 */
export interface CaptureViewport {
	readonly name: string
	readonly width: number
	readonly height: number
}

/**
 * Describes a logged viewport box a journey artifact records for pixel sampling.
 *
 * @example
 * ```ts
 * const box: CaptureBox = { x: 0, y: 64, width: 390, height: 780 }
 * ```
 */
export interface CaptureBox {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

/**
 * Carries the owner-bearing projection of a Vitest JSON assertion.
 *
 * @example
 * ```ts
 * const assertion: CaptureAssertion = {
 * 	case: 'mail shows the inbox',
 * 	owner: 'pages:mail',
 * 	variant: 'light-390',
 * 	eligible: true,
 * 	states: ['inbox'],
 * 	status: 'passed',
 * 	duration: 812,
 * }
 * ```
 */
export interface CaptureAssertion extends CaptureDeclaration {
	readonly status: string
	readonly duration?: number
}

/**
 * Holds validated reporter assertions without copying Vitest's unrelated wire members.
 *
 * @example
 * ```ts
 * const report: CaptureReport = readCaptureReport(parseJSON(text))
 * report.assertions.length
 * ```
 */
export interface CaptureReport {
	readonly start: number
	readonly end: number
	readonly assertions: readonly CaptureAssertion[]
}

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
 * Maps the states one portfolio writes to its output variant and physical root.
 *
 * @example
 * ```ts
 * const mapping: CaptureMapping = {
 * 	portfolio: 'states',
 * 	directory: 'tmp/captures/states',
 * 	scoped: true,
 * 	variant: 'light-390',
 * 	states: ['inbox'],
 * }
 * ```
 */
export interface CaptureMapping extends CapturePortfolioRoot {
	readonly variant: string
	readonly states: readonly string[]
}

/**
 * Declares the capture metadata a journey case carries in Vitest's task metadata.
 *
 * @remarks
 * Extend Vitest's `TaskMeta` with it in the workspace's own module declaration, so a case's
 * `meta` option and every collected task carry these fields.
 *
 * @example
 * ```ts
 * const meta: CaptureMeta = { owner: 'pages:mail', states: ['inbox'], variant: 'light-390' }
 * ```
 */
export interface CaptureMeta {
	readonly owner?: string
	readonly states?: readonly string[]
	readonly variant?: string
	readonly eligible?: boolean
}

/**
 * Declares the values a journey wrapper provides to each project, which the runner and the suite read.
 *
 * @remarks
 * Extend Vitest's `ProvidedContext` with it in the workspace's own module declaration. `request` is
 * present only when a runner is the parent, and `capture` reports whether frames are written.
 *
 * @example
 * ```ts
 * const provided: CaptureProvided = {
 * 	variant: 'light-390',
 * 	variants: [{ name: 'light-390', width: 390, height: 844 }],
 * 	directory: 'tmp/captures/states',
 * 	record: 'tmp/captures/states/runs/run-1/selected/light-390.json',
 * 	inputs: ['src/**'],
 * 	final: 'closes the run',
 * 	first: 'light-390',
 * 	portfolios: [{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }],
 * 	capture: false,
 * }
 * ```
 */
export interface CaptureProvided {
	readonly variant: string
	readonly variants: readonly CaptureViewport[]
	readonly directory: string
	readonly record: string
	readonly inputs: readonly string[]
	readonly final: string
	readonly first: string
	readonly uniform?: readonly string[]
	readonly portfolios: readonly CapturePortfolioRoot[]
	readonly standalone?: readonly CapturePortfolioRoot[]
	readonly capture: boolean
	readonly request?: CaptureRequest
}

/**
 * Mirrors the members of Vitest's `TaskResult` that a run record reads.
 *
 * @example
 * ```ts
 * const result: CaptureTaskResult = { state: 'pass', duration: 812 }
 * ```
 */
export interface CaptureTaskResult {
	readonly state: string
	readonly duration?: number
}

/**
 * Mirrors the members of a Vitest file, suite, or test task that case collection reads.
 *
 * @remarks
 * A Vitest `RunnerTask` satisfies it when the workspace's `TaskMeta` extends `CaptureMeta`. A task with
 * `filepath` is a file, and a task with `tasks` is a file or a suite.
 *
 * @example
 * ```ts
 * const task: CaptureTask = { name: 'opens the inbox', mode: 'run', meta: { owner: 'pages:mail' } }
 * ```
 */
export interface CaptureTask {
	readonly name: string
	readonly mode: string
	readonly tags?: readonly string[]
	readonly meta: CaptureMeta
	readonly result?: CaptureTaskResult
	readonly filepath?: string
	readonly tasks?: readonly CaptureTask[]
}

/**
 * Carries one collected case, including a case a runner filter excluded.
 *
 * @example
 * ```ts
 * const entry: CaptureCase = {
 * 	name: 'mail opens the inbox',
 * 	mode: 'run',
 * 	tags: ['owner:pages', 'owner:pages:mail', 'pages', 'pages:mail'],
 * 	meta: { owner: 'pages:mail', states: ['inbox'], variant: 'light-390' },
 * 	result: { state: 'pass', duration: 812 },
 * }
 * ```
 */
export interface CaptureCase {
	readonly name: string
	readonly mode: string
	readonly tags: readonly string[]
	readonly meta: CaptureMeta
	readonly result?: CaptureTaskResult
}

/**
 * Supplies one case's owner, states, producing variant, and harness registration values.
 *
 * @remarks
 * An owner-bearing case derives its tags from its owner and states; a case without an owner, such
 * as the final case, names its tags.
 *
 * @example
 * ```ts
 * const input: CaptureCaseInput = { owner: 'pages:mail', states: ['inbox'], variant: 'light-390' }
 * ```
 */
export interface CaptureCaseInput {
	readonly owner?: string
	readonly states?: readonly string[]
	readonly variant: string
	readonly eligible?: boolean
	readonly timeout?: number
	readonly tags?: readonly string[]
}

/**
 * Carries the Vitest test options a capture case registers with.
 *
 * @remarks
 * `tags` is a mutable array because Vitest's `TestOptions` declares its `tags` member that way.
 *
 * @example
 * ```ts
 * const options: CaptureTestOptions = {
 * 	tags: ['owner:pages', 'owner:pages:mail', 'pages', 'pages:mail'],
 * 	meta: { owner: 'pages:mail', states: ['inbox'], variant: 'light-390' },
 * }
 * ```
 */
export interface CaptureTestOptions {
	readonly tags: string[]
	readonly meta: CaptureMeta
	readonly timeout?: number
}

/**
 * Resolves a declared state to the canonical owner path of the part that renders it.
 *
 * @remarks Throw for a state the host does not declare.
 *
 * @example
 * ```ts
 * const part: CapturePartHandler = (state) => (state.startsWith('inbox') ? 'pages:mail' : 'pages:board')
 * ```
 */
export type CapturePartHandler = (state: string) => string

/**
 * Resolves a canonical owner path to its own, shared, and behavioral source attribution.
 *
 * @remarks Throw for an owner the host does not attribute.
 *
 * @example
 * ```ts
 * const sources: CaptureSourcesHandler = (owner) => ({ own: [`src/${owner.split(':')[1]}/**`], shared: [], tests: [] })
 * ```
 */
export type CaptureSourcesHandler = (owner: string) => CaptureSources

/**
 * Supplies the host's owner population and its part and source resolvers.
 *
 * @remarks
 * `owners` lists every canonical owner path the host declares. `part` and `sources` carry the
 * product rules the package never infers.
 *
 * @example
 * ```ts
 * const rules: CaptureRules = { owners: ['pages:mail'], part: () => 'pages:mail', sources }
 * ```
 */
export interface CaptureRules {
	readonly owners: readonly string[]
	readonly part: CapturePartHandler
	readonly sources: CaptureSourcesHandler
}

/**
 * Configures the producing project and the portfolio mappings of a destination build.
 *
 * @example
 * ```ts
 * const options: CaptureDestinationOptions = { project: 'journey:light-390', portfolios: [mapping] }
 * ```
 */
export interface CaptureDestinationOptions {
	readonly project: string
	readonly portfolios: readonly CaptureMapping[]
}

/**
 * Supplies the collected cases, the destinations, and the observed and emitted states of one run record.
 *
 * @remarks
 * `observed` lists every state the run placed, whether or not it wrote a frame. `emitted` pairs
 * each written state with the path its portfolio wrote. `time` is an ISO 8601 timestamp, and
 * `request` is the runner request the wrapper provided.
 *
 * @example
 * ```ts
 * const options: CaptureRunOptions = {
 * 	cases,
 * 	registry,
 * 	observed: ['inbox'],
 * 	emitted: [['inbox', 'tmp/captures/states/pages/inbox--light-390.png']],
 * 	variant: 'light-390',
 * 	time: '2026-11-15T09:00:00.000Z',
 * }
 * ```
 */
export interface CaptureRunOptions {
	readonly cases: readonly CaptureCase[]
	readonly registry: readonly CaptureDestination[]
	readonly observed: readonly string[]
	readonly emitted: ReadonlyArray<readonly [state: string, path: string]>
	readonly variant: string
	readonly time: string
	readonly request?: CaptureRequest
}
