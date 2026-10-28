import type { CaptureDeclaration, CaptureDestination, CaptureRequest, CaptureRun } from '@src/core'
import type { CaptureReadOptions, CaptureRequestOptions } from '@src/server'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import {
	arrayOf,
	holds,
	isArray,
	isError,
	isFiniteNumber,
	isFunction,
	isRecord,
	isString,
} from '@orkestrel/contract'

// The producer child in tests/fixtures/capture/Writer.ts is a plain Node process that imports this
// module, so every value import above resolves without a Vite alias and the source under test is
// never imported here.

/** Bounds, in milliseconds, a case that creates a Git workspace and spawns producer children. */
export const FIXTURE_TIMEOUT = 60_000

/** Lists the producer faults a fixture child can inject, one per refusal the engine owns. */
export const FIXTURE_FAULTS = Object.freeze([
	'missing-record',
	'invalid-record',
	'identity',
	'observations',
	'projection',
	'declarations',
	'duration',
	'stale-record',
	'stale-image',
	'failed-child',
	'own-during',
	'shared-add-during',
	'test-during',
	'outside',
	'path',
	'signal',
	'complete',
	'reference',
	'artifact',
] as const)

/** Lists the authored declaration populations a fixture child can write. */
export const FIXTURE_POPULATIONS = Object.freeze(['changed', 'partial', 'files', 'nested'] as const)

/** Lists the defective journey artifacts a fixture child can write. */
export const FIXTURE_JOURNALS = Object.freeze(['blind', 'foreign'] as const)

/** Selects one deliberately invalid external protocol reading or real filesystem mutation. */
export type FixtureFault = (typeof FIXTURE_FAULTS)[number]

/** Selects an authored declaration population with changed, partial, Files, or nested owners. */
export type FixturePopulation = (typeof FIXTURE_POPULATIONS)[number]

/** Selects a defective journey artifact: one without page trees, or one naming another run. */
export type FixtureJournal = (typeof FIXTURE_JOURNALS)[number]

/** Supplies inert declarations and output locations to the real external writer child. */
export interface FixtureWrite {
	readonly picture?: FixturePicture
	readonly population?: FixturePopulation
	readonly journal?: FixtureJournal
	readonly request?: CaptureRequest
	readonly variants: readonly string[]
	readonly report: string
	readonly records: Readonly<Record<string, string>>
	readonly capture: boolean
	readonly fault?: FixtureFault
	readonly duplicate?: boolean
	readonly vue?: boolean
}

/** Selects a scratch stage while retaining the normal transaction and child boundary. */
export interface FixtureStage {
	readonly picture?: FixturePicture
	readonly population?: FixturePopulation
	readonly journal?: FixtureJournal
	readonly command?: 'journey' | 'capture'
	readonly selector?: string
	readonly variants?: readonly string[]
	readonly case?: string
	readonly state?: string
	readonly fault?: FixtureFault
	readonly signal?: AbortSignal
}

/** Selects complete producer receipts for an isolated registry refresh. */
export interface FixtureSeed {
	readonly population?: FixturePopulation
	readonly variants?: readonly string[]
	readonly duplicate?: boolean
	readonly vue?: boolean
}

/** Pairs an exact read refusal with its discriminating engine diagnostic. */
export interface FixtureReadRefusal {
	readonly selection: CaptureReadOptions
	readonly reason: string
}

/** Supplies the bounded host input patterns every fixture project shares. */
export const INPUTS = Object.freeze([
	'src/**',
	'behavior/**',
	'fixture with spaces.config.ts',
] as const)

/** Supplies the producing variants of the fixture wrapper, in an order unlike any real host's. */
export const VARIANTS = Object.freeze(['light-1280', 'dark-1280', 'light-390', 'dark-390'] as const)

/** Names the fixture case that declares the mail screen and reader states. */
export const MAIL = 'fixture journeys mail body'

/** Names the fixture case whose title carries quotes, parentheses, and a plus sign. */
export const QUOTED = 'fixture journeys retains \'mail\' (reader) + "quotes"'

/** Names the fixture case that declares the board screen state. */
export const BOARD = 'fixture journeys board'

/** Names the fixture case whose state lands in the auxiliary focused portfolio. */
export const FILES = 'fixture journeys files'

/** Names the fixture case that declares no state and only proves behavior. */
export const BEHAVIOR = 'fixture journeys behavior'

/** Supplies the fixture's authorized physical portfolio roots. */
export const PORTFOLIOS = Object.freeze([
	Object.freeze({ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }),
	Object.freeze({
		portfolio: 'files-focused',
		directory: 'tmp/captures/files-focused',
		scoped: false,
	}),
] as const)

/** Names the physical frame of the mail screen state for the light phone variant. */
export const MAIL_IMAGE = 'tmp/captures/states/pages/mail-screen--light-390.png'

/** Holds the one valid image, a single pixel, that every fixture frame reuses. */
export const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
	'base64',
)

/** Supplies product input edits that retain distinct pixel stale classifications. */
export const PRODUCT_INPUTS = Object.freeze(['src/mail/view.ts', 'src/shared/theme.ts'] as const)

/** Supplies the two declaration populations refused at publication and read time. */
export const COLLECTION_POPULATIONS = Object.freeze(['changed', 'partial'] as const)

/** Supplies the collection receipt members whose exact bytes are bound. */
export const COLLECTION_MEMBERS = Object.freeze(['run', 'report'] as const)

/** Supplies the stale-classification edits and the status each one produces. */
export const STALE_CHANGES = Object.freeze([
	{ change: 'missing', status: 'missing' },
	{ change: 'unstamped', status: 'unstamped' },
	{ change: 'own-bytes', status: 'stale-own' },
	{ change: 'own-add', status: 'stale-own' },
	{ change: 'own-remove', status: 'stale-own' },
	{ change: 'shared-bytes', status: 'stale-shared' },
	{ change: 'shared-add', status: 'stale-shared' },
	{ change: 'shared-remove', status: 'stale-shared' },
	{ change: 'image-bytes', status: 'unstamped' },
	{ change: 'image-time', status: 'unstamped' },
	{ change: 'obsolete-owner', status: 'orphan' },
] as const)

/** Pairs each producer fault with the refusal text the engine must raise for it. */
export const FIXTURE_FAULT_MESSAGES: Readonly<Record<FixtureFault, string>> = Object.freeze({
	'missing-record': 'Missing or stale execution output: tmp/captures/states/runs/',
	'invalid-record': 'Invalid JSON document: tmp/captures/states/runs/',
	identity: 'Run identity differs from its request',
	observations: 'Run observations differ from full passed declarations',
	projection: 'Emitted entries differ from exact requested projection',
	declarations: 'Run declarations differ from full reporter declarations',
	duration: `Emitted duration differs from its producing case: ${MAIL}`,
	'stale-record': 'Missing or stale execution output: tmp/captures/states/runs/',
	'stale-image':
		'Missing or stale execution output: tmp/captures/states/pages/mail-screen--light-390.png',
	'failed-child': 'Capture stage child did not exit successfully',
	'own-during':
		'Attributed inputs or membership changed during execution: tmp/captures/states/pages/mail-screen--light-390.png',
	'shared-add-during':
		'Attribution outside the predeclared host population: tmp/captures/states/pages/mail-screen--light-390.png',
	'test-during':
		'Attributed inputs or membership changed during execution: tmp/captures/states/pages/mail-screen--light-390.png',
	outside: 'Collected registry declarations changed; run the explicit complete-registry refresh',
	path: 'Invalid or mismatched final record: tmp/captures/states/runs/',
	signal: 'Capture stage child did not exit successfully',
	complete: 'Run completeness differs from eligible results',
	reference: 'Reference completeness differs from declaring section results',
	artifact: 'Journey artifact differs from its record: tmp/journey/runs/',
})

