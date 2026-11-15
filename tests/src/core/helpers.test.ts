import type { TestOptions } from 'vitest'
import {
	buildCaptureCase,
	buildCaptureDestinations,
	buildCaptureRun,
	buildCaptureTags,
	collectCaptureAncestors,
	collectCaptureCases,
	readCaptureArtifact,
	renderCaptureArtifact,
	requireCaptureCases,
	validateCaptureRun,
	collectCaptureChanges,
	collectCaptureDuplicates,
	describeCaptureDeclaration,
	describeCaptureDestination,
	describeCaptureError,
	describeCaptureIdentity,
	describeCaptureRequest,
	isCaptureError,
	isCaptureRun,
	matchesCaptureMembers,
	matchesCaptureSelector,
	readCaptureDirty,
	readCaptureReport,
	requireCaptureUnique,
	resolveCaptureKey,
	resolveCaptureOwner,
	resolveCaptureStatus,
	resolveLookupKey,
	validateCaptureReceipt,
} from '@src/core'
import { parseJSON } from '@orkestrel/contract'
import { captureError, requireValue } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	FIXTURE_CASE,
	createDeclarationFixture,
	createDestinationFixture,
	createIdentityFixture,
	createReceiptFixture,
	createRequestFixture,
	createRunFixture,
	createVitestFixture,
	readCaptureReportFixture,
	validateCaptureRunFixture,
	readCaptureEvidenceFailure,
	CAPTURE_PARKING_CASES,
	CAPTURE_RECORD_MAPPINGS,
	CAPTURE_RECORD_MUTATIONS,
	CAPTURE_RECORD_NAMES,
	CAPTURE_RECORD_PROJECT,
	CAPTURE_RECORD_RULES,
	CAPTURE_RECORD_SCENARIOS,
	CAPTURE_RECORD_TIME,
	createRecordCases,
	createRecordRun,
	createSourcesFixture,
} from '../../setup.js'
describe('describeCaptureError', () => {
	it('returns an error message and the string form of any other value', () => {
		expect(describeCaptureError(new Error('Unknown variant: phone'))).toBe('Unknown variant: phone')
		expect(describeCaptureError('refused')).toBe('refused')
		expect(describeCaptureError(404)).toBe('404')
		expect(describeCaptureError(undefined)).toBe('undefined')
	})
})

describe('collectCaptureDuplicates and requireCaptureUnique', () => {
	it('reports every member of a repeated identity and nothing when each is unique', () => {
		expect(collectCaptureDuplicates(['a', 'b', 'a'])).toEqual(['a', 'a'])
		expect(collectCaptureDuplicates(['a', 'b', 'c'])).toEqual([])
		expect(collectCaptureDuplicates([])).toEqual([])
	})

	it('compares exact identities unless folding is requested', () => {
		expect(collectCaptureDuplicates(['Pages', 'pages'])).toEqual([])
		expect(collectCaptureDuplicates(['Pages', 'pages'], true)).toEqual(['Pages', 'pages'])
	})

	it('returns for a unique population and throws an evidence refusal naming the repeats', () => {
		expect(captureError(() => requireCaptureUnique(['mail', 'files'], 'owners'))).toBeUndefined()
		const failure = captureError(() => requireCaptureUnique(['mail', 'mail'], 'owners'))
		expect(isCaptureError(failure)).toBe(true)
		expect(failure).toMatchObject({
			code: 'EVIDENCE',
			message: 'Duplicate owners: mail, mail',
			context: { label: 'owners', duplicates: ['mail', 'mail'] },
		})
		expect(
			readCaptureEvidenceFailure(() => requireCaptureUnique(['Pages', 'pages'], 'scopes', true)),
		).toMatchObject({ code: 'EVIDENCE', message: 'Duplicate scopes: Pages, pages' })
	})
})

describe('matchesCaptureMembers', () => {
	it('ignores order and keeps duplicates', () => {
		expect(matchesCaptureMembers(['b', 'a'], ['a', 'b'])).toBe(true)
		expect(matchesCaptureMembers([], [])).toBe(true)
		expect(matchesCaptureMembers(['a', 'a'], ['a'])).toBe(false)
		expect(matchesCaptureMembers(['a', 'a'], ['a', 'b'])).toBe(false)
	})

	it('does not mutate either population', () => {
		const left = ['b', 'a']
		const right = ['a', 'b']
		matchesCaptureMembers(left, right)
		expect(left).toEqual(['b', 'a'])
		expect(right).toEqual(['a', 'b'])
	})
})

describe('matchesCaptureSelector', () => {
	it('selects an owner at colon boundaries only', () => {
		expect(matchesCaptureSelector('pages:mail', 'pages:mail')).toBe(true)
		expect(matchesCaptureSelector('pages:mail', 'pages')).toBe(true)
		expect(matchesCaptureSelector('pages:mail:inbox', 'pages:mail')).toBe(true)
		expect(matchesCaptureSelector('pages:mailbox', 'pages:mail')).toBe(false)
		expect(matchesCaptureSelector('pages', 'pages:mail')).toBe(false)
		expect(matchesCaptureSelector('files:mail', 'pages')).toBe(false)
	})

	it('selects every owner with the all selector', () => {
		expect(matchesCaptureSelector('pages:mail', 'all')).toBe(true)
		expect(matchesCaptureSelector('x', 'all')).toBe(true)
	})
})

describe('resolveCaptureOwner and resolveCaptureKey', () => {
	it('joins scope, part, and an optional section', () => {
		expect(resolveCaptureOwner(createDestinationFixture())).toBe('pages:mail')
		expect(resolveCaptureOwner(createDestinationFixture({ section: 'inbox' }))).toBe(
			'pages:mail:inbox',
		)
	})

	it('keys a frame by scope, state, and output variant, independent of its file', () => {
		expect(resolveCaptureKey(createDestinationFixture())).toBe('pages/inbox--light-390.png')
		expect(resolveCaptureKey(createDestinationFixture({ file: 'tmp/elsewhere/x.png' }))).toBe(
			'pages/inbox--light-390.png',
		)
		expect(resolveCaptureKey(createDestinationFixture({ variant: 'dark-1280' }))).toBe(
			'pages/inbox--dark-1280.png',
		)
	})
})

