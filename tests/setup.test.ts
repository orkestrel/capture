import {
	isCapturePath,
	isCaptureDeclaration,
	isCaptureDestination,
	isCaptureIdentity,
	isCaptureLookup,
	isCaptureManifest,
	isCaptureReceipt,
	isCaptureRegistry,
	isCaptureRequest,
	isCaptureRun,
	isCaptureSources,
	isCaptureStamp,
	readCaptureReport,
	validateCaptureReceipt,
	validateCaptureRun,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	FIXTURE_CASE,
	FIXTURE_PROJECT,
	REFUSED_PATHS,
	createDeclarationFixture,
	createDestinationFixture,
	createIdentityFixture,
	createLookupFixture,
	createManifestFixture,
	createReceiptFixture,
	createRegistryFixture,
	createRequestFixture,
	createRunFixture,
	createSourcesFixture,
	createStampFixture,
	createVitestFixture,
	readFailure,
} from './setup.js'

describe('capture fixtures', () => {
	it('lists only paths the portable-path guard refuses', () => {
		expect(REFUSED_PATHS.length).toBeGreaterThan(0)
		expect(REFUSED_PATHS.filter((path) => isCapturePath(path))).toEqual([])
		expect(isCapturePath('tmp/valid/image.png')).toBe(true)
	})

	it('returns what a callback throws and undefined when it returns', () => {
		const thrown = new Error('boom')
		expect(
			readFailure(() => {
				throw thrown
			}),
		).toBe(thrown)
		expect(readFailure(() => 'fine')).toBeUndefined()
	})

	it('builds values the protocol guards accept', () => {
		expect(isCaptureSources(createSourcesFixture())).toBe(true)
		expect(isCaptureDestination(createDestinationFixture())).toBe(true)
		expect(isCaptureDeclaration(createDeclarationFixture())).toBe(true)
		expect(isCaptureIdentity(createIdentityFixture())).toBe(true)
		expect(isCaptureRequest(createRequestFixture())).toBe(true)
		expect(isCaptureRun(createRunFixture())).toBe(true)
		expect(isCaptureReceipt(createReceiptFixture())).toBe(true)
		expect(isCaptureRegistry(createRegistryFixture())).toBe(true)
		expect(isCaptureLookup(createLookupFixture())).toBe(true)
		expect(isCaptureStamp(createStampFixture())).toBe(true)
		expect(isCaptureManifest(createManifestFixture())).toBe(true)
	})

	it('replaces exactly the fields an override names', () => {
		expect(createDestinationFixture({ state: 'sent' })).toEqual({
			...createDestinationFixture(),
			state: 'sent',
		})
		expect(createDeclarationFixture({ eligible: false }).eligible).toBe(false)
		expect(createRequestFixture({ command: 'journey' }).command).toBe('journey')
		expect(createRunFixture({ complete: false }).complete).toBe(false)
	})

	it('builds a reporter, a run, and a receipt that agree with one another', () => {
		const report = readCaptureReport(createVitestFixture())
		expect(report.assertions.map((assertion) => assertion.case)).toEqual([FIXTURE_CASE])
		expect(() => validateCaptureRun(createRunFixture(), report, FIXTURE_PROJECT)).not.toThrow()
		expect(() => validateCaptureReceipt(createReceiptFixture(), report)).not.toThrow()
	})
})
