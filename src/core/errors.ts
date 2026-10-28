import type { CaptureErrorCode, CaptureErrorContext, CaptureErrorOptions } from './types.js'
import { holds, INTRINSICS, isError, isRecord } from '@orkestrel/contract'
import { CAPTURE_ERROR_BRAND, CAPTURE_ERROR_CODES } from './constants.js'

/**
 * Reports one capture failure under a stable condition axis.
 *
 * @remarks
 * Every refusal the engine, the runner, and the readers raise arrives as one of these, so the
 * executable branches on `code` rather than on message text: `USAGE` exits 64 and every other
 * condition exits 1. Narrow a caught value with `isCaptureError` before reading `code`.
 *
 * @example
 * ```ts
 * const error = new CaptureError('Unknown variant: phone', {
 * 	code: 'SELECTION',
 * 	context: { variant: 'phone' },
 * })
 * error.code // 'SELECTION'
 * error.context?.variant // 'phone'
 * ```
 */
export class CaptureError extends Error {
	override readonly name = 'CaptureError'
	readonly code: CaptureErrorCode
	readonly context: CaptureErrorContext | undefined

	/**
	 * Creates one classified capture failure.
	 *
	 * @param message - Human-readable description of what failed
	 * @param options - The condition, optional structured context, and optional cause
	 */
	constructor(message: string, options: CaptureErrorOptions) {
		super(message, 'cause' in options ? { cause: options.cause } : undefined)
		// The brand holds the error itself, so a transparent proxy over a branded error forwards its
		// target's identity and fails the comparison in `isCaptureError`.
		Object.defineProperty(this, CAPTURE_ERROR_BRAND, { value: this })
		this.code = options.code
		this.context = options.context
	}
}

/**
 * Checks whether an unknown value is a capture error.
 *
 * @remarks
 * Recognition requires a native `Error` whose prototype is not `Error.prototype`, an own brand
 * property holding the tested value itself, a declared condition code, and a record or absent
 * context. It recognizes an error from another installed copy of this package, and refuses a
 * look-alike with the same code and no brand, a proxy over a branded error, and a plain object
 * that only carries the brand.
 *
 * @param value - The value to inspect
 * @returns True if the value is a `CaptureError`; false otherwise
 *
 * @example
 * ```ts
 * isCaptureError(new CaptureError('Empty selection', { code: 'USAGE' })) // true
 * isCaptureError(new Error('Empty selection')) // false
 * ```
 */
export function isCaptureError(value: unknown): value is CaptureError {
	return holds(() => {
		if (!isError(value) || INTRINSICS.prototype(value) === INTRINSICS.error.prototype) return false
		if (INTRINSICS.describe(value, CAPTURE_ERROR_BRAND)?.value !== value) return false
		const code: unknown = INTRINSICS.reflect.read(value, 'code')
		const context: unknown = INTRINSICS.reflect.read(value, 'context')
		return (
			CAPTURE_ERROR_CODES.some((declared) => declared === code) &&
			(context === undefined || isRecord(context))
		)
	})
}