describe('describers', () => {
	it('serializes a destination without regard to the order of its source patterns', () => {
		const forward = createDestinationFixture({
			sources: { own: ['a', 'b'], shared: ['c', 'd'], tests: ['e', 'f'] },
		})
		const reversed = createDestinationFixture({
			sources: { own: ['b', 'a'], shared: ['d', 'c'], tests: ['f', 'e'] },
		})
		expect(describeCaptureDestination(forward)).toBe(describeCaptureDestination(reversed))
		expect(describeCaptureDestination(forward)).not.toBe(
			describeCaptureDestination(createDestinationFixture({ state: 'sent' })),
		)
	})

	it('serializes an identity without its source attribution', () => {
		const changed = createDestinationFixture({
			sources: { own: ['other/**'], shared: [], tests: [] },
		})
		expect(describeCaptureIdentity(createDestinationFixture())).toBe(
			describeCaptureIdentity(changed),
		)
		expect(describeCaptureDestination(createDestinationFixture())).not.toBe(
			describeCaptureDestination(changed),
		)
		expect(describeCaptureIdentity(createDestinationFixture())).not.toBe(
			describeCaptureIdentity(createDestinationFixture({ project: 'journey:dark-1280' })),
		)
	})

	it('serializes a declaration without regard to the order of its states and with its eligibility', () => {
		expect(describeCaptureDeclaration(createDeclarationFixture({ states: ['b', 'a'] }))).toBe(
			describeCaptureDeclaration(createDeclarationFixture({ states: ['a', 'b'] })),
		)
		expect(describeCaptureDeclaration(createDeclarationFixture({ eligible: false }))).not.toBe(
			describeCaptureDeclaration(createDeclarationFixture()),
		)
	})

	it('serializes a request with its exact argument order', () => {
		const request = createRequestFixture({ args: ['a', 'b'] })
		expect(describeCaptureRequest(request)).toBe(describeCaptureRequest({ ...request }))
		expect(describeCaptureRequest(request)).not.toBe(
			describeCaptureRequest({ ...request, args: ['b', 'a'] }),
		)
		expect(describeCaptureRequest(request)).not.toBe(
			describeCaptureRequest({ ...request, state: 'sent' }),
		)
		expect(describeCaptureRequest({ ...request, mode: 'vue' })).not.toBe(
			describeCaptureRequest(request),
		)
	})
})

describe('collectCaptureChanges', () => {
	it('names changed, added, and removed files in sorted order', () => {
		expect(
			collectCaptureChanges(
				{ 'a.ts': 'x', 'b.ts': 'y', 'd.ts': 'q' },
				{ 'a.ts': 'x', 'b.ts': 'z', 'c.ts': 'w' },
			),
		).toEqual(['b.ts', 'c.ts', 'd.ts'])
	})

	it('names nothing for equal populations', () => {
		expect(collectCaptureChanges({ 'a.ts': 'x' }, { 'a.ts': 'x' })).toEqual([])
		expect(collectCaptureChanges({}, {})).toEqual([])
	})
})

describe('resolveLookupKey', () => {
	it('keys a lookup by producing variant and full case, unambiguously', () => {
		expect(resolveLookupKey({ variant: 'light-390', case: 'a' })).toBe('["light-390","a"]')
		expect(resolveLookupKey({ variant: 'a', case: 'b","c' })).not.toBe(
			resolveLookupKey({ variant: 'a","b', case: 'c' }),
		)
	})
})

