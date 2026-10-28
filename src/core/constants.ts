/**
 * Lists the condition axes a capture failure carries, in the order the executable reports them.
 *
 * @remarks
 * `USAGE` is a refused command line and exits 64; every other condition exits 1. `SELECTION`
 * names a selector, variant, case, state, or portfolio the host does not declare. `HOST` names a
 * wrapper, configuration, or declaration fault. `STAGE` names a runner stage that did not
 * complete. `EVIDENCE` names a record, report, registry, or manifest that fails its protocol.
 * `CONTAINMENT` names a path that leaves the authorized roots.
 *
 * @example
 * ```ts
 * CAPTURE_ERROR_CODES.includes('USAGE') // true
 * ```
 */
export const CAPTURE_ERROR_CODES = Object.freeze([
	'USAGE',
	'SELECTION',
	'HOST',
	'STAGE',
	'EVIDENCE',
	'CONTAINMENT',
] as const)

/**
 * Keys the global brand a capture error carries, so a duplicate installation recognizes it.
 *
 * @remarks
 * The key follows the package-and-class form, `Symbol.for('<package>.<ClassName>')`. The brand is
 * a recognition marker and never proof that the class's constructor ran.
 *
 * @example
 * ```ts
 * CAPTURE_ERROR_BRAND === Symbol.for('@orkestrel/capture.CaptureError') // true
 * ```
 */
export const CAPTURE_ERROR_BRAND = Symbol.for('@orkestrel/capture.CaptureError')

/**
 * Lists the non-current freshness classifications from highest precedence to lowest.
 *
 * @remarks
 * `resolveCaptureStatus` reads this order to choose a frame's primary classification while the
 * reading keeps every finding separately. A frame with none of these is current.
 *
 * @example
 * ```ts
 * CAPTURE_STATUS_PRECEDENCE[0] // 'duplicate'
 * ```
 */
export const CAPTURE_STATUS_PRECEDENCE = Object.freeze([
	'duplicate',
	'orphan',
	'missing',
	'unstamped',
	'stale-shared',
	'stale-own',
] as const)

/**
 * Names the file prefix of a runner request, completed by the runner's process id and `.json`.
 *
 * @example
 * ```ts
 * `${CAPTURE_REQUEST_PREFIX}-${process.pid}.json` // 'journey-selection-4242.json'
 * ```
 */
export const CAPTURE_REQUEST_PREFIX = 'journey-selection'

/**
 * Holds the protocol version every request, record, receipt, registry, and manifest declares.
 *
 * @example
 * ```ts
 * CAPTURE_VERSION // 1
 * ```
 */
export const CAPTURE_VERSION = 1

/**
 * Holds the eight bytes every PNG file opens with.
 *
 * @example
 * ```ts
 * CAPTURE_PNG_SIGNATURE.map((byte) => byte.toString(16)).join('') // '89504e470d0a1a0a'
 * ```
 */
export const CAPTURE_PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10] as const)

/**
 * Names the default accepted complete-run registry file inside a portfolio directory.
 *
 * @example
 * ```ts
 * `tmp/captures/states/${CAPTURE_REGISTRY_FILE}` // 'tmp/captures/states/registry.json'
 * ```
 */
export const CAPTURE_REGISTRY_FILE = 'registry.json'

/**
 * Names the default image-stamp manifest file inside a portfolio directory.
 *
 * @example
 * ```ts
 * `tmp/captures/states/${CAPTURE_MANIFEST_FILE}` // 'tmp/captures/states/manifest.json'
 * ```
 */
export const CAPTURE_MANIFEST_FILE = 'manifest.json'

/**
 * Names the default lookup journal file inside a portfolio directory.
 *
 * @example
 * ```ts
 * `tmp/captures/states/${CAPTURE_LOOKUPS_FILE}` // 'tmp/captures/states/lookups.json'
 * ```
 */
export const CAPTURE_LOOKUPS_FILE = 'lookups.json'
