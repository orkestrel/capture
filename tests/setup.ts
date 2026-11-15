import type { CaptureImageResult, CapturePicture } from '@src/server'
import type {
	CaptureCase,
	CaptureDeclaration,
	CaptureDestination,
	CaptureIdentity,
	CaptureLookup,
	CaptureManifest,
	CaptureMapping,
	CaptureMeta,
	CaptureProvided,
	CaptureReceipt,
	CaptureReport,
	CaptureRegistry,
	CaptureRequest,
	CaptureRules,
	CaptureRun,
	CaptureSources,
	CaptureStamp,
} from '@src/core'
import { captureError } from '@orkestrel/test'
import {
	buildCaptureDestinations,
	buildCaptureRun,
	CAPTURE_VERSION,
	CaptureError,
	isCaptureError,
	readCaptureReport,
	validateCaptureRun,
	isCaptureSources,
	isCaptureIdentity,
	isCaptureRequest,
	isCaptureDeclaration,
	isCaptureDestination,
	isCaptureEntry,
	isCaptureArtifact,
	isCaptureRun,
	isCaptureDigest,
	isCaptureReceipt,
	isCaptureRegistry,
	isCaptureLookup,
	isCaptureLookupJournal,
	isCaptureStamp,
	isCaptureManifest,
	isCaptureCollection,
	isCaptureGeometry,
	isCaptureBox,
} from '@src/core'

declare module 'vitest' {
	interface TaskMeta extends CaptureMeta {}
}

/** Holds a valid SHA-256 digest every fixture reuses. */
export const FIXTURE_HASH = 'a'.repeat(64)

/** Holds a valid forty-character Git commit every stamp fixture reuses. */
export const FIXTURE_COMMIT = 'b'.repeat(40)

/** Holds the full name of the one case the run, receipt, and reporter fixtures declare. */
export const FIXTURE_CASE = 'mail shows the inbox'

/** Holds the Vitest project label the run and receipt fixtures name as their producer. */
export const FIXTURE_PROJECT = 'journey:light-390'

/** Lists serialized paths every portable-path guard must refuse before any file opens. */
export const REFUSED_PATHS: readonly string[] = Object.freeze([
	'/absolute.png',
	'C:/escape.png',
	'//server/share/image.png',
	'../escape.png',
	'tmp/../escape.png',
	'tmp\\..\\escape.png',
	'tmp/a:stream.png',
	'tmp/NUL.png',
	'tmp/COM1.png',
	'tmp/file. /image.png',
	'tmp/name./image.png',
	'tmp/a\0.png',
	'tmp//double.png',
	'',
])

/**
 * Creates a source attribution fixture.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid attribution
 */
export function createSourcesFixture(overrides: Partial<CaptureSources> = {}): CaptureSources {
	return { own: ['src/mail/**'], shared: ['src/core/**'], tests: ['tests/setup.ts'], ...overrides }
}

/**
 * Creates a destination fixture for the one declared case.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid destination
 */
export function createDestinationFixture(
	overrides: Partial<CaptureDestination> = {},
): CaptureDestination {
	return {
		portfolio: 'states',
		state: 'inbox',
		scope: 'pages',
		part: 'mail',
		variant: 'light-390',
		project: FIXTURE_PROJECT,
		file: 'tmp/captures/states/pages/inbox--light-390.png',
		case: FIXTURE_CASE,
		sources: createSourcesFixture(),
		...overrides,
	}
}

/**
 * Creates a declaration fixture for the one declared case.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid declaration
 */
export function createDeclarationFixture(
	overrides: Partial<CaptureDeclaration> = {},
): CaptureDeclaration {
	return {
		case: FIXTURE_CASE,
		owner: 'pages:mail',
		variant: 'light-390',
		eligible: true,
		states: ['inbox'],
		...overrides,
	}
}

/**
 * Creates an execution identity fixture.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid identity
 */
export function createIdentityFixture(overrides: Partial<CaptureIdentity> = {}): CaptureIdentity {
	return {
		id: 'run-1',
		stage: 'narrow',
		pid: 4242,
		config: 'configs/app/vite.journey.config.ts',
		...overrides,
	}
}

/**
 * Creates a runner request fixture for a capture of the one declared owner.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid request
 */
export function createRequestFixture(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
	return {
		...createIdentityFixture(),
		version: CAPTURE_VERSION,
		command: 'capture',
		selector: 'pages:mail',
		variants: ['light-390'],
		args: ['vitest.mjs', 'run'],
		...overrides,
	}
}

/**
 * Creates a final run record fixture that agrees with `createVitestFixture` and no request.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid run record with one passed case and one emitted frame
 */
export function createRunFixture(overrides: Partial<CaptureRun> = {}): CaptureRun {
	return {
		version: CAPTURE_VERSION,
		variant: 'light-390',
		time: '2026-10-28T09:00:00.000Z',
		complete: true,
		reference: false,
		declarations: [createDeclarationFixture()],
		registry: [createDestinationFixture()],
		passed: [FIXTURE_CASE],
		observed: ['inbox'],
		entries: [{ ...createDestinationFixture(), duration: 10 }],
		...overrides,
	}
}