describe('readCaptureReport', () => {
	it('projects the owner-bearing assertions and the reporter wall', () => {
		expect(readCaptureReportFixture()).toEqual({
			start: 1000,
			end: 1900,
			assertions: [
				{
					case: FIXTURE_CASE,
					owner: 'pages:mail',
					variant: 'light-390',
					eligible: true,
					states: ['inbox'],
					status: 'passed',
					duration: 10,
				},
			],
		})
	})

	it('takes the earliest start and the latest end across test files', () => {
		const report = readCaptureReport({
			...createVitestFixture([]),
			testResults: [
				{ status: 'passed', startTime: 1500, endTime: 1600, assertionResults: [] },
				{ status: 'passed', startTime: 900, endTime: 2500, assertionResults: [] },
			],
		})
		expect(report).toEqual({ start: 900, end: 2500, assertions: [] })
	})

	it('skips an assertion no owner claims and defaults eligibility and states', () => {
		const report = readCaptureReport(
			createVitestFixture([
				{ fullName: 'unowned', status: 'passed', meta: {} },
				{
					fullName: 'owned',
					status: 'passed',
					duration: null,
					meta: { owner: 'pages:files', variant: 'light-390' },
				},
				{
					fullName: 'excluded',
					status: 'skipped',
					meta: { owner: 'pages:files', variant: 'light-390', eligible: false, states: ['x'] },
				},
			]),
		)
		expect(report.assertions).toEqual([
			{
				case: 'owned',
				owner: 'pages:files',
				variant: 'light-390',
				eligible: true,
				states: [],
				status: 'passed',
			},
			{
				case: 'excluded',
				owner: 'pages:files',
				variant: 'light-390',
				eligible: false,
				states: ['x'],
				status: 'skipped',
			},
		])
	})

	it.each([
		['a failed reporter', { success: false }],
		['a failed test count', { numFailedTests: 1 }],
		['a failed suite count', { numFailedTestSuites: 1 }],
		['a missing start time', { startTime: undefined }],
		['no test files', { testResults: [] }],
		['a non-array test file list', { testResults: {} }],
	])('refuses %s as unsuccessful', (_label, overrides) => {
		expect(readCaptureEvidenceFailure(() => readCaptureReportFixture(overrides))).toMatchObject({
			code: 'EVIDENCE',
			message: 'Invalid or unsuccessful Vitest JSON report',
		})
	})

	it('refuses a non-record document', () => {
		for (const value of [null, undefined, [], 'report', 0]) {
			expect(readCaptureEvidenceFailure(() => readCaptureReport(value))).toMatchObject({
				code: 'EVIDENCE',
				message: 'Invalid or unsuccessful Vitest JSON report',
			})
		}
	})

	it.each([
		['a failed file', { status: 'failed' }],
		['an end before its start', { startTime: 5, endTime: 4 }],
		['a missing end time', { endTime: undefined }],
		['non-array assertions', { assertionResults: 'x' }],
	])('refuses %s', (_label, overrides) => {
		const file = { status: 'passed', startTime: 1, endTime: 2, assertionResults: [], ...overrides }
		expect(
			readCaptureEvidenceFailure(() =>
				readCaptureReport({ ...createVitestFixture([]), testResults: [file] }),
			),
		).toMatchObject({ code: 'EVIDENCE', message: 'Invalid Vitest file report' })
	})

	it('refuses an assertion without a metadata record', () => {
		const file = {
			status: 'passed',
			startTime: 1,
			endTime: 2,
			assertionResults: [{ fullName: 'a', status: 'passed' }],
		}
		expect(
			readCaptureEvidenceFailure(() =>
				readCaptureReport({ ...createVitestFixture([]), testResults: [file] }),
			),
		).toMatchObject({ code: 'EVIDENCE', message: 'Invalid Vitest assertion metadata' })
	})

	it.each([
		['an owner with a space', { meta: { owner: 'a b', variant: 'light-390' } }],
		['a missing variant', { meta: { owner: 'pages:mail' } }],
		['a non-string status', { status: 7 }],
		['a negative duration', { duration: -1 }],
		['a non-numeric duration', { duration: 'slow' }],
	])('refuses an owner-bearing assertion with %s', (_label, overrides) => {
		const assertion = {
			fullName: FIXTURE_CASE,
			status: 'passed',
			meta: { owner: 'pages:mail', variant: 'light-390' },
			...overrides,
		}
		expect(
			readCaptureEvidenceFailure(() => readCaptureReport(createVitestFixture([assertion]))),
		).toMatchObject({
			code: 'EVIDENCE',
			message: 'Invalid owner-bearing Vitest assertion',
		})
	})

	it('refuses two assertions that share a case and producing variant', () => {
		const assertion = {
			fullName: FIXTURE_CASE,
			status: 'passed',
			meta: { owner: 'pages:mail', variant: 'light-390' },
		}
		expect(
			readCaptureEvidenceFailure(() =>
				readCaptureReport(createVitestFixture([assertion, assertion])),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: `Duplicate reporter case identities: ["light-390","${FIXTURE_CASE}"], ["light-390","${FIXTURE_CASE}"]`,
		})
		expect(
			readCaptureReport(
				createVitestFixture([
					assertion,
					{ ...assertion, meta: { owner: 'pages:mail', variant: 'dark-1280' } },
				]),
			).assertions,
		).toHaveLength(2)
	})
})