/** Pairs each unchanged invalid read selection with its exact refusal reason. */
export const READ_REFUSALS: readonly FixtureReadRefusal[] = Object.freeze([
	{
		selection: { selector: 'pages:absent', variants: ['light-390'] },
		reason: 'Empty or unknown selector',
	},
	{ selection: { selector: 'pages:mail', variants: [] }, reason: 'Invalid capture selection' },
	{ selection: { selector: 'pages:mail', variants: ['absent'] }, reason: 'Empty selection' },
	{
		selection: { selector: 'pages:mail', variants: ['light-390'], state: 'board-screen' },
		reason: 'Empty selection',
	},
	{
		selection: { selector: 'pages:mail', variants: ['light-390'], case: BOARD },
		reason: 'Empty selection',
	},
	{
		selection: { selector: 'pages:mail', variants: ['light-390'], portfolio: 'files-focused' },
		reason: 'Empty or unknown selector',
	},
	{ selection: { selector: 'vue', portfolio: 'vue' }, reason: 'Invalid capture selection' },
])

/** Pairs published inputs with their SHA-256 digests, from a source other than the code under test. */
export const HASH_VECTORS = Object.freeze([
	{ text: '', digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
	{ text: 'abc', digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
] as const)

/** Pairs Paeth predictor inputs with the neighbor the PNG specification selects, worked by hand. */
export const PREDICTOR_CASES = Object.freeze([
	{ left: 0, up: 0, corner: 0, expected: 0 },
	{ left: 10, up: 20, corner: 10, expected: 20 },
	{ left: 5, up: 5, corner: 5, expected: 5 },
	{ left: 100, up: 50, corner: 120, expected: 50 },
	{ left: 9, up: 8, corner: 10, expected: 8 },
	{ left: 10, up: 10, corner: 0, expected: 10 },
	{ left: 0, up: 10, corner: 0, expected: 10 },
	{ left: 4, up: 8, corner: 6, expected: 6 },
] as const)

/** Pairs a filtered scanline with the row its filter reconstructs, worked by hand. */
export const UNFILTER_CASES = Object.freeze([
	{ filter: 0, line: [1, 2, 3, 4], above: undefined, channels: 1, expected: [1, 2, 3, 4] },
	{ filter: 1, line: [1, 1, 1, 1], above: undefined, channels: 1, expected: [1, 2, 3, 4] },
	{
		filter: 1,
		line: [1, 2, 1, 2, 1, 2],
		above: undefined,
		channels: 2,
		expected: [1, 2, 2, 4, 3, 6],
	},
	{ filter: 2, line: [1, 2, 3], above: [10, 20, 30], channels: 1, expected: [11, 22, 33] },
	{ filter: 3, line: [5, 5], above: [10, 20], channels: 1, expected: [10, 20] },
	{ filter: 4, line: [5, 5], above: [10, 20], channels: 1, expected: [15, 25] },
	{ filter: 2, line: [200], above: [100], channels: 1, expected: [44] },
] as const)

/** Holds scanlines that use the Sub, Up, Average, and Paeth filters and the pixels they reconstruct. */
export const FILTERED_PICTURE = Object.freeze({
	width: 2,
	height: 4,
	rows: [
		[1, 10, 20, 30, 1, 2, 3],
		[2, 1, 1, 1, 1, 1, 1],
		[3, 0, 0, 0, 0, 0, 0],
		[4, 1, 2, 3, 4, 5, 6],
	],
	pixels: [
		10, 20, 30, 11, 22, 33, 11, 21, 31, 12, 23, 34, 5, 10, 15, 8, 16, 24, 6, 12, 18, 12, 21, 30,
	],
} as const)

/** Holds RGBA scanlines whose alpha channel the reader drops, and the RGB pixels it keeps. */
export const ALPHA_PICTURE = Object.freeze({
	width: 1,
	height: 2,
	rows: [
		[0, 10, 20, 30, 255],
		[0, 40, 50, 60, 128],
	],
	pixels: [10, 20, 30, 40, 50, 60],
} as const)

/**
 * Checks the private child fixture transport before it writes any output.
 *
 * @param value - The decoded fixture request
 * @returns True if the transport is complete; false otherwise
 */
export function isFixtureWrite(value: unknown): value is FixtureWrite {
	return holds(
		() =>
			isRecord(value) &&
			(value.request === undefined || isFixtureRequest(value.request)) &&
			arrayOf(isString)(value.variants) &&
			isString(value.report) &&
			isRecord(value.records) &&
			Object.values(value.records).every(isString) &&
			typeof value.capture === 'boolean' &&
			(value.picture === undefined || isFixturePicture(value.picture)) &&
			(value.population === undefined ||
				FIXTURE_POPULATIONS.some((name) => name === value.population)) &&
			(value.journal === undefined || FIXTURE_JOURNALS.some((name) => name === value.journal)) &&
			(value.vue === undefined || typeof value.vue === 'boolean') &&
			(value.duplicate === undefined || typeof value.duplicate === 'boolean') &&
			(value.fault === undefined || FIXTURE_FAULTS.some((name) => name === value.fault)),
	)
}

/**
 * Checks the request the private transport carries without importing the source under test.
 *
 * @param value - The decoded request
 * @returns True if the request carries every field the writer reads; false otherwise
 */
export function isFixtureRequest(value: unknown): value is CaptureRequest {
	return holds(
		() =>
			isRecord(value) &&
			value.version === 1 &&
			isString(value.id) &&
			isString(value.stage) &&
			typeof value.pid === 'number' &&
			isString(value.config) &&
			(value.command === 'journey' || value.command === 'capture') &&
			isString(value.selector) &&
			(value.case === undefined || isString(value.case)) &&
			(value.state === undefined || isString(value.state)) &&
			arrayOf(isString)(value.variants) &&
			arrayOf(isString)(value.args),
	)
}

/**
 * Supplies full fixture declarations, including behavior-only and inapplicable cases.
 *
 * @param variant - The producing variant
 * @param vue - If `true`, supplies the separate Vue population; if `false`, supplies browser owners
 * @returns The authored external case population
 */
export function fixtureDeclarations(variant: string, vue = false): readonly CaptureDeclaration[] {
	if (vue)
		return [
			{
				case: 'vue fixture home',
				owner: 'vue:home',
				variant,
				eligible: true,
				states: ['vue-home'],
			},
		]
	return [
		{
			case: MAIL,
			owner: 'pages:mail',
			variant,
			eligible: true,
			states: ['mail-screen', 'mail-reader'],
		},
		{ case: QUOTED, owner: 'pages:mail', variant, eligible: true, states: ['mail-quotes'] },
		{ case: BOARD, owner: 'examples:board', variant, eligible: true, states: ['board-screen'] },
		{
			case: FILES,
			owner: 'examples:files',
			variant,
			eligible: ['light-390', 'dark-1280'].includes(variant),
			states: ['files-reading'],
		},
		{
			case: BEHAVIOR,
			owner: 'pages:mail',
			variant,
			eligible: true,
			states: [],
		},
	]
}

/**
 * Supplies the fixture's physical mapping, independently of the engine's key and path helpers.
 *
 * @param declarations - The complete authored case population
 * @returns The eligible output population with explicit own, shared, and test attribution
 * @throws Thrown when a declaration owner is not a scope and part pair.
 */
export function fixtureDestinations(
	declarations: readonly CaptureDeclaration[],
): readonly CaptureDestination[] {
	return declarations
		.filter((entry) => entry.eligible)
		.flatMap((entry) =>
			entry.states.map((state) => {
				const [scope, part, section] = entry.owner.split(':')
				if (scope === undefined || part === undefined) throw new Error('Invalid fixture owner')
				const focused = entry.case === FILES && state === 'files-reading'
				const vue = scope === 'vue'
				const variant = focused ? `${entry.variant.split('-')[0]}-320` : entry.variant
				return {
					portfolio: vue ? 'vue' : focused ? 'files-focused' : 'states',
					state,
					scope,
					part,
					...(section === undefined ? {} : { section }),
					variant,
					project: `${vue ? 'vue' : 'journey'}:${entry.variant}`,
					case: entry.case,
					file: vue
						? `tmp/captures/vue/${state}--${variant}.png`
						: focused
							? `tmp/captures/files-focused/${state}--${variant}.png`
							: `tmp/captures/states/${scope}/${state}--${variant}.png`,
					sources: {
						own: [scope === 'pages' ? 'src/mail/**' : 'src/board/**'],
						shared: ['src/shared/**'],
						tests: ['behavior/**', 'fixture with spaces.config.ts'],
					},
				}
			}),
		)
}

/**
 * Writes a real external reporter, final records, and PNG bytes from inert fixture data.
 *
 * @param input - The requested external outputs and optional negative control
 * @remarks It implements only the producer protocol; the engine owns validation and publication.
 */
export function writeFixtureOutputs(input: FixtureWrite): void {
	const start = Date.now()
	const reports = input.variants.map((variant) => {
		const authored = fixtureDeclarations(variant, input.vue)
		const declarations =
			input.population === 'nested'
				? authored.map((entry) =>
						entry.case === MAIL ? { ...entry, owner: 'pages:mail:inbox' } : entry,
					)
				: input.population === 'partial'
					? authored.slice(1)
					: input.population === 'changed'
						? authored.map((entry) =>
								entry.case === MAIL ? { ...entry, states: [...entry.states, 'mail-extra'] } : entry,
							)
						: input.population === 'files'
							? authored.map((entry) =>
									entry.case === FILES
										? { ...entry, states: [...entry.states, 'files-empty'] }
										: entry,
								)
							: authored
		const full = input.duplicate
			? [
					...declarations,
					{
						...declarations[0],
						case: 'duplicate fixture case',
						owner: 'pages:mail',
						variant,
						eligible: true,
						states: ['mail-screen'],
					},
				]
			: declarations
		if (
			typeof input.picture === 'object' &&
			Object.keys(input.picture).some(
				(state) => !full.some((entry) => entry.states.includes(state)),
			)
		)
			throw new Error('Fixture geometry names an undeclared state')
		const registry = fixtureDestinations(full)
		const request = input.request
		const passed = full.filter(
			(entry) =>
				entry.eligible &&
				(request === undefined ||
					((request.selector === 'all' ||
						entry.owner === request.selector ||
						entry.owner.startsWith(`${request.selector}:`)) &&
						(request.case === undefined || request.case === entry.case) &&
						(request.command === 'journey' || entry.states.length > 0))),
		)
		const emitted = input.capture
			? registry
					.filter(
						(entry) =>
							passed.some((test) => test.case === entry.case) &&
							(request?.state === undefined || request.state === entry.state),
					)
					.map((entry) => ({ ...entry, duration: 1 }))
			: []
		if (input.fault !== 'stale-image')
			for (const entry of emitted) {
				mkdirSync(dirname(resolve(entry.file)), { recursive: true })
				const geometry =
					typeof input.picture === 'object'
						? (input.picture[entry.state] ?? FIXTURE_GEOMETRY)
						: FIXTURE_GEOMETRY
				writeFileSync(
					entry.file,
					input.picture === undefined || input.picture === false
						? PNG
						: encodeFixturePicture(geometry, entry.state, entry.variant),
				)
			}
		const record = input.records[variant]
		if (record === undefined) throw new Error('Missing fixture record path')
		const complete = full.filter((entry) => entry.eligible).length === passed.length
		// A capture runs only the cases that place states, so its header reads complete once every such case ran.
		const covered =
			request?.command === 'capture'
				? full.filter((entry) => entry.eligible && entry.states.length > 0).length === passed.length
				: complete
		// The artifact mirrors the final case's coverage header and record binding, in one file per
		// invocation beside the per-variant copy a later run replaces.
		const invocation =
			request === undefined ? basename(dirname(record)) : `${request.id}/${request.stage}`
		const artifact = `tmp/journey/runs/${invocation}/${variant}.txt`
		const copy = `tmp/journey/${variant}${complete ? '' : '-scoped'}.txt`
		const journal = [
			`# ${variant}`,
			`coverage=${covered ? 'complete' : request?.case === undefined ? 'scoped' : 'case-scoped'}`,
			`record=${input.journal === 'foreign' ? `${record}.foreign` : record}`,
			...(input.journal === 'foreign' ? [] : passed.map((entry) => `case-ran=${entry.case}`)),
			'',
		].join('\n')
		for (const file of [artifact, copy]) {
			mkdirSync(dirname(resolve(file)), { recursive: true })
			writeFileSync(file, journal)
		}
		const run: CaptureRun = {
			version: 1,
			...(request === undefined
				? {}
				: {
						request,
						identity: {
							id: request.id,
							stage: request.stage,
							pid: request.pid,
							config: request.config,
						},
					}),
			variant,
			time: new Date().toISOString(),
			complete,
			reference: false,
			artifact: {
				file: artifact,
				digest: createHash('sha256').update(journal).digest('hex'),
			},
			declarations: full,
			registry,
			passed: passed.map((entry) => entry.case),
			observed: passed.flatMap((entry) => entry.states),
			entries: emitted,
		}
		const mutated =
			input.fault === 'identity'
				? { ...run, identity: { ...run.identity, id: 'foreign' } }
				: input.fault === 'observations'
					? { ...run, observed: run.observed.slice(1) }
					: input.fault === 'projection'
						? { ...run, entries: run.entries.slice(1) }
						: input.fault === 'declarations'
							? { ...run, declarations: run.declarations.slice(1) }
							: input.fault === 'duration'
								? { ...run, entries: run.entries.map((entry) => ({ ...entry, duration: 2 })) }
								: input.fault === 'stale-record'
									? { ...run, time: new Date(0).toISOString() }
									: input.fault === 'outside'
										? {
												...run,
												registry: run.registry.map((entry) => ({
													...entry,
													sources: { ...entry.sources, own: ['outside.ts'] },
												})),
												entries: run.entries.map((entry) => ({
													...entry,
													sources: { ...entry.sources, own: ['outside.ts'] },
												})),
											}
										: input.fault === 'path'
											? {
													...run,
													entries: run.entries.map((entry) => ({
														...entry,
														file: '../escape.png',
													})),
												}
											: input.fault === 'complete'
												? { ...run, complete: !run.complete }
												: input.fault === 'reference'
													? { ...run, reference: !run.reference }
													: input.fault === 'artifact'
														? {
																...run,
																artifact: {
																	file: artifact,
																	digest: createHash('sha256')
																		.update(`${journal}another run\n`)
																		.digest('hex'),
																},
															}
														: run
		if (input.fault !== 'missing-record' || variant !== input.variants.at(-1)) {
			mkdirSync(dirname(resolve(record)), { recursive: true })
			writeFileSync(record, input.fault === 'invalid-record' ? '{' : JSON.stringify(mutated))
			if (input.fault === 'stale-record') utimesSync(record, new Date(0), new Date(0))
		}
		return {
			name: `fixture-${variant}.test.ts`,
			status: 'passed',
			startTime: start,
			endTime: Date.now(),
			assertionResults: full.map((entry) => ({
				fullName: entry.case,
				status: passed.some((test) => test.case === entry.case) ? 'passed' : 'pending',
				duration: 1,
				meta: { owner: entry.owner, variant, eligible: entry.eligible, states: entry.states },
			})),
		}
	})
	if (input.fault === 'own-during') writeFileSync('src/mail/view.ts', randomUUID())
	if (input.fault === 'shared-add-during') writeFileSync('src/shared/new.ts', randomUUID())
	if (input.fault === 'test-during') writeFileSync('behavior/journeys.ts', randomUUID())
	mkdirSync(dirname(resolve(input.report)), { recursive: true })
	writeFileSync(
		input.report,
		JSON.stringify({
			success: true,
			numFailedTests: 0,
			numFailedTestSuites: 0,
			startTime: start,
			testResults: reports,
		}),
	)
	if (input.fault === 'failed-child') process.exitCode = 7
	if (input.fault === 'signal') process.kill(process.pid, 'SIGTERM')
}

/**
 * Reads exact inherited manifest bytes for failure and journey comparisons.
 *
 * @param root - The scratch workspace
 * @returns The exact text, or `undefined` before the first capture
 */
export function readFixtureManifest(root: string): string | undefined {
	try {
		return readFileSync(resolve(root, 'tmp/captures/states/manifest.json'), 'utf8')
	} catch (error) {
		if (isError(error) && 'code' in error && error.code === 'ENOENT') return undefined
		throw error
	}
}

/** Names the request directory, relative to the workspace, that the non-Veneer consumer declares. */
export const RUNNER_REQUESTS = 'var/requests'

/** Holds the final case's full name, which carries regular-expression punctuation. */
export const RUNNER_FINAL = 'closes [all] (states) + writes a.b*'

/** Lists the commands that start a Vitest process, in the order the runner proofs cover them. */
export const RUNNER_COMMANDS = Object.freeze(['journey', 'capture'] as const)

/** Describes one command-line refusal the runner makes before it spawns an execution child. */
export interface RunnerRefusal {
	readonly title: string
	readonly args: readonly string[]
	readonly message: string
}

/** Lists the command-line refusals both Vitest commands make, each read through exit 64. */
export const RUNNER_REFUSALS: readonly RunnerRefusal[] = Object.freeze([
	{ title: 'bare invocation', args: [], message: 'Selectors:' },
	{ title: 'unknown scope', args: ['missing'], message: 'Unknown scope: missing' },
	{ title: 'unknown owner', args: ['pages:missing'], message: 'Unknown owner: missing' },
	{ title: 'unknown deep owner', args: ['pages:mail:deep'], message: 'Unknown owner: deep' },
	{
		title: 'unknown variant',
		args: ['pages:mail', '--variant', 'missing'],
		message: 'Unknown variant: missing',
	},
	{
		title: 'repeated variant',
		args: ['pages:mail', '--variant', 'light-390', '--variant', 'light-390'],
		message: 'Repeated variant',
	},
	{
		title: 'invalid variant identity',
		args: ['pages:mail', '--variant', 'light 390'],
		message: 'Invalid variant identity',
	},
	{
		title: 'unsupported flag',
		args: ['pages:mail', '--mode', 'vue'],
		message: "Unknown option '--mode'",
	},
	{
		title: 'missing option value',
		args: ['pages:mail', '--variant'],
		message: "Option '--variant <value>' argument missing",
	},
	{
		title: 'repeated option',
		args: ['pages:mail', '--case', 'a', '--case', 'b'],
		message: 'Repeated option: --case',
	},
	{
		title: 'second selector',
		args: ['pages:mail', 'examples'],
		message: 'Expected exactly one selector',
	},
	{ title: 'blank case', args: ['pages:mail', '--case', ' '], message: 'Empty case name' },
	{
		title: 'portfolio flag',
		args: ['pages:mail', '--portfolio', 'vue'],
		message: "Unknown option '--portfolio'",
	},
])

/**
 * Reports whether this host can deliver a signal that a process group receives.
 *
 * @remarks
 * Windows has no signal a process group can receive: `process.kill(pid, 'SIGINT')` ends the target
 * without running its handler (portability § Processes), so the external-signal reading needs a
 * POSIX host and is recorded as a limit elsewhere.
 */
export const SUPPORTS_GROUP_SIGNAL = process.platform !== 'win32'

/** Names the wrapper path every wire request fixture records. */
export const WIRE_CONFIG = 'configs/bench.config.ts'

/** Lists the owner paths the wire request fixtures' wrapper declares. */
export const WIRE_OWNERS = Object.freeze(['app:mail', 'app:board', 'tools:search'] as const)

/** Lists the variant names the wire request fixtures' wrapper declares. */
export const WIRE_VARIANTS = Object.freeze(['wide', 'compact', 'phone'] as const)

/** Lists request file bytes that are not a record, each of which a wrapper refuses and names. */
export const WIRE_BYTES = Object.freeze(['{"pid":', 'null', '[]', '42', '"text"'] as const)

/**
 * Creates the plain record a runner writes for its child, with fields replaced by a patch.
 *
 * @param ppid - The runner process id the request names
 * @param argv - The exact child arguments the request records
 * @param patch - Fields that replace or add to the defaults; an `undefined` value omits the field
 * @returns A request record that passes every check for a capture of `app:mail`
 */
export function createWireRequest(
	ppid: number,
	argv: readonly string[],
	patch: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries({
			version: 1,
			id: 'wire-1',
			stage: 'narrow',
			config: WIRE_CONFIG,
			pid: ppid,
			command: 'capture',
			selector: 'app:mail',
			variants: ['compact'],
			args: argv,
			...patch,
		}).filter(([, value]) => value !== undefined),
	)
}

/**
 * Creates the options a wrapper passes to read its parent's request, for the wire fixtures' wrapper.
 *
 * @param directory - The absolute directory that holds request files
 * @param ppid - The parent process id
 * @param argv - The process arguments the request must record
 * @returns Options naming the wire fixtures' owners, variants, and wrapper path
 */
export function createWireOptions(
	directory: string,
	ppid: number,
	argv: readonly string[],
): CaptureRequestOptions {
	return {
		ppid,
		argv,
		directory,
		config: WIRE_CONFIG,
		owners: [...WIRE_OWNERS],
		variants: [...WIRE_VARIANTS],
	}
}

/** Describes one field patch that a wrapper refuses in an otherwise valid request. */
export interface WireRefusal {
	readonly title: string
	readonly patch: Readonly<Record<string, unknown>>
	readonly message: string
}

/** Lists the field patches a wrapper refuses, each with the refusal it names. */
export const WIRE_REFUSALS: readonly WireRefusal[] = Object.freeze([
	{ title: 'a different version', patch: { version: 2 }, message: 'invalid version' },
	{ title: 'a missing version', patch: { version: undefined }, message: 'invalid version' },
	{
		title: 'an identity with a separator',
		patch: { id: '../request' },
		message: 'invalid identity',
	},
	{ title: 'a reserved device identity', patch: { id: 'CON' }, message: 'invalid identity' },
	{ title: 'an empty stage', patch: { stage: '' }, message: 'invalid identity' },
	{ title: 'a numeric stage', patch: { stage: 4 }, message: 'invalid identity' },
	{
		title: 'another wrapper',
		patch: { config: 'configs/other.config.ts' },
		message: 'invalid config',
	},
	{ title: 'an empty state', patch: { state: '' }, message: 'invalid state' },
	{ title: 'a numeric state', patch: { state: 42 }, message: 'invalid state' },
	{
		title: 'a state on a journey',
		patch: { command: 'journey', state: 'inbox' },
		message: 'invalid state',
	},
	{
		title: 'an unknown command',
		patch: { command: 'stale' },
		message: 'invalid command, selector, variants, or case',
	},
	{
		title: 'a selector no owner carries',
		patch: { selector: 'app:missing' },
		message: 'invalid command, selector, variants, or case',
	},
	{
		title: 'a selector that only shares a prefix',
		patch: { selector: 'app:mai' },
		message: 'invalid command, selector, variants, or case',
	},
	{
		title: 'a blank selector',
		patch: { selector: ' ' },
		message: 'invalid command, selector, variants, or case',
	},
	{
		title: 'an undeclared variant',
		patch: { variants: ['missing'] },
		message: 'invalid command, selector, variants, or case',
	},
	{
		title: 'no variant',
		patch: { variants: [] },
		message: 'invalid command, selector, variants, or case',
	},
	{
		title: 'a repeated variant',
		patch: { variants: ['wide', 'wide'] },
		message: 'invalid command, selector, variants, or case',
	},
	{
		title: 'a numeric case',
		patch: { case: 42 },
		message: 'invalid command, selector, variants, or case',
	},
	{
		title: 'a blank case',
		patch: { case: ' ' },
		message: 'invalid command, selector, variants, or case',
	},
])

/**
 * Creates a Vitest project `test` configuration for a non-Veneer wrapper, with fields replaced.
 *
 * @param overrides - A replacement `name` or `tags`, and fields that replace the provided values; an `undefined` value omits the field
 * @returns A configuration that passes every check
 */
export function createProjectFixture(
	overrides: {
		readonly name?: unknown
		readonly tags?: unknown
		readonly provide?: Readonly<Record<string, unknown>>
	} = {},
): Record<string, unknown> {
	return {
		name: 'name' in overrides ? overrides.name : 'bench:wide',
		tags: 'tags' in overrides ? overrides.tags : [{ name: 'owner:app' }, { name: 'app' }],
		provide: {
			variant: 'wide',
			variants: [{ name: 'wide' }, { name: 'compact' }],
			directory: '/workspace/out/frames',
			record: 'out/frames/runs/direct-1/wide.json',
			inputs: ['lib/**'],
			final: RUNNER_FINAL,
			first: 'compact',
			portfolios: [{ portfolio: 'frames', directory: 'out/frames', scoped: true }],
			...overrides.provide,
		},
	}
}

/** Describes one malformed project configuration and the refusal it earns. */
export interface ProjectRefusal {
	readonly title: string
	readonly overrides: Parameters<typeof createProjectFixture>[0]
	readonly message: string
	readonly code: 'HOST' | 'EVIDENCE'
}

/** Lists the malformed project configurations a runner refuses, each with its refusal and code. */
export const PROJECT_REFUSALS: readonly ProjectRefusal[] = Object.freeze([
	{
		title: 'a numeric name',
		overrides: { name: 42 },
		message: 'Unsupported journey project name',
		code: 'HOST',
	},
	{
		title: 'a label that is not a string',
		overrides: { name: { label: 1 } },
		message: 'Unsupported journey project name',
		code: 'HOST',
	},
	{
		title: 'no name',
		overrides: { name: undefined },
		message: 'Unsupported journey project name',
		code: 'HOST',
	},
	{
		title: 'a tag with a space',
		overrides: { tags: [{ name: 'bad tag' }] },
		message: 'invalid tag name',
		code: 'HOST',
	},
	{
		title: 'a tag with an operator character',
		overrides: { tags: [{ name: 'a&b' }] },
		message: 'invalid tag name',
		code: 'HOST',
	},
	{
		title: 'a tag that is a filter word',
		overrides: { tags: [{ name: 'and' }] },
		message: 'invalid tag name',
		code: 'HOST',
	},
	{
		title: 'a tag that is not a string',
		overrides: { tags: [{ name: 1 }] },
		message: 'invalid tag name',
		code: 'HOST',
	},
	{
		title: 'no variants',
		overrides: { provide: { variants: undefined } },
		message: 'provides no variants',
		code: 'HOST',
	},
	{
		title: 'a nameless variant',
		overrides: { provide: { variants: [{}] } },
		message: 'variant has no name',
		code: 'HOST',
	},
	{
		title: 'no directory',
		overrides: { provide: { directory: undefined } },
		message: 'no bounded integrity host declaration',
		code: 'HOST',
	},
	{
		title: 'no record',
		overrides: { provide: { record: 3 } },
		message: 'no bounded integrity host declaration',
		code: 'HOST',
	},
	{
		title: 'an input that leaves the repository',
		overrides: { provide: { inputs: ['../outside/**'] } },
		message: 'no bounded integrity host declaration',
		code: 'HOST',
	},
	{
		title: 'a variant that is no portable identity',
		overrides: { provide: { variants: [{ name: 'wide 1' }, { name: 'compact' }] } },
		message: 'invalid identity',
		code: 'HOST',
	},
	{
		title: 'variants that differ only by case',
		overrides: { provide: { variants: [{ name: 'wide' }, { name: 'Wide' }, { name: 'compact' }] } },
		message: 'Duplicate journey variants',
		code: 'EVIDENCE',
	},
	{
		title: 'an own variant the wrapper does not declare',
		overrides: { provide: { variant: 'phone' } },
		message: 'provides no declared variant',
		code: 'HOST',
	},
	{
		title: 'no own variant',
		overrides: { provide: { variant: undefined } },
		message: 'provides no declared variant',
		code: 'HOST',
	},
	{
		title: 'a first variant the wrapper does not declare',
		overrides: { provide: { first: 'phone' } },
		message: 'no first-stage variant',
		code: 'HOST',
	},
	{
		title: 'no final case',
		overrides: { provide: { final: undefined } },
		message: 'no final case',
		code: 'HOST',
	},
	{
		title: 'a blank final case',
		overrides: { provide: { final: ' ' } },
		message: 'no final case',
		code: 'HOST',
	},
	{
		title: 'a uniform declaration that is not a list',
		overrides: { provide: { uniform: 'pages' } },
		message: 'uniform scopes must be a list of valid owner selectors',
		code: 'HOST',
	},
	{
		title: 'a null uniform declaration',
		overrides: { provide: { uniform: null } },
		message: 'uniform scopes must be a list of valid owner selectors',
		code: 'HOST',
	},
	{
		title: 'a non-string uniform scope',
		overrides: { provide: { uniform: [42] } },
		message: 'uniform scopes must be a list of valid owner selectors',
		code: 'HOST',
	},
	{
		title: 'an empty uniform selector',
		overrides: { provide: { uniform: [''] } },
		message: 'uniform scopes must be a list of valid owner selectors',
		code: 'HOST',
	},
	{
		title: 'a malformed uniform selector',
		overrides: { provide: { uniform: ['pages::mail'] } },
		message: 'uniform scopes must be a list of valid owner selectors',
		code: 'HOST',
	},
	{
		title: 'a uniform scope with whitespace',
		overrides: { provide: { uniform: ['pages mail'] } },
		message: 'uniform scopes must be a list of valid owner selectors',
		code: 'HOST',
	},
	{
		title: 'a repeated uniform scope',
		overrides: { provide: { uniform: ['pages', 'pages'] } },
		message: 'Duplicate uniform scopes',
		code: 'EVIDENCE',
	},
	{
		title: 'no portfolio list',
		overrides: { provide: { portfolios: undefined } },
		message: 'provides no portfolios',
		code: 'HOST',
	},
	{
		title: 'an empty portfolio list',
		overrides: { provide: { portfolios: [] } },
		message: 'no portfolio roots',
		code: 'HOST',
	},
	{
		title: 'a portfolio name that is no portable identity',
		overrides: {
			provide: { portfolios: [{ portfolio: 'a b', directory: 'out/a', scoped: true }] },
		},
		message: 'invalid portfolios root',
		code: 'HOST',
	},
	{
		title: 'a portfolio directory that leaves the repository',
		overrides: { provide: { portfolios: [{ portfolio: 'a', directory: '../a', scoped: true }] } },
		message: 'invalid portfolios root',
		code: 'HOST',
	},
	{
		title: 'a portfolio without a scoped flag',
		overrides: { provide: { portfolios: [{ portfolio: 'a', directory: 'out/a' }] } },
		message: 'invalid portfolios root',
		code: 'HOST',
	},
	{
		title: 'portfolios that differ only by case',
		overrides: {
			provide: {
				portfolios: [
					{ portfolio: 'a', directory: 'out/a', scoped: true },
					{ portfolio: 'A', directory: 'out/b', scoped: false },
				],
			},
		},
		message: 'Duplicate portfolios',
		code: 'EVIDENCE',
	},
	{
		title: 'a malformed standalone root',
		overrides: { provide: { standalone: [{ portfolio: 'g' }] } },
		message: 'invalid standalone portfolios root',
		code: 'HOST',
	},
	{
		title: 'a standalone root that is not a list',
		overrides: { provide: { standalone: 'gallery' } },
		message: 'provides no standalone portfolios',
		code: 'HOST',
	},
	{
		title: 'a standalone root named like a primary one',
		overrides: {
			provide: { standalone: [{ portfolio: 'frames', directory: 'out/other', scoped: false }] },
		},
		message: 'Duplicate portfolio names',
		code: 'EVIDENCE',
	},
])

/** Describes one command line the argument reader refuses. */
export interface ArgumentRefusal {
	readonly title: string
	readonly command: 'journey' | 'capture' | 'stale'
	readonly argv: readonly string[]
	readonly message: string
}

/** Lists the command lines the argument reader refuses, each with the command that refuses it. */
export const ARGUMENT_REFUSALS: readonly ArgumentRefusal[] = Object.freeze([
	{
		title: 'a state under journey',
		command: 'journey',
		argv: ['app', '--state', 'inbox'],
		message: "Unknown option '--state'",
	},
	{
		title: 'a portfolio under journey',
		command: 'journey',
		argv: ['app', '--portfolio', 'gallery'],
		message: "Unknown option '--portfolio'",
	},
	{
		title: 'a portfolio under capture',
		command: 'capture',
		argv: ['app', '--portfolio', 'gallery'],
		message: "Unknown option '--portfolio'",
	},
	{
		title: 'an unknown flag',
		command: 'stale',
		argv: ['app', '--mode', 'vue'],
		message: "Unknown option '--mode'",
	},
	{
		title: 'a flag at the end',
		command: 'journey',
		argv: ['app', '--case'],
		message: "Option '--case <value>' argument missing",
	},
	{
		title: 'a flag followed by a flag',
		command: 'journey',
		argv: ['app', '--case', '--variant', 'wide'],
		message: "Option '--case' argument is ambiguous",
	},
	{
		title: 'a flag with an empty value',
		command: 'journey',
		argv: ['app', '--variant', ''],
		message: 'Missing value: --variant',
	},
	{
		title: 'a repeated single flag',
		command: 'capture',
		argv: ['app', '--state', 'a', '--state', 'b'],
		message: 'Repeated option: --state',
	},
	{
		title: 'a repeated config',
		command: 'journey',
		argv: ['app', '--config', 'a', '--config', 'b'],
		message: 'Repeated option: --config',
	},
	{
		title: 'two selectors',
		command: 'journey',
		argv: ['app', 'tools'],
		message: 'Expected exactly one selector',
	},
	{
		title: 'a repeated variant',
		command: 'stale',
		argv: ['app', '--variant', 'wide', '--variant', 'wide'],
		message: 'Repeated variant',
	},
	{
		title: 'a variant that is no portable identity',
		command: 'journey',
		argv: ['app', '--variant', 'wide/1'],
		message: 'Invalid variant identity',
	},
	{
		title: 'a state that is no portable identity',
		command: 'capture',
		argv: ['app', '--state', 'a b'],
		message: 'Invalid state identity',
	},
	{
		title: 'a blank case',
		command: 'journey',
		argv: ['app', '--case', '  '],
		message: 'Empty case name',
	},
])

/**
 * Runs a callback with environment variables set, then restores each one to its earlier value.
 *
 * @param overrides - The variables to set for the callback
 * @param callback - The work that reads the process environment
 * @returns The callback's result after the environment is restored
 */
export async function withEnvironment<T>(
	overrides: Readonly<Record<string, string>>,
	callback: () => Promise<T>,
): Promise<T> {
	const previous = Object.keys(overrides).map((name) => ({ name, value: process.env[name] }))
	for (const [name, value] of Object.entries(overrides)) process.env[name] = value
	try {
		return await callback()
	} finally {
		for (const { name, value } of previous) {
			if (value === undefined) delete process.env[name]
			else process.env[name] = value
		}
	}
}

/** Supplies test-only encoded pixel dimensions, without declaring a capture mode. */
export interface FixtureGeometry {
	readonly width: number
	readonly height: number
}

/** Keeps the tiny default image choice or varies the geometry of existing fixture states. */
export type FixturePicture = boolean | Readonly<Record<string, FixtureGeometry>>

/** Holds the geometry every fixture frame has when a picture is requested without a state map. */
export const FIXTURE_GEOMETRY: FixtureGeometry = Object.freeze({ width: 128, height: 128 })

/** Lists the readers the reader proofs drive, each against the same selection. */
export const READER_COMMANDS = Object.freeze(['preflight', 'contact-sheets'] as const)

/** Names one reader the reader proofs drive. */
export type ReaderCommand = (typeof READER_COMMANDS)[number]

/** Supplies distinct image dimensions for mixed observations and contact-sheet artifacts. */
export const MIXED_PICTURES: Readonly<Record<string, FixtureGeometry>> = Object.freeze({
	'mail-screen': Object.freeze({ width: 128, height: 256 }),
	'mail-reader': Object.freeze({ width: 128, height: 128 }),
})

/** Describes one uniform declaration beside the observations it admits. */
export interface UniformDeclaration {
	readonly title: string
	readonly uniform: readonly string[] | undefined
	readonly observations: readonly string[]
}

/** Supplies uniform declarations beside the observations each admits over mixed owner families. */
export const UNIFORM_DECLARATIONS: readonly UniformDeclaration[] = Object.freeze([
	{
		title: 'an absent declaration',
		uniform: undefined,
		observations: [
			'Mixed framing: states/pages:mail@128: page, viewport',
			'Mixed framing: states/examples:board@128: page, viewport',
		],
	},
	{
		title: 'one declared scope',
		uniform: ['pages'],
		observations: ['Mixed framing: states/pages:mail@128: page, viewport'],
	},
	{
		title: 'a declared owner prefix',
		uniform: ['pages:mail'],
		observations: ['Mixed framing: states/pages:mail@128: page, viewport'],
	},
	{ title: 'a prefix without a colon boundary', uniform: ['page'], observations: [] },
	{ title: 'an empty declaration', uniform: [], observations: [] },
])

/** Supplies invalid pixel widths beside valid image restoration controls. */
export const INVALID_PICTURE_WIDTHS = Object.freeze([0, 2049, 1.5] as const)

/** Names the wrapper file the reader fixture writes into its workspace. */
export const READER_CONFIG = 'fixture with spaces.config.ts'

/** Names the journey artifact directory, relative to the workspace, the producer child writes. */
export const READER_JOURNEYS = 'tmp/journey'

/** Names the standalone portfolio root the reader fixture's wrapper declares beside its primary roots. */
export const READER_STANDALONE = Object.freeze({
	portfolio: 'vue',
	directory: 'tmp/captures/vue',
	scoped: false,
} as const)

/** Names the final case of the reader fixture's wrapper, which the producer never runs. */
export const READER_FINAL = 'fixture journeys close the run'

/**
 * Checks bounded test pixel dimensions while preserving the boolean image choices.
 *
 * @param value - The private writer's image data
 * @returns True for a boolean or a nonempty state map with integer axes from 1 through 2048
 */
export function isFixturePicture(value: unknown): value is FixturePicture {
	return holds(
		() =>
			typeof value === 'boolean' ||
			(isRecord(value) &&
				Object.keys(value).length > 0 &&
				Object.values(value).every(
					(geometry) =>
						isRecord(geometry) &&
						isFiniteNumber(geometry.width) &&
						Number.isSafeInteger(geometry.width) &&
						geometry.width >= 1 &&
						geometry.width <= 2048 &&
						isFiniteNumber(geometry.height) &&
						Number.isSafeInteger(geometry.height) &&
						geometry.height >= 1 &&
						geometry.height <= 2048,
				)),
	)
}

/**
 * Encodes one four-byte big-endian word, with no import from the source under test.
 *
 * @param value - An integer from 0 through 4294967295
 * @returns The four bytes, most significant first
 */
export function encodeFixtureWord(value: number): Buffer {
	return Buffer.from([24, 16, 8, 0].map((shift) => (value >>> shift) & 255))
}

/**
 * Encodes one checked PNG chunk, with no import from the source under test.
 *
 * @param name - The four-byte chunk name
 * @param data - The chunk payload
 * @returns Header, payload, and checksum bytes
 */
export function encodeFixtureChunk(name: string, data: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(name, 'latin1'), data])
	return Buffer.concat([encodeFixtureWord(data.length), body, encodeFixtureWord(crc32(body) >>> 0)])
}

