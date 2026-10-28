import type {
	CaptureArtifact,
	CaptureBox,
	CaptureCollectionReceipt,
	CaptureDeclaration,
	CaptureDestination,
	CaptureDigest,
	CaptureEntry,
	CaptureIdentity,
	CaptureLookup,
	CaptureLookupJournal,
	CaptureManifest,
	CaptureReceipt,
	CaptureRegistry,
	CaptureRequest,
	CaptureRun,
	CaptureSources,
	CaptureStamp,
	CaptureStoredManifest,
	CaptureViewport,
} from './types.js'
import { arrayOf, holds, isFiniteNumber, isObject, isRecord, isString } from '@orkestrel/contract'

/**
 * Checks whether a serialized path stays within the portable relative-path vocabulary.
 *
 * @param value - The serialized file or directory path
 * @returns True if every segment is portable and relative; false otherwise
 *
 * @example
 * ```ts
 * isCapturePath('tmp/captures/states/pages/mail--inbox.png') // true
 * isCapturePath('../escape.png') // false
 * ```
 */
export function isCapturePath(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		[...value].every((character) => character.charCodeAt(0) > 0x1f) &&
		value
			.split('/')
			.every(
				(segment) =>
					segment !== '' &&
					segment !== '.' &&
					segment !== '..' &&
					!/[<>:"\\|?*]/u.test(segment) &&
					!/[. ]$/u.test(segment) &&
					!/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(segment),
			)
	)
}

/**
 * Checks whether a native glob declaration uses relative portable path segments.
 *
 * @param value - A source attribution pattern
 * @returns True if the pattern has no path traversal or host-specific spelling; false otherwise
 *
 * @example
 * ```ts
 * isCapturePattern('src/**') // true
 * isCapturePattern('src\\**') // false
 * ```
 */
export function isCapturePattern(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		[...value].every((character) => character.charCodeAt(0) > 0x1f) &&
		value
			.split('/')
			.every(
				(segment) =>
					segment !== '' &&
					segment !== '.' &&
					segment !== '..' &&
					!/[<>:"\\|]/u.test(segment) &&
					!/[. ]$/u.test(segment) &&
					!/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(segment),
			)
	)
}

/**
 * Checks whether a protocol identity can occupy one portable path segment.
 *
 * @param value - The identity segment
 * @returns True if the segment is safe and nonempty; false otherwise
 *
 * @example
 * ```ts
 * isCaptureSegment('light-390') // true
 * isCaptureSegment('light 390') // false
 * ```
 */
export function isCaptureSegment(value: unknown): value is string {
	return isCapturePath(value) && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(value)
}

/**
 * Checks whether an owner selector uses canonical colon-separated segments.
 *
 * @param value - The owner selector
 * @returns True if every owner segment is canonical; false otherwise
 *
 * @example
 * ```ts
 * isCaptureSelector('pages:mail') // true
 * isCaptureSelector('pages::mail') // false
 * ```
 */
export function isCaptureSelector(value: unknown): value is string {
	return typeof value === 'string' && value.split(':').every(isCaptureSegment)
}

/**
 * Checks whether a value is a SHA-256 hexadecimal digest.
 *
 * @param value - The digest
 * @returns True if the digest has the expected hexadecimal width; false otherwise
 *
 * @example
 * ```ts
 * isCaptureHash('a'.repeat(64)) // true
 * isCaptureHash('abc') // false
 * ```
 */