describe('validateCaptureRun', () => {
	const mismatched = readCaptureReport(
		createVitestFixture([
			{
				fullName: FIXTURE_CASE,
				status: 'passed',
				duration: 10,
				meta: { owner: 'pages:mail', variant: 'light-390', states: ['sent'] },
			},
		]),
	)

	it('accepts a record that agrees with its reporter', () => {
		expect(captureError(() => validateCaptureRunFixture(createRunFixture()))).toBeUndefined()
	})

	it('accepts a record that agrees with a capture request and a journey request', () => {
		const identity = createIdentityFixture()
		expect(
			captureError(() =>
				validateCaptureRunFixture(createRunFixture({ identity, request: createRequestFixture() })),
			),
		).toBeUndefined()
		expect(
			captureError(() =>
				validateCaptureRunFixture(
					createRunFixture({
						identity,
						request: createRequestFixture({ command: 'journey' }),
						entries: [],
					}),
				),
			),
		).toBeUndefined()
	})

	it.each([
		[
			'a repeated declaring case',
			{ declarations: [createDeclarationFixture(), createDeclarationFixture()] },
			'Duplicate declaring cases: mail shows the inbox, mail shows the inbox',
		],
		[
			'a repeated passed case',
			{ passed: [FIXTURE_CASE, FIXTURE_CASE] },
			'Duplicate passed cases: mail shows the inbox, mail shows the inbox',
		],
		[
			'a repeated observed state',
			{ observed: ['inbox', 'Inbox'] },
			'Duplicate observed states: inbox, Inbox',
		],
		[
			'declarations the reporter lacks',
			{ declarations: [createDeclarationFixture({ states: ['sent'] })] },
			'Run declarations differ from full reporter declarations',
		],
		[
			'a passed case the reporter did not pass',
			{ passed: [] },
			'Run passed cases differ from reporter results',
		],
		[
			'an observation the reporter did not make',
			{ observed: [] },
			'Run observations differ from full passed declarations',
		],
		[
			'a completeness the results contradict',
			{ complete: false },
			'Run completeness differs from eligible results',
		],
		[
			'a registry that lacks the declared destination',
			{ registry: [] },
			`Registry differs from eligible declaration: ${FIXTURE_CASE}`,
		],
		[
			'a reference flag the sections contradict',
			{ reference: true },
			'Reference completeness differs from declaring section results',
		],
		[
			'an emitted frame the registry lacks',
			{
				entries: [
					{
						...createDestinationFixture({
							state: 'sent',
							file: 'tmp/captures/states/pages/sent--light-390.png',
						}),
						duration: 10,
					},
				],
			},
			'Emitted entries differ from exact requested projection',
		],
		[
			'a duration the producing case did not report',
			{ entries: [{ ...createDestinationFixture(), duration: 99 }] },
			`Emitted duration differs from its producing case: ${FIXTURE_CASE}`,
		],
	])('refuses %s', (_label, overrides, message) => {
		expect(
			readCaptureEvidenceFailure(() => validateCaptureRunFixture(createRunFixture(overrides))),
		).toMatchObject({
			code: 'EVIDENCE',
			message: message,
		})
	})

	it('refuses a destination produced by another project', () => {
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRunFixture(
					createRunFixture(),
					readCaptureReportFixture(),
					'journey:dark-1280',
				),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: `Registry differs from eligible declaration: ${FIXTURE_CASE}`,
		})
	})

	it('refuses a record the reporter disagrees with', () => {
		expect(
			readCaptureEvidenceFailure(() => validateCaptureRunFixture(createRunFixture(), mismatched)),
		).toMatchObject({
			code: 'EVIDENCE',
			message: 'Run declarations differ from full reporter declarations',
		})
	})

	it('refuses a registry entry no eligible declaration owns', () => {
		const extra = createDestinationFixture({
			case: 'orphan case',
			state: 'sent',
			file: 'tmp/captures/states/pages/sent--light-390.png',
		})
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRunFixture(
					createRunFixture({ registry: [createDestinationFixture(), extra] }),
				),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: 'Registry contains an ineligible or undeclared case',
		})
	})

	it('refuses a destination whose owner the declaration does not select', () => {
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRunFixture(
					createRunFixture({ registry: [createDestinationFixture({ part: 'files' })] }),
				),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: `Registry differs from eligible declaration: ${FIXTURE_CASE}`,
		})
	})

	it('refuses a request its record contradicts', () => {
		const identity = createIdentityFixture()
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRunFixture(
					createRunFixture({
						identity: { ...identity, id: 'other' },
						request: createRequestFixture(),
					}),
				),
			),
		).toMatchObject({ code: 'EVIDENCE', message: 'Run identity differs from its request' })
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRunFixture(
					createRunFixture({
						identity,
						request: createRequestFixture({ variants: ['dark-1280'] }),
					}),
				),
			),
		).toMatchObject({ code: 'EVIDENCE', message: 'Run identity differs from its request' })
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRunFixture(
					createRunFixture({
						identity,
						request: createRequestFixture({ selector: 'pages:files' }),
					}),
				),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: 'Selected full case names differ from passed results',
		})
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRunFixture(
					createRunFixture({ identity, request: createRequestFixture({ state: 'sent' }) }),
				),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: 'Requested state differs from its selected declaring case',
		})
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRunFixture(
					createRunFixture({ identity, request: createRequestFixture({ command: 'journey' }) }),
				),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: 'Emitted entries differ from exact requested projection',
		})
	})

	it('refuses a request whose case name selects nothing the record passed', () => {
		const identity = createIdentityFixture()
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRunFixture(
					createRunFixture({ identity, request: createRequestFixture({ case: 'another case' }) }),
				),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: 'Selected full case names differ from passed results',
		})
	})
})

describe('validateCaptureReceipt', () => {
	const report = readCaptureReportFixture()

	it('accepts a complete receipt that agrees with its reporter', () => {
		expect(
			captureError(() => validateCaptureReceipt(createReceiptFixture(), report)),
		).toBeUndefined()
	})

	it.each([
		[
			'an incomplete receipt',
			createReceiptFixture({ complete: false }),
			report,
			'Registry receipt does not prove complete eligible behavior',
		],
		[
			'declarations the reporter lacks',
			createReceiptFixture({ declarations: [createDeclarationFixture({ states: ['sent'] })] }),
			report,
			'Registry receipt does not prove complete eligible behavior',
		],
		[
			'a reporter with no eligible declaration',
			createReceiptFixture({ declarations: [] }),
			readCaptureReport(createVitestFixture([])),
			'Registry receipt does not prove complete eligible behavior',
		],
		[
			'an eligible case the reporter did not pass',
			createReceiptFixture(),
			readCaptureReport(
				createVitestFixture([
					{
						fullName: FIXTURE_CASE,
						status: 'failed',
						meta: { owner: 'pages:mail', variant: 'light-390', states: ['inbox'] },
					},
				]),
			),
			'Registry receipt does not prove complete eligible behavior',
		],
		[
			'a registry that lacks a declared destination',
			createReceiptFixture({ registry: [] }),
			report,
			'Registry receipt destination coverage differs from declarations',
		],
		[
			'a destination outside the declared owner',
			createReceiptFixture({ registry: [createDestinationFixture({ part: 'files' })] }),
			report,
			'Registry receipt destination coverage differs from declarations',
		],
		[
			'an undeclared output',
			createReceiptFixture({
				registry: [
					createDestinationFixture(),
					createDestinationFixture({
						case: 'orphan',
						state: 'sent',
						file: 'tmp/captures/states/pages/sent--light-390.png',
					}),
				],
			}),
			report,
			'Registry receipt contains an undeclared output or mixes producing projects',
		],
	])('refuses %s', (_label, receipt, against, message) => {
		expect(
			readCaptureEvidenceFailure(() => validateCaptureReceipt(receipt, against)),
		).toMatchObject({
			code: 'EVIDENCE',
			message: message,
		})
	})

	it('refuses a receipt whose destinations come from two producing projects', () => {
		const states = ['inbox', 'sent']
		const wide = readCaptureReport(
			createVitestFixture([
				{
					fullName: FIXTURE_CASE,
					status: 'passed',
					meta: { owner: 'pages:mail', variant: 'light-390', states },
				},
			]),
		)
		const receipt = createReceiptFixture({
			declarations: [createDeclarationFixture({ states })],
			registry: [
				createDestinationFixture(),
				createDestinationFixture({
					state: 'sent',
					file: 'tmp/captures/states/pages/sent--light-390.png',
					project: 'journey:dark-1280',
				}),
			],
		})
		expect(readCaptureEvidenceFailure(() => validateCaptureReceipt(receipt, wide))).toMatchObject({
			code: 'EVIDENCE',
			message: 'Registry receipt contains an undeclared output or mixes producing projects',
		})
		expect(
			captureError(() =>
				validateCaptureReceipt(
					createReceiptFixture({
						declarations: [createDeclarationFixture({ states })],
						registry: [
							createDestinationFixture(),
							createDestinationFixture({
								state: 'sent',
								file: 'tmp/captures/states/pages/sent--light-390.png',
							}),
						],
					}),
					wide,
				),
			),
		).toBeUndefined()
	})

	it('refuses a state declared twice with only a case difference', () => {
		const states = ['inbox', 'Inbox']
		const wide = readCaptureReport(
			createVitestFixture([
				{
					fullName: FIXTURE_CASE,
					status: 'passed',
					meta: { owner: 'pages:mail', variant: 'light-390', states },
				},
			]),
		)
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureReceipt(
					createReceiptFixture({ declarations: [createDeclarationFixture({ states })] }),
					wide,
				),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: 'Duplicate states within a declaration: inbox, Inbox',
		})
	})
})

