import type { ParseArgsOptionsConfig } from 'node:util'
import type {
	CaptureCollectionReceipt,
	CaptureDestination,
	CaptureDigest,
	CaptureLookup,
	CaptureLookupJournal,
	CaptureRegistry,
	CaptureRequest,
	CaptureViewport,
} from '@src/core'
import type {
	CaptureArgumentsOptions,
	CaptureChange,
	CaptureChangePlan,
	CaptureCommand,
	CaptureDescriptionExpectation,
	CaptureDiscoveryOptions,
	CaptureHashHandler,
	CaptureHostDescription,
	CaptureHostEntry,
	CaptureImageResult,
	CaptureIntegrityOptions,
	CaptureParsedArguments,
	CapturePicture,
	CapturePortfolioRoot,
	CaptureProducer,
	CaptureProject,
	CaptureReaderCommand,
	CaptureReaderDefaults,
	CaptureReceiptInput,
	CaptureRegistryArguments,
	CaptureRequestOptions,
	CaptureRunnerArguments,
	CaptureStagePlan,
} from './types.js'
import { createHash, randomUUID } from 'node:crypto'
import {
	existsSync,
	globSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { dirname, matchesGlob, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import {
	arrayOf,
	attempt,
	isArray,
	isError,
	isFunction,
	isRecord,
	isString,
	parseJSON,
} from '@orkestrel/contract'
import {
	CAPTURE_LOOKUPS_FILE,
	CAPTURE_MANIFEST_FILE,
	CAPTURE_PNG_SIGNATURE,
	CAPTURE_REGISTRY_FILE,
	CAPTURE_REQUEST_PREFIX,
	CAPTURE_VERSION,
	CaptureError,
	describeCaptureDeclaration,
	describeCaptureDestination,
	describeCaptureError,
	isCaptureGeometry,
	isCapturePath,
	isCapturePattern,
	isCaptureReceipt,
	isCaptureSegment,
	isCaptureSelector,
	matchesCaptureMembers,
	matchesCaptureSelector,
	readCaptureReport,
	requireCaptureUnique,
	resolveCaptureKey,
	resolveCaptureOwner,
	validateCaptureReceipt,
} from '@src/core'
import {
	CAPTURE_COMMAND_NAMES,
	CAPTURE_COMMAND_OPTIONS,
	CAPTURE_DEFAULTS,
	CAPTURE_DISCOVERY,
	CAPTURE_OWNER_PREFIX,
	CAPTURE_REQUESTS_FLAG,
	CAPTURE_RUNS_DIRECTORY,
	CAPTURE_STAGES,
	CAPTURE_TAG_OPERATORS,
} from './constants.js'

/**
 * Hashes exact source or image bytes with SHA-256.
 *
 * @param bytes - The bytes, or the explicitly encoded UTF-8 text
 * @returns The lowercase hexadecimal digest
 *
 * @example
 * ```ts
 * computeCaptureHash('') // 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
 * ```
 */
export function computeCaptureHash(bytes: string | Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Classifies changed paths through accepted patterns and reduces owners by ancestry.
 *
 * @param paths - Git paths, including removed paths that no longer exist
 * @param entries - The authenticated accepted registry destinations
 * @returns Sorted path classifications and sorted minimal owners; shared patterns take precedence
 * @example
 * ```ts
 * buildCaptureChangePlan(['README.md'], []).changes
 * // [{ path: 'README.md', classification: 'outside', owners: [] }]
 * ```
 */
export function buildCaptureChangePlan(
	paths: readonly string[],
	entries: readonly CaptureDestination[],
): CaptureChangePlan {
	const population = [...new Set(entries.map(resolveCaptureOwner))].toSorted()
	const changes = [...new Set(paths)].toSorted().map((path): CaptureChange => {
		if (
			entries.some((entry) =>
				[...entry.sources.shared, ...entry.sources.tests].some((pattern) =>
					matchesGlob(path, pattern),
				),
			)
		)
			return { path, classification: 'shared', owners: population }
		const owners = [
			...new Set(
				entries
					.filter((entry) => entry.sources.own.some((pattern) => matchesGlob(path, pattern)))
					.map(resolveCaptureOwner),
			),
		].toSorted()
		return { path, classification: owners.length === 0 ? 'outside' : 'own', owners }
	})
	const owners = [
		...new Set(
			changes
				.filter((change) => change.classification === 'own')
				.flatMap((change) => change.owners),
		),
	].toSorted()
	return {
		changes,
		owners: owners.filter(
			(owner) =>
				!owners.some((ancestor) => ancestor !== owner && matchesCaptureSelector(owner, ancestor)),
		),
	}
}

/**
 * Renders an exact owner command with the selected variants and filters in host shell syntax.
 *
 * @param command - The request command, translated to its executable name, or the registry command
 * @param parsed - The parsed flags; changed and plan flags are deliberately replaced by the owner
 * @param selector - The explicit owner or all selector; omitted for a registry refresh
 * @param root - The workspace that makes the wrapper path relative
 * @returns The command ready to copy into the host shell
 * @example
 * ```ts
 * renderCaptureCommand('journey', { config: '/repo/journey.ts', variants: [] }, 'pages:mail', '/repo')
 * // 'capture journey pages:mail --config journey.ts'
 * ```
 */
export function renderCaptureCommand(
	command: CaptureCommand | 'registry',
	parsed: CaptureRunnerArguments,
	selector: string | undefined,
	root: string,
): string {
	const config = resolveCaptureRelative(root, parsed.config)
	return [
		'capture',
		command === 'registry' ? command : CAPTURE_COMMAND_NAMES[command],
		...(selector === undefined ? [] : [selector]),
		...parsed.variants.flatMap((variant) => ['--variant', variant]),
		...(parsed.case === undefined
			? []
			: parsed.case.startsWith('-')
				? [`--case=${parsed.case}`]
				: ['--case', parsed.case]),
		...(parsed.state === undefined ? [] : ['--state', parsed.state]),
		...(config.startsWith('-') ? [`--config=${config}`] : ['--config', config]),
	]
		.map((argument) =>
			/^[\w./:-]+$/u.test(argument)
				? argument
				: process.platform === 'win32'
					? `'${argument.replaceAll("'", "''")}'`
					: `'${argument.replaceAll("'", "'\\''")}'`,
		)
		.join(' ')
}

/**
 * Normalizes a host path to forward slashes.
 *
 * @param path - A host path
 * @returns The same path with every backslash replaced by a slash
 *
 * @example
 * ```ts
 * normalizeSlashes('tmp\\captures\\a.png') // 'tmp/captures/a.png'
 * ```
 */
export function normalizeSlashes(path: string): string {
	return path.replaceAll('\\', '/')
}

/**
 * Computes the digest of both pattern declarations and expanded path and hash membership.
 *
 * @param patterns - The supplied native glob patterns
 * @param files - The expanded file hashes
 * @returns A deterministic digest retaining the original evidence populations
 *
 * @example
 * ```ts
 * buildCaptureDigest(['src/**'], { 'src/a.ts': 'f'.repeat(64) }).patterns // ['src/**']
 * ```
 */
export function buildCaptureDigest(
	patterns: readonly string[],
	files: Readonly<Record<string, string>>,
): CaptureDigest {
	const ordered = Object.entries(files).toSorted(([left], [right]) =>
		left.localeCompare(right, 'en'),
	)
	return {
		patterns: patterns.toSorted(),
		files: Object.fromEntries(ordered),
		digest: computeCaptureHash(JSON.stringify([patterns.toSorted(), ordered])),
	}
}

/**
 * Stores each distinct lookup input population once in a manifest-bound journal.
 *
 * @param lookups - The expanded passing case evidence to publish
 * @param collections - The independently authenticated collection receipts
 * @param manifest - The predecessor manifest digest, absent before the first capture
 * @returns The journal with content-addressed input maps and ordered lookup references
 *
 * @example
 * ```ts
 * buildCaptureLookupJournal([], []).inputs // {}
 * ```
 */
export function buildCaptureLookupJournal(
	lookups: readonly CaptureLookup[],
	collections: readonly CaptureCollectionReceipt[],
	manifest?: string,
): CaptureLookupJournal {
	const populations = new Map<Readonly<Record<string, string>>, CaptureDigest>()
	const references = lookups.map((lookup) => {
		const known = populations.get(lookup.inputs)
		const population = known ?? buildCaptureDigest([], lookup.inputs)
		if (known === undefined) populations.set(lookup.inputs, population)
		return { ...lookup, inputs: population.digest }
	})
	return {
		version: CAPTURE_VERSION,
		...(manifest === undefined ? {} : { manifest }),
		inputs: Object.fromEntries(
			[...populations.values()].map((population) => [population.digest, population.files]),
		),
		lookups: references,
		collections,
	}
}

/**
 * Resolves journal lookup references after verifying each stored input population's digest.
 *
 * @param journal - A structurally validated lookup journal
 * @returns Every expanded lookup in its stored order, sharing the verified input maps
 * @throws Thrown when an input digest differs from its map or a lookup names an unknown digest.
 *
 * @example
 * ```ts
 * readCaptureLookups(buildCaptureLookupJournal([], [])) // []
 * ```
 */
export function readCaptureLookups(journal: CaptureLookupJournal): readonly CaptureLookup[] {
	const populations = new Map(
		Object.entries(journal.inputs).map(([digest, inputs]) => {
			if (buildCaptureDigest([], inputs).digest !== digest)
				throw new CaptureError(`Lookup input digest differs from its map: ${digest}`, {
					code: 'EVIDENCE',
				})
			return [digest, inputs] as const
		}),
	)
	return journal.lookups.map((lookup) => {
		const inputs = populations.get(lookup.inputs)
		if (inputs === undefined)
			throw new CaptureError(`Lookup names an unknown inputs digest: ${lookup.inputs}`, {
				code: 'EVIDENCE',
			})
		return { ...lookup, inputs }
	})
}

/**
 * Computes the registry identity from its authenticated receipts and exact output population.
 *
 * @param registry - The registry fields before its digest is attached
 * @returns The deterministic SHA-256 registry identity
 *
 * @example
 * ```ts
 * computeRegistryDigest({ version: 1, receipts: [], entries: [] }).length // 64
 * ```
 */
export function computeRegistryDigest(
	registry: Pick<CaptureRegistry, 'version' | 'receipts' | 'entries'>,
): string {
	return computeCaptureHash(
		JSON.stringify([
			registry.version,
			registry.receipts
				.map((receipt) =>
					JSON.stringify([
						receipt.version,
						receipt.variant,
						receipt.time,
						receipt.complete,
						receipt.report.file,
						receipt.report.digest,
						Object.entries(receipt.inputs).toSorted(([left], [right]) =>
							left.localeCompare(right, 'en'),
						),
						receipt.declarations.map(describeCaptureDeclaration).toSorted(),
						receipt.registry.map(describeCaptureDestination).toSorted(),
					]),
				)
				.toSorted(),
			registry.entries.map(describeCaptureDestination).toSorted(),
		]),
	)
}

/**
 * Imports complete receipts only after their actual exits and exact report bytes validate.
 *
 * @param inputs - Verifier-owned reporter bytes, receipt declarations, and process outcomes
 * @returns The registry document to publish through the verifier's owned evidence path
 * @throws Thrown for caps, signals, unsuccessful exits, altered reports, or incomplete coverage.
 * @remarks This pure importer starts no process and changes no retained receipt or manifest.
 *
 * @example
 * ```ts
 * const registry = buildCaptureRegistry([{ receipt, report: text, outcome: { code: 0, signal: null }, capped: false }])
 * registry.digest.length // 64
 * ```
 */
export function buildCaptureRegistry(inputs: readonly CaptureReceiptInput[]): CaptureRegistry {
	if (inputs.length === 0)
		throw new CaptureError('A registry requires complete-run receipts', { code: 'EVIDENCE' })
	for (const input of inputs) {
		if (
			input.capped ||
			input.outcome.code !== 0 ||
			input.outcome.signal !== null ||
			!isCaptureReceipt(input.receipt) ||
			!input.receipt.complete ||
			computeCaptureHash(input.report) !== input.receipt.report.digest
		)
			throw new CaptureError(
				'Registry receipt requires an uncapped successful exit and unchanged report',
				{ code: 'EVIDENCE' },
			)
		validateCaptureReceipt(input.receipt, readCaptureReport(parseJSON(input.report)))
	}
	const receipts = inputs.map((input) => input.receipt)
	requireCaptureUnique(
		receipts.map((receipt) => receipt.variant),
		'complete receipt variants',
		true,
	)
	const entries = receipts.flatMap((receipt) => receipt.registry)
	requireCaptureUnique(entries.map(resolveCaptureKey), 'registry identities', true)
	requireCaptureUnique(
		entries.map((entry) => entry.file),
		'registry paths',
		true,
	)
	const registry = { version: CAPTURE_VERSION, receipts, entries }
	return { ...registry, digest: computeRegistryDigest(registry) }
}

/**
 * Checks whether bytes open with the eight-byte PNG signature.
 *
 * @param bytes - The leading bytes of a file
 * @returns True if the first eight bytes equal the signature; false otherwise
 *
 * @example
 * ```ts
 * matchesCaptureSignature(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])) // true
 * ```
 */
export function matchesCaptureSignature(bytes: Uint8Array): boolean {
	return Buffer.from(CAPTURE_PNG_SIGNATURE).equals(bytes.subarray(0, CAPTURE_PNG_SIGNATURE.length))
}

/**
 * Computes the PNG Paeth predictor used by both image readers.
 *
 * @param left - The reconstructed left byte
 * @param up - The reconstructed byte above
 * @param corner - The reconstructed upper-left byte
 * @returns The closest neighbor to the linear estimate
 *
 * @example
 * ```ts
 * predictCaptureByte(10, 20, 10) // 20
 * ```
 */
export function predictCaptureByte(left: number, up: number, corner: number): number {
	const estimate = left + up - corner
	const distances = [
		Math.abs(estimate - left),
		Math.abs(estimate - up),
		Math.abs(estimate - corner),
	]
	return (distances[0] ?? 0) <= (distances[1] ?? 0) && (distances[0] ?? 0) <= (distances[2] ?? 0)
		? left
		: (distances[1] ?? 0) <= (distances[2] ?? 0)
			? up
			: corner
}

/**
 * Reads PNG compressed-data chunks while refusing truncated or corrupt image bytes.
 *
 * @param bytes - The complete PNG
 * @param offset - The next chunk header. Default: 8.
 * @returns Ordered compressed-data chunks
 * @throws Thrown for truncated chunks, bad checksums, or a missing closing chunk.
 *
 * @example
 * ```ts
 * readCaptureChunks(encodeCapturePicture(picture)).length // 1
 * ```
 */
export function readCaptureChunks(bytes: Buffer, offset = 8): readonly Buffer[] {
	if (offset + 12 > bytes.length)
		throw new CaptureError('Truncated capture PNG', { code: 'EVIDENCE' })
	const length = bytes.readUInt32BE(offset)
	const end = offset + 12 + length
	if (end > bytes.length)
		throw new CaptureError('Truncated capture PNG chunk', { code: 'EVIDENCE' })
	const name = bytes.toString('latin1', offset + 4, offset + 8)
	if (crc32(bytes.subarray(offset + 4, end - 4)) >>> 0 !== bytes.readUInt32BE(end - 4))
		throw new CaptureError('Capture PNG checksum differs', { code: 'EVIDENCE' })
	if (name === 'IEND') {
		if (length !== 0 || end !== bytes.length)
			throw new CaptureError('Invalid capture PNG closing chunk', { code: 'EVIDENCE' })
		return []
	}
	return [
		...(name === 'IDAT' ? [bytes.subarray(offset + 8, end - 4)] : []),
		...readCaptureChunks(bytes, end),
	]
}

/**
 * Reconstructs one filtered PNG scanline from its filter byte and the row above.
 *
 * @param filter - The scanline's filter type, from 0 through 4
 * @param line - The filtered bytes of the row, without the filter byte
 * @param above - The reconstructed row above, or `undefined` for the first row
 * @param channels - The number of bytes in one pixel
 * @returns The reconstructed row
 *
 * @example
 * ```ts
 * unfilterCaptureRow(1, Uint8Array.from([1, 1, 1, 1]), undefined, 1) // Uint8Array [1, 2, 3, 4]
 * ```
 */
export function unfilterCaptureRow(
	filter: number,
	line: Uint8Array,
	above: Uint8Array | undefined,
	channels: number,
): Uint8Array {
	// Each reconstructed byte reads the bytes before it, so the row is a log the loop appends to.
	const bytes: number[] = []
	for (const [index, value] of line.entries()) {
		const left = index >= channels ? (bytes[index - channels] ?? 0) : 0
		const up = above?.[index] ?? 0
		const corner = index >= channels ? (above?.[index - channels] ?? 0) : 0
		const predicted =
			filter === 1
				? left
				: filter === 2
					? up
					: filter === 3
						? (left + up) >> 1
						: filter === 4
							? predictCaptureByte(left, up, corner)
							: 0
		bytes.push((value + predicted) & 255)
	}
	return Uint8Array.from(bytes)
}

/**
 * Inflates a PNG's compressed stream, refusing one that is corrupt or longer than declared.
 *
 * @param data - The concatenated data-chunk payloads
 * @param length - The inflated length the header's dimensions declare
 * @returns The inflated scanlines
 * @throws Thrown when the stream is not valid deflate data or inflates past `length`.
 *
 * @example
 * ```ts
 * inflateCaptureStream(deflateSync(Buffer.from([1, 2, 3])), 3) // Buffer <01 02 03>
 * ```
 */
export function inflateCaptureStream(data: Buffer, length: number): Buffer {
	try {
		return inflateSync(data, { maxOutputLength: length })
	} catch (error) {
		throw new CaptureError('Capture PNG stream is corrupt or longer than declared', {
			code: 'EVIDENCE',
			cause: error,
		})
	}
}

/**
 * Decodes the eight-bit, non-interlaced PNGs the capture readers consume.
 *
 * @remarks
 * It reads grayscale, grayscale with alpha, RGB, and RGBA, the colour types an encoder writes for a
 * browser capture. A grayscale sample fills all three channels, and an alpha channel is dropped.
 * Indexed colour, other bit depths, and interlacing are refused.
 *
 * @param bytes - The exact physical image bytes
 * @returns Image dimensions and RGB pixels
 * @throws Thrown for unsupported, malformed, or truncated images.
 *
 * @example
 * ```ts
 * decodeCapturePicture(encodeCapturePicture({ width: 1, height: 1, pixels: Uint8Array.from([1, 2, 3]) })).pixels // Uint8Array [1, 2, 3]
 * ```
 */
export function decodeCapturePicture(bytes: Buffer): CapturePicture {
	if (
		bytes.length < 33 ||
		!matchesCaptureSignature(bytes) ||
		bytes.toString('latin1', 12, 16) !== 'IHDR' ||
		bytes.readUInt32BE(8) !== 13
	)
		throw new CaptureError('Invalid capture PNG header', { code: 'EVIDENCE' })
	const width = bytes.readUInt32BE(16)
	const height = bytes.readUInt32BE(20)
	const channels =
		bytes[25] === 6 ? 4 : bytes[25] === 2 ? 3 : bytes[25] === 4 ? 2 : bytes[25] === 0 ? 1 : 0
	const gray = bytes[25] === 0 || bytes[25] === 4
	if (
		width === 0 ||
		height === 0 ||
		channels === 0 ||
		bytes[24] !== 8 ||
		bytes[26] !== 0 ||
		bytes[27] !== 0 ||
		bytes[28] !== 0
	)
		throw new CaptureError('Unsupported capture PNG encoding', { code: 'EVIDENCE' })
	const stride = width * channels
	const length = (stride + 1) * height
	if (!Number.isSafeInteger(length))
		throw new CaptureError('Invalid capture PNG dimensions', { code: 'EVIDENCE' })
	const raw = inflateCaptureStream(Buffer.concat(readCaptureChunks(bytes)), length)
	if (raw.length !== length)
		throw new CaptureError('Capture PNG scanline length differs', { code: 'EVIDENCE' })
	// Each row reads the reconstructed row above it, so the rows are a log the loop appends to.
	const rows: Uint8Array[] = []
	for (const row of new Array(height).keys()) {
		const filter = raw[row * (stride + 1)]
		if (filter === undefined || filter > 4)
			throw new CaptureError('Unsupported capture PNG filter', { code: 'EVIDENCE' })
		rows.push(
			unfilterCaptureRow(
				filter,
				raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)),
				rows[row - 1],
				channels,
			),
		)
	}
	const pixels = Uint8Array.from(
		{ length: width * height * 3 },
		(_, index) =>
			rows[Math.floor(index / (width * 3))]?.[
				Math.floor((index % (width * 3)) / 3) * channels + (gray ? 0 : index % 3)
			] ?? 0,
	)
	return { width, height, pixels }
}

/**
 * Encodes an unsigned 32-bit integer as four big-endian bytes.
 *
 * @param value - An integer from 0 through 4294967295
 * @returns The four bytes, most significant first
 *
 * @example
 * ```ts
 * encodeCaptureWord(258) // Buffer <00 00 01 02>
 * ```
 */
export function encodeCaptureWord(value: number): Buffer {
	return Buffer.from([24, 16, 8, 0].map((shift) => (value >>> shift) & 255))
}

/**
 * Encodes one checked PNG chunk for contact-sheet output.
 *
 * @param name - The four-byte chunk name
 * @param data - The chunk payload
 * @returns Header, payload, and checksum bytes
 *
 * @example
 * ```ts
 * encodeCaptureChunk('IEND', Buffer.alloc(0)).length // 12
 * ```
 */
export function encodeCaptureChunk(name: string, data: Buffer): Buffer {
	const header = Buffer.concat([encodeCaptureWord(data.length), Buffer.from(name, 'latin1')])
	const tail = encodeCaptureWord(crc32(Buffer.concat([header.subarray(4), data])) >>> 0)
	return Buffer.concat([header, data, tail])
}

/**
 * Encodes an RGB picture using the contact-sheet writer's native PNG format.
 *
 * @param picture - The complete RGB pixel buffer
 * @param compressed - If `true`, compresses scanlines; if `false`, stores them in the deflate stream. Default: `true`.
 * @returns A PNG file
 * @throws Thrown when dimensions and pixel length disagree.
 *
 * @example
 * ```ts
 * encodeCapturePicture({ width: 1, height: 1, pixels: Uint8Array.from([1, 2, 3]) }).subarray(1, 4).toString() // 'PNG'
 * ```
 */
export function encodeCapturePicture(picture: CapturePicture, compressed = true): Buffer {
	if (
		!Number.isSafeInteger(picture.width) ||
		!Number.isSafeInteger(picture.height) ||
		picture.width <= 0 ||
		picture.height <= 0 ||
		picture.pixels.length !== picture.width * picture.height * 3
	)
		throw new CaptureError('Invalid capture picture dimensions', { code: 'EVIDENCE' })
	const stride = picture.width * 3
	const raw = Buffer.concat(
		Array.from({ length: picture.height }, (_, row) =>
			Buffer.concat([Buffer.from([0]), picture.pixels.subarray(row * stride, (row + 1) * stride)]),
		),
	)
	return Buffer.concat([
		Buffer.from(CAPTURE_PNG_SIGNATURE),
		encodeCaptureChunk(
			'IHDR',
			Buffer.concat([
				encodeCaptureWord(picture.width),
				encodeCaptureWord(picture.height),
				Buffer.from([8, 2, 0, 0, 0]),
			]),
		),
		encodeCaptureChunk('IDAT', deflateSync(raw, { level: compressed ? 6 : 0 })),
		encodeCaptureChunk('IEND', Buffer.alloc(0)),
	])
}

/**
 * Scales a picture by a whole-number area average and clips its displayed height.
 *
 * @param picture - The source RGB picture
 * @param factor - The integer reduction factor
 * @param limit - The maximum displayed height
 * @returns A separately owned scaled picture
 *
 * @example
 * ```ts
 * shrinkCapturePicture({ width: 2, height: 2, pixels: new Uint8Array(12) }, 2, 8).width // 1
 * ```
 */
export function shrinkCapturePicture(
	picture: CapturePicture,
	factor: number,
	limit: number,
): CapturePicture {
	const width = Math.max(1, Math.floor(picture.width / factor))
	const height = Math.min(Math.max(1, Math.floor(picture.height / factor)), limit)
	const pixels = Uint8Array.from({ length: width * height * 3 }, (_, index) => {
		const y = Math.floor(index / (width * 3))
		const x = Math.floor((index % (width * 3)) / 3)
		const channel = index % 3
		const sum = Array.from(
			{ length: factor * factor },
			(_value, sample) =>
				picture.pixels[
					((y * factor + Math.floor(sample / factor)) * picture.width +
						x * factor +
						(sample % factor)) *
						3 +
						channel
				] ?? 0,
		).reduce((total, value) => total + value, 0)
		return Math.round(sum / (factor * factor))
	})
	return { width, height, pixels }
}

/**
 * Composes pictures on the contact-sheet gray background.
 *
 * @param pictures - The ordered source cells or rows
 * @param vertical - If `true`, stacks rows; if `false`, places cells side by side
 * @param gap - The space between source pictures. Default: 6.
 * @returns A separately owned composite
 * @throws Thrown for an empty picture selection.
 *
 * @example
 * ```ts
 * composeCapturePictures([picture, picture], false).width // picture.width * 2 + 6
 * ```
 */
export function composeCapturePictures(
	pictures: readonly CapturePicture[],
	vertical: boolean,
	gap = 6,
): CapturePicture {
	if (pictures.length === 0)
		throw new CaptureError('Empty contact-sheet picture selection', { code: 'USAGE' })
	const width = vertical
		? Math.max(...pictures.map((entry) => entry.width))
		: pictures.reduce((sum, entry) => sum + entry.width, 0) + gap * (pictures.length - 1)
	const height = vertical
		? pictures.reduce((sum, entry) => sum + entry.height, 0) + gap * (pictures.length - 1)
		: Math.max(...pictures.map((entry) => entry.height))
	const offsets = pictures.map((_picture, position) =>
		pictures
			.slice(0, position)
			.reduce((sum, entry) => sum + (vertical ? entry.height : entry.width) + gap, 0),
	)
	// Each output byte belongs to the last picture that starts at or before it, or to the gray gap.
	const pixels = Uint8Array.from({ length: width * height * 3 }, (_value, index) => {
		const x = Math.floor((index % (width * 3)) / 3)
		const y = Math.floor(index / (width * 3))
		const position = offsets.findLastIndex((offset) => offset <= (vertical ? y : x))
		const picture = pictures[position]
		const offset = offsets[position]
		if (picture === undefined || offset === undefined) return 128
		const column = vertical ? x : x - offset
		const row = vertical ? y - offset : y
		return column < picture.width && row < picture.height
			? (picture.pixels[(row * picture.width + column) * 3 + (index % 3)] ?? 0)
			: 128
	})
	return { width, height, pixels }
}

/**
 * Reads the process id that a request file, or its temporary sibling, names.
 *
 * @param name - A file name from the request directory
 * @returns The positive process id the name carries, or `undefined` for any other name
 *
 * @example
 * ```ts
 * readCaptureRequestOwner('journey-selection-4242.json') // 4242
 * readCaptureRequestOwner('journey-selection-4242.json.tmp') // 4242
 * readCaptureRequestOwner('journey-selection.json') // undefined
 * ```
 */
export function readCaptureRequestOwner(name: string): number | undefined {
	const match = new RegExp(`^${CAPTURE_REQUEST_PREFIX}-(\\d+)\\.json(?:\\.tmp)?$`, 'u').exec(name)
	const pid = Number(match?.[1])
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

/**
 * Resolves a path to the slash-separated form the evidence documents store, relative to a root.
 *
 * @param root - The absolute workspace path
 * @param target - The absolute or workspace-relative path
 * @returns The path relative to the root, with every backslash replaced by a slash
 *
 * @example
 * ```ts
 * resolveCaptureRelative(process.cwd(), resolve('tmp', 'units')) // 'tmp/units'
 * ```
 */
export function resolveCaptureRelative(root: string, target: string): string {
	return normalizeSlashes(relative(root, resolve(root, target)))
}

/**
 * Escapes every regular-expression metacharacter so a case name matches only itself.
 *
 * @param text - The literal text
 * @returns The text with each metacharacter backslash-quoted
 *
 * @example
 * ```ts
 * escapeCapturePattern('renders (a.b) + c') // 'renders \\(a\\.b\\) \\+ c'
 * ```
 */
export function escapeCapturePattern(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Builds the tag expression that selects an owner population, and its capture tags for frames.
 *
 * @remarks
 * A journey selects `owner:<selector>`. A capture intersects that with the capture tag the
 * selector names, which is its scope and part: the first two segments. The `all` selector unions
 * every declared scope. Colons stay part of a tag name.
 *
 * @param command - The runner command
 * @param selector - The requested owner path or `all`
 * @param selectors - Every owner path the wrapper declares, without the `owner:` prefix
 * @returns The expression for `--tags-filter`
 *
 * @example
 * ```ts
 * buildCaptureFilter('journey', 'pages:mail', ['pages', 'pages:mail']) // 'owner:pages:mail'
 * buildCaptureFilter('capture', 'pages:mail', ['pages', 'pages:mail']) // 'owner:pages:mail && pages:mail'
 * ```
 */
export function buildCaptureFilter(
	command: CaptureCommand,
	selector: string,
	selectors: readonly string[],
): string {
	const scopes = selectors.filter((entry) => !entry.includes(':'))
	const owner =
		selector === 'all'
			? `(${scopes.map((scope) => `${CAPTURE_OWNER_PREFIX}${scope}`).join(' || ')})`
			: `${CAPTURE_OWNER_PREFIX}${selector}`
	const capture =
		selector === 'all' ? `(${scopes.join(' || ')})` : selector.split(':').slice(0, 2).join(':')
	return command === 'journey' ? owner : `${owner} && ${capture}`
}

/**
 * Plans one selected journey stage or narrow and remaining frame stages.
 *
 * @remarks
 * Journeys run every selected variant together. Frame captures stage the first variant alone and
 * the remaining variants together. Empty stages are dropped and no unselected variant is added.
 *
 * @param variants - The selected variants in declaration order
 * @param first - The variant the wrapper stages alone first
 * @param command - The journey or capture command whose stage contract applies
 * @returns The non-empty stages in run order
 *
 * @example
 * ```ts
 * resolveCaptureStages(['wide', 'compact'], 'compact', 'capture')
 * // [{ name: 'narrow', variants: ['compact'] }, { name: 'rest', variants: ['wide'] }]
 * ```
 */
export function resolveCaptureStages(
	variants: readonly string[],
	first: string,
	command: CaptureRequest['command'],
): readonly CaptureStagePlan[] {
	if (command === 'journey')
		return variants.length === 0 ? [] : [{ name: CAPTURE_STAGES.selected, variants: [...variants] }]
	const stages: readonly CaptureStagePlan[] = [
		{ name: CAPTURE_STAGES.first, variants: variants.filter((variant) => variant === first) },
		{ name: CAPTURE_STAGES.rest, variants: variants.filter((variant) => variant !== first) },
	]
	return stages.filter((stage) => stage.variants.length > 0)
}

/**
 * Resolves selected producing variants in declaration order and requires their projects.
 *
 * @param selected - Explicit variants, or an empty list for every declared variant
 * @param projects - The discovered host projects
 * @returns The declared variants the selection includes
 * @throws Thrown as USAGE for an unknown variant or HOST for missing variant projects.
 * @example
 * ```ts
 * const variants = resolveCaptureVariants(['light-390'], projects)
 * // ['light-390'] when the wrapper declares its project
 * ```
 */
export function resolveCaptureVariants(
	selected: readonly string[],
	projects: readonly CaptureProject[],
): readonly string[] {
	const declared = [...new Set(projects.flatMap((project) => project.variants))]
	for (const variant of selected) {
		if (!declared.includes(variant))
			throw new CaptureError(`Unknown variant: ${variant}`, { code: 'USAGE', context: { variant } })
	}
	const variants = declared.filter((variant) => selected.length === 0 || selected.includes(variant))
	if (variants.length === 0)
		throw new CaptureError('The wrapper declares no journey variants', { code: 'HOST' })
	for (const variant of variants) {
		if (!projects.some((project) => project.variant === variant))
			throw new CaptureError(`The wrapper declares no journey project for ${variant}`, {
				code: 'HOST',
				context: { variant },
			})
	}
	return variants
}

/**
 * Builds the exact Node argument array that spawns one Vitest stage.
 *
 * @remarks
 * Each value is its own array element, so no shell quoting applies and a case name keeps its
 * spaces and quotes. An exact case adds `-t` with the anchored pattern for that case and the
 * final case, so the final case still writes the run record.
 *
 * @param options - The entry, wrapper, report, projects, tag filter, and optional exact case and mode
 * @returns The arguments after the Node executable
 *
 * @example
 * ```ts
 * const args = buildCaptureArguments({
 * 	entry: '/repo/node_modules/vitest/vitest.mjs',
 * 	config: '/repo/vite.journey.config.ts',
 * 	report: '/repo/tmp/units/runs/a/journey-selected.json',
 * 	projects: ['journey:light-390'],
 * 	filter: 'owner:pages:mail',
 * 	final: 'closes the run',
 * })
 * args.includes('--bail=1') // true
 * ```
 */
export function buildCaptureArguments(options: CaptureArgumentsOptions): readonly string[] {
	return [
		options.entry,
		'run',
		'--config',
		options.config,
		...(options.mode === undefined ? [] : ['--mode', options.mode]),
		'--configLoader',
		'runner',
		'--no-cache',
		'--bail=1',
		'--reporter=dot',
		'--reporter=json',
		`--outputFile.json=${options.report}`,
		...options.projects.flatMap((project) => ['--project', project]),
		'--tags-filter',
		options.filter,
		...(options.case === undefined
			? []
			: [
					'-t',
					`^(?:${[options.case, options.final].map((name) => escapeCapturePattern(name)).join('|')})$`,
				]),
	]
}

/**
 * Parses standard option tokens and refuses empty values, terminators, and repeated single options.
 *
 * @param argv - The arguments after the subcommand
 * @param options - The command's frozen Node option definitions
 * @param usage - The command syntax appended to every parser refusal
 * @returns Typed values, positionals, and the tokens that supplied them
 * @example
 * ```ts
 * readCaptureOptions(['--case=-draft'], CAPTURE_COMMAND_OPTIONS.journey, 'Usage: capture journey <selector>').values.case // '-draft'
 * ```
 */
export function readCaptureOptions<Options extends ParseArgsOptionsConfig>(
	argv: readonly string[],
	options: Options,
	usage: string,
): CaptureParsedArguments<Options> {
	try {
		const parsed = parseArgs({
			args: [...argv],
			options,
			tokens: true,
			strict: true,
			allowPositionals: true,
		})
		for (const token of parsed.tokens) {
			if (token.kind === 'option-terminator')
				throw new CaptureError('The -- option terminator is refused', { code: 'USAGE' })
			if (token.kind !== 'option') continue
			if (token.value === '')
				throw new CaptureError(`Missing value: --${token.name}`, { code: 'USAGE' })
			if (
				options[token.name]?.multiple !== true &&
				parsed.tokens.some(
					(earlier) =>
						earlier.kind === 'option' && earlier.name === token.name && earlier.index < token.index,
				)
			)
				throw new CaptureError(`Repeated option: --${token.name}`, { code: 'USAGE' })
		}
		return parsed
	} catch (error) {
		throw new CaptureError(`${describeCaptureError(error)}\n${usage}`, {
			code: 'USAGE',
			cause: error,
		})
	}
}

/**
 * Reads the runner's command line into one selector, its flags, and the resolved wrapper path.
 *
 * @remarks
 * `--state` belongs to `capture` and `stale`, and `--portfolio` to `stale`. Journey and capture
 * accept `--changed <ref>` instead of a selector, with optional valueless `--plan`. Every other
 * flag takes one nonempty value, either separated or in equals form, and only `--variant` repeats.
 * A value beginning with a dash requires equals form. A bare invocation leaves its selector absent
 * so the caller can print usage with the declared selectors.
 *
 * @param argv - The arguments after the entry name
 * @param command - The runner command the flags belong to
 * @param root - The absolute workspace path the wrapper path resolves against
 * @param fallback - The repository-relative wrapper path used when `--config` is absent
 * @returns The parsed arguments with an absolute wrapper path
 * @throws Thrown as a `USAGE` capture error for an unknown, repeated, misplaced, or valueless flag, a
 * second selector, a repeated or invalid variant, an invalid state, or an empty case.
 *
 * @example
 * ```ts
 * readCaptureArguments(['pages:mail', '--variant', 'light-390'], 'journey', '/repo', 'vite.journey.config.ts')
 * // { selector: 'pages:mail', config: '/repo/vite.journey.config.ts', variants: ['light-390'] }
 * ```
 */
export function readCaptureArguments(
	argv: readonly string[],
	command: CaptureCommand,
	root: string,
	fallback: string,
): CaptureRunnerArguments {
	const usage = `Usage: capture ${CAPTURE_COMMAND_NAMES[command]} <selector> [options]${command === 'stale' ? '' : `; capture ${CAPTURE_COMMAND_NAMES[command]} --changed <ref> [--plan] [options]`}`
	const { values, positionals: positional } = readCaptureOptions(
		argv,
		CAPTURE_COMMAND_OPTIONS[command],
		usage,
	)
	if (positional.length > 1)
		throw new CaptureError('Expected exactly one selector', { code: 'USAGE' })
	const variants = values.variant ?? []
	if (new Set(variants).size !== variants.length)
		throw new CaptureError('Repeated variant', { code: 'USAGE' })
	if (variants.some((variant) => !isCaptureSegment(variant)))
		throw new CaptureError('Invalid variant identity', { code: 'USAGE' })
	const state = 'state' in values && typeof values.state === 'string' ? values.state : undefined
	if (state !== undefined && !isCaptureSegment(state))
		throw new CaptureError('Invalid state identity', { code: 'USAGE' })
	const name = values.case
	if (name !== undefined && name.trim() === '')
		throw new CaptureError('Empty case name', { code: 'USAGE' })
	const portfolio =
		'portfolio' in values && typeof values.portfolio === 'string' ? values.portfolio : undefined
	const selector = positional.at(0)
	const changed =
		'changed' in values && typeof values.changed === 'string' ? values.changed : undefined
	const plan = 'plan' in values && values.plan === true
	if (changed !== undefined && selector !== undefined)
		throw new CaptureError(
			'A selector cannot be combined with --changed; use --changed <ref> alone',
			{ code: 'USAGE' },
		)
	if (plan && changed === undefined)
		throw new CaptureError('--plan requires --changed <ref>', { code: 'USAGE' })
	return {
		...(selector === undefined ? {} : { selector }),
		...(changed === undefined ? {} : { changed }),
		...(plan ? { plan: true } : {}),
		config: resolve(root, values.config ?? fallback),
		variants,
		...(name === undefined ? {} : { case: name }),
		...(state === undefined ? {} : { state }),
		...(portfolio === undefined ? {} : { portfolio }),
	}
}

/**
 * Reads the physical portfolio roots a wrapper declares and refuses a malformed or repeated root.
 *
 * @param value - The wrapper's declaration, expected to be a list of roots
 * @param subject - The name of the declaration in a refusal
 * @returns The validated roots in declaration order
 * @throws Thrown as a `HOST` capture error when the declaration is not a list or a root is malformed, and
 * as an `EVIDENCE` capture error when a portfolio name repeats, case-folded.
 *
 * @example
 * ```ts
 * readCapturePortfolios([{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }], 'portfolios')
 * ```
 */
export function readCapturePortfolios(
	value: unknown,
	subject: string,
): readonly CapturePortfolioRoot[] {
	if (!isArray(value))
		throw new CaptureError(`The wrapper provides no ${subject}`, { code: 'HOST' })
	const roots = value.map((root): CapturePortfolioRoot => {
		if (
			!isRecord(root) ||
			!isCaptureSegment(root.portfolio) ||
			!isCapturePath(root.directory) ||
			typeof root.scoped !== 'boolean'
		)
			throw new CaptureError(`The wrapper provides an invalid ${subject} root`, { code: 'HOST' })
		return { portfolio: root.portfolio, directory: root.directory, scoped: root.scoped }
	})
	requireCaptureUnique(
		roots.map((root) => root.portfolio),
		subject,
		true,
	)
	return roots
}

/**
 * Reads one wrapper project's host declarations from its Vitest test configuration.
 *
 * @remarks
 * The label is the project's `name` or its `label` member. Tags must not contain whitespace or a
 * tag-filter operator, and a variant must be a portable identity. The project's own `variant` must
 * be one of the declared `variants`, and so must the `first` stage variant. Portfolio roots and
 * the final case are required, and standalone roots default to none. `uniform` is an optional
 * list of unique valid owner selectors for the preflight's frame scan. Default: every scope.
 * An empty list judges none; the declaration never narrows the other readings.
 *
 * @param test - The project's `test` configuration, or any value the wrapper supplied in its place
 * @returns The validated project declaration
 * @throws Thrown as a `HOST` capture error when a declaration is missing or malformed.
 *
 * @example
 * ```ts
 * const project = readCaptureProject({
 * 	name: 'journey:light-390',
 * 	tags: [{ name: 'owner:pages:mail' }],
 * 	provide: {
 * 		variant: 'light-390',
 * 		variants: [{ name: 'light-390' }],
 * 		directory: '/repo/tmp/captures/states',
 * 		record: 'tmp/captures/states/runs/a/light-390.json',
 * 		inputs: ['src/**'],
 * 		final: 'closes the run',
 * 		first: 'light-390',
 * 		portfolios: [{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }],
 * 	},
 * })
 * project.variant // 'light-390'
 * ```
 */
export function readCaptureProject(test: unknown): CaptureProject {
	const name: unknown = isRecord(test) ? test.name : undefined
	const label =
		typeof name === 'string'
			? name
			: isRecord(name) && typeof name.label === 'string'
				? name.label
				: undefined
	if (label === undefined)
		throw new CaptureError(
			'Unsupported journey project name: expected a string or an object with a string label',
			{ code: 'HOST' },
		)
	const entries: unknown = isRecord(test) ? test.tags : undefined
	const tags: unknown = (isArray(entries) ? entries : []).map((tag): unknown =>
		isRecord(tag) ? tag.name : undefined,
	)
	if (
		!arrayOf(isString)(tags) ||
		tags.some((tag) => /[\s!*&|()]/u.test(tag) || CAPTURE_TAG_OPERATORS.includes(tag))
	)
		throw new CaptureError('The wrapper declares an invalid tag name', { code: 'HOST' })
	const provided: unknown = isRecord(test) ? test.provide : undefined
	const declared: unknown = isRecord(provided) ? provided.variants : undefined
	if (!isArray(declared))
		throw new CaptureError('A journey project provides no variants', { code: 'HOST' })
	const variants = declared.map((entry): unknown => (isRecord(entry) ? entry.name : undefined))
	if (!arrayOf(isString)(variants))
		throw new CaptureError('A journey variant has no name', { code: 'HOST' })
	if (
		!isRecord(provided) ||
		!isString(provided.directory) ||
		!isString(provided.record) ||
		!arrayOf(isCapturePattern)(provided.inputs)
	)
		throw new CaptureError('The wrapper provides no bounded integrity host declaration', {
			code: 'HOST',
		})
	if (!variants.every((variant) => isCaptureSegment(variant)))
		throw new CaptureError('A journey variant has an invalid identity', { code: 'HOST' })
	requireCaptureUnique(variants, 'journey variants', true)
	const variant = provided.variant
	if (!isString(variant) || !variants.includes(variant))
		throw new CaptureError(`The project ${label} provides no declared variant`, { code: 'HOST' })
	const first = provided.first
	if (!isString(first) || !variants.includes(first))
		throw new CaptureError('The wrapper provides no first-stage variant among its variants', {
			code: 'HOST',
		})
	const final = provided.final
	if (!isString(final) || final.trim() === '')
		throw new CaptureError('The wrapper provides no final case', { code: 'HOST' })
	const uniform = provided.uniform
	if (uniform !== undefined && !arrayOf(isCaptureSelector)(uniform))
		throw new CaptureError('The wrapper uniform scopes must be a list of valid owner selectors', {
			code: 'HOST',
		})
	if (uniform !== undefined) requireCaptureUnique(uniform, 'uniform scopes')
	const portfolios = readCapturePortfolios(provided.portfolios, 'portfolios')
	if (portfolios.length === 0)
		throw new CaptureError('The wrapper provides no portfolio roots', { code: 'HOST' })
	const standalone =
		provided.standalone === undefined
			? []
			: readCapturePortfolios(provided.standalone, 'standalone portfolios')
	requireCaptureUnique(
		[...portfolios, ...standalone].map((root) => root.portfolio),
		'portfolio names',
		true,
	)
	return {
		name: label,
		variant,
		tags,
		variants,
		directory: provided.directory,
		record: provided.record,
		inputs: provided.inputs,
		final,
		first,
		...(uniform === undefined ? {} : { uniform }),
		portfolios,
		standalone,
	}
}

/**
 * Describes a project's portfolio roots as comparable lines, primary roots apart from standalone ones.
 *
 * @param project - The project whose roots to describe
 * @returns One line per root, naming its kind, portfolio, directory, and scoping
 *
 * @example
 * ```ts
 * describeCapturePortfolios({
 * 	portfolios: [{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }],
 * 	standalone: [],
 * }) // ['primary states tmp/captures/states true']
 * ```
 */
export function describeCapturePortfolios(
	project: Pick<CaptureProject, 'portfolios' | 'standalone'>,
): readonly string[] {
	return [
		...project.portfolios.map(
			(root) => `primary ${root.portfolio} ${root.directory} ${String(root.scoped)}`,
		),
		...project.standalone.map(
			(root) => `standalone ${root.portfolio} ${root.directory} ${String(root.scoped)}`,
		),
	]
}

/**
 * Refuses a wrapper project set whose members repeat or disagree on a host declaration.
 *
 * @remarks
 * Project labels are unique and so is each project's own variant, case-folded. Every project must
 * declare the same primary directory, inputs, variants, first-stage variant, final case, and
 * portfolio roots, because the runner builds one engine for the whole set. Uniform declarations
 * must also agree as populations, with absence distinct from an empty list.
 *
 * @param projects - The wrapper's projects
 * @returns The first project, whose declarations every other project matches
 * @throws Thrown as a `HOST` capture error when the set is empty or its members disagree, and as an
 * `EVIDENCE` capture error when a label or variant repeats.
 *
 * @example
 * ```ts
 * requireCaptureProjects([project]) // project
 * ```
 */
export function requireCaptureProjects(projects: readonly CaptureProject[]): CaptureProject {
	const first = projects.at(0)
	if (first === undefined)
		throw new CaptureError('No host project declares integrity inputs', { code: 'HOST' })
	requireCaptureUnique(
		projects.map((project) => project.name),
		'journey projects',
	)
	requireCaptureUnique(
		projects.map((project) => project.variant),
		'journey project variants',
		true,
	)
	if (
		projects.some(
			(project) =>
				project.directory !== first.directory ||
				project.final !== first.final ||
				project.first !== first.first ||
				(project.uniform === undefined || first.uniform === undefined
					? project.uniform !== first.uniform
					: !matchesCaptureMembers(project.uniform, first.uniform)) ||
				!matchesCaptureMembers(project.inputs, first.inputs) ||
				!matchesCaptureMembers(project.variants, first.variants) ||
				!matchesCaptureMembers(
					describeCapturePortfolios(project),
					describeCapturePortfolios(first),
				),
		)
	)
		throw new CaptureError('Host project integrity declarations disagree', { code: 'HOST' })
	return first
}

/**
 * Describes why a selector names nothing the wrapper declares, naming the first unknown segment.
 *
 * @remarks
 * The depth of a segment decides its label: the first segment is a scope and every deeper one an
 * owner. `all` and every declared owner path, ancestors included, name something.
 *
 * @param selector - The requested owner path or `all`
 * @param selectors - Every owner path the wrapper declares, ancestors included
 * @returns The refusal text, or `undefined` when the selector names a declared population
 *
 * @example
 * ```ts
 * describeCaptureSelectorFault('pages:mail', ['pages', 'pages:mail']) // undefined
 * describeCaptureSelectorFault('pages:none', ['pages', 'pages:mail'])
 * // 'Unknown owner: none (selector pages:none; obsolete owner paths are not aliases)'
 * ```
 */
export function describeCaptureSelectorFault(
	selector: string,
	selectors: readonly string[],
): string | undefined {
	if (selector === 'all' || selectors.includes(selector)) return undefined
	const parts = selector.split(':')
	const missing = parts.findIndex(
		(_part, index) => !selectors.includes(parts.slice(0, index + 1).join(':')),
	)
	return `Unknown ${missing === 0 ? 'scope' : 'owner'}: ${parts[missing] ?? selector} (selector ${selector}; obsolete owner paths are not aliases)`
}

/**
 * Builds the refusal a wrapper raises for a request file it cannot accept as its parent's.
 *
 * @param file - The absolute request path, named in the message
 * @param cause - The underlying failure, when there is one
 * @returns A `HOST` capture error naming the file
 *
 * @example
 * ```ts
 * buildCaptureRequestRefusal('/repo/tmp/units/journey-selection-4242.json').message
 * // 'Invalid journey selection request: /repo/tmp/units/journey-selection-4242.json'
 * ```
 */
export function buildCaptureRequestRefusal(file: string, cause?: unknown): CaptureError {
	return new CaptureError(`Invalid journey selection request: ${file}`, {
		code: 'HOST',
		context: { file },
		...(cause === undefined ? {} : { cause }),
	})
}

/**
 * Reads and validates the request the runner wrote for the wrapper process that is its child.
 *
 * @remarks
 * Only the file named by `ppid` is read, so a request a stopped runner left never reaches a run
 * that has no runner parent. Every refusal names its cause: a file that does not parse, a record
 * whose `pid` differs from the parent's, arguments that differ from the process's own, an
 * unsupported version, an identity that is not a portable segment, a wrapper path that is not
 * `config`, a state on a command that cannot carry one, and a command, selector, variant list, or
 * case the wrapper does not declare.
 *
 * @param options - The parent id, the process arguments, the request directory, and the wrapper's declarations
 * @returns The validated request, or `undefined` when the parent wrote none
 * @throws Thrown as a `HOST` capture error when a request exists and fails any check.
 *
 * @example
 * ```ts
 * const request = readCaptureRequest({
 * 	ppid: process.ppid,
 * 	argv: process.argv.slice(1),
 * 	directory: '/repo/tmp/units',
 * 	config: 'configs/vite.journey.config.ts',
 * 	owners: ['pages:mail'],
 * 	variants: ['light-390'],
 * })
 * request?.selector // 'pages:mail', or undefined when no runner is the parent
 * ```
 */
export function readCaptureRequest(options: CaptureRequestOptions): CaptureRequest | undefined {
	const file = resolve(
		resolveCaptureRequests(options.directory),
		`${CAPTURE_REQUEST_PREFIX}-${String(options.ppid)}.json`,
	)
	if (!existsSync(file)) return undefined
	const read = attempt(() => readFileSync(file, 'utf8'))
	if (!read.success) throw buildCaptureRequestRefusal(file, read.error)
	const parsed = parseJSON(read.value)
	if (!isRecord(parsed)) throw buildCaptureRequestRefusal(file)
	if (parsed.phase !== undefined)
		throw buildCaptureRequestRefusal(
			file,
			new CaptureError('Journey selection request belongs to the discovery phase', {
				code: 'HOST',
			}),
		)
	if (parsed.pid !== options.ppid)
		throw buildCaptureRequestRefusal(
			file,
			new CaptureError('Journey selection request does not belong to the parent process', {
				code: 'HOST',
			}),
		)
	const args = arrayOf(isString)(parsed.args) ? parsed.args : undefined
	if (
		args === undefined ||
		args.length !== options.argv.length ||
		!args.every((argument, index) => argument === options.argv[index])
	)
		throw new CaptureError(
			`Journey selection request arguments differ from the process arguments: ${file}`,
			{ code: 'HOST', context: { file } },
		)
	if (parsed.version !== 1)
		throw new CaptureError('Journey selection request has invalid version', { code: 'HOST' })
	if (!isCaptureSegment(parsed.id) || !isCaptureSegment(parsed.stage))
		throw new CaptureError('Journey selection request has invalid identity', { code: 'HOST' })
	if (parsed.config !== options.config)
		throw new CaptureError('Journey selection request has invalid config', { code: 'HOST' })
	const command =
		parsed.command === 'journey' || parsed.command === 'capture' ? parsed.command : undefined
	if (
		parsed.state !== undefined &&
		(typeof parsed.state !== 'string' || parsed.state.trim() === '' || command !== 'capture')
	)
		throw new CaptureError('Journey selection request has invalid state', { code: 'HOST' })
	const selector = typeof parsed.selector === 'string' ? parsed.selector : undefined
	const variants = arrayOf(isString)(parsed.variants) ? parsed.variants : undefined
	if (
		command === undefined ||
		selector === undefined ||
		selector.trim() === '' ||
		(selector !== 'all' &&
			!options.owners.some((owner) => matchesCaptureSelector(owner, selector))) ||
		variants === undefined ||
		variants.length === 0 ||
		new Set(variants).size !== variants.length ||
		variants.some((variant) => !options.variants.includes(variant)) ||
		(parsed.case !== undefined && (typeof parsed.case !== 'string' || parsed.case.trim() === ''))
	)
		throw new CaptureError(
			'Journey selection request has invalid command, selector, variants, or case',
			{ code: 'HOST' },
		)
	return {
		version: 1,
		id: parsed.id,
		stage: parsed.stage,
		config: options.config,
		pid: options.ppid,
		command,
		selector,
		...(typeof parsed.case === 'string' ? { case: parsed.case } : {}),
		variants,
		args,
		...(typeof parsed.state === 'string' ? { state: parsed.state } : {}),
	}
}

/**
 * Reads a reader's command line into its selection, its flags, and the resolved paths.
 *
 * @remarks
 * The first argument is the selector and every flag after it takes one nonempty value, separated
 * or in equals form. Only `--variant` repeats. `--output` belongs to sheets; the preflight option
 * table refuses it before discovery. The wrapper, the journey artifact directory, and the checks module
 * resolve against `root`; `defaults` supplies the first two when the command line names neither.
 *
 * @param argv - The arguments after the entry name
 * @param root - The absolute workspace path the paths resolve against
 * @param defaults - The repository-relative wrapper and journey artifact directory to fall back to
 * @param command - The reader command whose option table applies. Default: `sheets`
 * @returns The reader options and the optional contact-sheet directory
 * @throws Thrown as a `USAGE` capture error for an absent selector, an unknown, repeated, or
 * valueless flag.
 *
 * @example
 * ```ts
 * readCaptureReaderArguments(['pages:mail', '--variant', 'light-390'], '/repo', {
 * 	config: 'configs/vite.journey.config.ts',
 * 	journeys: 'tmp/journey',
 * }).reader.selection // { selector: 'pages:mail', variants: ['light-390'] }
 * ```
 */
export function readCaptureReaderArguments(
	argv: readonly string[],
	root: string,
	defaults: CaptureReaderDefaults,
	command: 'preflight' | 'sheets' = 'sheets',
): CaptureReaderCommand {
	const usage = `Usage: capture ${command} <selector> ${command === 'sheets' ? '--output <directory> ' : ''}[options]`
	const { values, positionals, tokens } = readCaptureOptions(
		argv,
		CAPTURE_COMMAND_OPTIONS[command],
		usage,
	)
	const selector = positionals.at(0)
	if (selector === undefined || positionals.length !== 1 || tokens.at(0)?.kind !== 'positional')
		throw new CaptureError(usage, { code: 'USAGE' })
	const variants = values.variant ?? []
	const state = values.state
	const name = values.case
	const portfolio = values.portfolio
	const checks = values.checks
	const output = 'output' in values && typeof values.output === 'string' ? values.output : undefined
	return {
		reader: {
			root: resolve(root),
			config: resolve(root, values.config ?? defaults.config),
			journeys: resolve(root, values.journeys ?? defaults.journeys),
			selection: {
				selector,
				...(variants.length === 0 ? {} : { variants }),
				...(state === undefined ? {} : { state }),
				...(name === undefined ? {} : { case: name }),
				...(portfolio === undefined ? {} : { portfolio }),
			},
			...(checks === undefined ? {} : { checks: resolve(root, checks) }),
			...(defaults.requests === undefined ? {} : { requests: defaults.requests }),
		},
		...(output === undefined ? {} : { output: resolve(root, output) }),
	}
}

/**
 * Reads the viewport a wrapper project's producing variant declares.
 *
 * @param test - The project's `test` configuration, or any value the wrapper supplied in its place
 * @returns The producing variant's name and pixel geometry
 * @throws Thrown as a `HOST` capture error when the project declares no variant geometry or its
 * producing variant has none.
 *
 * @example
 * ```ts
 * readCaptureViewport({
 * 	provide: { variant: 'light-390', variants: [{ name: 'light-390', width: 390, height: 844 }] },
 * }) // { name: 'light-390', width: 390, height: 844 }
 * ```
 */
export function readCaptureViewport(test: unknown): CaptureViewport {
	const provided: unknown = isRecord(test) ? test.provide : undefined
	const declared: unknown = isRecord(provided) ? provided.variants : undefined
	const variant: unknown = isRecord(provided) ? provided.variant : undefined
	if (!arrayOf(isCaptureGeometry)(declared))
		throw new CaptureError('A reader project declares no viewport geometry', { code: 'HOST' })
	const viewport = declared.find((entry) => entry.name === variant)
	if (viewport === undefined)
		throw new CaptureError('A reader project has no declared producing viewport', { code: 'HOST' })
	return { name: viewport.name, width: viewport.width, height: viewport.height }
}

/**
 * Derives the integrity engine's options from a wrapper project's host declarations.
 *
 * @remarks
 * Without `standalone` the engine reads the project's primary directory and every portfolio root the
 * project authorizes. With one, the engine reads that root alone, keeping its registry, manifest, and
 * lookups beside its own directory.
 *
 * @param root - The absolute workspace path
 * @param project - The wrapper project whose declarations the engine adopts
 * @param standalone - The standalone root to read through, when a selection names one
 * @returns The options the engine is constructed with
 * @throws Thrown as a `HOST` capture error when the directory leaves the repository.
 *
 * @example
 * ```ts
 * buildCaptureIntegrityOptions(root, project).manifest // 'tmp/captures/states/manifest.json'
 * ```
 */
export function buildCaptureIntegrityOptions(
	root: string,
	project: CaptureProject,
	standalone?: CapturePortfolioRoot,
): CaptureIntegrityOptions {
	const directory =
		standalone === undefined
			? resolveCaptureRelative(root, project.directory)
			: standalone.directory
	if (!isCapturePath(directory))
		throw new CaptureError('The wrapper provides a directory outside the repository', {
			code: 'HOST',
			context: { directory },
		})
	return {
		root,
		directory,
		inputs: project.inputs,
		registry: `${directory}/${CAPTURE_REGISTRY_FILE}`,
		manifest: `${directory}/${CAPTURE_MANIFEST_FILE}`,
		lookups: `${directory}/${CAPTURE_LOOKUPS_FILE}`,
		portfolios: standalone === undefined ? project.portfolios : [standalone],
	}
}

/**
 * Reports a portfolio, owner, and viewport whose frames mix cropped, viewport-sized, and page-sized images.
 *
 * @remarks
 * Only a frame at its own producing variant counts, so an auxiliary output variant never joins its
 * producer's group. A frame narrower than its viewport reads `crop`, one as tall as the viewport
 * reads `viewport`, and any other reads `page`. The observation names the mixture without inferring
 * which framing was intended.
 *
 * @param images - The selected images, decoded
 * @param producers - The wrapper's producing viewports
 * @returns One observation per group that holds more than one kind
 *
 * @example
 * ```ts
 * scanCaptureFrames(images, producers) // ['Mixed framing: states/pages:mail@390: page, viewport']
 * ```
 */
export function scanCaptureFrames(
	images: readonly CaptureImageResult[],
	producers: readonly CaptureProducer[],
): readonly string[] {
	const families = [
		...new Set(images.map(({ entry }) => `${entry.portfolio}/${resolveCaptureOwner(entry)}`)),
	]
	return families.flatMap((family) =>
		[...new Set(producers.map((producer) => producer.width))].flatMap((width) => {
			const kinds = [
				...new Set(
					images.flatMap(({ entry, picture }) => {
						const viewport = producers.find((producer) => producer.project === entry.project)
						if (
							`${entry.portfolio}/${resolveCaptureOwner(entry)}` !== family ||
							viewport?.width !== width ||
							entry.variant !== viewport.name
						)
							return []
						return [
							picture.width < viewport.width
								? 'crop'
								: picture.height === viewport.height
									? 'viewport'
									: 'page',
						]
					}),
				),
			]
			return kinds.length > 1
				? [`Mixed framing: ${family}@${String(width)}: ${kinds.join(', ')}`]
				: []
		}),
	)
}

/**
 * Groups the selected images whose bytes are identical.
 *
 * @param images - The selected images, decoded
 * @returns One list of files per digest shared by more than one image
 *
 * @example
 * ```ts
 * collectCaptureIdentical(images) // [['tmp/captures/a.png', 'tmp/captures/b.png']]
 * ```
 */
export function collectCaptureIdentical(
	images: readonly CaptureImageResult[],
): ReadonlyArray<readonly string[]> {
	return [...new Set(images.map((image) => image.digest))]
		.map((digest) =>
			images.filter((image) => image.digest === digest).map((image) => image.entry.file),
		)
		.filter((files) => files.length > 1)
}

/**
 * Finds the journey artifact lines that report an uncaught, unhandled, or logged error.
 *
 * @param file - The artifact's repository-relative path, which prefixes each finding
 * @param text - The artifact's text
 * @returns One finding per matching line
 *
 * @example
 * ```ts
 * collectCaptureErrors('tmp/journey/light-390.txt', 'ok\nUncaught TypeError') // ['tmp/journey/light-390.txt: Uncaught TypeError']
 * ```
 */
export function collectCaptureErrors(file: string, text: string): readonly string[] {
	return text
		.split('\n')
		.filter((line) => /\b(uncaught|unhandled|error:)/iu.test(line))
		.map((line) => `${file}: ${line}`)
}

/**
 * Checks whether a process with this id is running, counting one the caller may not signal.
 *
 * @remarks
 * A zero signal tests existence without sending one. A refusal for permission still proves the
 * process exists, so only a missing process reads as not running.
 *
 * @param pid - The process id
 * @returns True if the process exists; false otherwise
 *
 * @example
 * ```ts
 * readCaptureRunning(process.pid) // true
 * ```
 */
export function readCaptureRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return isError(error) && 'code' in error && error.code === 'EPERM'
	}
}

/**
 * Resolves one entry of a wrapper's project list to the project it declares.
 *
 * @remarks
 * A factory entry is called with the serve command and the test mode, as Vitest calls it, and a
 * promise is awaited. The result is the project as plain data, not yet judged: the runner reads
 * and validates it, so one reader owns every refusal.
 *
 * @param input - The entry as the wrapper declared it: an inline project, a promise of one, or a factory
 * @returns The resolved project, whatever it holds
 *
 * @example
 * ```ts
 * const project = await resolveCaptureWrapperProject(wrapper.test.projects[0])
 * ```
 */
export async function resolveCaptureWrapperProject(input: unknown): Promise<unknown> {
	return isFunction(input) ? await input({ command: 'serve', mode: 'test' }) : await input
}

/**
 * Reads one wrapper project, as the description file holds it, into its host declarations and viewport.
 *
 * @remarks
 * The viewport is read when the project declares geometry for its producing variant and is absent
 * otherwise, because a runner command needs none and only a reader refuses its absence.
 *
 * @param value - The resolved project as plain data
 * @returns The validated project and, when it declares one, its producing viewport
 * @throws Thrown as a `HOST` capture error when the project is a path or a non-record, or when its
 * declarations are malformed.
 *
 * @example
 * ```ts
 * const { project } = readCaptureEntry({ test: { name: 'journey:light-390', provide } })
 * project.variant // 'light-390'
 * ```
 */
export function readCaptureEntry(value: unknown): CaptureHostEntry {
	if (!isRecord(value))
		throw new CaptureError('The journey wrapper must declare inline projects', { code: 'HOST' })
	const project = readCaptureProject(value.test)
	const viewport = attempt(() => readCaptureViewport(value.test))
	return { project, ...(viewport.success ? { viewport: viewport.value } : {}) }
}

/**
 * Resolves the directory that holds the runner's request files for the process that reads them.
 *
 * @remarks
 * A directory the wrapper names wins. Otherwise the directory the runner handed this child in
 * `CAPTURE_REQUESTS` applies, and a process the runner did not start reads `CAPTURE_DEFAULTS.requests`
 * beneath its working directory. The one default therefore lives here and in the executable, and a
 * consumer never has to repeat it.
 *
 * @param directory - The directory the wrapper declares, when it declares one
 * @returns The absolute directory
 *
 * @example
 * ```ts
 * resolveCaptureRequests('/repo/tmp/units') // '/repo/tmp/units'
 * ```
 */
export function resolveCaptureRequests(directory?: string): string {
	return resolve(directory ?? process.env[CAPTURE_REQUESTS_FLAG] ?? CAPTURE_DEFAULTS.requests)
}

/**
 * Builds the empty Node configuration a wrapper returns once it has answered a discovery request.
 *
 * @remarks
 * It carries no project, no setup file, and no include pattern, so Vitest collects no test, starts
 * no browser, and initializes no output for a discovery child.
 *
 * @returns A fresh configuration object
 *
 * @example
 * ```ts
 * export default (await answerCaptureDiscovery(options)) ? buildCaptureDiscoveryConfig() : config
 * ```
 */
export function buildCaptureDiscoveryConfig(): {
	readonly test: {
		readonly include: string[]
		readonly passWithNoTests: boolean
		readonly watch: boolean
	}
} {
	return { test: { include: [], passWithNoTests: true, watch: false } }
}

/**
 * Accepts the description a wrapper wrote only when it answers this exchange and no other.
 *
 * @remarks
 * Every echo must match: the invocation, the challenge, the wrapper path, the runner as the
 * wrapper's parent, and the child the runner spawned as the writer. Each project then passes the same
 * reader the wrapper's own declarations pass through, and the list may not be empty.
 *
 * @param value - The parsed description file
 * @param expected - What the request and the spawn establish
 * @returns The validated description
 * @throws Thrown as a `HOST` capture error naming the first echo that differs, a malformed
 * document, an empty project list, or a malformed project.
 *
 * @example
 * ```ts
 * const description = readCaptureDescription(parseJSON(text), expected)
 * ```
 */
export function readCaptureDescription(
	value: unknown,
	expected: CaptureDescriptionExpectation,
): CaptureHostDescription {
	if (!isRecord(value) || value.version !== CAPTURE_VERSION || !isArray(value.projects))
		throw new CaptureError('The host description is malformed', { code: 'HOST' })
	if (value.id !== expected.id)
		throw new CaptureError('The host description answers another invocation', { code: 'HOST' })
	if (value.nonce !== expected.nonce)
		throw new CaptureError('The host description answers another challenge (a replay)', {
			code: 'HOST',
		})
	if (value.config !== expected.config)
		throw new CaptureError('The host description names another wrapper', { code: 'HOST' })
	if (value.parent !== expected.parent)
		throw new CaptureError('The host description was written for another parent process', {
			code: 'HOST',
		})
	if (expected.pid === undefined || value.pid !== expected.pid)
		throw new CaptureError('The host description was not written by the discovery child', {
			code: 'HOST',
		})
	if (value.projects.length === 0)
		throw new CaptureError('The wrapper declares no projects', { code: 'HOST' })
	return {
		version: CAPTURE_VERSION,
		id: expected.id,
		nonce: expected.nonce,
		config: expected.config,
		parent: expected.parent,
		pid: expected.pid,
		projects: value.projects.map(readCaptureEntry),
	}
}

/**
 * Answers the runner's discovery request from the wrapper, before the wrapper does any other work.
 *
 * @remarks
 * The wrapper calls it once, ahead of anything that sets up a browser, initializes an output
 * directory, or collects a test, and returns `buildCaptureDiscoveryConfig()` when it answered. It
 * reads only the request file its parent process wrote and answers `false` when there is none, or
 * when the file is no discovery request, so an execution child falls through to `readCaptureRequest`.
 * A discovery request is accepted only from its own parent with the exact arguments it recorded, the
 * wrapper path it names, and an identity and challenge that are portable segments. The wrapper
 * describes every project from its own declarations and writes one description, atomically, to the
 * invocation directory; a second answer from another process is refused as a replay, while the same
 * process may answer again if Vitest loads its configuration twice.
 *
 * @param options - The parent id, the process arguments, the request directory, the wrapper path, and the wrapper's `test.projects`
 * @returns True once the description is written; false when the request is no discovery request
 * @throws Thrown as a `HOST` capture error for a discovery request that fails any check or a
 * replayed answer. It does not judge the projects: the runner reads and refuses a malformed one.
 *
 * @example
 * ```ts
 * const answered = await answerCaptureDiscovery({
 * 	ppid: process.ppid,
 * 	argv: process.argv.slice(1),
 * 	config: 'configs/vite.journey.config.ts',
 * 	projects,
 * })
 * ```
 */
export async function answerCaptureDiscovery(options: CaptureDiscoveryOptions): Promise<boolean> {
	const directory = resolveCaptureRequests(options.directory)
	const file = resolve(directory, `${CAPTURE_REQUEST_PREFIX}-${String(options.ppid)}.json`)
	if (!existsSync(file)) return false
	const read = attempt(() => readFileSync(file, 'utf8'))
	if (!read.success) return false
	const parsed = parseJSON(read.value)
	if (!isRecord(parsed) || parsed.phase !== CAPTURE_DISCOVERY.phase) return false
	if (parsed.pid !== options.ppid)
		throw buildCaptureRequestRefusal(
			file,
			new CaptureError('Discovery request does not belong to the parent process', {
				code: 'HOST',
			}),
		)
	const args = arrayOf(isString)(parsed.args) ? parsed.args : undefined
	if (
		args === undefined ||
		args.length !== options.argv.length ||
		!args.every((argument, index) => argument === options.argv[index])
	)
		throw new CaptureError(
			`Discovery request arguments differ from the process arguments: ${file}`,
			{ code: 'HOST', context: { file } },
		)
	if (parsed.version !== CAPTURE_VERSION)
		throw new CaptureError('Discovery request has invalid version', { code: 'HOST' })
	if (!isCaptureSegment(parsed.id) || !isCaptureSegment(parsed.nonce))
		throw new CaptureError('Discovery request has invalid identity', { code: 'HOST' })
	if (parsed.config !== options.config)
		throw new CaptureError('Discovery request has invalid config', { code: 'HOST' })
	const answer = resolve(
		directory,
		CAPTURE_RUNS_DIRECTORY,
		parsed.id,
		CAPTURE_DISCOVERY.description,
	)
	const prior = existsSync(answer) ? parseJSON(readFileSync(answer, 'utf8')) : undefined
	if (prior !== undefined && !(isRecord(prior) && prior.pid === process.pid))
		throw new CaptureError(`Discovery was already answered for this request: ${file}`, {
			code: 'HOST',
			context: { file },
		})
	// The projects travel as plain data; the runner reads and judges them, so one reader owns every refusal.
	const projects = await Promise.all(options.projects.map(resolveCaptureWrapperProject))
	writeCaptureDocument(answer, {
		version: CAPTURE_VERSION,
		id: parsed.id,
		nonce: parsed.nonce,
		config: options.config,
		parent: options.ppid,
		pid: process.pid,
		projects,
	})
	return true
}

/**
 * Reads the registry command line into the wrapper path, the variants to refresh, and the mode.
 *
 * @remarks
 * The command takes no selector: it refreshes every producing variant the wrapper declares, or the
 * variants named by repeated `--variant` flags. Every flag takes one value, and only `--variant`
 * repeats. `--mode` is forwarded to the wrapper's Vitest process unread.
 *
 * @param argv - The arguments after the subcommand
 * @param root - The absolute workspace path the wrapper path resolves against
 * @param fallback - The repository-relative wrapper path used when `--config` is absent
 * @returns The parsed arguments with an absolute wrapper path
 * @throws Thrown as a `USAGE` capture error for a positional argument, an unknown, repeated, or
 * valueless flag, or a repeated or invalid variant.
 *
 * @example
 * ```ts
 * readCaptureRegistryArguments(['--variant', 'light-390'], '/repo', 'vite.journey.config.ts')
 * // { config: '/repo/vite.journey.config.ts', variants: ['light-390'] }
 * ```
 */
export function readCaptureRegistryArguments(
	argv: readonly string[],
	root: string,
	fallback: string,
): CaptureRegistryArguments {
	const usage = 'Usage: capture registry [--variant <name>]... [--mode <name>] [--config <file>]'
	const { values, positionals } = readCaptureOptions(argv, CAPTURE_COMMAND_OPTIONS.registry, usage)
	if (positionals.length > 0)
		throw new CaptureError(
			`Unexpected argument ${JSON.stringify(positionals[0]?.slice(0, 80))}: the registry command takes no selector and refreshes every producing variant, or those named by --variant. ${usage}`,
			{ code: 'USAGE' },
		)
	const variants = values.variant ?? []
	if (new Set(variants).size !== variants.length)
		throw new CaptureError('Repeated variant', { code: 'USAGE' })
	if (variants.some((variant) => !isCaptureSegment(variant)))
		throw new CaptureError('Invalid variant identity', { code: 'USAGE' })
	const mode = values.mode
	return {
		config: resolve(root, values.config ?? fallback),
		variants,
		...(mode === undefined ? {} : { mode }),
	}
}

/**
 * Reads the bounded input population a project declares, as file paths and content hashes.
 *
 * @remarks
 * The expansion is the one the integrity engine takes: the native glob over the patterns, regular
 * files only, sorted, each path contained in the workspace. A pattern that matches nothing
 * contributes no file.
 *
 * @param root - The absolute workspace path
 * @param patterns - The project's native input patterns
 * @param hash - Digests each file's exact bytes. Default: `computeCaptureHash`
 * @returns The workspace-relative path of every matched file and its digest
 * @throws Thrown as a `CONTAINMENT` capture error for a matched path the evidence cannot hold, and as
 * an `EVIDENCE` capture error for a path that matches under two spellings.
 *
 * @example
 * ```ts
 * readCaptureInputs(process.cwd(), ['src/**']) // { 'src/a.ts': '3f2a…' }
 * ```
 */
export function readCaptureInputs(
	root: string,
	patterns: readonly string[],
	hash: CaptureHashHandler = computeCaptureHash,
): Readonly<Record<string, string>> {
	const files = [...new Set(globSync([...patterns], { cwd: root }).map(normalizeSlashes))]
		.filter((file) => {
			if (!isCapturePath(file))
				throw new CaptureError(`Input path cannot be held as evidence: ${JSON.stringify(file)}`, {
					code: 'CONTAINMENT',
				})
			return statSync(resolve(root, file)).isFile()
		})
		.toSorted()
	requireCaptureUnique(files, 'input paths', true)
	return Object.fromEntries(files.map((file) => [file, hash(readFileSync(resolve(root, file)))]))
}

/**
 * Writes one JSON document atomically, so a reader sees the old bytes or the new and never a part.
 *
 * @remarks
 * The document is written to a unique temporary sibling, flushed, and renamed over the target. The
 * signal is checked after the flush and before the rename, and the temporary file never outlives the
 * call.
 *
 * @param path - The absolute target path, whose directory is created when missing
 * @param value - The value to serialize
 * @param signal - Aborts the write before the rename when it fires
 *
 * @example
 * ```ts
 * writeCaptureDocument('/repo/tmp/captures/states/registry.json', registry)
 * ```
 */
export function writeCaptureDocument(path: string, value: unknown, signal?: AbortSignal): void {
	mkdirSync(dirname(path), { recursive: true })
	const temporary = `${path}.${randomUUID()}.tmp`
	try {
		writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', flush: true })
		signal?.throwIfAborted()
		renameSync(temporary, path)
	} finally {
		rmSync(temporary, { force: true })
	}
}
