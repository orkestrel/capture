import type { CaptureImageResult, CapturePicture } from '@src/server'
import type {
	CaptureDeclaration,
	CaptureDestination,
	CaptureIdentity,
	CaptureLookup,
	CaptureManifest,
	CaptureReceipt,
	CaptureReport,
	CaptureRegistry,
	CaptureRequest,
	CaptureRun,
	CaptureSources,
	CaptureStamp,
} from '@src/core'
import { captureError } from '@orkestrel/test'
import {
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
		version: 1,
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
		version: 1,
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
		version: 1,
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
		version: 1,
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
		version: 1,
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
		Object.entries({ version: 1, ...expected, projects: [project], ...patch }).filter(
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
			version: 1,
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
			['another version', { ...createRequestFixture(), version: 2 }],
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
			['another version', createRunFixture({ version: 2 })],
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
			['another version', createRegistryFixture({ version: 2 })],
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
			version: 1,
			manifest: FIXTURE_HASH,
			inputs: { [FIXTURE_HASH]: createLookupFixture().inputs },
			lookups: [{ ...createLookupFixture(), inputs: FIXTURE_HASH }],
		},
		[
			['another version', { version: 2, inputs: {}, lookups: [] }],
			['a short manifest digest', { version: 1, manifest: 'abc', inputs: {}, lookups: [] }],
			['a malformed collection', { version: 1, collections: [{}], inputs: {}, lookups: [] }],
			['a malformed lookup', { version: 1, inputs: {}, lookups: [{}] }],
			['a missing input table', { version: 1, lookups: [] }],
			['a short table digest', { version: 1, inputs: { abc: {} }, lookups: [] }],
			[
				'a malformed input map',
				{ version: 1, inputs: { [FIXTURE_HASH]: { '../escape': FIXTURE_HASH } }, lookups: [] },
			],
			[
				'an embedded lookup input map',
				{ version: 1, inputs: {}, lookups: [createLookupFixture()] },
			],
			[
				'a short input reference',
				{ version: 1, inputs: {}, lookups: [{ ...createLookupFixture(), inputs: 'abc' }] },
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
			['another version', createManifestFixture({ version: 2 })],
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

export const CAPTURE_CORE_VALUES = [
	'CAPTURE_ERROR_BRAND',
	'CAPTURE_ERROR_CODES',
	'CAPTURE_LOOKUPS_FILE',
	'CAPTURE_MANIFEST_FILE',
	'CAPTURE_PNG_SIGNATURE',
	'CAPTURE_REGISTRY_FILE',
	'CAPTURE_REQUEST_PREFIX',
	'CAPTURE_STATUS_PRECEDENCE',
	'CAPTURE_VERSION',
	'CaptureError',
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
	'isCaptureEntry',
	'isCaptureError',
	'isCaptureGeometry',
	'isCaptureHash',
	'isCaptureHashes',
	'isCaptureIdentity',
	'isCaptureLookup',
	'isCaptureLookupJournal',
	'isCaptureManifest',
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
	'isCaptureStoredManifest',
	'matchesCaptureMembers',
	'matchesCaptureSelector',
	'readCaptureDirty',
	'readCaptureReport',
	'requireCaptureUnique',
	'resolveCaptureKey',
	'resolveCaptureOwner',
	'resolveCaptureStatus',
	'resolveLookupKey',
	'validateCaptureReceipt',
	'validateCaptureRun',
]