describe('resolveCaptureStatus', () => {
	it('chooses the highest-precedence classification and defaults to current', () => {
		expect(resolveCaptureStatus([])).toBe('current')
		expect(resolveCaptureStatus(['current'])).toBe('current')
		expect(resolveCaptureStatus(['stale-own'])).toBe('stale-own')
		expect(resolveCaptureStatus(['stale-own', 'stale-shared'])).toBe('stale-shared')
		expect(resolveCaptureStatus(['stale-shared', 'unstamped', 'stale-own'])).toBe('unstamped')
		expect(resolveCaptureStatus(['missing', 'unstamped'])).toBe('missing')
		expect(resolveCaptureStatus(['orphan', 'missing'])).toBe('orphan')
		expect(resolveCaptureStatus(['stale-own', 'duplicate', 'orphan'])).toBe('duplicate')
	})

	it('does not depend on the order the findings arrive in', () => {
		expect(resolveCaptureStatus(['missing', 'stale-own'])).toBe(
			resolveCaptureStatus(['stale-own', 'missing']),
		)
	})
})

describe('readCaptureDirty', () => {
	it('reads NUL-delimited paths without splitting on spaces', () => {
		expect(readCaptureDirty(' M src/a.ts\0?? docs/with space/file name.md\0')).toEqual([
			'docs/with space/file name.md',
			'src/a.ts',
		])
	})

	it('reads both sides of a rename and of a copy', () => {
		expect(readCaptureDirty('R  src/new.ts\0src/old.ts\0')).toEqual(['src/new.ts', 'src/old.ts'])
		expect(readCaptureDirty('C  src/copy.ts\0src/source.ts\0 M src/a.ts\0')).toEqual([
			'src/a.ts',
			'src/copy.ts',
			'src/source.ts',
		])
	})

	it('reads an original path that begins like a rename status as a path', () => {
		expect(readCaptureDirty('R  src/new.ts\0Common/old.ts\0 M src/a.ts\0')).toEqual([
			'Common/old.ts',
			'src/a.ts',
			'src/new.ts',
		])
	})

	it('sorts and removes repeated paths and reads an empty status as clean', () => {
		expect(readCaptureDirty(' M b.ts\0 M a.ts\0MM a.ts\0')).toEqual(['a.ts', 'b.ts'])
		expect(readCaptureDirty('')).toEqual([])
	})

	it('refuses a rename with no original path', () => {
		expect(readCaptureEvidenceFailure(() => readCaptureDirty('R  src/new.ts\0'))).toMatchObject({
			code: 'EVIDENCE',
			message: 'Incomplete Git rename provenance',
		})
	})
})

describe('collectCaptureAncestors', () => {
	it('returns each colon-bounded prefix from the scope through the owner', () => {
		expect(collectCaptureAncestors('pages:mail:inbox')).toEqual([
			'pages',
			'pages:mail',
			'pages:mail:inbox',
		])
		expect(collectCaptureAncestors('pages')).toEqual(['pages'])
	})
})

describe('buildCaptureTags', () => {
	it('declares each owner and ancestor tag and each scope and part tag once', () => {
		expect(buildCaptureTags(['pages:mail'])).toEqual([
			'owner:pages',
			'owner:pages:mail',
			'pages',
			'pages:mail',
		])
		expect(buildCaptureTags(['pages:mail', 'pages:board', 'reference:components:details'])).toEqual(
			[
				'owner:pages',
				'owner:pages:mail',
				'pages',
				'pages:mail',
				'owner:pages:board',
				'pages:board',
				'owner:reference',
				'owner:reference:components',
				'owner:reference:components:details',
				'reference',
				'reference:components',
			],
		)
		expect(buildCaptureTags([])).toEqual([])
	})

	it('refuses an owner that is not a canonical selector', () => {
		expect(
			readCaptureEvidenceFailure(() => buildCaptureTags(['pages:mail', 'pages::board', ''])),
		).toMatchObject({ code: 'HOST', message: expect.stringContaining('"pages::board", ""') })
	})
})

