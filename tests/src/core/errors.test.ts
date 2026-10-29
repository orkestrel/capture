import { CAPTURE_ERROR_BRAND, CAPTURE_ERROR_CODES, CaptureError, isCaptureError } from '@src/core'
import { createHostileValues } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	CaptureContextFixture,
	createCaptureCallableContext,
	ForeignCaptureError,
	SpecialCaptureError,
} from '../../setup.js'
describe('CaptureError', () => {
	it('carries its message, condition, context, and cause', () => {
		const cause = new Error('underlying')
		const error = new CaptureError('Unknown variant: phone', {
			code: 'SELECTION',
			context: { variant: 'phone' },
			cause,
		})
		expect(error).toBeInstanceOf(Error)
		expect(error.name).toBe('CaptureError')
		expect(error.message).toBe('Unknown variant: phone')
		expect(error.code).toBe('SELECTION')
		expect(error.context).toEqual({ variant: 'phone' })
		expect(error.cause).toBe(cause)
	})

	it('omits the cause and the context when none is supplied', () => {
		const error = new CaptureError('Empty selection', { code: 'USAGE' })
		expect(error.context).toBeUndefined()
		expect(Object.hasOwn(error, 'cause')).toBe(false)
	})

	it('holds the error itself under a non-enumerable, non-writable brand', () => {
		const error = new CaptureError('Empty selection', { code: 'USAGE' })
		expect(Object.getOwnPropertyDescriptor(error, CAPTURE_ERROR_BRAND)).toMatchObject({
			value: error,
			enumerable: false,
			writable: false,
		})
	})

	it('keys its brand to the package and the class', () => {
		expect(CAPTURE_ERROR_BRAND).toBe(Symbol.for('@orkestrel/capture.CaptureError'))
	})
})

describe('isCaptureError', () => {
	it('accepts a class instance as context', () => {
		const error = new CaptureError('Refused', { code: 'HOST' })
		Object.defineProperty(error, 'context', { value: new CaptureContextFixture() })
		expect(isCaptureError(error)).toBe(true)
	})

	it('accepts a callable object as context', () => {
		const error = new CaptureError('Refused', { code: 'HOST' })
		Object.defineProperty(error, 'context', { value: createCaptureCallableContext() })
		expect(isCaptureError(error)).toBe(true)
	})

	it.each(CAPTURE_ERROR_CODES)('accepts an error carrying %s', (code) => {
		expect(isCaptureError(new CaptureError('Refused', { code }))).toBe(true)
	})

	it('accepts an instance of a subclass', () => {
		expect(isCaptureError(new SpecialCaptureError('Refused', { code: 'STAGE' }))).toBe(true)
	})

	it('accepts an error another installed copy of the package stamped', () => {
		expect(isCaptureError(new ForeignCaptureError('Refused'))).toBe(true)
	})

	it('refuses a plain error and a look-alike carrying the same code and no brand', () => {
		const lookalike = Object.assign(new Error('Refused'), { code: 'USAGE', name: 'CaptureError' })
		expect(isCaptureError(new Error('Refused'))).toBe(false)
		expect(isCaptureError(lookalike)).toBe(false)
	})

	it('refuses a branded error whose prototype is the native error prototype', () => {
		const error = Object.assign(new Error('Refused'), { code: 'USAGE' })
		Object.defineProperty(error, CAPTURE_ERROR_BRAND, { value: error })
		expect(isCaptureError(error)).toBe(false)
	})

	it('refuses a transparent proxy over a branded error', () => {
		const error = new CaptureError('Refused', { code: 'USAGE' })
		expect(isCaptureError(new Proxy(error, {}))).toBe(false)
	})

	it('refuses a plain object that only carries the brand', () => {
		const forged = { code: 'USAGE', message: 'Refused' }
		Object.defineProperty(forged, CAPTURE_ERROR_BRAND, { value: forged })
		expect(isCaptureError(forged)).toBe(false)
	})

	it('refuses a branded error that carries an undeclared condition or a non-record context', () => {
		const undeclared = new CaptureError('Refused', { code: 'USAGE' })
		Object.defineProperty(undeclared, 'code', { value: 'NOPE' })
		const scalar = new CaptureError('Refused', { code: 'USAGE' })
		Object.defineProperty(scalar, 'context', { value: 'text' })
		expect(isCaptureError(undeclared)).toBe(false)
		expect(isCaptureError(scalar)).toBe(false)
	})

	it('refuses an object that inherits a branded error instead of owning the brand', () => {
		const first = new CaptureError('First', { code: 'USAGE' })
		expect(isCaptureError(Object.create(first))).toBe(false)
	})

	it('stays total over hostile values', () => {
		const hostile = new Proxy(
			{},
			{
				get: () => {
					throw new Error('Hostile getter')
				},
				getPrototypeOf: () => {
					throw new Error('Hostile prototype')
				},
			},
		)
		for (const value of [...createHostileValues(), hostile, undefined, null, 'refused', 42]) {
			expect(isCaptureError(value)).toBe(false)
		}
	})
})