/**
 * Encodes a deterministic RGB frame whose bytes depend on its state and variant, stored uncompressed.
 *
 * @remarks
 * The producer child runs in plain Node, so this encoder imports no source module. Stored
 * scanlines keep a 128 pixel frame above the reader's four kilobyte floor, and the bytes differ
 * between states and variants so no two frames are identical.
 *
 * @param geometry - The frame's pixel dimensions
 * @param state - The state the frame shows
 * @param variant - The output variant the frame belongs to
 * @returns A PNG file
 */
export function encodeFixturePicture(
	geometry: FixtureGeometry,
	state: string,
	variant: string,
): Buffer {
	const stride = geometry.width * 3
	const pixels = Uint8Array.from(
		{ length: stride * geometry.height },
		(_, index) =>
			(index * 17 +
				(state.codePointAt(index % state.length) ?? 0) +
				(variant.codePointAt(index % variant.length) ?? 0)) %
			256,
	)
	const raw = Buffer.concat(
		Array.from({ length: geometry.height }, (_, row) =>
			Buffer.concat([Buffer.from([0]), pixels.subarray(row * stride, (row + 1) * stride)]),
		),
	)
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		encodeFixtureChunk(
			'IHDR',
			Buffer.concat([
				encodeFixtureWord(geometry.width),
				encodeFixtureWord(geometry.height),
				Buffer.from([8, 2, 0, 0, 0]),
			]),
		),
		encodeFixtureChunk('IDAT', deflateSync(raw, { level: 0 })),
		encodeFixtureChunk('IEND', Buffer.alloc(0)),
	])
}