/**
 * Creates a complete-run receipt fixture that agrees with `createVitestFixture`.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid receipt
 */
export function createReceiptFixture(overrides: Partial<CaptureReceipt> = {}): CaptureReceipt {
	return {
		version: CAPTURE_VERSION,
		variant: 'light-390',
		time: '2026-10-28T09:00:00.000Z',
		report: { file: 'tmp/captures/states/runs/run-1/journey-selected.json', digest: FIXTURE_HASH },
		inputs: { 'src/mail/view.ts': FIXTURE_HASH },
		declarations: [createDeclarationFixture()],
		registry: [createDestinationFixture()],
		complete: true,
		...overrides,
	}
}

/**
 * Creates a registry fixture over one receipt.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid registry
 */
export function createRegistryFixture(overrides: Partial<CaptureRegistry> = {}): CaptureRegistry {
	return {
		version: CAPTURE_VERSION,
		receipts: [createReceiptFixture()],
		entries: [createDestinationFixture()],
		digest: FIXTURE_HASH,
		...overrides,
	}
}

/**
 * Creates a state lookup fixture for the one declared case.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid lookup
 */
export function createLookupFixture(overrides: Partial<CaptureLookup> = {}): CaptureLookup {
	return {
		registry: FIXTURE_HASH,
		variant: 'light-390',
		case: FIXTURE_CASE,
		owner: 'pages:mail',
		states: ['inbox'],
		inputs: { 'src/mail/view.ts': FIXTURE_HASH },
		run: { file: 'tmp/captures/states/runs/run-1/narrow/light-390.json', digest: FIXTURE_HASH },
		...overrides,
	}
}

/**
 * Creates an image stamp fixture for the one emitted frame.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid stamp
 */
export function createStampFixture(overrides: Partial<CaptureStamp> = {}): CaptureStamp {
	return {
		...createDestinationFixture(),
		duration: 10,
		identity: createIdentityFixture(),
		time: '2026-10-28T09:00:00.000Z',
		commit: FIXTURE_COMMIT,
		dirty: ['src/mail/view.ts'],
		own: { 'src/mail/view.ts': FIXTURE_HASH },
		shared: {
			patterns: ['src/core/**'],
			files: { 'src/core/index.ts': FIXTURE_HASH },
			digest: FIXTURE_HASH,
		},
		tests: { 'tests/setup.ts': FIXTURE_HASH },
		image: { digest: FIXTURE_HASH, size: 2048, modified: 1730000000000 },
		registry: FIXTURE_HASH,
		...overrides,
	}
}

/**
 * Creates a manifest fixture holding the one stamped frame and the one lookup.
 *
 * @param overrides - Fields that replace the defaults
 * @returns A valid manifest
 */
export function createManifestFixture(overrides: Partial<CaptureManifest> = {}): CaptureManifest {
	return {
		version: CAPTURE_VERSION,
		registry: createRegistryFixture(),
		entries: { 'pages/inbox--light-390.png': createStampFixture() },
		lookups: [createLookupFixture()],
		...overrides,
	}
}

/**
 * Creates a Vitest JSON reporter fixture for a run that passed.
 *
 * @param assertions - The assertions the one passed test file reports, each carrying a full name, a status, an optional duration, and a meta record. Default: the one declared case
 * @returns The parsed reporter document `readCaptureReport` reads
 */
export function createVitestFixture(
	assertions: ReadonlyArray<Readonly<Record<string, unknown>>> = [
		{
			fullName: FIXTURE_CASE,
			status: 'passed',
			duration: 10,
			meta: { owner: 'pages:mail', variant: 'light-390', states: ['inbox'] },
		},
	],
): Record<string, unknown> {
	return {
		success: true,
		numFailedTests: 0,
		numFailedTestSuites: 0,
		startTime: 1000,
		testResults: [
			{ status: 'passed', startTime: 1100, endTime: 1900, assertionResults: assertions },
		],
	}
}

export function readCaptureReportFixture(overrides: Record<string, unknown> = {}): CaptureReport {
	return readCaptureReport({ ...createVitestFixture(), ...overrides })
}

export function validateCaptureRunFixture(
	run: CaptureRun,
	against: CaptureReport = readCaptureReportFixture(),
	project = FIXTURE_PROJECT,
): void {
	validateCaptureRun(run, against, project)
}

export function readCaptureEvidenceFailure(callback: () => unknown): unknown {
	const failure = captureError(callback)
	return isCaptureError(failure) ? failure : undefined
}

// Stands for the same package installed a second time: another class, the same brand key.
export class ForeignCaptureError extends Error {
	override readonly name = 'CaptureError'
	readonly code = 'HOST'
	readonly context = undefined