describe('buildCaptureCase', () => {
	it('derives an owner-bearing case tags from its owner and its states parts', () => {
		const options: TestOptions = buildCaptureCase(
			{
				owner: 'pages:mail',
				states: ['mail-screen', 'mail-reader'],
				variant: 'light-390',
				timeout: 5000,
			},
			CAPTURE_RECORD_RULES,
		)
		expect(options).toEqual({
			tags: ['owner:pages', 'owner:pages:mail', 'pages', 'pages:mail'],
			meta: { owner: 'pages:mail', states: ['mail-screen', 'mail-reader'], variant: 'light-390' },
			timeout: 5000,
		})
	})

	it('derives a section owner and a scope owner whose states belong to one of its parts', () => {
		expect(
			buildCaptureCase(
				{ owner: 'reference:components:details', states: ['details'], variant: 'light-390' },
				CAPTURE_RECORD_RULES,
			).tags,
		).toEqual([
			'owner:reference',
			'owner:reference:components',
			'owner:reference:components:details',
			'reference',
			'reference:components',
		])
		expect(
			buildCaptureCase(
				{ owner: 'pages', states: ['mail-screen'], variant: 'light-390', eligible: false },
				CAPTURE_RECORD_RULES,
			),
		).toEqual({
			tags: ['owner:pages', 'pages', 'pages:mail'],
			meta: { owner: 'pages', states: ['mail-screen'], variant: 'light-390', eligible: false },
		})
	})

	it('keeps an ownerless final case on the declared tags it names', () => {
		const tags = buildCaptureTags(CAPTURE_RECORD_RULES.owners)
		expect(
			buildCaptureCase({ states: [], variant: 'light-390', tags }, CAPTURE_RECORD_RULES),
		).toEqual({ tags: [...tags], meta: { states: [], variant: 'light-390' } })
	})

	it('refuses an undeclared owner, named tags beside an owner, and an undeclared tag', () => {
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureCase({ owner: 'pages:calendar', variant: 'light-390' }, CAPTURE_RECORD_RULES),
			),
		).toMatchObject({ code: 'HOST', message: expect.stringContaining('"pages:calendar"') })
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureCase(
					{ owner: 'pages:mail', variant: 'light-390', tags: ['owner:pages:mail'] },
					CAPTURE_RECORD_RULES,
				),
			),
		).toMatchObject({ code: 'HOST', message: expect.stringContaining('derives its tags') })
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureCase(
					{ states: [], variant: 'light-390', tags: ['pages:mail', 'pages:calendar'] },
					CAPTURE_RECORD_RULES,
				),
			),
		).toMatchObject({ code: 'HOST', message: expect.stringContaining('"pages:calendar"') })
	})

	it('refuses capture tags on a case that declares no states', () => {
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureCase({ variant: 'light-390', tags: ['pages'] }, CAPTURE_RECORD_RULES),
			),
		).toMatchObject({ code: 'HOST', message: expect.stringContaining('declares no states') })
	})

	it('refuses a state outside the owner and a state whose part is not a declared owner', () => {
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureCase(
					{ owner: 'pages:mail', states: ['buttons-rest'], variant: 'light-390' },
					CAPTURE_RECORD_RULES,
				),
			),
		).toMatchObject({
			code: 'HOST',
			message: expect.stringContaining('buttons-rest belongs to reference:components:buttons'),
		})
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureCase(
					{ owner: 'shell:overview', states: ['overview-deep'], variant: 'light-390' },
					CAPTURE_RECORD_RULES,
				),
			),
		).toMatchObject({
			code: 'HOST',
			message: expect.stringContaining('shell:overview:hero:banner'),
		})
	})

	it('lets the host part rule refuse a state it does not declare', () => {
		expect(
			captureError(() =>
				buildCaptureCase(
					{ owner: 'pages:mail', states: ['mail-unknown'], variant: 'light-390' },
					CAPTURE_RECORD_RULES,
				),
			),
		).toMatchObject({ message: 'Unknown fixture state: mail-unknown' })
	})
})

describe('collectCaptureCases', () => {
	it(
		'names a real Vitest case by its suite and own titles and keeps its capture metadata',
		{ meta: { owner: 'pages:mail', states: ['mail-screen'], variant: 'light-390' } },
		({ task }) => {
			const cases = collectCaptureCases(task.file)
			const own = cases.find(
				(entry) =>
					entry.name ===
					'collectCaptureCases names a real Vitest case by its suite and own titles and keeps its capture metadata',
			)
			expect(own).toMatchObject({
				mode: 'run',
				tags: [],
				meta: { owner: 'pages:mail', states: ['mail-screen'], variant: 'light-390' },
			})
			expect(own?.result?.state).toBe('run')
			expect(cases.some((entry) => entry.name.startsWith('describeCaptureError '))).toBe(true)
		},
	)

	it('skips the file name, keeps filtered cases, and copies each result', () => {
		expect(
			collectCaptureCases({
				name: 'tests/app/browser/integration.test.ts',
				filepath: '/workspace/tests/app/browser/integration.test.ts',
				mode: 'run',
				meta: {},
				tasks: [
					{
						name: 'mail',
						mode: 'run',
						meta: {},
						tasks: [
							{
								name: 'opens the inbox',
								mode: 'skip',
								tags: ['owner:pages:mail'],
								meta: { owner: 'pages:mail', states: ['mail-screen'], eligible: false },
							},
						],
					},
					{
						name: 'closes the run',
						mode: 'run',
						meta: {},
						result: { state: 'pass', duration: 3 },
					},
				],
			}),
		).toEqual([
			{
				name: 'mail opens the inbox',
				mode: 'skip',
				tags: ['owner:pages:mail'],
				meta: { owner: 'pages:mail', states: ['mail-screen'], eligible: false },
			},
			{
				name: 'closes the run',
				mode: 'run',
				tags: [],
				meta: {},
				result: { state: 'pass', duration: 3 },
			},
		])
		expect(collectCaptureCases({ name: 'mail', mode: 'run', meta: {}, tasks: [] })).toEqual([])
	})
})

