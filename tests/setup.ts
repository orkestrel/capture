import type {
	CaptureDeclaration,
	CaptureDestination,
	CaptureIdentity,
	CaptureLookup,
	CaptureManifest,
	CaptureReceipt,
	CaptureRegistry,
	CaptureRequest,
	CaptureRun,
	CaptureSources,
	CaptureStamp,
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
 * Runs a callback and returns the value it throws, so a proof can read the error's fields.
 *
 * @param callback - The work expected to throw
 * @returns The thrown value, or `undefined` when the callback returns
 */
export function readFailure(callback: () => unknown): unknown {
	try {
		callback()
		return undefined
	} catch (error) {
		return error
	}
}

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
 * Creates a closing run record fixture that agrees with `createVitestFixture` and no request.
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
		report: { file: 'tmp/captures/states/runs/run-1/journey-narrow.json', digest: FIXTURE_HASH },
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