	constructor(message: string) {
		super(message)
		Object.defineProperty(this, Symbol.for('@orkestrel/capture.CaptureError'), { value: this })
	}
}

export class SpecialCaptureError extends CaptureError {}

/** Supplies a class instance as an error's structured context. */
export class CaptureContextFixture {
	readonly file = 'frame.png'
}

/** Supplies a callable object as an error's structured context. */
export function createCaptureCallableContext() {
	return Object.assign(() => undefined, { file: 'frame.png' })
}

export function createCaptureSolidPicture(width: number, height: number, value: number) {
	return { width, height, pixels: new Uint8Array(width * height * 3).fill(value) }
}

export function createCaptureImageFixture(
	state: string,
	width: number,
	height: number,
	overrides: Partial<CaptureDestination> = {},
): CaptureImageResult {
	const entry = createDestinationFixture({
		state,
		file: `tmp/captures/states/pages/${state}--${overrides.variant ?? 'light-390'}.png`,
		...overrides,
	})
	return {
		entry,
		picture: { width, height },
		thumbnail: createCaptureSolidPicture(width, height, 0),
		digest: state,
		size: 4096,
	}
}

export function createCaptureDigestImageFixture(file: string, digest: string): CaptureImageResult {
	return {
		entry: createDestinationFixture({ file }),
		picture: { width: 1, height: 1 },
		thumbnail: createCaptureSolidPicture(1, 1, 0),
		digest,
		size: 4096,
	}
}

/** Reads the red channel down one fixture picture column. */
export function readCapturePictureColumn(
	picture: CapturePicture,
	x: number,
): ReadonlyArray<number | undefined> {
	return Array.from(
		{ length: picture.height },
		(_, y) => picture.pixels[(y * picture.width + x) * 3],
	)
}

export function createCaptureDescriptionFixture(
	expected: Readonly<Record<string, unknown>>,
	project: unknown,
	patch: Readonly<Record<string, unknown>> = {},
): unknown {
	return Object.fromEntries(
		Object.entries({ version: CAPTURE_VERSION, ...expected, projects: [project], ...patch }).filter(
			([, value]) => value !== undefined,
		),
	)
}

export function createCaptureDiscoveryRequest(
	ppid: number,
	argv: readonly string[],
	config: string,
	patch: Readonly<Record<string, unknown>> = {},
): unknown {
	return Object.fromEntries(
		Object.entries({
			version: CAPTURE_VERSION,
			phase: 'discover',
			id: 'run-1',
			nonce: 'nonce-1',
			config,
			pid: ppid,
			args: argv,
			...patch,
		}).filter(([, value]) => value !== undefined),
	)
}

export async function readCaptureRejection(attempt: Promise<unknown>): Promise<unknown> {
	return await attempt.then(
		() => undefined,
		(error: unknown) => error,
	)
}

export const CAPTURE_COLLECTION_FIXTURE = {
	project: 'journey:light-390',
	registry: FIXTURE_HASH,
	variant: 'light-390',
	inputs: { patterns: [], files: {}, digest: FIXTURE_HASH },
	run: { file: 'tmp/runs/a.json', digest: FIXTURE_HASH },
	report: { file: 'tmp/runs/a-report.json', digest: FIXTURE_HASH },
}

// Each row pairs a guard with a value it accepts and the edits that must make it refuse. A row
// whose edit still passes means the guard stopped reading that field.
export const CAPTURE_GUARD_CASES: ReadonlyArray<
	readonly [string, (value: unknown) => boolean, unknown, ReadonlyArray<readonly [string, unknown]>]