describe('requireCaptureCases', () => {
	it('accepts no selection, the all selector, an owner with no parked case, and an exact case', () => {
		expect(
			captureError(() => requireCaptureCases(CAPTURE_PARKING_CASES, CAPTURE_RECORD_RULES)),
		).toBeUndefined()
		for (const selection of [
			{ selector: 'all' },
			{ selector: 'shell' },
			{ selector: 'pages:mail', case: 'Fixture mail opens the reader' },
		])
			expect(
				captureError(() =>
					requireCaptureCases(CAPTURE_PARKING_CASES, CAPTURE_RECORD_RULES, selection),
				),
			).toBeUndefined()
	})

	it('refuses a case owned outside the selection that places a selected state', () => {
		for (const selector of ['pages:mail', 'pages'])
			expect(
				readCaptureEvidenceFailure(() =>
					requireCaptureCases(CAPTURE_PARKING_CASES, CAPTURE_RECORD_RULES, { selector }),
				),
			).toMatchObject({
				code: 'HOST',
				message: expect.stringContaining(
					'Fixture overview parks a mail state: owner shell:overview; foreign states mail-screen',
				),
			})
	})

	it('refuses a selector the host does not declare', () => {
		expect(
			readCaptureEvidenceFailure(() =>
				requireCaptureCases(CAPTURE_PARKING_CASES, CAPTURE_RECORD_RULES, {
					selector: 'pages:calendar',
				}),
			),
		).toMatchObject({ code: 'SELECTION', message: expect.stringContaining('"pages:calendar"') })
	})
})

describe('buildCaptureDestinations', () => {
	it('maps each eligible owner-bearing state to its portfolio, variant, file, and sources', () => {
		const destinations = buildCaptureDestinations(createRecordCases(), CAPTURE_RECORD_RULES, {
			project: CAPTURE_RECORD_PROJECT,
			portfolios: CAPTURE_RECORD_MAPPINGS,
		})
		expect(destinations.map((entry) => entry.state)).toEqual([
			'mail-screen',
			'mail-reader',
			'buttons-rest',
			'details',
		])
		expect(destinations[1]).toEqual({
			portfolio: 'focused',
			state: 'mail-reader',
			scope: 'pages',
			part: 'mail',
			variant: 'light-320',
			project: 'journey:light-390',
			file: 'tmp/captures/focused/mail-reader--light-320.png',
			case: CAPTURE_RECORD_NAMES.mail,
			sources: createSourcesFixture({ own: ['src/pages/mail/**'] }),
		})
		expect(destinations[3]).toEqual({
			portfolio: 'states',
			state: 'details',
			scope: 'reference',
			part: 'components',
			section: 'details',
			variant: 'light-390',
			project: 'journey:light-390',
			file: 'tmp/captures/states/reference/details--light-390.png',
			case: CAPTURE_RECORD_NAMES.details,
			sources: createSourcesFixture({ own: ['src/reference/components/details/**'] }),
		})
	})

	it('refuses a state with no mapping and a state with two', () => {
		const options = { project: CAPTURE_RECORD_PROJECT, portfolios: CAPTURE_RECORD_MAPPINGS }
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureDestinations(createRecordCases(), CAPTURE_RECORD_RULES, {
					...options,
					portfolios: CAPTURE_RECORD_MAPPINGS.slice(0, 1),
				}),
			),
		).toMatchObject({ code: 'HOST', message: expect.stringContaining('mail-reader') })
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureDestinations(createRecordCases(), CAPTURE_RECORD_RULES, {
					...options,
					portfolios: [...CAPTURE_RECORD_MAPPINGS, ...CAPTURE_RECORD_MAPPINGS.slice(1)],
				}),
			),
		).toMatchObject({ code: 'HOST', message: expect.stringContaining('"focused", "focused"') })
	})

	it('refuses a state outside its case owner and an owner outside the scope, part, and section form', () => {
		const options = { project: CAPTURE_RECORD_PROJECT, portfolios: CAPTURE_RECORD_MAPPINGS }
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureDestinations(
					[
						{
							name: 'mail',
							mode: 'run',
							tags: [],
							meta: { owner: 'pages:mail', states: ['arrival'] },
						},
					],
					CAPTURE_RECORD_RULES,
					options,
				),
			),
		).toMatchObject({
			code: 'HOST',
			message: expect.stringContaining('arrival belongs to shell:overview'),
		})
		for (const [owner, state] of [
			['shell', 'overview-flat'],
			['shell:overview', 'overview-deep'],
		] as const)
			expect(
				readCaptureEvidenceFailure(() =>
					buildCaptureDestinations(
						[{ name: 'shell', mode: 'run', tags: [], meta: { owner, states: [state] } }],
						CAPTURE_RECORD_RULES,
						{
							...options,
							portfolios: [{ ...requireValue(CAPTURE_RECORD_MAPPINGS[0]), states: [state] }],
						},
					),
				),
			).toMatchObject({ code: 'HOST', message: expect.stringContaining(state) })
	})
})