/**
 * Builds the wrapper a reader loads: one project per producing variant, all declaring the same host data.
 *
 * @remarks
 * The module is plain data, so Vite reads it with no dependency. It declares the variants in an
 * order unlike any real host's, the fixture's portfolio roots, and one standalone root.
 *
 * @param root - The absolute workspace path, which the primary directory resolves against
 * @param producers - The producing variants that get a project. Default: every fixture variant.
 * @param uniform - The optional owner selectors the preflight judges for mixed observations; an empty list judges none
 * @returns The wrapper module's source text
 */
export function createReaderWrapper(
	root: string,
	producers: readonly string[] = VARIANTS,
	uniform?: readonly string[],
): string {
	const projects = producers.map((variant) => ({
		test: {
			name: { label: `journey:${variant}`, color: 'green' },
			provide: {
				directory: resolve(root, 'tmp/captures/states'),
				record: `tmp/captures/states/runs/reader/${variant}.json`,
				inputs: INPUTS,
				variant,
				variants: VARIANTS.map((name) => ({ name, width: 128, height: 128 })),
				final: READER_FINAL,
				first: VARIANTS[0],
				...(uniform === undefined ? {} : { uniform }),
				portfolios: PORTFOLIOS,
				standalone: [READER_STANDALONE],
			},
		},
	}))
	return `export default ${JSON.stringify({ test: { projects } })}\n`
}