> = [
	[
		'isCaptureSources',
		isCaptureSources,
		createSourcesFixture(),
		[
			['a traversing own pattern', createSourcesFixture({ own: ['../x'] })],
			['a backslash shared pattern', createSourcesFixture({ shared: ['src\\core'] })],
			['a non-array tests member', { ...createSourcesFixture(), tests: 'tests/setup.ts' }],
			['a missing member', { own: [], shared: [] }],
		],
	],
	[
		'isCaptureIdentity',
		isCaptureIdentity,
		createIdentityFixture(),
		[
			['a zero pid', createIdentityFixture({ pid: 0 })],
			['a fractional pid', createIdentityFixture({ pid: 1.5 })],
			['a spaced stage', createIdentityFixture({ stage: 'rest stage' })],
			['an escaping config', createIdentityFixture({ config: '../vite.config.ts' })],
			['a reserved device id', createIdentityFixture({ id: 'nul/x' })],
		],
	],
	[
		'isCaptureRequest',
		isCaptureRequest,
		createRequestFixture(),
		[
			['another version', { ...createRequestFixture(), version: 1 }],
			['an unknown command', { ...createRequestFixture(), command: 'stale' }],
			['no variants', createRequestFixture({ variants: [] })],
			['a repeated-separator selector', createRequestFixture({ selector: 'pages::mail' })],
			['a blank case', createRequestFixture({ case: '  ' })],
			['a journey carrying a state', createRequestFixture({ command: 'journey', state: 'inbox' })],
			['a non-string argument', { ...createRequestFixture(), args: [1] }],
		],
	],
	[
		'isCaptureDeclaration',
		isCaptureDeclaration,
		createDeclarationFixture(),
		[
			['a blank case', createDeclarationFixture({ case: ' ' })],
			['an owner with an empty segment', createDeclarationFixture({ owner: 'pages:' })],
			['a non-boolean eligibility', { ...createDeclarationFixture(), eligible: 'yes' }],
			['a spaced state', createDeclarationFixture({ states: ['two words'] })],
		],
	],
	[
		'isCaptureDestination',
		isCaptureDestination,
		createDestinationFixture(),
		[
			['an escaping file', createDestinationFixture({ file: '../escape.png' })],
			['an empty project', createDestinationFixture({ project: '' })],
			['a spaced section', createDestinationFixture({ section: 'a b' })],
			['a blank case', createDestinationFixture({ case: '' })],
			['invalid sources', { ...createDestinationFixture(), sources: { own: [] } }],
		],
	],
	[
		'isCaptureEntry',
		isCaptureEntry,
		{ ...createDestinationFixture(), duration: 0 },
		[
			['a negative duration', { ...createDestinationFixture(), duration: -1 }],
			['a non-finite duration', { ...createDestinationFixture(), duration: Number.NaN }],
			['no duration', createDestinationFixture()],
		],
	],
	[
		'isCaptureArtifact',
		isCaptureArtifact,
		{ file: 'tmp/runs/a/light-390.txt', digest: FIXTURE_HASH },
		[
			['an absolute file', { file: '/runs/a.txt', digest: FIXTURE_HASH }],
			['a short digest', { file: 'tmp/runs/a.txt', digest: 'abc' }],
		],
	],
	[
		'isCaptureRun',
		isCaptureRun,
		createRunFixture(),
		[
			['another version', { ...createRunFixture(), version: 1 }],
			['an unparsable time', createRunFixture({ time: 'yesterday' })],
			['a request without an identity', createRunFixture({ request: createRequestFixture() })],
			['an identity without a request', createRunFixture({ identity: createIdentityFixture() })],
			['a malformed artifact', { ...createRunFixture(), artifact: { file: 'a', digest: 'x' } }],
			['a spaced variant', createRunFixture({ variant: 'light 390' })],
		],
	],
	[
		'isCaptureDigest',
		isCaptureDigest,
		{ patterns: ['src/**'], files: { 'src/a.ts': FIXTURE_HASH }, digest: FIXTURE_HASH },
		[
			['no digest', { patterns: [], files: {} }],
			[
				'a case-colliding file pair',
				{
					patterns: [],
					files: { 'A.ts': FIXTURE_HASH, 'a.ts': FIXTURE_HASH },
					digest: FIXTURE_HASH,
				},
			],
			['a bad file hash', { patterns: [], files: { 'a.ts': 'x' }, digest: FIXTURE_HASH }],
		],
	],
	[
		'isCaptureReceipt',
		isCaptureReceipt,
		createReceiptFixture(),
		[
			['an unparsable time', createReceiptFixture({ time: 'x' })],
			['a malformed report', { ...createReceiptFixture(), report: { file: 'a', digest: 'x' } }],
			['a non-boolean completeness', { ...createReceiptFixture(), complete: 1 }],
		],
	],
	[
		'isCaptureRegistry',
		isCaptureRegistry,
		createRegistryFixture(),
		[
			['another version', { ...createRegistryFixture(), version: 1 }],
			['a malformed receipt', { ...createRegistryFixture(), receipts: [{}] }],
			['a short digest', createRegistryFixture({ digest: 'abc' })],
		],
	],
	[
		'isCaptureLookup',
		isCaptureLookup,
		createLookupFixture(),
		[
			['a short registry digest', createLookupFixture({ registry: 'abc' })],
			['a blank case', createLookupFixture({ case: ' ' })],
			[
				'a malformed run',
				{ ...createLookupFixture(), run: { file: '../a', digest: FIXTURE_HASH } },
			],
		],
	],
	[
		'isCaptureLookupJournal',
		isCaptureLookupJournal,
		{
			version: CAPTURE_VERSION,
			manifest: FIXTURE_HASH,
			populations: { [FIXTURE_HASH]: createLookupFixture().inputs },
			lookups: [{ ...createLookupFixture(), inputs: FIXTURE_HASH }],
		},
		[
			['another version', { version: 1, populations: {}, lookups: [] }],
			['the version-1 table name', { version: CAPTURE_VERSION, inputs: {}, lookups: [] }],
			[
				'a short manifest digest',
				{ version: CAPTURE_VERSION, manifest: 'abc', populations: {}, lookups: [] },
			],
			[
				'a malformed collection',
				{ version: CAPTURE_VERSION, collections: [{}], populations: {}, lookups: [] },
			],
			['a malformed lookup', { version: CAPTURE_VERSION, populations: {}, lookups: [{}] }],
			['a missing population table', { version: CAPTURE_VERSION, lookups: [] }],
			['a short table digest', { version: CAPTURE_VERSION, populations: { abc: {} }, lookups: [] }],
			[
				'a malformed input map',
				{
					version: CAPTURE_VERSION,
					populations: { [FIXTURE_HASH]: { '../escape': FIXTURE_HASH } },
					lookups: [],
				},
			],
			[
				'an embedded lookup input map',
				{ version: CAPTURE_VERSION, populations: {}, lookups: [createLookupFixture()] },
			],
			[
				'a short input reference',
				{
					version: CAPTURE_VERSION,
					populations: {},
					lookups: [{ ...createLookupFixture(), inputs: 'abc' }],
				},
			],
		],
	],
	[
		'isCaptureStamp',
		isCaptureStamp,
		createStampFixture(),
		[
			['a short commit', createStampFixture({ commit: 'abc123' })],
			[
				'an empty image',
				createStampFixture({ image: { digest: FIXTURE_HASH, size: 0, modified: 1 } }),
			],
			[
				'a negative modification time',
				createStampFixture({ image: { digest: FIXTURE_HASH, size: 1, modified: -1 } }),
			],
			['an escaping dirty path', createStampFixture({ dirty: ['../x'] })],
			['an unparsable time', createStampFixture({ time: 'x' })],
		],
	],
	[
		'isCaptureManifest',
		isCaptureManifest,
		createManifestFixture(),
		[
			['another version', { ...createManifestFixture(), version: 1 }],
			['a malformed stamp', { ...createManifestFixture(), entries: { 'pages/a.png': {} } }],
			[
				'an escaping stamp key',
				{ ...createManifestFixture(), entries: { '../a.png': createStampFixture() } },
			],
		],
	],
	[
		'isCaptureCollection',
		isCaptureCollection,
		CAPTURE_COLLECTION_FIXTURE,
		[
			['a blank project', { ...CAPTURE_COLLECTION_FIXTURE, project: ' ' }],
			['a malformed report', { ...CAPTURE_COLLECTION_FIXTURE, report: { file: 'a', digest: 'x' } }],
			[
				'an escaping run file',
				{ ...CAPTURE_COLLECTION_FIXTURE, run: { file: '../a.json', digest: FIXTURE_HASH } },
			],
			[
				'an undigested input population',
				{ ...CAPTURE_COLLECTION_FIXTURE, inputs: { patterns: [], files: {} } },
			],
		],
	],
	[
		'isCaptureGeometry',
		isCaptureGeometry,
		{ name: 'light-390', width: 390, height: 844 },
		[
			['a zero width', { name: 'light-390', width: 0, height: 844 }],
			['a spaced name', { name: 'light 390', width: 390, height: 844 }],
			['a missing height', { name: 'light-390', width: 390 }],
			['a string width', { name: 'light-390', width: '390', height: 844 }],
		],
	],
	[
		'isCaptureBox',
		isCaptureBox,
		{ x: 0, y: 64, width: 390, height: 780 },
		[
			['a zero height', { x: 0, y: 64, width: 390, height: 0 }],
			['an infinite x', { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 }],
		],
	],
]

