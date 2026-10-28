import type { TestProjectConfiguration } from 'vitest/config'
import type { CaptureDigest, CaptureRegistry, CaptureRequest, CaptureViewport } from '@src/core'
import type {
	CaptureArgumentsOptions,
	CaptureCommand,
	CaptureHashHandler,
	CaptureImageReading,
	CaptureIntegrityOptions,
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
	closeSync,
	existsSync,
	fsyncSync,
	globSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { loadConfigFromFile } from 'vite'
import {
	arrayOf,
	attempt,
	isArray,
	isError,
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
	isCaptureGeometry,
	isCapturePath,
	isCapturePattern,
	isCaptureReceipt,
	isCaptureSegment,
	matchesCaptureMembers,
	matchesCaptureSelector,
	readCaptureReport,
	requireCaptureUnique,
	resolveCaptureKey,
	resolveCaptureOwner,
	validateCaptureReceipt,
} from '@src/core'
import {
	CAPTURE_FLAG,
	CAPTURE_FLAG_VALUE,
	CAPTURE_OPTION_FLAGS,
	CAPTURE_OWNER_PREFIX,
	CAPTURE_READER_FLAGS,
	CAPTURE_REGISTRY_FLAGS,
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
 * Reads the value that follows a flag.
 *
 * @param argv - The arguments after the entry name
 * @param name - The flag, such as `--variant`
 * @returns The value after the flag, or `undefined` when the flag is absent, last, or followed by
 * another flag
 *
 * @example
 * ```ts
 * readFlag(['pages:mail', '--case', 'inbox'], '--case') // 'inbox'
 * ```
 */
export function readFlag(argv: readonly string[], name: string): string | undefined {
	const index = argv.indexOf(name)
	const value = index === -1 ? undefined : argv[index + 1]
	return value === undefined || value.startsWith('--') ? undefined : value
}

/**
 * Reads every value that follows a repeatable flag.
 *
 * @param argv - The arguments after the entry name
 * @param name - The flag, such as `--variant`
 * @returns The values in order, empty when the flag never appears
 *
 * @example
 * ```ts
 * readFlags(['--variant', 'a', '--variant', 'b'], '--variant') // ['a', 'b']
 * ```
 */
export function readFlags(argv: readonly string[], name: string): readonly string[] {
	return argv.flatMap((argument, index) => {
		const value = argv[index + 1]
		return argument === name && value !== undefined && !value.startsWith('--') ? [value] : []
	})
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
 * Decodes the RGB or RGBA, eight-bit, non-interlaced PNGs the capture readers consume.
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
	const channels = bytes[25] === 6 ? 4 : bytes[25] === 2 ? 3 : 0
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
				Math.floor((index % (width * 3)) / 3) * channels + (index % 3)
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
 * Plans the stages of one invocation: the first variant alone, then every other variant together.
 *
 * @remarks
 * A stage with no variant is dropped, so an invocation that does not select the first variant runs
 * the selected variants in one stage. The plan adds no variant the caller did not select.
 *
 * @param variants - The selected variants in declaration order
 * @param first - The variant the wrapper stages alone first
 * @returns The non-empty stages in run order
 *
 * @example
 * ```ts
 * resolveCaptureStages(['wide', 'compact'], 'compact')
 * // [{ name: 'narrow', variants: ['compact'] }, { name: 'rest', variants: ['wide'] }]
 * ```
 */
export function resolveCaptureStages(
	variants: readonly string[],
	first: string,
): readonly CaptureStagePlan[] {
	return [
		{ name: CAPTURE_STAGES.first, variants: variants.filter((variant) => variant === first) },
		{ name: CAPTURE_STAGES.rest, variants: variants.filter((variant) => variant !== first) },
	].filter((stage) => stage.variants.length > 0)
}

/**
 * Builds the exact Node argument array that spawns one Vitest stage.
 *
 * @remarks
 * Each value is its own array element, so no shell quoting applies and a case name keeps its
 * spaces and quotes. An exact case adds `-t` with the anchored pattern for that case and the
 * closing case, so the closing case still writes the run record.
 *
 * @param options - The entry, wrapper, report, projects, tag filter, and optional exact case and mode
 * @returns The arguments after the Node executable
 *
 * @example
 * ```ts
 * const args = buildCaptureArguments({
 * 	entry: '/repo/node_modules/vitest/vitest.mjs',
 * 	config: '/repo/vite.journey.config.ts',
 * 	report: '/repo/tmp/units/runs/a/journey-narrow.json',
 * 	projects: ['journey:light-390'],
 * 	filter: 'owner:pages:mail',
 * 	closing: 'closes the run',
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
					`^(?:${[options.case, options.closing].map((name) => escapeCapturePattern(name)).join('|')})$`,
				]),
	]
}

/**
 * Reads the runner's command line into one selector, its flags, and the resolved wrapper path.
 *
 * @remarks
 * `--state` belongs to `capture` and `stale`, and `--portfolio` to `stale`. Every flag takes one
 * value, only `--variant` repeats, and exactly one positional selector is allowed. An omitted
 * selector is returned as absent so the caller can print its usage with the declared selectors.
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
	const values: Array<{ readonly flag: string; readonly value: string }> = []
	const positional: string[] = []
	const cursor = argv.values()
	for (const argument of cursor) {
		if (!argument.startsWith('--')) {
			positional.push(argument)
			continue
		}
		if (argument === '--state' && command === 'journey')
			throw new CaptureError('State selection is available only to capture and stale', {
				code: 'USAGE',
			})
		if (argument === '--portfolio' && command !== 'stale')
			throw new CaptureError('Portfolio selection is available only to stale', { code: 'USAGE' })
		if (!CAPTURE_OPTION_FLAGS.includes(argument))
			throw new CaptureError(`Unknown option: ${argument}`, { code: 'USAGE' })
		const value = cursor.next().value
		if (value === undefined || value === '' || value.startsWith('--'))
			throw new CaptureError(`Missing value: ${argument}`, { code: 'USAGE' })
		if (argument !== '--variant' && values.some((entry) => entry.flag === argument))
			throw new CaptureError(`Repeated option: ${argument}`, { code: 'USAGE' })
		values.push({ flag: argument, value })
	}
	if (positional.length > 1)
		throw new CaptureError('Expected exactly one selector', { code: 'USAGE' })
	const variants = readFlags(argv, '--variant')
	if (new Set(variants).size !== variants.length)
		throw new CaptureError('Repeated variant', { code: 'USAGE' })
	if (variants.some((variant) => !isCaptureSegment(variant)))
		throw new CaptureError('Invalid variant identity', { code: 'USAGE' })
	const state = readFlag(argv, '--state')
	if (state !== undefined && !isCaptureSegment(state))
		throw new CaptureError('Invalid state identity', { code: 'USAGE' })
	const name = readFlag(argv, '--case')
	if (name !== undefined && name.trim() === '')
		throw new CaptureError('Empty case name', { code: 'USAGE' })
	const portfolio = readFlag(argv, '--portfolio')
	const selector = positional.at(0)
	return {
		...(selector === undefined ? {} : { selector }),
		config: resolve(root, readFlag(argv, '--config') ?? fallback),
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
 * the closing case are required, and standalone roots default to none.
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
 * 		closing: 'closes the run',
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
	const tags = (isArray(entries) ? entries : []).map((tag): unknown =>
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
	const closing = provided.closing
	if (!isString(closing) || closing.trim() === '')
		throw new CaptureError('The wrapper provides no closing case', { code: 'HOST' })
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
		closing,
		first,
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
 * declare the same primary directory, inputs, variants, first-stage variant, closing case, and
 * portfolio roots, because the runner builds one engine for the whole set.
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
				project.closing !== first.closing ||
				project.first !== first.first ||
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
	const file = resolve(options.directory, `${CAPTURE_REQUEST_PREFIX}-${String(options.ppid)}.json`)
	if (!existsSync(file)) return undefined
	const read = attempt(() => readFileSync(file, 'utf8'))
	if (!read.success) throw buildCaptureRequestRefusal(file, read.error)
	const parsed = parseJSON(read.value)
	if (!isRecord(parsed)) throw buildCaptureRequestRefusal(file)
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
 * The first argument is the selector and every flag after it takes exactly one value. Only
 * `--variant` repeats. `--output` belongs to the contact sheets and the caller refuses it for a
 * reader that writes none. The wrapper, the journey artifact directory, and the checks module
 * resolve against `root`; `defaults` supplies the first two when the command line names neither.
 *
 * @param argv - The arguments after the entry name
 * @param root - The absolute workspace path the paths resolve against
 * @param defaults - The repository-relative wrapper and journey artifact directory to fall back to
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
): CaptureReaderCommand {
	const selector = argv.at(0)
	if (selector === undefined || selector.startsWith('--'))
		throw new CaptureError(
			'Usage: <selector> [--variant <output>] [--state <state>] [--case <name>] [--portfolio <name>] [--config <file>] [--journeys <directory>] [--checks <module>] [--output <directory>]',
			{ code: 'USAGE' },
		)
	const rest = argv.slice(1)
	for (const [index, argument] of rest.entries()) {
		if (index % 2 === 0 && !CAPTURE_READER_FLAGS.includes(argument))
			throw new CaptureError(`Unknown reader option: ${argument}`, { code: 'USAGE' })
		if (index % 2 === 1 && (argument === '' || argument.startsWith('--')))
			throw new CaptureError('Missing reader option value', { code: 'USAGE' })
	}
	if (rest.length % 2 === 1)
		throw new CaptureError('Missing reader option value', { code: 'USAGE' })
	for (const flag of CAPTURE_READER_FLAGS.filter((entry) => entry !== '--variant')) {
		if (readFlags(argv, flag).length > 1)
			throw new CaptureError(`Repeated reader option: ${flag}`, { code: 'USAGE' })
	}
	const variants = readFlags(argv, '--variant')
	const state = readFlag(argv, '--state')
	const name = readFlag(argv, '--case')
	const portfolio = readFlag(argv, '--portfolio')
	const checks = readFlag(argv, '--checks')
	const output = readFlag(argv, '--output')
	return {
		reader: {
			root: resolve(root),
			config: resolve(root, readFlag(argv, '--config') ?? defaults.config),
			journeys: resolve(root, readFlag(argv, '--journeys') ?? defaults.journeys),
			selection: {
				selector,
				...(variants.length === 0 ? {} : { variants }),
				...(state === undefined ? {} : { state }),
				...(name === undefined ? {} : { case: name }),
				...(portfolio === undefined ? {} : { portfolio }),
			},
			...(checks === undefined ? {} : { checks: resolve(root, checks) }),
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
 * collectCaptureFraming(images, producers) // ['Mixed framing: states/pages:mail@390: page, viewport']
 * ```
 */
export function collectCaptureFraming(
	images: readonly CaptureImageReading[],
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
	images: readonly CaptureImageReading[],
): readonly (readonly string[])[] {
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
 * Resolves one entry of a wrapper's project list and reads its host declarations.
 *
 * @remarks A factory entry is called with the serve command and the test mode, as Vitest calls it.
 *
 * @param input - The entry as the wrapper declared it: an inline project, a promise of one, or a factory
 * @returns The validated project
 * @throws Thrown as a `HOST` capture error when the entry is a path, or when its declarations are malformed.
 *
 * @example
 * ```ts
 * const project = await readCaptureWrapperProject(wrapper.test.projects[0])
 * project.variant // 'light-390'
 * ```
 */
export async function readCaptureWrapperProject(
	input: TestProjectConfiguration,
): Promise<CaptureProject> {
	const project =
		typeof input === 'function' ? await input({ command: 'serve', mode: 'test' }) : await input
	if (typeof project === 'string')
		throw new CaptureError('The journey wrapper must declare inline projects', { code: 'HOST' })
	return readCaptureProject(project.test)
}

/**
 * Loads the wrapper in this process and reads every project's host declarations.
 *
 * @remarks
 * The wrapper loads through Vite's `loadConfigFromFile` with the capture variable set for the
 * inspection, so the wrapper never runs its destructive no-capture directory initialization, and the
 * inherited value is restored afterwards. A project the wrapper declares as a factory is called with
 * the serve command and the test mode.
 *
 * @param root - The absolute workspace path
 * @param config - The absolute or workspace-relative wrapper path, which must stay inside the workspace
 * @returns The validated projects in declaration order
 * @throws Thrown as a `USAGE` capture error for a wrapper outside the workspace, and as a `HOST`
 * capture error when the wrapper cannot load, declares no projects, or declares a project by path.
 *
 * @example
 * ```ts
 * const projects = await loadCaptureProjects(process.cwd(), 'configs/app/vite.journey.config.ts')
 * projects.map((project) => project.variant)
 * ```
 */
export async function loadCaptureProjects(
	root: string,
	config: string,
): Promise<readonly CaptureProject[]> {
	if (!isCapturePath(resolveCaptureRelative(root, config)))
		throw new CaptureError('Config must be a contained repository path', { code: 'USAGE' })
	const inherited = Object.entries(process.env).filter(
		([name]) => name.toLowerCase() === CAPTURE_FLAG.toLowerCase(),
	)
	for (const [name] of inherited) delete process.env[name]
	// Inspection must not execute the wrapper's destructive no-capture directory initialization.
	process.env[CAPTURE_FLAG] = CAPTURE_FLAG_VALUE
	try {
		const loaded = await loadConfigFromFile(
			{ command: 'serve', mode: 'test' },
			config,
			root,
			'silent',
			undefined,
			'runner',
		)
		if (loaded === null)
			throw new CaptureError('Unable to load the journey wrapper', { code: 'HOST' })
		const projects = loaded.config.test?.projects
		if (projects === undefined)
			throw new CaptureError('The wrapper declares no projects', { code: 'HOST' })
		return await Promise.all(projects.map(readCaptureWrapperProject))
	} finally {
		delete process.env[CAPTURE_FLAG]
		for (const [name, value] of inherited) process.env[name] = value
	}
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
	const flags: string[] = []
	const cursor = argv.values()
	for (const argument of cursor) {
		if (!argument.startsWith('--'))
			throw new CaptureError(
				`Unexpected argument ${JSON.stringify(argument.slice(0, 80))}: the registry command takes no selector and refreshes every producing variant, or those named by --variant. ${usage}`,
				{ code: 'USAGE' },
			)
		if (!CAPTURE_REGISTRY_FLAGS.includes(argument))
			throw new CaptureError(
				`Unknown option ${JSON.stringify(argument.slice(0, 80))}: expected one of ${CAPTURE_REGISTRY_FLAGS.join(', ')}. ${usage}`,
				{ code: 'USAGE' },
			)
		const value = cursor.next().value
		if (value === undefined || value === '' || value.startsWith('--'))
			throw new CaptureError(`Missing value: ${argument}. ${usage}`, { code: 'USAGE' })
		if (argument !== '--variant' && flags.includes(argument))
			throw new CaptureError(`Repeated option: ${argument}. ${usage}`, { code: 'USAGE' })
		flags.push(argument)
	}
	const variants = readFlags(argv, '--variant')
	if (new Set(variants).size !== variants.length)
		throw new CaptureError('Repeated variant', { code: 'USAGE' })
	if (variants.some((variant) => !isCaptureSegment(variant)))
		throw new CaptureError('Invalid variant identity', { code: 'USAGE' })
	const mode = readFlag(argv, '--mode')
	return {
		config: resolve(root, readFlag(argv, '--config') ?? fallback),
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
		const handle = openSync(temporary, 'wx')
		try {
			writeFileSync(handle, `${JSON.stringify(value)}\n`)
			fsyncSync(handle)
		} finally {
			closeSync(handle)
		}
		signal?.throwIfAborted()
		renameSync(temporary, path)
	} finally {
		rmSync(temporary, { force: true })
	}
}