/** Names the request directory, relative to the workspace, that the composed workspace's wrapper declares. */
export const COMPOSED_REQUESTS = 'tmp/requests'

/** Names the primary portfolio directory the composed workspace's producer writes its run records under. */
export const COMPOSED_DIRECTORY = 'tmp/captures/states'

/** Names the variant the composed workspace's wrapper stages alone before the rest. */
export const COMPOSED_FIRST = 'light-390'

/** Lists the owner paths the composed workspace's wrapper declares, ancestors included. */
export const COMPOSED_OWNERS = Object.freeze([
	'pages',
	'pages:mail',
	'examples',
	'examples:board',
	'examples:files',
] as const)

/** Names the producer entry, a plain Node process, that the composed workspace's Vitest stand-in loads. */
export const COMPOSED_PRODUCER = resolve(import.meta.dirname, 'fixtures/capture/Producer.ts')

/** Carries what one composed execution printed and the exit it returned. */
export interface ComposedRun {
	readonly code: number
	readonly stdout: string
	readonly stderr: string
}

/**
 * Selects the environment of a composed execution, how to interrupt it once its child is up, and the
 * discovery deadline in milliseconds.
 */
export interface ComposedExecution {
	readonly environment?: Readonly<Record<string, string>>
	readonly interrupt?: 'emit' | 'signal'
	readonly deadline?: number
}