/** Lists the owner paths the record fixtures declare, a section owner and a shell owner included. */
export const CAPTURE_RECORD_OWNERS: readonly string[] = Object.freeze([
	'pages:mail',
	'pages:board',
	'reference:components:buttons',
	'reference:components:details',
	'examples:files',
	'shell:overview',
])

/** Maps each fixture state to the owner path of the part that renders it. */
export const CAPTURE_RECORD_PARTS: Readonly<Record<string, string>> = Object.freeze({
	'mail-screen': 'pages:mail',
	'mail-reader': 'pages:mail',
	'board-lanes': 'pages:board',
	'buttons-rest': 'reference:components:buttons',
	details: 'reference:components:details',
	'files-empty': 'examples:files',
	arrival: 'shell:overview',
	'overview-deep': 'shell:overview:hero:banner',
	'overview-flat': 'shell',
})

/**
 * Resolves a fixture state to its part's owner path, as a host's injected part rule does.
 *
 * @param state - The declared state
 * @returns The owner path `CAPTURE_RECORD_PARTS` maps the state to
 * @throws Thrown when the fixture table declares no such state.
 */
export function resolveRecordPart(state: string): string {
	const owner = CAPTURE_RECORD_PARTS[state]
	if (owner === undefined) throw new Error(`Unknown fixture state: ${state}`)
	return owner
}

/**
 * Attributes a fixture owner's own, shared, and behavioral sources, as a host's injected source rule does.
 *
 * @param owner - The canonical owner path
 * @returns Sources whose own pattern spells the owner path as directories
 */
export function resolveRecordSources(owner: string): CaptureSources {
	return createSourcesFixture({ own: [`src/${owner.replaceAll(':', '/')}/**`] })
}