describe('buildCaptureRun', () => {
	it.each(CAPTURE_RECORD_SCENARIOS)('round-trips %s through the validator', (_label, scenario) => {
		const { run, report } = createRecordRun(scenario)
		expect(
			captureError(() => validateCaptureRun(run, report, CAPTURE_RECORD_PROJECT)),
		).toBeUndefined()
		expect(isCaptureRun(parseJSON(JSON.stringify(run)))).toBe(true)
	})

	it('derives passed cases, completeness, reference completeness, and durations from the cases', () => {
		const written = createRecordRun(
			requireValue(new Map(CAPTURE_RECORD_SCENARIOS).get('a run that wrote each passed frame')),
		)
		expect(written.run).toMatchObject({
			version: 1,
			variant: 'light-390',
			time: CAPTURE_RECORD_TIME,
			complete: false,
			reference: true,
			passed: [CAPTURE_RECORD_NAMES.mail, CAPTURE_RECORD_NAMES.details],
			observed: ['mail-screen', 'mail-reader', 'details'],
		})
		expect(written.run.identity).toBeUndefined()
		expect(written.run.declarations.map((entry) => [entry.case, entry.eligible])).toEqual([
			[CAPTURE_RECORD_NAMES.mail, true],
			[CAPTURE_RECORD_NAMES.buttons, true],
			[CAPTURE_RECORD_NAMES.files, false],
			[CAPTURE_RECORD_NAMES.details, true],
		])
		expect(written.run.entries.map((entry) => [entry.state, entry.duration])).toEqual([
			['mail-screen', 12],
			['mail-reader', 12],
			['details', 7],
		])
		expect(
			createRecordRun(requireValue(new Map(CAPTURE_RECORD_SCENARIOS).get('a complete run'))).run
				.complete,
		).toBe(true)
	})

	it('binds a requested run to its request identity and keeps the destination file', () => {
		const { run } = createRecordRun(
			requireValue(
				new Map(CAPTURE_RECORD_SCENARIOS).get(
					'a capture of one requested state written at an absolute provider path',
				),
			),
		)
		expect(run.identity).toEqual(createIdentityFixture())
		expect(run.request).toEqual(createRequestFixture({ state: 'mail-reader' }))
		expect(run.entries.map((entry) => entry.file)).toEqual([
			'tmp/captures/focused/mail-reader--light-320.png',
		])
	})

	it.each(CAPTURE_RECORD_MUTATIONS)('lets the validator refuse %s', (_label, scenario, mutate) => {
		const { run, report } = createRecordRun(
			requireValue(new Map(CAPTURE_RECORD_SCENARIOS).get(scenario)),
		)
		expect(
			captureError(() => validateCaptureRun(run, report, CAPTURE_RECORD_PROJECT)),
		).toBeUndefined()
		expect(
			readCaptureEvidenceFailure(() =>
				validateCaptureRun(mutate(run), report, CAPTURE_RECORD_PROJECT),
			),
		).toMatchObject({ code: 'EVIDENCE' })
	})

	it('refuses an emitted state with no destination and a producing case with no duration', () => {
		const { cases, registry } = createRecordRun(
			requireValue(new Map(CAPTURE_RECORD_SCENARIOS).get('a run that wrote each passed frame')),
		)
		const base = { cases, registry, observed: [], variant: 'light-390', time: CAPTURE_RECORD_TIME }
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureRun({
					...base,
					emitted: [['board-lanes', 'tmp/captures/states/pages/board-lanes--light-390.png']],
				}),
			),
		).toMatchObject({ code: 'EVIDENCE', message: expect.stringContaining('board-lanes') })
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureRun({
					...base,
					cases: cases.map((entry) =>
						entry.name === CAPTURE_RECORD_NAMES.details
							? { ...entry, result: { state: 'pass' } }
							: entry,
					),
					emitted: [['details', 'tmp/captures/states/reference/details--light-390.png']],
				}),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: expect.stringContaining(CAPTURE_RECORD_NAMES.details),
		})
	})

	it('refuses an emitted path other than its destination file', () => {
		const { cases, registry } = createRecordRun(
			requireValue(new Map(CAPTURE_RECORD_SCENARIOS).get('a run that wrote each passed frame')),
		)
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureRun({
					cases,
					registry,
					observed: ['mail-screen', 'mail-reader', 'details'],
					emitted: [['mail-reader', 'tmp/captures/states/pages/mail-reader--light-390.png']],
					variant: 'light-390',
					time: CAPTURE_RECORD_TIME,
				}),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: expect.stringContaining('tmp/captures/focused/mail-reader--light-320.png'),
		})
	})

	it('refuses an owner-bearing case that declares no variant', () => {
		expect(
			readCaptureEvidenceFailure(() =>
				buildCaptureRun({
					cases: [{ name: 'mail', mode: 'run', tags: [], meta: { owner: 'pages:mail' } }],
					registry: [],
					observed: [],
					emitted: [],
					variant: 'light-390',
					time: CAPTURE_RECORD_TIME,
				}),
			),
		).toMatchObject({ code: 'HOST', message: expect.stringContaining('mail') })
	})
})

describe('renderCaptureArtifact', () => {
	it('renders the record binding and one line per passed case', () => {
		expect(
			renderCaptureArtifact('tmp/captures/states/runs/run-1/selected/light-390.json', {
				passed: [CAPTURE_RECORD_NAMES.mail, CAPTURE_RECORD_NAMES.details],
			}),
		).toEqual([
			'record=tmp/captures/states/runs/run-1/selected/light-390.json',
			`case-ran=${CAPTURE_RECORD_NAMES.mail}`,
			`case-ran=${CAPTURE_RECORD_NAMES.details}`,
		])
		expect(renderCaptureArtifact('tmp/run.json', { passed: [] })).toEqual(['record=tmp/run.json'])
	})

	it('renders lines the artifact reader reads back under either line ending', () => {
		const record = 'tmp/captures/states/runs/run-1/selected/light-390.json'
		const passed = [CAPTURE_RECORD_NAMES.mail, CAPTURE_RECORD_NAMES.details]
		for (const ending of ['\n', '\r\n'])
			expect(
				readCaptureArtifact(
					[
						'# light-390',
						'coverage=complete',
						...renderCaptureArtifact(record, { passed }),
						'recorded=elsewhere',
						'## Journal',
						'',
					].join(ending),
				),
			).toEqual({ records: [record], cases: passed })
	})

	it('refuses a record path or a case name that a line cannot carry', () => {
		expect(
			readCaptureEvidenceFailure(() => renderCaptureArtifact('../escape.json', { passed: [] })),
		).toMatchObject({ code: 'EVIDENCE', message: expect.stringContaining('"../escape.json"') })
		expect(
			readCaptureEvidenceFailure(() =>
				renderCaptureArtifact('tmp/run.json', { passed: ['mail\ncase-ran=board', 'mail\rreader'] }),
			),
		).toMatchObject({
			code: 'EVIDENCE',
			message: expect.stringContaining('"mail\\ncase-ran=board", "mail\\rreader"'),
		})
	})
})

describe('readCaptureArtifact', () => {
	it('reads each record binding and ran case in text order and ignores every other line', () => {
		expect(
			readCaptureArtifact(
				'# light-390\nrecord=tmp/a.json\r\ncase-ran=mail\ncase-ran=\nrecord=tmp/b.json.foreign\nrecorded=tmp/c.json\n',
			),
		).toEqual({ records: ['tmp/a.json', 'tmp/b.json.foreign'], cases: ['mail', ''] })
		expect(readCaptureArtifact('')).toEqual({ records: [], cases: [] })
	})
})
