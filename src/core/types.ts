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
 * 	stage: 'narrow',
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
 * @example
 * ```ts
 * const request: unknown = JSON.parse(text)
 * if (isCaptureRequest(request)) request.variants // readonly string[]
 * ```
 */
export interface CaptureRequest extends CaptureSelection, CaptureIdentity {
	readonly version: 1
	readonly command: 'journey' | 'capture'
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
 * Names the journey artifact a closing case wrote and the SHA-256 of its bytes.
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