/** Supplies the host rules every record helper proof injects. */
export const CAPTURE_RECORD_RULES: CaptureRules = Object.freeze({
	owners: CAPTURE_RECORD_OWNERS,
	part: resolveRecordPart,
	sources: resolveRecordSources,
})

/** Names the producing project of the record fixtures. */
export const CAPTURE_RECORD_PROJECT = 'journey:light-390'

/** Maps each fixture state to a scoped primary portfolio or an unscoped narrow-variant portfolio. */
export const CAPTURE_RECORD_MAPPINGS: readonly CaptureMapping[] = Object.freeze([
	{
		portfolio: 'states',
		directory: 'tmp/captures/states',
		scoped: true,
		variant: 'light-390',
		states: ['mail-screen', 'buttons-rest', 'details', 'files-empty', 'arrival', 'board-lanes'],
	},
	{
		portfolio: 'focused',
		directory: 'tmp/captures/focused',
		scoped: false,
		variant: 'light-320',
		states: ['mail-reader'],
	},
])

/** Names the full case names the record fixtures declare. */
export const CAPTURE_RECORD_NAMES = Object.freeze({
	mail: 'Fixture mail opens the reader',
	buttons: 'Fixture buttons rest',
	files: 'Fixture files stay empty',
	details: 'Fixture details open',
	final: 'Fixture closes the run',
})

/**
 * Creates the collected cases of one fixture run: a passed page, a filtered reference part, an
 * ineligible example, a passed reference section, and an ownerless final case.
 *
 * @param passed - The owner-bearing case names that ran and passed; every other one was filtered out. Default: the page and the section
 * @returns The collected cases in declaration order
 */
export function createRecordCases(
	passed: readonly string[] = [CAPTURE_RECORD_NAMES.mail, CAPTURE_RECORD_NAMES.details],
): readonly CaptureCase[] {
	const declared: ReadonlyArray<readonly [string, CaptureMeta, number]> = [
		[
			CAPTURE_RECORD_NAMES.mail,
			{ owner: 'pages:mail', states: ['mail-screen', 'mail-reader'], variant: 'light-390' },
			12,
		],
		[
			CAPTURE_RECORD_NAMES.buttons,
			{ owner: 'reference:components:buttons', states: ['buttons-rest'], variant: 'light-390' },
			9,
		],
		[
			CAPTURE_RECORD_NAMES.files,
			{ owner: 'examples:files', states: ['files-empty'], variant: 'light-390', eligible: false },
			4,
		],
		[
			CAPTURE_RECORD_NAMES.details,
			{ owner: 'reference:components:details', states: ['details'], variant: 'light-390' },
			7,
		],
	]
	return [
		...declared.map(([name, meta, duration]): CaptureCase => {
			const ran = passed.includes(name)
			return {
				name,
				mode: ran ? 'run' : 'skip',
				tags: [],
				meta,
				...(ran ? { result: { state: 'pass', duration } } : {}),
			}
		}),
		{
			name: CAPTURE_RECORD_NAMES.final,
			mode: 'run',
			tags: [],
			meta: { variant: 'light-390' },
			result: { state: 'pass', duration: 30 },
		},
	]
}

/** Maps a Vitest task state or mode to its JSON reporter status, as Vitest's own status map does. */
export const CAPTURE_RECORD_STATUSES: Readonly<Record<string, string>> = Object.freeze({
	pass: 'passed',
	fail: 'failed',
	skip: 'skipped',
	todo: 'todo',
	run: 'pending',
	only: 'pending',
	queued: 'pending',
})

/**
 * Projects collected cases into the Vitest JSON reporter document their run writes.
 *
 * @param cases - The collected cases
 * @returns The reporter document, with Vitest's status for each case's state or mode
 */
export function createRecordReport(cases: readonly CaptureCase[]): Record<string, unknown> {
	return createVitestFixture(
		cases.map((entry) => ({
			fullName: entry.name,
			status: CAPTURE_RECORD_STATUSES[entry.result?.state ?? entry.mode] ?? 'pending',
			...(entry.result?.duration === undefined ? {} : { duration: entry.result.duration }),
			meta: entry.meta,
		})),
	)
}

/** Describes one record round trip: the cases, observed states, emitted pairs, and request of a run. */
export interface CaptureRecordScenario {
	readonly passed: readonly string[]
	readonly observed: readonly string[]
	readonly emitted: ReadonlyArray<readonly [state: string, path: string]>
	readonly request?: CaptureRequest
}