/**
 * Builds the wrapper a composed workspace loads: owner tags, viewports, and the fixture's host data.
 *
 * @remarks
 * The module is plain data, so Vite reads it with no dependency. Its projects, inputs, and portfolio
 * roots are the ones the integrity fixture's engine is bound to, so the runner and the real engine
 * agree on every declaration.
 *
 * @param root - The absolute workspace path, which the primary directory resolves against
 * @param first - The variant every project stages alone before the rest. Default: `COMPOSED_FIRST`
 * @returns The wrapper module's source text
 */
export function createComposedWrapper(root: string, first: string = COMPOSED_FIRST): string {
	const projects = VARIANTS.map((variant) => ({
		test: {
			name: { label: `journey:${variant}`, color: 'green' },
			tags: COMPOSED_OWNERS.map((owner) => ({ name: `owner:${owner}` })),
			provide: {
				directory: resolve(root, COMPOSED_DIRECTORY),
				record: `${COMPOSED_DIRECTORY}/runs/composed/${variant}.json`,
				inputs: INPUTS,
				variant,
				variants: VARIANTS.map((name) => ({ name, width: 128, height: 128 })),
				final: READER_FINAL,
				first,
				portfolios: PORTFOLIOS,
				standalone: [READER_STANDALONE],
			},
		},
	}))
	return `export default ${JSON.stringify({ test: { projects } })}\n`
}