export function isCaptureHash(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

/**
 * Checks whether a file-hash map has portable keys and valid digests.
 *
 * @param value - The hash map
 * @returns True if every key and digest is valid and no two keys differ only by case; false otherwise
 *
 * @example
 * ```ts
 * isCaptureHashes({ 'src/index.ts': 'a'.repeat(64) }) // true
 * isCaptureHashes({ 'src/index.ts': 'x' }) // false
 * ```
 */
export function isCaptureHashes(value: unknown): value is Readonly<Record<string, string>> {
	return holds(
		() =>
			isRecord(value) &&
			Object.entries(value).every(
				([file, digest]) => isCapturePath(file) && isCaptureHash(digest),
			) &&
			new Set(Object.keys(value).map((file) => file.toLowerCase())).size ===
				Object.keys(value).length,
	)
}

/**
 * Checks whether source attribution separates own, shared, and behavioral patterns.
 *
 * @param value - The attribution
 * @returns True if every declared pattern is valid; false otherwise
 *
 * @example
 * ```ts
 * isCaptureSources({ own: ['src/mail/**'], shared: [], tests: [] }) // true
 * isCaptureSources({ own: ['../x'], shared: [], tests: [] }) // false
 * ```
 */
export function isCaptureSources(value: unknown): value is CaptureSources {
	return holds(
		() =>
			isRecord(value) &&
			arrayOf(isCapturePattern)(value.own) &&
			arrayOf(isCapturePattern)(value.shared) &&
			arrayOf(isCapturePattern)(value.tests),
	)
}

/**
 * Checks whether an execution identity carries its required authorization fields.
 *
 * @param value - The identity
 * @returns True if the identity is valid; false otherwise
 *
 * @example
 * ```ts
 * isCaptureIdentity({ id: 'run-1', stage: 'narrow', pid: 4242, config: 'configs/journey.ts' }) // true
 * isCaptureIdentity({ id: 'run-1', stage: 'narrow', pid: 0, config: 'configs/journey.ts' }) // false
 * ```
 */
export function isCaptureIdentity(value: unknown): value is CaptureIdentity {
	return holds(
		() =>
			isRecord(value) &&
			isCaptureSegment(value.id) &&
			isCaptureSegment(value.stage) &&
			typeof value.pid === 'number' &&
			Number.isSafeInteger(value.pid) &&
			value.pid > 0 &&
			isCapturePath(value.config),
	)
}

/**
 * Checks whether a request has the supported version and complete execution identity.
 *
 * @param value - The transported request
 * @returns True if every request field has its protocol shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureRequest(JSON.parse(text)) // true for a well-formed runner request
 * isCaptureRequest({ version: 2 }) // false
 * ```
 */
export function isCaptureRequest(value: unknown): value is CaptureRequest {
	return holds(
		() =>
			isRecord(value) &&
			isCaptureIdentity(value) &&
			value.version === 1 &&
			(value.command === 'journey' || value.command === 'capture') &&
			isCaptureSelector(value.selector) &&
			arrayOf(isCaptureSegment)(value.variants) &&
			value.variants.length > 0 &&
			arrayOf(isString)(value.args) &&
			(value.case === undefined || (typeof value.case === 'string' && value.case.trim() !== '')) &&
			(value.state === undefined || (value.command === 'capture' && isCaptureSegment(value.state))),
	)
}

/**
 * Checks whether a collected declaration preserves its full owner and state population.
 *
 * @param value - The declaration
 * @returns True if the declaration has its supported shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureDeclaration({
 * 	case: 'mail shows the inbox',
 * 	owner: 'pages:mail',
 * 	variant: 'light-390',
 * 	eligible: true,
 * 	states: ['inbox'],
 * }) // true
 * ```
 */
export function isCaptureDeclaration(value: unknown): value is CaptureDeclaration {
	return holds(
		() =>
			isRecord(value) &&
			typeof value.case === 'string' &&
			value.case.trim() !== '' &&
			isCaptureSelector(value.owner) &&
			isCaptureSegment(value.variant) &&
			typeof value.eligible === 'boolean' &&
			arrayOf(isCaptureSegment)(value.states),
	)
}

/**
 * Checks whether a destination supplies canonical identity and source attribution fields.
 *
 * @param value - The destination
 * @returns True if the destination has its supported shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureDestination(JSON.parse(text)) // true for a registry destination row
 * isCaptureDestination({}) // false
 * ```
 */
export function isCaptureDestination(value: unknown): value is CaptureDestination {
	return holds(
		() =>
			isRecord(value) &&
			isCaptureSegment(value.portfolio) &&
			isCaptureSegment(value.state) &&
			isCaptureSegment(value.scope) &&
			isCaptureSegment(value.part) &&
			(value.section === undefined || isCaptureSegment(value.section)) &&
			isCaptureSegment(value.variant) &&
			typeof value.project === 'string' &&
			value.project !== '' &&
			isCapturePath(value.file) &&
			typeof value.case === 'string' &&
			value.case.trim() !== '' &&
			isCaptureSources(value.sources),
	)
}

/**
 * Checks whether an emitted entry includes a finite nonnegative case duration.
 *
 * @param value - The emitted entry
 * @returns True if the entry is valid; false otherwise
 *
 * @example
 * ```ts
 * isCaptureEntry({ ...destination, duration: 812 }) // true
 * isCaptureEntry({ ...destination, duration: -1 }) // false
 * ```
 */
export function isCaptureEntry(value: unknown): value is CaptureEntry {
	return holds(
		() =>
			isRecord(value) &&
			isCaptureDestination(value) &&
			isFiniteNumber(value.duration) &&
			value.duration >= 0,
	)
}

/**
 * Checks whether a record names its journey artifact by portable path and SHA-256 digest.
 *
 * @param value - The decoded artifact reference
 * @returns True if the reference has its supported shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureArtifact({ file: 'tmp/runs/a/light-390.txt', digest: 'a'.repeat(64) }) // true
 * isCaptureArtifact({ file: '/abs.txt', digest: 'a'.repeat(64) }) // false
 * ```
 */
export function isCaptureArtifact(value: unknown): value is CaptureArtifact {
	return holds(() => isRecord(value) && isCapturePath(value.file) && isCaptureHash(value.digest))
}

/**
 * Checks whether a closing record preserves declarations, observations, and output separately.
 *
 * @param value - The decoded run record
 * @returns True if the record has the supported protocol shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureRun(JSON.parse(text)) // true for a closing run record
 * isCaptureRun(null) // false
 * ```
 */
export function isCaptureRun(value: unknown): value is CaptureRun {
	return holds(
		() =>
			isRecord(value) &&
			value.version === 1 &&
			isCaptureSegment(value.variant) &&
			typeof value.time === 'string' &&
			Number.isFinite(Date.parse(value.time)) &&
			typeof value.complete === 'boolean' &&
			typeof value.reference === 'boolean' &&
			arrayOf(isCaptureDeclaration)(value.declarations) &&
			arrayOf(isCaptureDestination)(value.registry) &&
			arrayOf(isString)(value.passed) &&
			arrayOf(isCaptureSegment)(value.observed) &&
			arrayOf(isCaptureEntry)(value.entries) &&
			(value.artifact === undefined || isCaptureArtifact(value.artifact)) &&
			((value.identity === undefined && value.request === undefined) ||
				(isCaptureIdentity(value.identity) && isCaptureRequest(value.request))),
	)
}

/**
 * Checks whether a shared-source digest retains both patterns and expanded file hashes.
 *
 * @param value - The digest reading
 * @returns True if the digest reading has its supported shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureDigest({ patterns: ['src/**'], files: {}, digest: 'a'.repeat(64) }) // true
 * isCaptureDigest({ patterns: [], files: {} }) // false
 * ```
 */
export function isCaptureDigest(value: unknown): value is CaptureDigest {
	return holds(
		() =>
			isRecord(value) &&
			arrayOf(isCapturePattern)(value.patterns) &&
			isCaptureHashes(value.files) &&
			isCaptureHash(value.digest),
	)
}

/**
 * Checks whether a complete-run receipt binds the report, inputs, and declaration registry.
 *
 * @param value - The receipt
 * @returns True if the receipt has its supported shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureReceipt(JSON.parse(text)) // true for a complete-run receipt
 * isCaptureReceipt({}) // false
 * ```
 */
export function isCaptureReceipt(value: unknown): value is CaptureReceipt {
	return holds(
		() =>
			isRecord(value) &&
			value.version === 1 &&
			isCaptureSegment(value.variant) &&
			typeof value.time === 'string' &&
			Number.isFinite(Date.parse(value.time)) &&
			isRecord(value.report) &&
			isCapturePath(value.report.file) &&
			isCaptureHash(value.report.digest) &&
			isCaptureHashes(value.inputs) &&
			arrayOf(isCaptureDeclaration)(value.declarations) &&
			arrayOf(isCaptureDestination)(value.registry) &&
			typeof value.complete === 'boolean',
	)
}

/**
 * Checks whether a registry document retains its receipts and required output pairs.
 *
 * @param value - The registry document
 * @returns True if the registry has the supported shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureRegistry(JSON.parse(text)) // true for a published registry.json
 * isCaptureRegistry([]) // false
 * ```
 */
export function isCaptureRegistry(value: unknown): value is CaptureRegistry {
	return holds(
		() =>
			isRecord(value) &&
			value.version === 1 &&
			arrayOf(isCaptureReceipt)(value.receipts) &&
			arrayOf(isCaptureDestination)(value.entries) &&
			isCaptureHash(value.digest),
	)
}

/**
 * Checks whether a lookup binds a passing case to its full run record and input hashes.
 *
 * @param value - The lookup receipt
 * @returns True if the receipt has its supported shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureLookup(JSON.parse(text)) // true for a lookup row
 * isCaptureLookup(undefined) // false
 * ```
 */
export function isCaptureLookup(value: unknown): value is CaptureLookup {
	return holds(
		() =>
			isRecord(value) &&
			isCaptureHash(value.registry) &&
			isCaptureSegment(value.variant) &&
			typeof value.case === 'string' &&
			value.case.trim() !== '' &&
			isCaptureSelector(value.owner) &&
			arrayOf(isCaptureSegment)(value.states) &&
			isCaptureHashes(value.inputs) &&
			isRecord(value.run) &&
			isCapturePath(value.run.file) &&
			isCaptureHash(value.run.digest),
	)
}

/**
 * Checks the separate lookup journal and its optional predecessor manifest digest.
 *
 * @param value - The decoded journal
 * @returns True if the journal has its supported shape; false otherwise
 * @remarks Input-map digests and reference existence are verified when the journal is read.
 *
 * @example
 * ```ts
 * isCaptureLookupJournal({ version: 1, inputs: {}, lookups: [] }) // true
 * isCaptureLookupJournal({ version: 2, inputs: {}, lookups: [] }) // false
 * ```
 */
export function isCaptureLookupJournal(value: unknown): value is CaptureLookupJournal {
	return holds(
		() =>
			isRecord(value) &&
			(value.collections === undefined || arrayOf(isCaptureCollection)(value.collections)) &&
			value.version === 1 &&
			(value.manifest === undefined || isCaptureHash(value.manifest)) &&
			isRecord(value.inputs) &&
			Object.entries(value.inputs).every(
				([digest, inputs]) => isCaptureHash(digest) && isCaptureHashes(inputs),
			) &&
			arrayOf(
				(entry) =>
					isRecord(entry) &&
					isCaptureHash(entry.inputs) &&
					isCaptureLookup({ ...entry, inputs: {} }),
			)(value.lookups),
	)
}

/**
 * Checks whether a stamp binds an emitted image to source and execution provenance.
 *
 * @param value - The stamp
 * @returns True if the stamp has its supported shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureStamp(manifest.entries['pages/mail--inbox.png']) // true for a stamped frame
 * isCaptureStamp({}) // false
 * ```
 */
export function isCaptureStamp(value: unknown): value is CaptureStamp {
	return holds(
		() =>
			isRecord(value) &&
			isCaptureEntry(value) &&
			isCaptureIdentity(value.identity) &&
			typeof value.time === 'string' &&
			Number.isFinite(Date.parse(value.time)) &&
			typeof value.commit === 'string' &&
			/^[a-f0-9]{40,64}$/u.test(value.commit) &&
			arrayOf(isCapturePath)(value.dirty) &&
			isCaptureHashes(value.own) &&
			isCaptureDigest(value.shared) &&
			isCaptureHashes(value.tests) &&
			isCaptureHash(value.registry) &&
			isRecord(value.image) &&
			isCaptureHash(value.image.digest) &&
			isFiniteNumber(value.image.size) &&
			Number.isSafeInteger(value.image.size) &&
			value.image.size > 0 &&
			isFiniteNumber(value.image.modified) &&
			value.image.modified >= 0,
	)
}

/**
 * Checks whether an inherited manifest has the supported schema without discarding malformed rows.
 *
 * @param value - The manifest
 * @returns True if every inherited member validates; false otherwise
 *
 * @example
 * ```ts
 * isCaptureManifest(JSON.parse(text)) // true for a published manifest.json
 * isCaptureManifest('manifest') // false
 * ```
 */
export function isCaptureManifest(value: unknown): value is CaptureManifest {
	return holds(
		() =>
			isRecord(value) &&
			value.version === 1 &&
			isCaptureRegistry(value.registry) &&
			isRecord(value.entries) &&
			Object.entries(value.entries).every(
				([key, stamp]) => isCapturePath(key) && isCaptureStamp(stamp),
			) &&
			arrayOf(isCaptureLookup)(value.lookups),
	)
}

/**
 * Checks whether collection evidence pins complete input membership and both external artifacts.
 *
 * @param value - The collection receipt
 * @returns True if every field has the supported shape; false otherwise
 *
 * @example
 * ```ts
 * isCaptureCollection(manifest.collections?.[0]) // true for a collection receipt
 * isCaptureCollection({}) // false
 * ```
 */
export function isCaptureCollection(value: unknown): value is CaptureCollectionReceipt {
	return holds(
		() =>
			isRecord(value) &&
			isCaptureHash(value.registry) &&
			isCaptureSegment(value.variant) &&
			typeof value.project === 'string' &&
			value.project.trim() !== '' &&
			isCaptureDigest(value.inputs) &&
			isRecord(value.run) &&
			isCapturePath(value.run.file) &&
			isCaptureHash(value.run.digest) &&
			isRecord(value.report) &&
			isCapturePath(value.report.file) &&
			isCaptureHash(value.report.digest),
	)
}

/**
 * Checks optional collection metadata without upgrading historical image evidence.
 *
 * @param value - The inherited image transaction
 * @returns True if its existing manifest and any collection receipts are valid; false otherwise
 *
 * @example
 * ```ts
 * isCaptureStoredManifest(JSON.parse(text)) // true for a manifest with or without collections
 * isCaptureStoredManifest(null) // false
 * ```
 */
export function isCaptureStoredManifest(value: unknown): value is CaptureStoredManifest {
	return holds(
		() =>
			isCaptureManifest(value) &&
			isRecord(value) &&
			(value.collections === undefined || arrayOf(isCaptureCollection)(value.collections)),
	)
}

/**
 * Checks the host's declared viewport without deriving geometry from an output name.
 *
 * @param value - The published viewport data
 * @returns True if the named viewport has usable dimensions; false otherwise
 *
 * @example
 * ```ts
 * isCaptureGeometry({ name: 'light-390', width: 390, height: 844 }) // true
 * isCaptureGeometry({ name: 'light-390', width: 0, height: 844 }) // false
 * ```
 */
export function isCaptureGeometry(value: unknown): value is CaptureViewport {
	return holds(
		() =>
			isObject(value) &&
			'name' in value &&
			isCaptureSegment(value.name) &&
			'width' in value &&
			isFiniteNumber(value.width) &&
			value.width > 0 &&
			'height' in value &&
			isFiniteNumber(value.height) &&
			value.height > 0,
	)
}

/**
 * Checks a journey artifact's recorded sampling box.
 *
 * @param value - The recorded viewport box
 * @returns True if its coordinates and dimensions are finite; false otherwise
 *
 * @example
 * ```ts
 * isCaptureBox({ x: 0, y: 64, width: 390, height: 780 }) // true
 * isCaptureBox({ x: 0, y: 64, width: 0, height: 780 }) // false
 * ```
 */
export function isCaptureBox(value: unknown): value is CaptureBox {
	return holds(
		() =>
			isRecord(value) &&
			isFiniteNumber(value.x) &&
			isFiniteNumber(value.y) &&
			isFiniteNumber(value.width) &&
			value.width > 0 &&
			isFiniteNumber(value.height) &&
			value.height > 0,
	)
}