/** Lists the record round trips: a capture-on run, a capture-off run, a journey, a one-state capture, and a complete run. */
export const CAPTURE_RECORD_SCENARIOS: ReadonlyArray<readonly [string, CaptureRecordScenario]> =
	Object.freeze([
		[
			'a run that wrote each passed frame',
			{
				passed: [CAPTURE_RECORD_NAMES.mail, CAPTURE_RECORD_NAMES.details],
				observed: ['mail-screen', 'mail-reader', 'details'],
				emitted: [
					['mail-screen', 'tmp/captures/states/pages/mail-screen--light-390.png'],
					['mail-reader', 'tmp/captures/focused/mail-reader--light-320.png'],
					['details', 'tmp/captures/states/reference/details--light-390.png'],
				],
			},
		],
		[
			'a run with capture off',
			{
				passed: [CAPTURE_RECORD_NAMES.mail, CAPTURE_RECORD_NAMES.details],
				observed: ['mail-screen', 'mail-reader', 'details'],
				emitted: [],
			},
		],
		[
			'a journey selection of one owner',
			{
				passed: [CAPTURE_RECORD_NAMES.mail],
				observed: ['mail-screen', 'mail-reader'],
				emitted: [],
				request: createRequestFixture({ command: 'journey', stage: 'selected' }),
			},
		],
		[
			'a capture of one requested state written at an absolute provider path',
			{
				passed: [CAPTURE_RECORD_NAMES.mail],
				observed: ['mail-screen', 'mail-reader'],
				emitted: [['mail-reader', 'C:\\work\\tmp\\captures\\focused\\mail-reader--light-320.png']],
				request: createRequestFixture({ state: 'mail-reader' }),
			},
		],
		[
			'a complete run',
			{
				passed: [
					CAPTURE_RECORD_NAMES.mail,
					CAPTURE_RECORD_NAMES.buttons,
					CAPTURE_RECORD_NAMES.details,
				],
				observed: ['mail-screen', 'mail-reader', 'buttons-rest', 'details'],
				emitted: [
					['mail-screen', 'tmp/captures/states/pages/mail-screen--light-390.png'],
					['mail-reader', 'tmp/captures/focused/mail-reader--light-320.png'],
					['buttons-rest', 'tmp/captures/states/reference/buttons-rest--light-390.png'],
					['details', 'tmp/captures/states/reference/details--light-390.png'],
				],
			},
		],
	])

/** Holds the timestamp every fixture record carries. */
export const CAPTURE_RECORD_TIME = '2026-11-15T09:00:00.000Z'

/** Carries the cases, destinations, built record, and reporter projection of one record scenario. */
export interface CaptureRecordFixture {
	readonly cases: readonly CaptureCase[]
	readonly registry: readonly CaptureDestination[]
	readonly run: CaptureRun
	readonly report: CaptureReport
}

/**
 * Builds a scenario's record through the real destination and run builders, beside its reporter.
 *
 * @param scenario - The passed cases, observed states, emitted pairs, and request of the run
 * @returns The collected cases, the destinations, the record, and the read reporter document
 */
export function createRecordRun(scenario: CaptureRecordScenario): CaptureRecordFixture {
	const cases = createRecordCases(scenario.passed)
	const registry = buildCaptureDestinations(cases, CAPTURE_RECORD_RULES, {
		project: CAPTURE_RECORD_PROJECT,
		portfolios: CAPTURE_RECORD_MAPPINGS,
	})
	return {
		cases,
		registry,
		run: buildCaptureRun({
			cases,
			registry,
			observed: scenario.observed,
			emitted: scenario.emitted,
			variant: 'light-390',
			time: CAPTURE_RECORD_TIME,
			...(scenario.request === undefined ? {} : { request: scenario.request }),
		}),
		report: readCaptureReport(createRecordReport(cases)),
	}
}

/** Lists record mutations the validator must refuse, each with the scenario it mutates. */
export const CAPTURE_RECORD_MUTATIONS: ReadonlyArray<
	readonly [string, string, (run: CaptureRun) => CaptureRun]
> = Object.freeze([
	[
		'an observed state removed',
		'a run that wrote each passed frame',
		(run) => ({ ...run, observed: run.observed.slice(1) }),
	],
	[
		'a passed case removed',
		'a run that wrote each passed frame',
		(run) => ({ ...run, passed: run.passed.slice(1) }),
	],
	[
		'completeness claimed',
		'a run that wrote each passed frame',
		(run) => ({ ...run, complete: true }),
	],
	[
		'reference completeness denied',
		'a run that wrote each passed frame',
		(run) => ({ ...run, reference: false }),
	],
	[
		'an emitted duration changed',
		'a run that wrote each passed frame',
		(run) => ({
			...run,
			entries: run.entries.map((entry) => ({ ...entry, duration: entry.duration + 1 })),
		}),
	],
	[
		'an emitted entry removed',
		'a run that wrote each passed frame',
		(run) => ({ ...run, entries: run.entries.slice(1) }),
	],
	[
		'a declaration state added',
		'a run that wrote each passed frame',
		(run) => ({
			...run,
			declarations: run.declarations.map((entry, index) =>
				index === 0 ? { ...entry, states: [...entry.states, 'board-lanes'] } : entry,
			),
		}),
	],
	[
		'a declaration variant changed',
		'a run that wrote each passed frame',
		(run) => ({
			...run,
			declarations: run.declarations.map((entry) => ({ ...entry, variant: 'dark-390' })),
		}),
	],
	[
		'a destination moved to another project',
		'a run that wrote each passed frame',
		(run) => ({
			...run,
			registry: run.registry.map((entry) => ({ ...entry, project: 'journey:dark-390' })),
		}),
	],
	[
		'an entry emitted by a journey',
		'a journey selection of one owner',
		(run) => ({
			...run,
			entries: run.registry.slice(0, 1).map((entry) => ({ ...entry, duration: 12 })),
		}),
	],
	[
		'an identity from another invocation',
		'a capture of one requested state written at an absolute provider path',
		(run) => ({ ...run, identity: createIdentityFixture({ id: 'run-2' }) }),
	],
])