/**
 * Builds the Vitest entry stand-in a composed workspace spawns: it loads the producer in this package.
 *
 * @remarks
 * The stand-in names no request directory. The producer reads the one the runner hands every child in
 * `CAPTURE_REQUESTS`, so each composed proof also proves that propagation.
 *
 * @returns The stand-in module's source text
 */
export function createStandIn(): string {
	return [
		`process.env.CAPTURE_PRODUCER_DIRECTORY = ${JSON.stringify(COMPOSED_DIRECTORY)}`,
		`await import(${JSON.stringify(pathToFileURL(COMPOSED_PRODUCER).href)})`,
		'',
	].join('\n')
}

/** Lists the producer faults a registry refresh refuses, each with the refusal text it must raise. */
export const REGISTRY_REFUSALS = Object.freeze([
	{
		fault: 'failed-child',
		reason: 'The registry journey for light-1280 did not exit successfully (7)',
	},
	{ fault: 'complete', reason: 'Run completeness differs from eligible results' },
	{ fault: 'invalid-record', reason: 'Invalid or mismatched final record' },
	{ fault: 'declarations', reason: 'Run declarations differ from full reporter declarations' },
] as const)

/** Pairs a refused registry command line with the text its refusal must carry. */
export interface RegistryArgumentRefusal {
	readonly title: string
	readonly argv: readonly string[]
	readonly reason: string
}

/** Lists the registry command lines the parser refuses as usage, each with its discriminating text. */
export const REGISTRY_ARGUMENT_REFUSALS: readonly RegistryArgumentRefusal[] = Object.freeze([
	{
		title: 'a selector',
		argv: ['pages:mail'],
		reason: 'the registry command takes no selector',
	},
	{ title: 'an unknown flag', argv: ['--state', 'inbox'], reason: "Unknown option '--state'" },
	{
		title: 'a flag with no value',
		argv: ['--variant'],
		reason: "Option '--variant <value>' argument missing",
	},
	{
		title: 'a flag whose value opens with two dashes',
		argv: ['--mode', '--config', 'x'],
		reason: "Option '--mode' argument is ambiguous",
	},
	{
		title: 'a repeated config',
		argv: ['--config', 'a.ts', '--config', 'b.ts'],
		reason: 'Repeated option: --config',
	},
	{
		title: 'a repeated mode',
		argv: ['--mode', 'a', '--mode', 'b'],
		reason: 'Repeated option: --mode',
	},
	{
		title: 'a repeated variant',
		argv: ['--variant', 'wide', '--variant', 'wide'],
		reason: 'Repeated variant',
	},
	{
		title: 'a variant that is not a portable identity',
		argv: ['--variant', 'wide screen'],
		reason: 'Invalid variant identity',
	},
])

/** Pairs a refused executable command line with the text its refusal must carry on the error stream. */
export interface BinRefusal {
	readonly title: string
	readonly argv: readonly string[]
	readonly reason: string
}