/** Supplies the values a wrapper provides to the record fixtures' project, typed as the core protocol declares them. */
export const CAPTURE_PROVIDED_FIXTURE: CaptureProvided = Object.freeze({
	variant: 'light-390',
	variants: [
		{ name: 'light-390', width: 390, height: 844 },
		{ name: 'light-320', width: 320, height: 640 },
	],
	directory: 'tmp/captures/states',
	record: 'tmp/captures/states/runs/run-1/selected/light-390.json',
	inputs: ['src/**', 'tests/setup.ts'],
	sources: { shared: ['src/shared/**'], tests: ['tests/setup.ts'] },
	final: CAPTURE_RECORD_NAMES.final,
	first: 'light-390',
	uniform: ['pages'],
	portfolios: CAPTURE_RECORD_MAPPINGS.map(({ portfolio, directory, scoped }) => ({
		portfolio,
		directory,
		scoped,
	})),
	capture: true,
	request: createRequestFixture(),
})

/** Supplies a case owned outside the selection that places a selected state, beside a case that does not. */
export const CAPTURE_PARKING_CASES: readonly CaptureCase[] = Object.freeze([
	{
		name: 'Fixture overview parks a mail state',
		mode: 'skip',
		tags: [],
		meta: { owner: 'shell:overview', states: ['arrival', 'mail-screen'], variant: 'light-390' },
	},
	{
		name: 'Fixture mail opens the reader',
		mode: 'run',
		tags: [],
		meta: { owner: 'pages:mail', states: ['mail-reader'], variant: 'light-390' },
	},
	{
		name: 'Fixture closes the run',
		mode: 'run',
		tags: [],
		meta: { variant: 'light-390' },
	},
])

export const CAPTURE_CORE_VALUES = [
	'CAPTURE_ARTIFACT_PREFIXES',
	'CAPTURE_ERROR_BRAND',
	'CAPTURE_ERROR_CODES',
	'CAPTURE_LOOKUPS_FILE',
	'CAPTURE_MANIFEST_FILE',
	'CAPTURE_OWNER_PREFIX',
	'CAPTURE_PNG_SIGNATURE',
	'CAPTURE_REGISTRY_FILE',
	'CAPTURE_REQUEST_PREFIX',
	'CAPTURE_STATUS_PRECEDENCE',
	'CAPTURE_VERSION',
	'CaptureError',
	'buildCaptureDestinations',
	'buildCaptureRun',
	'buildCaptureTags',
	'buildCaptureTest',
	'collectCaptureAncestors',
	'collectCaptureCases',
	'collectCaptureChanges',
	'collectCaptureDuplicates',
	'describeCaptureDeclaration',
	'describeCaptureDestination',
	'describeCaptureError',
	'describeCaptureIdentity',
	'describeCaptureRequest',
	'isCaptureArtifact',
	'isCaptureBox',
	'isCaptureCollection',
	'isCaptureDeclaration',
	'isCaptureDestination',
	'isCaptureDigest',
	'isCaptureDigestReference',
	'isCaptureEntry',
	'isCaptureError',
	'isCaptureExpandedManifest',
	'isCaptureGeometry',
	'isCaptureHash',
	'isCaptureHashes',
	'isCaptureIdentity',
	'isCaptureLookup',
	'isCaptureLookupJournal',
	'isCaptureManifest',
	'isCaptureManifestDocument',
	'isCapturePath',
	'isCapturePattern',
	'isCaptureReceipt',
	'isCaptureRegistry',
	'isCaptureRequest',
	'isCaptureRun',
	'isCaptureSegment',
	'isCaptureSelector',
	'isCaptureSources',
	'isCaptureStamp',
	'matchesCaptureMembers',
	'matchesCaptureSelector',
	'readCaptureArtifact',
	'readCaptureDirty',
	'readCaptureReport',
	'renderCaptureArtifact',
	'requireCaptureCases',
	'requireCaptureUnique',
	'resolveCaptureKey',
	'resolveCaptureOwner',
	'resolveCaptureStatus',
	'resolveLookupKey',
	'validateCaptureReceipt',
	'validateCaptureRun',
]