/** Lists the executable command lines refused as usage, each with its discriminating text. */
export const BIN_REFUSALS: readonly BinRefusal[] = Object.freeze([
	{ title: 'no command', argv: [], reason: 'No command given' },
	{ title: 'an unknown command', argv: ['frobnicate'], reason: 'Unknown command "frobnicate"' },
	{ title: 'a bare journey', argv: ['journey'], reason: 'Usage: capture journey <selector>' },
	{ title: 'a bare frames', argv: ['frames'], reason: 'Usage: capture frames <selector>' },
	{ title: 'a bare stale', argv: ['stale'], reason: 'Usage: capture stale <selector>' },
	{
		title: 'a state on a journey',
		argv: ['journey', 'pages:mail', '--state', 'mail-screen'],
		reason: "Unknown option '--state'",
	},
	{
		title: 'an unknown flag on stale',
		argv: ['stale', 'pages:mail', '--bogus', 'x'],
		reason: "Unknown option '--bogus'",
	},
	{
		title: 'an unknown scope',
		argv: ['journey', 'nope'],
		reason: 'Unknown scope: nope',
	},
	{
		title: 'an unknown owner',
		argv: ['frames', 'pages:none'],
		reason: 'Unknown owner: none',
	},
	{ title: 'a bare preflight', argv: ['preflight'], reason: 'Usage: capture preflight <selector>' },
	{
		title: 'an unknown reader flag',
		argv: ['preflight', 'pages:mail', '--bogus', 'x'],
		reason: "Unknown option '--bogus'",
	},
	{
		title: 'an output on a preflight',
		argv: ['preflight', 'pages:mail', '--output', 'tmp/sheets'],
		reason: "Unknown option '--output'",
	},
	{
		title: 'sheets without an output',
		argv: ['sheets', 'pages:mail'],
		reason: 'requires --output',
	},
	{
		title: 'a selector on the registry',
		argv: ['registry', 'pages:mail'],
		reason: 'the registry command takes no selector',
	},
])

/**
 * Names the module the brand proof loads from each copy of the installed package, as plain data
 * the driver script reads: the core entry for the `import` condition and for the `require` one.
 */
export const BRAND_ENTRIES = Object.freeze({
	import: 'dist/src/core/index.js',
	require: 'dist/src/core/index.cjs',
} as const)

/**
 * Holds the consumer script that proves the `CaptureError` brand across copies of the package.
 *
 * @remarks
 * The script loads the `import` entry of the installed package, the same entry from a copy of its
 * files at a second path, and the `require` entry of the installed package. It prints one JSON line
 * of observations: each guard reading the other copies' errors, that the copies are distinct, and
 * that the guard accepts a subclass and refuses a look-alike, a transparent proxy, and a plain object
 * that only carries the brand. The two paths arrive as arguments.
 */
export const BRAND_DRIVER = `import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [installed, copy] = process.argv.slice(2)
const first = await import(pathToFileURL(join(installed, ${JSON.stringify(BRAND_ENTRIES.import)})).href)
const second = await import(pathToFileURL(join(copy, ${JSON.stringify(BRAND_ENTRIES.import)})).href)
const required = createRequire(import.meta.url)(join(installed, ${JSON.stringify(BRAND_ENTRIES.require)}))
const error = new first.CaptureError('first', { code: 'USAGE' })
class Narrowed extends first.CaptureError {}
const brand = Symbol.for('@orkestrel/capture.CaptureError')
process.stdout.write(JSON.stringify({
	distinct: [first.CaptureError !== second.CaptureError, first.CaptureError !== required.CaptureError],
	own: first.isCaptureError(error),
	copyReadsInstalled: second.isCaptureError(error),
	installedReadsCopy: first.isCaptureError(new second.CaptureError('second', { code: 'HOST' })),
	requireReadsImport: required.isCaptureError(error),
	importReadsRequire: first.isCaptureError(new required.CaptureError('third', { code: 'STAGE' })),
	subclass: [first.isCaptureError(new Narrowed('narrow', { code: 'EVIDENCE' })), second.isCaptureError(new Narrowed('narrow', { code: 'EVIDENCE' }))],
	lookAlike: first.isCaptureError(Object.assign(new Error('same code'), { code: 'USAGE' })),
	proxy: first.isCaptureError(new Proxy(error, {})),
	branded: first.isCaptureError({ [brand]: true, code: 'USAGE', message: 'plain', name: 'Error' }),
}))
`

/** Holds the observations the brand driver must print, in the order it prints them. */
export const BRAND_EXPECTED = Object.freeze({
	distinct: [true, true],
	own: true,
	copyReadsInstalled: true,
	installedReadsCopy: true,
	requireReadsImport: true,
	importReadsRequire: true,
	subclass: [true, true],
	lookAlike: false,
	proxy: false,
	branded: false,
})

/** Lists the faults a discovery child can inject, one per refusal the runner owns. */
export const FIXTURE_DISCOVERY_FAULTS = Object.freeze([
	'silent',
	'failed',
	'hang',
	'replay',
	'other-invocation',
	'other-config',
	'other-parent',
	'other-child',
	'malformed',
	'empty',
] as const)

/** Selects one deliberately invalid discovery answer: none, a failed exit, a hang, or a mismatched echo. */
export type FixtureDiscoveryFault = (typeof FIXTURE_DISCOVERY_FAULTS)[number]

/** Pairs each discovery fault with the refusal text the runner must raise for it. */
export const FIXTURE_DISCOVERY_MESSAGES: Readonly<Record<FixtureDiscoveryFault, string>> =
	Object.freeze({
		silent: 'answered no discovery request',
		failed: 'did not exit successfully (7)',
		hang: 'did not finish within',
		replay: 'answers another challenge',
		'other-invocation': 'answers another invocation',
		'other-config': 'names another wrapper',
		'other-parent': 'written for another parent process',
		'other-child': 'not written by the discovery child',
		malformed: 'The host description is malformed',
		empty: 'The wrapper declares no projects',
	})

/** Carries the fields of a discovery request the stand-in echoes in its answer. */
export interface FixtureDiscovery {
	readonly id: string
	readonly nonce: string
	readonly config: string
}

/**
 * Checks the discovery request a stand-in reads from its parent, without importing the source.
 *
 * @param value - The decoded request file
 * @returns True if the file is a discovery request carrying the fields the answer echoes; false otherwise
 */
export function isFixtureDiscovery(value: unknown): value is FixtureDiscovery {
	return holds(
		() =>
			isRecord(value) &&
			value.phase === 'discover' &&
			isString(value.id) &&
			isString(value.nonce) &&
			isString(value.config),
	)
}

/** Configures one discovery answer the stand-in writes. */
export interface FixtureDescription {
	readonly request: FixtureDiscovery
	readonly config: string
	readonly requests: string
	readonly fault?: FixtureDiscoveryFault
}

/**
 * Writes the description a wrapper writes for a discovery request, from the wrapper's own projects.
 *
 * @remarks
 * It imports the wrapper as plain data, resolves its projects the way Vitest does, and writes them
 * unjudged, so every refusal a proof reads comes from the runner. It implements only the answering
 * protocol; the package's `answerCaptureDiscovery` is proved in process and through a real Vitest.
 *
 * @param input - The request, the wrapper path, the request directory, and an optional fault
 */
export async function writeFixtureDescription(input: FixtureDescription): Promise<void> {
	const imported: unknown = await import(pathToFileURL(input.config).href)
	const exported: unknown = isRecord(imported) ? imported.default : undefined
	const test: unknown = isRecord(exported) ? exported.test : undefined
	const declared: unknown = isRecord(test) ? test.projects : undefined
	const projects =
		input.fault === 'empty' || !isArray(declared)
			? []
			: await Promise.all(
					declared.map(async (entry): Promise<unknown> => {
						return isFunction(entry) ? await entry({ command: 'serve', mode: 'test' }) : await entry
					}),
				)
	const { fault, request } = input
	if (fault === 'hang') {
		writeFileSync('ready.json', JSON.stringify({ pid: process.pid }))
		setInterval(() => undefined, 1_000)
		await new Promise(() => undefined)
	}
	if (fault === 'silent') return
	const file = resolve(input.requests, 'runs', request.id, 'description.json')
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(
		file,
		fault === 'malformed'
			? '{'
			: JSON.stringify({
					version: 1,
					id: fault === 'other-invocation' ? 'foreign' : request.id,
					nonce: fault === 'replay' ? 'replayed' : request.nonce,
					config: fault === 'other-config' ? 'other.config.ts' : request.config,
					parent: fault === 'other-parent' ? process.ppid + 1 : process.ppid,
					pid: fault === 'other-child' ? process.pid + 1 : process.pid,
					projects,
				}),
	)
	if (fault === 'failed') process.exitCode = 7
}
