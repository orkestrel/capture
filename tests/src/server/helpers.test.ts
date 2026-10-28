import type { CaptureDestination } from '@src/core'
import type { CaptureImageReading, CaptureProducer } from '@src/server'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { parseJSON } from '@orkestrel/contract'
import { createScratch } from '@orkestrel/test/server'
import { isCaptureError, isCaptureLookupJournal } from '@src/core'
import {
	CAPTURE_DEFAULTS,
	answerCaptureDiscovery,
	buildCaptureArguments,
	buildCaptureDigest,
	buildCaptureLookupJournal,
	buildCaptureDiscoveryConfig,
	buildCaptureFilter,
	buildCaptureIntegrityOptions,
	buildCaptureRegistry,
	buildCaptureRequestRefusal,
	collectCaptureErrors,
	collectCaptureFraming,
	collectCaptureIdentical,
	composeCapturePictures,
	computeCaptureHash,
	computeRegistryDigest,
	decodeCapturePicture,
	describeCapturePortfolios,
	describeCaptureSelectorFault,
	encodeCaptureChunk,
	encodeCapturePicture,
	encodeCaptureWord,
	escapeCapturePattern,
	inflateCaptureStream,
	matchesCaptureSignature,
	normalizeSlashes,
	predictCaptureByte,
	readCaptureArguments,
	readCaptureChunks,
	readCaptureDescription,
	readCaptureEntry,
	readCaptureInputs,
	readCaptureLookups,
	readCapturePortfolios,
	readCaptureProject,
	readCaptureReaderArguments,
	readCaptureRegistryArguments,
	readCaptureRequest,
	readCaptureRequestOwner,
	readCaptureRunning,
	readCaptureViewport,
	resolveCaptureWrapperProject,
	readFlag,
	readFlags,
	requireCaptureProjects,
	resolveCaptureRelative,
	resolveCaptureRequests,
	resolveCaptureStages,
	shrinkCapturePicture,
	unfilterCaptureRow,
	writeCaptureDocument,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import { createPngBytes } from '../../fixtures/capture/createPngBytes.js'
import {
	readExitedPid,
	startSleeper,
	stopFixtureChild,
} from '../../fixtures/capture/ProcessFixture.js'
import {
	FIXTURE_HASH,
	createDestinationFixture,
	createLookupFixture,
	createReceiptFixture,
	createVitestFixture,
	readThrown,
} from '../../setup.js'
import {
	ALPHA_PICTURE,
	ARGUMENT_REFUSALS,
	FILTERED_PICTURE,
	HASH_VECTORS,
	PNG,
	PREDICTOR_CASES,
	PROJECT_REFUSALS,
	REGISTRY_ARGUMENT_REFUSALS,
	RUNNER_CLOSING,
	UNFILTER_CASES,
	WIRE_BYTES,
	WIRE_CONFIG,
	WIRE_REFUSALS,
	createProjectFixture,
	createWireOptions,
	createWireRequest,
	withEnvironment,
} from '../../setupServer.js'

function createSolid(width: number, height: number, value: number) {
	return { width, height, pixels: new Uint8Array(width * height * 3).fill(value) }
}

function createImportInput(
	overrides: Partial<Parameters<typeof buildCaptureRegistry>[0][number]> = {},
) {
	const report = JSON.stringify(createVitestFixture())
	return {
		receipt: createReceiptFixture({
			report: {
				file: 'tmp/captures/states/runs/run-1/journey-narrow.json',
				digest: computeCaptureHash(report),
			},
		}),
		report,
		outcome: { code: 0, signal: null },
		capped: false,
		...overrides,
	}
}

describe('computeCaptureHash', () => {
	it.each(HASH_VECTORS)('matches the published SHA-256 digest of $text', ({ text, digest }) => {
		expect(computeCaptureHash(text)).toBe(digest)
		expect(computeCaptureHash(new TextEncoder().encode(text))).toBe(digest)
	})

	it('differs for a one-byte change', () => {
		expect(computeCaptureHash(Uint8Array.from([1, 2, 3]))).not.toBe(
			computeCaptureHash(Uint8Array.from([1, 2, 4])),
		)
	})
})

describe('normalizeSlashes', () => {
	it('replaces every backslash and leaves a portable path unchanged', () => {
		expect(normalizeSlashes('tmp\\captures\\states\\a.png')).toBe('tmp/captures/states/a.png')
		expect(normalizeSlashes('tmp/captures\\a.png')).toBe('tmp/captures/a.png')
		expect(normalizeSlashes('tmp/captures/a.png')).toBe('tmp/captures/a.png')
		expect(normalizeSlashes('')).toBe('')
	})
})

describe('readFlag', () => {
	it('reads the value after the first occurrence of a flag', () => {
		expect(readFlag(['pages:mail', '--case', 'inbox', '--case', 'other'], '--case')).toBe('inbox')
	})

	it('answers undefined for an absent, last, or valueless flag', () => {
		expect(readFlag(['pages:mail'], '--case')).toBeUndefined()
		expect(readFlag(['pages:mail', '--case'], '--case')).toBeUndefined()
		expect(readFlag(['--case', '--state', 'inbox'], '--case')).toBeUndefined()
		expect(readFlag([], '--case')).toBeUndefined()
	})
})

describe('readFlags', () => {
	it('reads every value of a repeated flag in order', () => {
		expect(readFlags(['--variant', 'a', '--state', 'x', '--variant', 'b'], '--variant')).toEqual([
			'a',
			'b',
		])
	})

	it('skips an occurrence with no value and answers empty when the flag never appears', () => {
		expect(readFlags(['--variant', '--variant', 'b', '--variant'], '--variant')).toEqual(['b'])
		expect(readFlags(['pages:mail'], '--variant')).toEqual([])
	})
})

describe('buildCaptureDigest', () => {
	it('sorts patterns and files and ignores the order they arrive in', () => {
		const first = buildCaptureDigest(['b/**', 'a/**'], {
			'b.ts': FIXTURE_HASH,
			'a.ts': 'c'.repeat(64),
		})
		const second = buildCaptureDigest(['a/**', 'b/**'], {
			'a.ts': 'c'.repeat(64),
			'b.ts': FIXTURE_HASH,
		})
		expect(first.patterns).toEqual(['a/**', 'b/**'])
		expect(Object.keys(first.files)).toEqual(['a.ts', 'b.ts'])
		expect(first).toEqual(second)
		expect(first.digest).toMatch(/^[a-f0-9]{64}$/u)
	})

	it('changes when a pattern, a path, or a hash changes', () => {
		const base = buildCaptureDigest(['a/**'], { 'a.ts': FIXTURE_HASH }).digest
		expect(buildCaptureDigest(['b/**'], { 'a.ts': FIXTURE_HASH }).digest).not.toBe(base)
		expect(buildCaptureDigest(['a/**'], { 'b.ts': FIXTURE_HASH }).digest).not.toBe(base)
		expect(buildCaptureDigest(['a/**'], { 'a.ts': 'c'.repeat(64) }).digest).not.toBe(base)
		expect(buildCaptureDigest(['a/**'], {}).digest).not.toBe(base)
	})

	it('digests an empty population', () => {
		expect(buildCaptureDigest([], {})).toMatchObject({ patterns: [], files: {} })
	})
})

describe('buildCaptureLookupJournal and readCaptureLookups', () => {
	it('stores a shared input map once and reads every lookup back from serialized bytes', () => {
		const inputs = Object.fromEntries(
			Array.from({ length: 309 }, (_, index) => [`src/input-${index}.ts`, FIXTURE_HASH]),
		)
		const lookups = Array.from({ length: 1400 }, (_, index) =>
			createLookupFixture({ case: `case ${index}`, inputs }),
		)
		const journal = buildCaptureLookupJournal(lookups, [], FIXTURE_HASH)
		const text = JSON.stringify(journal)
		const decoded: unknown = parseJSON(text)
		if (!isCaptureLookupJournal(decoded)) throw new Error('Invalid serialized lookup journal')
		expect(Object.values(decoded.inputs)).toEqual([inputs])
		expect(text.match(/"src\/input-0.ts"/gu)).toHaveLength(1)
		expect(decoded.lookups).toHaveLength(lookups.length)
		expect(new Set(decoded.lookups.map((entry) => entry.inputs)).size).toBe(1)
		expect(decoded.manifest).toBe(FIXTURE_HASH)
		const expanded = readCaptureLookups(decoded)
		expect(expanded).toEqual(lookups)
		expect(expanded.every((entry) => entry.inputs === expanded[0]?.inputs)).toBe(true)
	})

	it('deduplicates equal maps in different orders and retains genuinely different populations', () => {
		const inputs = { 'src/a.ts': FIXTURE_HASH, 'src/b.ts': 'b'.repeat(64) }
		const lookups = [
			createLookupFixture({ case: 'first', inputs }),
			createLookupFixture({
				case: 'second',
				inputs: Object.fromEntries(Object.entries(inputs).reverse()),
			}),
			createLookupFixture({ case: 'changed', inputs: { ...inputs, 'src/a.ts': 'c'.repeat(64) } }),
			createLookupFixture({ case: 'removed', inputs: { 'src/a.ts': FIXTURE_HASH } }),
		]
		const journal = buildCaptureLookupJournal(lookups, [])
		expect(Object.keys(journal.inputs)).toHaveLength(3)
		expect(readCaptureLookups(journal)).toEqual(lookups)
		expect(journal.manifest).toBeUndefined()
	})

	it('preserves empty lookup collections without inventing an input population', () => {
		const journal = buildCaptureLookupJournal([], [])
		expect(journal).toEqual({ version: 1, inputs: {}, lookups: [], collections: [] })
		expect(isCaptureLookupJournal(journal)).toBe(true)
		expect(readCaptureLookups(journal)).toEqual([])
	})

	it('refuses an unknown input reference with its digest named', () => {
		const journal = buildCaptureLookupJournal([createLookupFixture()], [])
		const unknown = { ...journal, inputs: {} }
		expect(isCaptureLookupJournal(unknown)).toBe(true)
		expect(() => readCaptureLookups(unknown)).toThrow(
			`Lookup names an unknown inputs digest: ${journal.lookups[0]?.inputs}`,
		)
	})

	it('refuses a stored map whose bytes no longer match its digest', () => {
		const journal = buildCaptureLookupJournal([createLookupFixture()], [])
		const altered = {
			...journal,
			inputs: Object.fromEntries(
				Object.keys(journal.inputs).map((digest) => [digest, { 'src/altered.ts': FIXTURE_HASH }]),
			),
		}
		expect(isCaptureLookupJournal(altered)).toBe(true)
		expect(() => readCaptureLookups(altered)).toThrow('Lookup input digest differs from its map')
	})
})

describe('computeRegistryDigest', () => {
	const receipt = createReceiptFixture()
	const entries = receipt.registry
	const base = computeRegistryDigest({ version: 1, receipts: [receipt], entries })

	it('is a SHA-256 identity that ignores the order of receipts and entries', () => {
		const other = createReceiptFixture({ variant: 'dark-390' })
		expect(base).toMatch(/^[a-f0-9]{64}$/u)
		expect(computeRegistryDigest({ version: 1, receipts: [receipt, other], entries })).toBe(
			computeRegistryDigest({ version: 1, receipts: [other, receipt], entries }),
		)
	})

	it('changes with the version, a receipt field, and the entry population', () => {
		expect(computeRegistryDigest({ version: 2, receipts: [receipt], entries })).not.toBe(base)
		expect(
			computeRegistryDigest({
				version: 1,
				receipts: [createReceiptFixture({ time: '2026-10-29T09:00:00.000Z' })],
				entries,
			}),
		).not.toBe(base)
		expect(
			computeRegistryDigest({
				version: 1,
				receipts: [createReceiptFixture({ inputs: { 'src/mail/view.ts': 'c'.repeat(64) } })],
				entries,
			}),
		).not.toBe(base)
		expect(computeRegistryDigest({ version: 1, receipts: [receipt], entries: [] })).not.toBe(base)
	})
})

describe('buildCaptureRegistry', () => {
	it('imports an uncapped successful receipt with an unchanged report', () => {
		const input = createImportInput()
		const registry = buildCaptureRegistry([input])
		expect(registry.receipts).toEqual([input.receipt])
		expect(registry.entries).toEqual(input.receipt.registry)
		expect(registry.version).toBe(1)
		expect(registry.digest).toBe(
			computeRegistryDigest({
				version: registry.version,
				receipts: registry.receipts,
				entries: registry.entries,
			}),
		)
	})

	it.each([
		['a cap', { capped: true }],
		['a nonzero exit', { outcome: { code: 7, signal: null } }],
		['a signal', { outcome: { code: null, signal: 'SIGTERM' } }],
		['an incomplete receipt', { receipt: createReceiptFixture({ complete: false }) }],
	] as const)('refuses %s before importing', (_name, overrides) => {
		const failure = readThrown(() => buildCaptureRegistry([createImportInput(overrides)]))
		expect(failure).toMatchObject({
			message: 'Registry receipt requires an uncapped successful exit and unchanged report',
			code: 'EVIDENCE',
		})
		expect(isCaptureError(failure)).toBe(true)
	})

	it('refuses a report whose bytes changed after the receipt pinned them', () => {
		const input = createImportInput()
		expect(() => buildCaptureRegistry([{ ...input, report: `${input.report} ` }])).toThrow(
			'Registry receipt requires an uncapped successful exit and unchanged report',
		)
	})

	it('refuses an empty import, a repeated variant, and an unparsable report', () => {
		const input = createImportInput()
		expect(() => buildCaptureRegistry([])).toThrow('A registry requires complete-run receipts')
		expect(() => buildCaptureRegistry([input, input])).toThrow(
			'Duplicate complete receipt variants',
		)
		const broken = '{'
		expect(() =>
			buildCaptureRegistry([
				createImportInput({
					report: broken,
					receipt: createReceiptFixture({
						report: { file: 'tmp/report.json', digest: computeCaptureHash(broken) },
					}),
				}),
			]),
		).toThrow('Invalid or unsuccessful Vitest JSON report')
	})
})

describe('matchesCaptureSignature', () => {
	it('accepts the PNG signature and refuses a short or altered one', () => {
		expect(matchesCaptureSignature(PNG)).toBe(true)
		expect(matchesCaptureSignature(PNG.subarray(0, 8))).toBe(true)
		expect(matchesCaptureSignature(PNG.subarray(0, 7))).toBe(false)
		expect(matchesCaptureSignature(Buffer.concat([Buffer.from([0]), PNG.subarray(1)]))).toBe(false)
		expect(matchesCaptureSignature(new Uint8Array())).toBe(false)
	})
})

describe('predictCaptureByte', () => {
	it.each(PREDICTOR_CASES)(
		'selects $expected for left $left, up $up, corner $corner',
		({ left, up, corner, expected }) => {
			expect(predictCaptureByte(left, up, corner)).toBe(expected)
		},
	)
})

describe('unfilterCaptureRow', () => {
	it.each(UNFILTER_CASES)(
		'reconstructs filter $filter at $channels channels',
		({ filter, line, above, channels, expected }) => {
			expect([
				...unfilterCaptureRow(
					filter,
					Uint8Array.from(line),
					above === undefined ? undefined : Uint8Array.from(above),
					channels,
				),
			]).toEqual(expected)
		},
	)

	it('leaves its inputs unchanged', () => {
		const line = Uint8Array.from([1, 1, 1])
		const above = Uint8Array.from([5, 5, 5])
		unfilterCaptureRow(2, line, above, 1)
		expect([...line]).toEqual([1, 1, 1])
		expect([...above]).toEqual([5, 5, 5])
	})
})

describe('encodeCaptureWord', () => {
	it('encodes an unsigned integer as four big-endian bytes', () => {
		expect([...encodeCaptureWord(0)]).toEqual([0, 0, 0, 0])
		expect([...encodeCaptureWord(258)]).toEqual([0, 0, 1, 2])
		expect([...encodeCaptureWord(4294967295)]).toEqual([255, 255, 255, 255])
	})
})

describe('encodeCaptureChunk', () => {
	it('frames the closing chunk with the specification checksum', () => {
		expect([...encodeCaptureChunk('IEND', Buffer.alloc(0))]).toEqual([
			0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
		])
	})

	it('carries its payload between the length and the checksum', () => {
		const chunk = encodeCaptureChunk('IDAT', Buffer.from([1, 2, 3]))
		expect(chunk.readUInt32BE(0)).toBe(3)
		expect(chunk.toString('latin1', 4, 8)).toBe('IDAT')
		expect([...chunk.subarray(8, 11)]).toEqual([1, 2, 3])
		expect(chunk).toHaveLength(15)
	})
})

describe('readCaptureChunks', () => {
	it('returns the compressed-data chunks in order and skips every other chunk', () => {
		const chunks = readCaptureChunks(createPngBytes({ ...FILTERED_PICTURE, split: true }))
		expect(chunks).toHaveLength(2)
		expect([...inflateSync(Buffer.concat(chunks))]).toEqual(FILTERED_PICTURE.rows.flat())
	})

	it('refuses truncated, corrupt, and unterminated bytes', () => {
		const png = createPngBytes(FILTERED_PICTURE)
		expect(() => readCaptureChunks(png.subarray(0, 40))).toThrow('Truncated capture PNG')
		expect(() => readCaptureChunks(png.subarray(0, 46))).toThrow('Truncated capture PNG chunk')
		const corrupt = Buffer.from(png)
		corrupt[41] = (corrupt[41] ?? 0) ^ 1
		expect(() => readCaptureChunks(corrupt)).toThrow('Capture PNG checksum differs')
		expect(() => readCaptureChunks(Buffer.concat([png, Buffer.from([0])]))).toThrow(
			'Invalid capture PNG closing chunk',
		)
	})
})

describe('decodeCapturePicture', () => {
	it('reconstructs every filter type to the hand-worked pixels', () => {
		const picture = decodeCapturePicture(createPngBytes(FILTERED_PICTURE))
		expect([picture.width, picture.height]).toEqual([2, 4])
		expect([...picture.pixels]).toEqual(FILTERED_PICTURE.pixels)
	})

	it('joins a compressed stream split across several data chunks', () => {
		const picture = decodeCapturePicture(createPngBytes({ ...FILTERED_PICTURE, split: true }))
		expect([...picture.pixels]).toEqual(FILTERED_PICTURE.pixels)
	})

	it('drops the alpha channel of an RGBA image', () => {
		const picture = decodeCapturePicture(createPngBytes({ ...ALPHA_PICTURE, color: 6 }))
		expect([picture.width, picture.height]).toEqual([1, 2])
		expect([...picture.pixels]).toEqual(ALPHA_PICTURE.pixels)
	})

	it('fills all three channels from a grayscale sample, with or without alpha', () => {
		const gray = decodeCapturePicture(
			createPngBytes({ width: 2, height: 1, rows: [[0, 7, 9]], color: 0 }),
		)
		expect([gray.width, gray.height]).toEqual([2, 1])
		expect([...gray.pixels]).toEqual([7, 7, 7, 9, 9, 9])
		const alpha = decodeCapturePicture(
			createPngBytes({ width: 2, height: 1, rows: [[0, 7, 255, 9, 128]], color: 4 }),
		)
		expect([...alpha.pixels]).toEqual([7, 7, 7, 9, 9, 9])
		const filtered = decodeCapturePicture(
			createPngBytes({ width: 2, height: 1, rows: [[1, 7, 255, 2, 1]], color: 4 }),
		)
		expect([...filtered.pixels]).toEqual([7, 7, 7, 9, 9, 9])
	})

	it('reads a valid single-pixel grey-and-alpha file', () => {
		const picture = decodeCapturePicture(PNG)
		expect([picture.width, picture.height, picture.pixels.length]).toEqual([1, 1, 3])
	})

	it.each([
		['a short file', () => PNG.subarray(0, 20), 'Invalid capture PNG header'],
		[
			'a wrong signature',
			() => Buffer.concat([Buffer.from([0]), PNG.subarray(1)]),
			'Invalid capture PNG header',
		],
		[
			'an indexed image',
			() => createPngBytes({ width: 1, height: 1, rows: [[0, 0]], color: 3 }),
			'Unsupported capture PNG encoding',
		],
		[
			'sixteen-bit samples',
			() => createPngBytes({ width: 1, height: 1, rows: [[0, 0, 0, 0, 0, 0, 0]], depth: 16 }),
			'Unsupported capture PNG encoding',
		],
		[
			'an interlaced image',
			() => createPngBytes({ width: 1, height: 1, rows: [[0, 1, 2, 3]], interlace: 1 }),
			'Unsupported capture PNG encoding',
		],
		[
			'a zero width',
			() => createPngBytes({ width: 0, height: 1, rows: [[0]] }),
			'Unsupported capture PNG encoding',
		],
		[
			'dimensions beyond a safe length',
			() => createPngBytes({ width: 4294967295, height: 4294967295, rows: [[0]] }),
			'Invalid capture PNG dimensions',
		],
		[
			'an unknown filter',
			() => createPngBytes({ width: 1, height: 1, rows: [[5, 1, 2, 3]] }),
			'Unsupported capture PNG filter',
		],
		[
			'a short stream',
			() => createPngBytes({ width: 1, height: 1, rows: [[0, 1, 2]] }),
			'Capture PNG scanline length differs',
		],
	] as const)('refuses %s', (_name, build, message) => {
		const failure = readThrown(() => decodeCapturePicture(build()))
		expect(failure).toMatchObject({ message, code: 'EVIDENCE' })
	})

	it('refuses a stream that inflates past the declared length or is not deflate data', () => {
		const long = createPngBytes({ width: 1, height: 1, rows: [[0, 1, 2, 3, 4, 5, 6, 7]] })
		expect(readThrown(() => decodeCapturePicture(long))).toMatchObject({
			message: 'Capture PNG stream is corrupt or longer than declared',
			code: 'EVIDENCE',
		})
		const header = createPngBytes({ width: 1, height: 1, rows: [[0, 1, 2, 3]] }).subarray(0, 33)
		const garbage = Buffer.concat([
			header,
			encodeCaptureChunk('IDAT', Buffer.from([1, 2, 3, 4])),
			encodeCaptureChunk('IEND', Buffer.alloc(0)),
		])
		expect(readThrown(() => decodeCapturePicture(garbage))).toMatchObject({
			code: 'EVIDENCE',
			cause: expect.any(Error),
		})
	})
})

describe('inflateCaptureStream', () => {
	it('inflates a stream within its declared length', () => {
		expect([...inflateCaptureStream(deflateSync(Buffer.from([1, 2, 3])), 3)]).toEqual([1, 2, 3])
	})

	it('refuses a longer stream and invalid data under one condition', () => {
		expect(() => inflateCaptureStream(deflateSync(Buffer.alloc(8)), 3)).toThrow(
			'Capture PNG stream is corrupt or longer than declared',
		)
		expect(() => inflateCaptureStream(Buffer.from([1, 2, 3]), 3)).toThrow(
			'Capture PNG stream is corrupt or longer than declared',
		)
	})
})

describe('encodeCapturePicture', () => {
	const picture = {
		width: 3,
		height: 2,
		pixels: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 250, 251, 252, 253, 254, 255, 0, 1, 2]),
	}

	it('round-trips through the decoder, compressed and stored', () => {
		for (const compressed of [true, false]) {
			const decoded = decodeCapturePicture(encodeCapturePicture(picture, compressed))
			expect([decoded.width, decoded.height]).toEqual([3, 2])
			expect([...decoded.pixels]).toEqual([...picture.pixels])
		}
	})

	it('opens with the signature and stores a flat picture larger than it compresses', () => {
		const flat = createSolid(64, 64, 9)
		const compressed = encodeCapturePicture(flat)
		const stored = encodeCapturePicture(flat, false)
		expect(matchesCaptureSignature(compressed)).toBe(true)
		expect(compressed.length).toBeLessThan(stored.length)
	})

	it.each([
		['a zero width', { width: 0, height: 1, pixels: new Uint8Array() }],
		['a negative height', { width: 1, height: -1, pixels: new Uint8Array(3) }],
		['a fractional width', { width: 1.5, height: 1, pixels: new Uint8Array(3) }],
		['a pixel length that differs', { width: 2, height: 1, pixels: new Uint8Array(3) }],
	])('refuses %s', (_name, bad) => {
		expect(readThrown(() => encodeCapturePicture(bad))).toMatchObject({
			message: 'Invalid capture picture dimensions',
			code: 'EVIDENCE',
		})
	})
})

describe('shrinkCapturePicture', () => {
	it('averages each whole-number block per channel and rounds half up', () => {
		const source = {
			width: 2,
			height: 2,
			pixels: Uint8Array.from([0, 0, 0, 10, 20, 30, 10, 20, 30, 10, 20, 30]),
		}
		const shrunk = shrinkCapturePicture(source, 2, 8)
		expect([shrunk.width, shrunk.height]).toEqual([1, 1])
		expect([...shrunk.pixels]).toEqual([8, 15, 23])
	})

	it('clips the displayed height and never reduces below one pixel', () => {
		expect(shrinkCapturePicture(createSolid(2, 8, 5), 1, 3).height).toBe(3)
		const tiny = shrinkCapturePicture(createSolid(1, 1, 5), 4, 8)
		expect([tiny.width, tiny.height, ...tiny.pixels]).toEqual([1, 1, 0, 0, 0])
	})

	it('returns a separately owned picture', () => {
		const source = createSolid(2, 2, 5)
		const shrunk = shrinkCapturePicture(source, 1, 8)
		shrunk.pixels.fill(0)
		expect([...source.pixels]).toEqual(new Array(12).fill(5))
	})
})

describe('composeCapturePictures', () => {
	it('places cells side by side on the gray background with the default gap', () => {
		const sheet = composeCapturePictures([createSolid(2, 1, 10), createSolid(2, 1, 20)], false)
		expect([sheet.width, sheet.height]).toEqual([10, 1])
		const values = Array.from({ length: sheet.width }, (_, x) => sheet.pixels[x * 3])
		expect(values).toEqual([10, 10, 128, 128, 128, 128, 128, 128, 20, 20])
	})

	it('stacks rows and leaves gray where a narrower row ends', () => {
		const sheet = composeCapturePictures([createSolid(2, 1, 10), createSolid(3, 1, 20)], true, 2)
		expect([sheet.width, sheet.height]).toEqual([3, 4])
		const column = (x: number) =>
			Array.from({ length: sheet.height }, (_, y) => sheet.pixels[(y * sheet.width + x) * 3])
		expect(column(0)).toEqual([10, 128, 128, 20])
		expect(column(2)).toEqual([128, 128, 128, 20])
	})

	it('pads a shorter cell with gray below it', () => {
		const sheet = composeCapturePictures([createSolid(1, 2, 10), createSolid(1, 1, 20)], false, 1)
		expect([sheet.width, sheet.height]).toEqual([3, 2])
		expect(
			Array.from({ length: sheet.height }, (_, y) => sheet.pixels[(y * sheet.width + 2) * 3]),
		).toEqual([20, 128])
	})

	it('refuses an empty selection', () => {
		expect(readThrown(() => composeCapturePictures([], false))).toMatchObject({
			message: 'Empty contact-sheet picture selection',
			code: 'USAGE',
		})
	})
})

describe('readCaptureRequestOwner', () => {
	it.each([
		{ name: 'journey-selection-4242.json', expected: 4242 },
		{ name: 'journey-selection-4242.json.tmp', expected: 4242 },
		{ name: 'journey-selection-1.json', expected: 1 },
		{ name: 'journey-selection-0.json', expected: undefined },
		{ name: 'journey-selection-00.json', expected: undefined },
		{ name: 'journey-selection.json', expected: undefined },
		{ name: 'journey-selection-abc.json', expected: undefined },
		{ name: 'journey-selection-4242.json.bak', expected: undefined },
		{ name: 'prefix-journey-selection-4242.json', expected: undefined },
		{ name: 'journey-selection-99999999999999999999.json', expected: undefined },
		{ name: '', expected: undefined },
	])('reads $name as $expected', ({ name, expected }) => {
		expect(readCaptureRequestOwner(name)).toBe(expected)
	})
})

describe('resolveCaptureRelative', () => {
	it('relates an absolute or a workspace-relative path to the root with slashes', () => {
		const root = resolve('workspace')
		expect(resolveCaptureRelative(root, resolve(root, 'tmp', 'units'))).toBe('tmp/units')
		expect(resolveCaptureRelative(root, 'tmp/units')).toBe('tmp/units')
		expect(resolveCaptureRelative(root, root)).toBe('')
		expect(resolveCaptureRelative(root, resolve(root, '..', 'elsewhere'))).toBe('../elsewhere')
	})
})

describe('escapeCapturePattern', () => {
	it('quotes every regular-expression metacharacter so the text matches only itself', () => {
		for (const character of '.*+?^${}()|[]\\') {
			const text = `a${character}b`
			const pattern = new RegExp(`^${escapeCapturePattern(text)}$`, 'u')
			expect(pattern.test(text), `${text} must match itself`).toBe(true)
			expect(pattern.test('axb'), `${text} must not match a stand-in`).toBe(false)
		}
		const punctuated = 'renders [a] (b) + c.d* | e^f$ {g} ? \\h'
		expect(new RegExp(`^${escapeCapturePattern(punctuated)}$`, 'u').test(punctuated)).toBe(true)
		expect(escapeCapturePattern('plain words')).toBe('plain words')
		expect(escapeCapturePattern('')).toBe('')
	})
})

describe('buildCaptureFilter', () => {
	const SELECTORS = ['app', 'app:mail', 'tools', 'tools:search']

	it.each([
		{ command: 'journey', selector: 'app', expected: 'owner:app' },
		{ command: 'journey', selector: 'tools:search', expected: 'owner:tools:search' },
		{ command: 'journey', selector: 'all', expected: '(owner:app || owner:tools)' },
		{ command: 'capture', selector: 'app', expected: 'owner:app && app' },
		{
			command: 'capture',
			selector: 'tools:search',
			expected: 'owner:tools:search && tools:search',
		},
		{
			command: 'capture',
			selector: 'a:b:c',
			expected: 'owner:a:b:c && a:b',
		},
		{
			command: 'capture',
			selector: 'all',
			expected: '(owner:app || owner:tools) && (app || tools)',
		},
	] as const)(
		'selects $selector under $command as $expected',
		({ command, selector, expected }) => {
			expect(buildCaptureFilter(command, selector, SELECTORS)).toBe(expected)
		},
	)
})

describe('resolveCaptureStages', () => {
	it.each([
		{
			title: 'a first variant among others',
			variants: ['wide', 'compact', 'phone'],
			first: 'compact',
			expected: [
				{ name: 'narrow', variants: ['compact'] },
				{ name: 'rest', variants: ['wide', 'phone'] },
			],
		},
		{
			title: 'a first variant that leads',
			variants: ['compact', 'wide'],
			first: 'compact',
			expected: [
				{ name: 'narrow', variants: ['compact'] },
				{ name: 'rest', variants: ['wide'] },
			],
		},
		{
			title: 'only the first variant',
			variants: ['compact'],
			first: 'compact',
			expected: [{ name: 'narrow', variants: ['compact'] }],
		},
		{
			title: 'no first variant selected',
			variants: ['wide', 'phone'],
			first: 'compact',
			expected: [{ name: 'rest', variants: ['wide', 'phone'] }],
		},
		{ title: 'no variant', variants: [], first: 'compact', expected: [] },
	])('plans $title', ({ variants, first, expected }) => {
		expect(resolveCaptureStages(variants, first)).toEqual(expected)
	})
})

describe('buildCaptureArguments', () => {
	const BASE = {
		entry: '/workspace/node_modules/vitest/vitest.mjs',
		config: '/workspace/fixture with spaces.config.ts',
		report: '/workspace/var/requests/runs/a/journey-narrow.json',
		projects: ['bench:compact', 'bench:wide'],
		filter: 'owner:app:mail && app:mail',
		closing: RUNNER_CLOSING,
	}

	it('builds the exact argument array, one element per value, with every project in order', () => {
		expect(buildCaptureArguments(BASE)).toEqual([
			'/workspace/node_modules/vitest/vitest.mjs',
			'run',
			'--config',
			'/workspace/fixture with spaces.config.ts',
			'--configLoader',
			'runner',
			'--no-cache',
			'--bail=1',
			'--reporter=dot',
			'--reporter=json',
			'--outputFile.json=/workspace/var/requests/runs/a/journey-narrow.json',
			'--project',
			'bench:compact',
			'--project',
			'bench:wide',
			'--tags-filter',
			'owner:app:mail && app:mail',
		])
	})

	it('adds one anchored pattern for an exact case and the closing case', () => {
		const exact = 'retains \'mail\' [reader] + "quotes"'
		const args = buildCaptureArguments({ ...BASE, case: exact })
		const pattern = new RegExp(args[args.indexOf('-t') + 1] ?? '', 'u')
		expect(args.slice(-2, -1)).toEqual(['-t'])
		expect(pattern.test(exact)).toBe(true)
		expect(pattern.test(RUNNER_CLOSING)).toBe(true)
		expect(pattern.test(`${exact} too`)).toBe(false)
		expect(pattern.test('retains mail reader quotes')).toBe(false)
		expect(args.filter((argument) => argument === '-t')).toHaveLength(1)
	})

	it('adds no projects and no pattern when none are given', () => {
		const args = buildCaptureArguments({ ...BASE, projects: [] })
		expect(args).not.toContain('--project')
		expect(args).not.toContain('-t')
	})

	it('forwards a mode right after the wrapper, and adds none when absent', () => {
		expect(buildCaptureArguments({ ...BASE, mode: 'vue' }).slice(2, 6)).toEqual([
			'--config',
			BASE.config,
			'--mode',
			'vue',
		])
		expect(buildCaptureArguments(BASE)).not.toContain('--mode')
	})
})

describe('readCaptureArguments', () => {
	const ROOT = resolve('workspace')

	it('reads a selector, every flag, and an absolute wrapper path', () => {
		expect(
			readCaptureArguments(
				[
					'app:mail',
					'--variant',
					'wide',
					'--variant',
					'phone',
					'--state',
					'inbox',
					'--case',
					'a case',
					'--portfolio',
					'gallery',
					'--config',
					'other.config.ts',
				],
				'stale',
				ROOT,
				'default.config.ts',
			),
		).toEqual({
			selector: 'app:mail',
			config: resolve(ROOT, 'other.config.ts'),
			variants: ['wide', 'phone'],
			case: 'a case',
			state: 'inbox',
			portfolio: 'gallery',
		})
	})

	it('falls back to the default wrapper, leaves absent fields out, and accepts an absolute config', () => {
		const bare = readCaptureArguments([], 'journey', ROOT, 'configs/default.config.ts')
		expect(bare).toEqual({ config: resolve(ROOT, 'configs/default.config.ts'), variants: [] })
		expect('selector' in bare).toBe(false)
		const absolute = resolve('elsewhere', 'wrapper.config.ts')
		expect(readCaptureArguments(['app', '--config', absolute], 'journey', ROOT, 'x').config).toBe(
			absolute,
		)
	})

	it('reads a state under capture and a flag in any position', () => {
		expect(readCaptureArguments(['--state', 'inbox', 'app'], 'capture', ROOT, 'x')).toMatchObject({
			selector: 'app',
			state: 'inbox',
		})
	})

	it.each(ARGUMENT_REFUSALS)('refuses $title as a usage failure', ({ command, argv, message }) => {
		const failure = readThrown(() => readCaptureArguments(argv, command, ROOT, 'x'))
		expect(isCaptureError(failure)).toBe(true)
		expect(failure).toMatchObject({ message, code: 'USAGE' })
	})
})

describe('describeCaptureSelectorFault', () => {
	const SELECTORS = ['app', 'app:mail', 'tools']

	it.each(['all', 'app', 'app:mail', 'tools'])('names nothing wrong with %s', (selector) => {
		expect(describeCaptureSelectorFault(selector, SELECTORS)).toBeUndefined()
	})

	it.each([
		{ selector: 'missing', label: 'scope', segment: 'missing' },
		{ selector: 'missing:mail', label: 'scope', segment: 'missing' },
		{ selector: 'app:missing', label: 'owner', segment: 'missing' },
		{ selector: 'app:mail:deep', label: 'owner', segment: 'deep' },
		{ selector: 'tools:search', label: 'owner', segment: 'search' },
	])('names the first unknown segment of $selector', ({ selector, label, segment }) => {
		expect(describeCaptureSelectorFault(selector, SELECTORS)).toBe(
			`Unknown ${label}: ${segment} (selector ${selector}; obsolete owner paths are not aliases)`,
		)
	})
})

describe('readCapturePortfolios', () => {
	it('reads each root in declaration order', () => {
		const roots = [
			{ portfolio: 'frames', directory: 'out/frames', scoped: true },
			{ portfolio: 'extras', directory: 'out/extras', scoped: false },
		]
		expect(readCapturePortfolios(roots, 'portfolios')).toEqual(roots)
		expect(readCapturePortfolios([], 'portfolios')).toEqual([])
	})

	it('drops every field a root does not declare', () => {
		expect(
			readCapturePortfolios(
				[{ portfolio: 'frames', directory: 'out/frames', scoped: true, extra: 1 }],
				'portfolios',
			),
		).toEqual([{ portfolio: 'frames', directory: 'out/frames', scoped: true }])
	})

	it('names the subject in a refusal for a missing list', () => {
		expect(
			readThrown(() => readCapturePortfolios(undefined, 'standalone portfolios')),
		).toMatchObject({
			message: 'The wrapper provides no standalone portfolios',
			code: 'HOST',
		})
	})
})

describe('describeCapturePortfolios', () => {
	it('separates primary roots from standalone ones and keeps every field', () => {
		expect(
			describeCapturePortfolios({
				portfolios: [{ portfolio: 'frames', directory: 'out/frames', scoped: true }],
				standalone: [{ portfolio: 'gallery', directory: 'out/gallery', scoped: false }],
			}),
		).toEqual(['primary frames out/frames true', 'standalone gallery out/gallery false'])
		expect(describeCapturePortfolios({ portfolios: [], standalone: [] })).toEqual([])
	})
})

describe('readCaptureProject', () => {
	it('reads a string name, the tags, and every host declaration', () => {
		expect(readCaptureProject(createProjectFixture())).toEqual({
			name: 'bench:wide',
			variant: 'wide',
			tags: ['owner:app', 'app'],
			variants: ['wide', 'compact'],
			directory: '/workspace/out/frames',
			record: 'out/frames/runs/direct-1/wide.json',
			inputs: ['lib/**'],
			closing: RUNNER_CLOSING,
			first: 'compact',
			portfolios: [{ portfolio: 'frames', directory: 'out/frames', scoped: true }],
			standalone: [],
		})
	})

	it('reads an object name through its label, standalone roots, and a project without tags', () => {
		const project = readCaptureProject(
			createProjectFixture({
				name: { label: 'bench:wide', color: 'green' },
				tags: undefined,
				provide: {
					standalone: [{ portfolio: 'gallery', directory: 'out/gallery', scoped: false }],
				},
			}),
		)
		expect(project).toMatchObject({
			name: 'bench:wide',
			tags: [],
			standalone: [{ portfolio: 'gallery', directory: 'out/gallery', scoped: false }],
		})
	})

	it.each(PROJECT_REFUSALS)('refuses $title', ({ overrides, message, code }) => {
		const failure = readThrown(() => readCaptureProject(createProjectFixture(overrides)))
		expect(isCaptureError(failure)).toBe(true)
		expect(failure).toMatchObject({ code })
		expect(failure instanceof Error ? failure.message : '').toContain(message)
	})

	it.each([undefined, null, 'journey:wide', 42, []])(
		'refuses the non-record configuration %s',
		(value) => {
			expect(readThrown(() => readCaptureProject(value))).toMatchObject({
				message: expect.stringContaining('Unsupported journey project name'),
				code: 'HOST',
			})
		},
	)
})

describe('requireCaptureProjects', () => {
	const FIRST = readCaptureProject(createProjectFixture())
	const SECOND = { ...FIRST, name: 'bench:compact', variant: 'compact' }

	it('returns the first project of an agreeing set', () => {
		expect(requireCaptureProjects([FIRST, SECOND])).toBe(FIRST)
		expect(requireCaptureProjects([FIRST])).toBe(FIRST)
	})

	it.each([
		{ title: 'a different directory', patch: { directory: '/workspace/out/other' } },
		{ title: 'a different closing case', patch: { closing: 'another closing case' } },
		{ title: 'a different first variant', patch: { first: 'wide' } },
		{ title: 'different inputs', patch: { inputs: ['lib/**', 'specs/**'] } },
		{ title: 'different declared variants', patch: { variants: ['wide'] } },
		{
			title: 'different portfolio roots',
			patch: { portfolios: [{ portfolio: 'frames', directory: 'out/frames', scoped: false }] },
		},
		{
			title: 'an added standalone root',
			patch: { standalone: [{ portfolio: 'gallery', directory: 'out/gallery', scoped: false }] },
		},
	])('refuses $title between two projects', ({ patch }) => {
		expect(
			readThrown(() => requireCaptureProjects([FIRST, { ...SECOND, ...patch }])),
		).toMatchObject({
			message: 'Host project integrity declarations disagree',
			code: 'HOST',
		})
	})

	it('treats inputs and variants as populations, not sequences', () => {
		const reordered = { ...SECOND, variants: [...FIRST.variants].toReversed() }
		expect(requireCaptureProjects([FIRST, reordered])).toBe(FIRST)
	})

	it('refuses an empty set, a repeated label, and a repeated variant case-folded', () => {
		expect(readThrown(() => requireCaptureProjects([]))).toMatchObject({
			message: 'No host project declares integrity inputs',
			code: 'HOST',
		})
		expect(
			readThrown(() => requireCaptureProjects([FIRST, { ...SECOND, name: FIRST.name }])),
		).toMatchObject({
			message: 'Duplicate journey projects: bench:wide, bench:wide',
			code: 'EVIDENCE',
		})
		expect(
			readThrown(() => requireCaptureProjects([FIRST, { ...SECOND, variant: 'WIDE' }])),
		).toMatchObject({
			message: 'Duplicate journey project variants: wide, WIDE',
			code: 'EVIDENCE',
		})
	})
})

describe('buildCaptureRequestRefusal', () => {
	it('names the file, carries it as context, and keeps the cause only when there is one', () => {
		const bare = buildCaptureRequestRefusal('/workspace/var/requests/journey-selection-1.json')
		expect(bare).toMatchObject({
			message:
				'Invalid journey selection request: /workspace/var/requests/journey-selection-1.json',
			code: 'HOST',
			context: { file: '/workspace/var/requests/journey-selection-1.json' },
		})
		expect('cause' in bare).toBe(false)
		const cause = new Error('root cause')
		expect(buildCaptureRequestRefusal('f', cause).cause).toBe(cause)
	})
})

describe('readCaptureRequest', () => {
	const PPID = 424242
	const ARGV = ['/workspace/run.ts', 'case with \'single\' and "double" quotes', '--flag']

	it('returns nothing when the parent wrote no request', () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			expect(readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))).toBeUndefined()
		} finally {
			scratch.destroy()
		}
	})

	it('ignores a truncated legacy file and a whole or truncated file under another process id', () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			scratch.write('journey-selection.json', '{"pid":')
			scratch.write(`journey-selection-${String(PPID + 1)}.json`, '{"pid":')
			scratch.write(
				`journey-selection-${String(PPID + 2)}.json`,
				JSON.stringify(createWireRequest(PPID + 2, ARGV)),
			)
			expect(readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))).toBeUndefined()
		} finally {
			scratch.destroy()
		}
	})

	it('returns the validated request with the wrapper path and process id the wrapper supplies', () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			const record = createWireRequest(PPID, ARGV, { case: 'a case', state: 'inbox' })
			scratch.write(`journey-selection-${String(PPID)}.json`, JSON.stringify(record))
			expect(readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))).toEqual({
				version: 1,
				id: 'wire-1',
				stage: 'narrow',
				config: WIRE_CONFIG,
				pid: PPID,
				command: 'capture',
				selector: 'app:mail',
				case: 'a case',
				variants: ['compact'],
				args: ARGV,
				state: 'inbox',
			})
		} finally {
			scratch.destroy()
		}
	})

	it('leaves out an absent case and state', () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			scratch.write(
				`journey-selection-${String(PPID)}.json`,
				JSON.stringify(createWireRequest(PPID, ARGV)),
			)
			const request = readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))
			expect(request).toBeDefined()
			expect(request !== undefined && 'case' in request).toBe(false)
			expect(request !== undefined && 'state' in request).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it.each([
		{ title: 'a scope that owns the selector', selector: 'app' },
		{ title: 'an exact owner path', selector: 'tools:search' },
		{ title: 'the all selector', selector: 'all' },
	])('accepts $title', ({ selector }) => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			scratch.write(
				`journey-selection-${String(PPID)}.json`,
				JSON.stringify(createWireRequest(PPID, ARGV, { selector })),
			)
			expect(readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))?.selector).toBe(
				selector,
			)
		} finally {
			scratch.destroy()
		}
	})

	it('accepts a journey and several variants in any declared order', () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			scratch.write(
				`journey-selection-${String(PPID)}.json`,
				JSON.stringify(
					createWireRequest(PPID, ARGV, { command: 'journey', variants: ['phone', 'wide'] }),
				),
			)
			expect(readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))).toMatchObject({
				command: 'journey',
				variants: ['phone', 'wide'],
			})
		} finally {
			scratch.destroy()
		}
	})

	it.each(WIRE_REFUSALS)('refuses $title and names the field', ({ patch, message }) => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			scratch.write(
				`journey-selection-${String(PPID)}.json`,
				JSON.stringify(createWireRequest(PPID, ARGV, patch)),
			)
			const failure = readThrown(() =>
				readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV)),
			)
			expect(isCaptureError(failure)).toBe(true)
			expect(failure).toMatchObject({ code: 'HOST' })
			expect(failure instanceof Error ? failure.message : '').toContain(message)
		} finally {
			scratch.destroy()
		}
	})

	it.each(WIRE_BYTES)('refuses the parent request bytes %s and names the file', (text) => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			const file = scratch.write(`journey-selection-${String(PPID)}.json`, text)
			expect(
				readThrown(() => readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))),
			).toMatchObject({
				message: `Invalid journey selection request: ${file}`,
				code: 'HOST',
			})
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a wrong process id inside the parent file, names the file, and carries the reason', () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			const name = `journey-selection-${String(PPID)}.json`
			const file = scratch.write(name, JSON.stringify(createWireRequest(PPID + 1000000, ARGV)))
			const failure = readThrown(() =>
				readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV)),
			)
			expect(failure).toMatchObject({
				message: `Invalid journey selection request: ${file}`,
				code: 'HOST',
			})
			expect(failure instanceof Error ? failure.cause : undefined).toMatchObject({
				message: 'Journey selection request does not belong to the parent process',
			})
			// The control: the same request under the right process id is accepted.
			scratch.write(name, JSON.stringify(createWireRequest(PPID, ARGV)))
			expect(readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))?.pid).toBe(PPID)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a parent file the host cannot read as a file and carries the host error', () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			scratch.ensure(`journey-selection-${String(PPID)}.json`)
			const failure = readThrown(() =>
				readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV)),
			)
			expect(failure).toMatchObject({ code: 'HOST' })
			expect(failure instanceof Error ? failure.cause : undefined).toBeInstanceOf(Error)
		} finally {
			scratch.destroy()
		}
	})

	it.each([
		{ title: 'an extra argument', argv: [...ARGV, 'extra'] },
		{ title: 'a missing argument', argv: ARGV.slice(0, -1) },
		{ title: 'a changed argument', argv: [ARGV[0] ?? '', 'another', '--flag'] },
		{ title: 'a reordered pair', argv: [ARGV[1] ?? '', ARGV[0] ?? '', '--flag'] },
		{ title: 'no arguments', argv: [] },
	])('refuses $title between the request and the process arguments', ({ argv }) => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			const file = scratch.write(
				`journey-selection-${String(PPID)}.json`,
				JSON.stringify(createWireRequest(PPID, ARGV)),
			)
			expect(
				readThrown(() => readCaptureRequest(createWireOptions(scratch.path, PPID, argv))),
			).toMatchObject({
				message: `Journey selection request arguments differ from the process arguments: ${file}`,
				code: 'HOST',
			})
			// The control: the recorded arguments themselves are accepted.
			expect(readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))).toBeDefined()
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a request whose arguments are not a list of strings', () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			scratch.write(
				`journey-selection-${String(PPID)}.json`,
				JSON.stringify(createWireRequest(PPID, ARGV, { args: [1, 2, 3] })),
			)
			expect(
				readThrown(() => readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))),
			).toMatchObject({
				message: expect.stringContaining('arguments differ from the process arguments'),
			})
		} finally {
			scratch.destroy()
		}
	})

	it('reads the directory the runner handed this child when the wrapper names none', async () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			scratch.write(
				`journey-selection-${String(PPID)}.json`,
				JSON.stringify(createWireRequest(PPID, ARGV)),
			)
			const options = createWireOptions(scratch.path, PPID, ARGV)
			await withEnvironment({ CAPTURE_REQUESTS: scratch.path }, async () => {
				expect(
					readCaptureRequest({
						ppid: options.ppid,
						argv: options.argv,
						config: options.config,
						owners: options.owners,
						variants: options.variants,
					})?.pid,
				).toBe(PPID)
			})
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a discovery request as no stage request, so a wrapper that skipped its answer fails loudly', () => {
		const scratch = createScratch({ prefix: 'request-' })
		try {
			scratch.write(
				`journey-selection-${String(PPID)}.json`,
				JSON.stringify(createWireRequest(PPID, ARGV, { phase: 'discover' })),
			)
			expect(
				readThrown(() => readCaptureRequest(createWireOptions(scratch.path, PPID, ARGV))),
			).toMatchObject({
				code: 'HOST',
				message: expect.stringContaining('Invalid journey selection request'),
			})
		} finally {
			scratch.destroy()
		}
	})
})

describe('readCaptureReaderArguments', () => {
	const ROOT = resolve('workspace')
	const DEFAULTS = { config: 'configs/default.config.ts', journeys: 'tmp/default-journeys' }

	it('reads a selector and every flag into absolute paths', () => {
		expect(
			readCaptureReaderArguments(
				[
					'app:mail',
					'--variant',
					'wide',
					'--variant',
					'phone',
					'--state',
					'inbox',
					'--case',
					'a case',
					'--portfolio',
					'gallery',
					'--config',
					'other.config.ts',
					'--journeys',
					'journeys',
					'--checks',
					'checks.ts',
					'--output',
					'sheets',
				],
				ROOT,
				DEFAULTS,
			),
		).toEqual({
			reader: {
				root: ROOT,
				config: resolve(ROOT, 'other.config.ts'),
				journeys: resolve(ROOT, 'journeys'),
				checks: resolve(ROOT, 'checks.ts'),
				selection: {
					selector: 'app:mail',
					variants: ['wide', 'phone'],
					state: 'inbox',
					case: 'a case',
					portfolio: 'gallery',
				},
			},
			output: resolve(ROOT, 'sheets'),
		})
	})

	it('falls back to the defaults and leaves every absent field out', () => {
		const command = readCaptureReaderArguments(['app'], ROOT, DEFAULTS)
		expect(command).toEqual({
			reader: {
				root: ROOT,
				config: resolve(ROOT, 'configs/default.config.ts'),
				journeys: resolve(ROOT, 'tmp/default-journeys'),
				selection: { selector: 'app' },
			},
		})
		expect('output' in command).toBe(false)
		expect('checks' in command.reader).toBe(false)
		expect('variants' in command.reader.selection).toBe(false)
	})

	it('keeps an absolute path as given', () => {
		const absolute = resolve('elsewhere', 'wrapper.config.ts')
		expect(
			readCaptureReaderArguments(['app', '--config', absolute], ROOT, DEFAULTS).reader.config,
		).toBe(absolute)
	})

	it.each([
		{ title: 'no arguments', argv: [], message: 'Usage: <selector>' },
		{
			title: 'a flag where the selector belongs',
			argv: ['--variant', 'wide'],
			message: 'Usage: <selector>',
		},
		{
			title: 'an unknown flag',
			argv: ['app', '--mode', 'vue'],
			message: 'Unknown reader option: --mode',
		},
		{
			title: 'a second positional argument',
			argv: ['app', 'tools'],
			message: 'Unknown reader option: tools',
		},
		{
			title: 'a flag with no value',
			argv: ['app', '--variant'],
			message: 'Missing reader option value',
		},
		{
			title: 'a flag followed by a flag',
			argv: ['app', '--variant', '--state', 'x'],
			message: 'Missing reader option value',
		},
		{ title: 'a blank value', argv: ['app', '--case', ''], message: 'Missing reader option value' },
		{
			title: 'a repeated state',
			argv: ['app', '--state', 'a', '--state', 'b'],
			message: 'Repeated reader option: --state',
		},
		{
			title: 'a repeated output',
			argv: ['app', '--output', 'a', '--output', 'b'],
			message: 'Repeated reader option: --output',
		},
		{
			title: 'a repeated checks module',
			argv: ['app', '--checks', 'a.ts', '--checks', 'b.ts'],
			message: 'Repeated reader option: --checks',
		},
	])('refuses $title as a usage failure', ({ argv, message }) => {
		const failure = readThrown(() => readCaptureReaderArguments(argv, ROOT, DEFAULTS))
		expect(isCaptureError(failure)).toBe(true)
		expect(failure).toMatchObject({ code: 'USAGE', message: expect.stringContaining(message) })
	})
})

describe('readCaptureViewport', () => {
	const VARIANTS_LIST = [
		{ name: 'light-390', width: 390, height: 844 },
		{ name: 'dark-1280', width: 1280, height: 800, extra: true },
	]

	it('reads the producing variant geometry and drops what the wrapper added', () => {
		expect(
			readCaptureViewport({ provide: { variant: 'dark-1280', variants: VARIANTS_LIST } }),
		).toEqual({
			name: 'dark-1280',
			width: 1280,
			height: 800,
		})
	})

	it.each([
		{ title: 'a value that is not a record', test: 3, message: 'declares no viewport geometry' },
		{ title: 'no provided values', test: {}, message: 'declares no viewport geometry' },
		{
			title: 'variants that are names only',
			test: { provide: { variant: 'a', variants: [{ name: 'a' }] } },
			message: 'declares no viewport geometry',
		},
		{
			title: 'a zero width',
			test: { provide: { variant: 'a', variants: [{ name: 'a', width: 0, height: 1 }] } },
			message: 'declares no viewport geometry',
		},
		{
			title: 'a variant that is no portable identity',
			test: { provide: { variant: 'a b', variants: [{ name: 'a b', width: 1, height: 1 }] } },
			message: 'declares no viewport geometry',
		},
		{
			title: 'a producing variant outside the list',
			test: { provide: { variant: 'phone', variants: VARIANTS_LIST } },
			message: 'no declared producing viewport',
		},
		{
			title: 'no producing variant',
			test: { provide: { variants: VARIANTS_LIST } },
			message: 'no declared producing viewport',
		},
	])('refuses $title as a host fault', ({ test, message }) => {
		const failure = readThrown(() => readCaptureViewport(test))
		expect(isCaptureError(failure)).toBe(true)
		expect(failure).toMatchObject({ code: 'HOST', message: expect.stringContaining(message) })
	})
})

describe('buildCaptureIntegrityOptions', () => {
	const ROOT = resolve('/workspace')
	const GALLERY = { portfolio: 'gallery', directory: 'out/gallery', scoped: false }

	it('derives the primary directory, its evidence documents, and every authorized root', () => {
		const project = readCaptureProject(createProjectFixture())
		expect(buildCaptureIntegrityOptions(ROOT, project)).toEqual({
			root: ROOT,
			directory: 'out/frames',
			inputs: ['lib/**'],
			registry: 'out/frames/registry.json',
			manifest: 'out/frames/manifest.json',
			lookups: 'out/frames/lookups.json',
			portfolios: project.portfolios,
		})
	})

	it('reads a standalone root alone, with its evidence documents beside its own directory', () => {
		const project = readCaptureProject(createProjectFixture())
		expect(buildCaptureIntegrityOptions(ROOT, project, GALLERY)).toEqual({
			root: ROOT,
			directory: 'out/gallery',
			inputs: ['lib/**'],
			registry: 'out/gallery/registry.json',
			manifest: 'out/gallery/manifest.json',
			lookups: 'out/gallery/lookups.json',
			portfolios: [GALLERY],
		})
	})

	it('refuses a primary directory outside the repository as a host fault', () => {
		const project = readCaptureProject(
			createProjectFixture({ provide: { directory: resolve('/elsewhere/frames') } }),
		)
		const failure = readThrown(() => buildCaptureIntegrityOptions(ROOT, project))
		expect(isCaptureError(failure)).toBe(true)
		expect(failure).toMatchObject({
			code: 'HOST',
			message: 'The wrapper provides a directory outside the repository',
		})
	})
})

describe('collectCaptureFraming', () => {
	const PRODUCERS: readonly CaptureProducer[] = [
		{ project: 'journey:light-390', name: 'light-390', width: 390, height: 844 },
		{ project: 'journey:light-1280', name: 'light-1280', width: 1280, height: 800 },
	]

	function createImage(
		state: string,
		width: number,
		height: number,
		overrides: Partial<CaptureDestination> = {},
	): CaptureImageReading {
		const entry = createDestinationFixture({
			state,
			file: `tmp/captures/states/pages/${state}--${overrides.variant ?? 'light-390'}.png`,
			...overrides,
		})
		return { entry, picture: createSolid(width, height, 0), digest: state, size: 4096 }
	}

	it('names the kinds a group mixes, in the order the frames arrive', () => {
		expect(
			collectCaptureFraming(
				[createImage('long', 390, 2000), createImage('fit', 390, 844)],
				PRODUCERS,
			),
		).toEqual(['Mixed framing: states/pages:mail@390: page, viewport'])
		expect(
			collectCaptureFraming(
				[
					createImage('narrow', 200, 300),
					createImage('fit', 390, 844),
					createImage('long', 390, 2000),
				],
				PRODUCERS,
			),
		).toEqual(['Mixed framing: states/pages:mail@390: crop, viewport, page'])
	})

	it('reports nothing for a group of one kind, or for no frames', () => {
		expect(
			collectCaptureFraming([createImage('a', 390, 844), createImage('b', 390, 844)], PRODUCERS),
		).toEqual([])
		expect(
			collectCaptureFraming([createImage('a', 390, 2000), createImage('b', 390, 3000)], PRODUCERS),
		).toEqual([])
		expect(collectCaptureFraming([], PRODUCERS)).toEqual([])
	})

	it('leaves an auxiliary output variant out of its producer group', () => {
		expect(
			collectCaptureFraming(
				[createImage('fit', 390, 844), createImage('aux', 320, 2000, { variant: 'light-320' })],
				PRODUCERS,
			),
		).toEqual([])
	})

	it('groups by owner, so each owner is judged alone', () => {
		const board = { part: 'board' }
		expect(
			collectCaptureFraming(
				[
					createImage('a', 390, 844),
					createImage('b', 390, 844),
					createImage('c', 390, 2000, board),
					createImage('d', 390, 3000, board),
				],
				PRODUCERS,
			),
		).toEqual([])
		expect(
			collectCaptureFraming(
				[
					createImage('a', 390, 844),
					createImage('c', 390, 2000, board),
					createImage('d', 390, 844, board),
				],
				PRODUCERS,
			),
		).toEqual(['Mixed framing: states/pages:board@390: page, viewport'])
	})

	it('groups by portfolio, so one portfolio mixing sizes does not taint another', () => {
		const focused = { portfolio: 'files-focused' }
		expect(
			collectCaptureFraming(
				[
					createImage('a', 390, 844),
					createImage('b', 390, 2000),
					createImage('c', 390, 844, focused),
					createImage('d', 390, 844, focused),
				],
				PRODUCERS,
			),
		).toEqual(['Mixed framing: states/pages:mail@390: viewport, page'])
	})

	it('groups by declared viewport width, so each width is judged alone', () => {
		const wide = { project: 'journey:light-1280', variant: 'light-1280' }
		expect(
			collectCaptureFraming(
				[
					createImage('a', 390, 844),
					createImage('b', 390, 844),
					createImage('c', 1280, 800, wide),
					createImage('d', 1280, 2400, wide),
				],
				PRODUCERS,
			),
		).toEqual(['Mixed framing: states/pages:mail@1280: viewport, page'])
	})

	it('ignores a frame whose project the wrapper does not declare', () => {
		expect(
			collectCaptureFraming(
				[createImage('a', 390, 844), createImage('b', 390, 2000, { project: 'journey:absent' })],
				PRODUCERS,
			),
		).toEqual([])
	})
})

describe('collectCaptureIdentical', () => {
	function createImage(file: string, digest: string): CaptureImageReading {
		return {
			entry: createDestinationFixture({ file }),
			picture: createSolid(1, 1, 0),
			digest,
			size: 4096,
		}
	}

	it('groups the files that share a digest and leaves unique images out', () => {
		expect(
			collectCaptureIdentical([
				createImage('a.png', 'one'),
				createImage('b.png', 'two'),
				createImage('c.png', 'one'),
				createImage('d.png', 'one'),
			]),
		).toEqual([['a.png', 'c.png', 'd.png']])
	})

	it('reports nothing for unique images or no images', () => {
		expect(
			collectCaptureIdentical([createImage('a.png', 'one'), createImage('b.png', 'two')]),
		).toEqual([])
		expect(collectCaptureIdentical([])).toEqual([])
	})
})

describe('collectCaptureErrors', () => {
	it('finds uncaught, unhandled, and logged error lines and names the artifact', () => {
		expect(
			collectCaptureErrors(
				'tmp/journey/light-390.txt',
				'ok\nUncaught TypeError: x\nan unhandled rejection\nconsole error: bad\nfine',
			),
		).toEqual([
			'tmp/journey/light-390.txt: Uncaught TypeError: x',
			'tmp/journey/light-390.txt: an unhandled rejection',
			'tmp/journey/light-390.txt: console error: bad',
		])
	})

	it('reports nothing for a clean artifact, or for a word that merely ends in error', () => {
		expect(collectCaptureErrors('a.txt', 'ok\nterror: not a log line\nrecord=x')).toEqual([])
		expect(collectCaptureErrors('a.txt', '')).toEqual([])
	})
})

describe('readCaptureRunning', () => {
	it('reads this process as running and an exited process as not', async () => {
		expect(readCaptureRunning(process.pid)).toBe(true)
		expect(readCaptureRunning(await readExitedPid())).toBe(false)
	})

	it('reads a live child as running until it is stopped', async () => {
		const child = await startSleeper()
		try {
			expect(readCaptureRunning(child.pid ?? 0)).toBe(true)
		} finally {
			await stopFixtureChild(child)
		}
		expect(readCaptureRunning(child.pid ?? 0)).toBe(false)
	})
})

const PROJECT = { test: createProjectFixture() }

describe('resolveCaptureWrapperProject', () => {
	it('resolves an inline project, a promise of one, and a factory the way Vitest calls it', async () => {
		const invocations: unknown[] = []
		expect(await resolveCaptureWrapperProject(PROJECT)).toBe(PROJECT)
		expect(await resolveCaptureWrapperProject(Promise.resolve(PROJECT))).toBe(PROJECT)
		expect(
			await resolveCaptureWrapperProject((invocation: unknown) => {
				invocations.push(invocation)
				return PROJECT
			}),
		).toBe(PROJECT)
		expect(invocations).toEqual([{ command: 'serve', mode: 'test' }])
	})

	it('hands back a project declared by path unjudged, for the runner to refuse', async () => {
		expect(await resolveCaptureWrapperProject('./project.config.ts')).toBe('./project.config.ts')
	})
})

describe('readCaptureEntry', () => {
	it('reads the declarations and no viewport for a project that declares no geometry', () => {
		const entry = readCaptureEntry(PROJECT)
		expect(entry.project).toEqual(readCaptureProject(PROJECT.test))
		expect(entry.viewport).toBeUndefined()
		expect('viewport' in entry).toBe(false)
	})

	it('reads the producing variant as the viewport when the project declares geometry', () => {
		const geometry = {
			test: createProjectFixture({
				provide: {
					variants: [
						{ name: 'wide', width: 390, height: 844 },
						{ name: 'compact', width: 128, height: 128 },
					],
				},
			}),
		}
		expect(readCaptureEntry(geometry).viewport).toEqual({ name: 'wide', width: 390, height: 844 })
	})

	it.each(['./project.config.ts', 42, null, undefined])(
		'refuses %j as a project that is not declared inline',
		(value) => {
			expect(readThrown(() => readCaptureEntry(value))).toMatchObject({
				code: 'HOST',
				message: 'The journey wrapper must declare inline projects',
			})
		},
	)

	it.each(PROJECT_REFUSALS)(
		'refuses $title with the reader that owns the declaration',
		(refusal) => {
			const failure = readThrown(() =>
				readCaptureEntry({ test: createProjectFixture(refusal.overrides) }),
			)
			expect(failure).toMatchObject({ code: refusal.code })
			expect(failure instanceof Error ? failure.message : '').toContain(refusal.message)
		},
	)
})

describe('resolveCaptureRequests', () => {
	it('prefers the directory the wrapper names, then the one the runner handed, then the one default', async () => {
		expect(resolveCaptureRequests('named')).toBe(resolve('named'))
		await withEnvironment({ CAPTURE_REQUESTS: resolve('handed') }, async () => {
			expect(resolveCaptureRequests()).toBe(resolve('handed'))
			expect(resolveCaptureRequests('named')).toBe(resolve('named'))
		})
		expect(resolveCaptureRequests()).toBe(resolve(CAPTURE_DEFAULTS.requests))
	})
})

describe('buildCaptureDiscoveryConfig', () => {
	it('builds a fresh configuration that holds no project, no setup file, and nothing to collect', () => {
		const config = buildCaptureDiscoveryConfig()
		expect(config).toEqual({ test: { include: [], passWithNoTests: true, watch: false } })
		expect(buildCaptureDiscoveryConfig()).not.toBe(config)
	})
})

describe('readCaptureDescription', () => {
	const EXPECTED = {
		id: 'run-1',
		nonce: 'nonce-1',
		config: 'wrapper.config.ts',
		parent: 4242,
		pid: 4343,
	}

	function createDescription(patch: Readonly<Record<string, unknown>> = {}): unknown {
		return Object.fromEntries(
			Object.entries({ version: 1, ...EXPECTED, projects: [PROJECT], ...patch }).filter(
				([, value]) => value !== undefined,
			),
		)
	}

	it('accepts a description that echoes this exchange and validates each project', () => {
		const description = readCaptureDescription(createDescription(), EXPECTED)
		expect(description).toMatchObject({ version: 1, ...EXPECTED })
		expect(description.projects).toEqual([readCaptureEntry(PROJECT)])
	})

	it.each([
		{ title: 'another invocation', patch: { id: 'run-2' }, message: 'answers another invocation' },
		{
			title: 'a replayed challenge',
			patch: { nonce: 'old' },
			message: 'answers another challenge',
		},
		{
			title: 'another wrapper',
			patch: { config: 'other.config.ts' },
			message: 'names another wrapper',
		},
		{
			title: 'another parent',
			patch: { parent: 1 },
			message: 'written for another parent process',
		},
		{ title: 'another writer', patch: { pid: 1 }, message: 'not written by the discovery child' },
		{
			title: 'no writer',
			patch: { pid: undefined },
			message: 'not written by the discovery child',
		},
		{
			title: 'another version',
			patch: { version: 2 },
			message: 'The host description is malformed',
		},
		{ title: 'a project list that is no list', patch: { projects: 'x' }, message: 'malformed' },
		{
			title: 'an empty project list',
			patch: { projects: [] },
			message: 'The wrapper declares no projects',
		},
	])('refuses $title', ({ patch, message }) => {
		const failure = readThrown(() => readCaptureDescription(createDescription(patch), EXPECTED))
		expect(failure).toMatchObject({ code: 'HOST' })
		expect(failure instanceof Error ? failure.message : '').toContain(message)
	})

	it.each([undefined, null, [], 'text', 42])('refuses %j as no document', (value) => {
		expect(readThrown(() => readCaptureDescription(value, EXPECTED))).toMatchObject({
			code: 'HOST',
			message: 'The host description is malformed',
		})
	})

	it('refuses an expectation that names no discovery child', () => {
		const failure = readThrown(() =>
			readCaptureDescription(createDescription(), { ...EXPECTED, pid: undefined }),
		)
		expect(failure).toMatchObject({
			code: 'HOST',
			message: 'The host description was not written by the discovery child',
		})
	})

	it('refuses a project the wrapper declares malformed, with the reader that owns it', () => {
		const failure = readThrown(() =>
			readCaptureDescription(createDescription({ projects: [{ test: {} }] }), EXPECTED),
		)
		expect(failure).toMatchObject({ code: 'HOST' })
	})
})

describe('answerCaptureDiscovery', () => {
	const PPID = 4242
	const ARGV = ['/workspace/node_modules/vitest/vitest.mjs', 'list', '--filesOnly']
	const CONFIG = 'configs/wrapper.config.ts'

	function createDiscoveryRequest(patch: Readonly<Record<string, unknown>> = {}): unknown {
		return Object.fromEntries(
			Object.entries({
				version: 1,
				phase: 'discover',
				id: 'run-1',
				nonce: 'nonce-1',
				config: CONFIG,
				pid: PPID,
				args: ARGV,
				...patch,
			}).filter(([, value]) => value !== undefined),
		)
	}

	function describeAnswer(directory: string, projects: readonly unknown[] = [PROJECT]) {
		return answerCaptureDiscovery({ ppid: PPID, argv: ARGV, directory, config: CONFIG, projects })
	}

	async function readRejection(attempt: Promise<unknown>): Promise<unknown> {
		return await attempt.then(
			() => undefined,
			(error: unknown) => error,
		)
	}

	it('writes the projects the wrapper declares, unjudged, to the invocation directory and answers true', async () => {
		const scratch = createScratch({ prefix: 'answer-' })
		try {
			scratch.write(
				`requests/journey-selection-${String(PPID)}.json`,
				JSON.stringify(createDiscoveryRequest()),
			)
			const directory = resolve(scratch.path, 'requests')
			expect(
				await describeAnswer(directory, [PROJECT, Promise.resolve(PROJECT), () => PROJECT]),
			).toBe(true)
			const written: unknown = parseJSON(scratch.read('requests/runs/run-1/description.json') ?? '')
			expect(written).toEqual({
				version: 1,
				id: 'run-1',
				nonce: 'nonce-1',
				config: CONFIG,
				parent: PPID,
				pid: process.pid,
				projects: [PROJECT, PROJECT, PROJECT],
			})
			expect(scratch.names('requests/runs/run-1')).toEqual(['description.json'])
		} finally {
			scratch.destroy()
		}
	})

	it('answers the same request again from the same process, as Vitest may load a configuration twice', async () => {
		const scratch = createScratch({ prefix: 'answer-' })
		try {
			scratch.write(
				`requests/journey-selection-${String(PPID)}.json`,
				JSON.stringify(createDiscoveryRequest()),
			)
			const directory = resolve(scratch.path, 'requests')
			expect(await describeAnswer(directory)).toBe(true)
			expect(await describeAnswer(directory)).toBe(true)
		} finally {
			scratch.destroy()
		}
	})

	it('reads the directory the runner handed this child when the wrapper names none', async () => {
		const scratch = createScratch({ prefix: 'answer-' })
		try {
			scratch.write(
				`requests/journey-selection-${String(PPID)}.json`,
				JSON.stringify(createDiscoveryRequest()),
			)
			await withEnvironment({ CAPTURE_REQUESTS: resolve(scratch.path, 'requests') }, async () => {
				expect(
					await answerCaptureDiscovery({
						ppid: PPID,
						argv: ARGV,
						config: CONFIG,
						projects: [PROJECT],
					}),
				).toBe(true)
			})
			expect(scratch.has('requests/runs/run-1/description.json')).toBe(true)
		} finally {
			scratch.destroy()
		}
	})

	it('answers false, and writes nothing, when there is no request, no record, or only a stage request', async () => {
		const scratch = createScratch({ prefix: 'answer-' })
		try {
			const directory = resolve(scratch.path, 'requests')
			scratch.ensure('requests')
			expect(await describeAnswer(directory)).toBe(false)
			const file = `requests/journey-selection-${String(PPID)}.json`
			scratch.write(file, '{')
			expect(await describeAnswer(directory)).toBe(false)
			scratch.write(file, 'null')
			expect(await describeAnswer(directory)).toBe(false)
			scratch.write(file, JSON.stringify(createWireRequest(PPID, ARGV)))
			expect(await describeAnswer(directory)).toBe(false)
			expect(scratch.has('requests/runs')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it.each([
		{
			title: 'a request from another parent',
			patch: { pid: 1 },
			message: 'Invalid journey selection request',
		},
		{ title: 'different arguments', patch: { args: ['other'] }, message: 'arguments differ' },
		{ title: 'another version', patch: { version: 2 }, message: 'invalid version' },
		{ title: 'an identity with a separator', patch: { id: '../run' }, message: 'invalid identity' },
		{ title: 'a challenge with a space', patch: { nonce: 'a b' }, message: 'invalid identity' },
		{ title: 'no challenge', patch: { nonce: undefined }, message: 'invalid identity' },
		{
			title: 'another wrapper',
			patch: { config: 'configs/other.config.ts' },
			message: 'invalid config',
		},
	])('refuses $title as a host fault and writes no answer', async ({ patch, message }) => {
		const scratch = createScratch({ prefix: 'answer-' })
		try {
			scratch.write(
				`requests/journey-selection-${String(PPID)}.json`,
				JSON.stringify(createDiscoveryRequest(patch)),
			)
			const failure = await readRejection(describeAnswer(resolve(scratch.path, 'requests')))
			expect(failure).toMatchObject({ code: 'HOST' })
			expect(failure instanceof Error ? failure.message : '').toContain(message)
			expect(scratch.has('requests/runs')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses an answer that another process already wrote for the request, and keeps its bytes', async () => {
		const scratch = createScratch({ prefix: 'answer-' })
		try {
			scratch.write(
				`requests/journey-selection-${String(PPID)}.json`,
				JSON.stringify(createDiscoveryRequest()),
			)
			const prior = JSON.stringify({ pid: process.pid + 1, projects: [] })
			scratch.write('requests/runs/run-1/description.json', prior)
			const failure = await readRejection(describeAnswer(resolve(scratch.path, 'requests')))
			expect(failure).toMatchObject({ code: 'HOST' })
			expect(failure instanceof Error ? failure.message : '').toContain('already answered')
			expect(scratch.read('requests/runs/run-1/description.json')).toBe(prior)
		} finally {
			scratch.destroy()
		}
	})
})

describe('readCaptureRegistryArguments', () => {
	const ROOT = resolve('workspace')

	it('reads repeated variants, a mode, and an absolute wrapper path', () => {
		expect(
			readCaptureRegistryArguments(
				[
					'--variant',
					'light-390',
					'--mode',
					'vue',
					'--variant',
					'dark-390',
					'--config',
					'other.config.ts',
				],
				ROOT,
				'default.config.ts',
			),
		).toEqual({
			config: resolve(ROOT, 'other.config.ts'),
			variants: ['light-390', 'dark-390'],
			mode: 'vue',
		})
	})

	it('falls back to the default wrapper, leaves absent fields out, and accepts an absolute config', () => {
		const bare = readCaptureRegistryArguments([], ROOT, 'configs/default.config.ts')
		expect(bare).toEqual({ config: resolve(ROOT, 'configs/default.config.ts'), variants: [] })
		expect('mode' in bare).toBe(false)
		const absolute = resolve('elsewhere', 'wrapper.config.ts')
		expect(readCaptureRegistryArguments(['--config', absolute], ROOT, 'x').config).toBe(absolute)
	})

	it.each(REGISTRY_ARGUMENT_REFUSALS)('refuses $title as a usage failure', ({ argv, reason }) => {
		const failure = readThrown(() => readCaptureRegistryArguments(argv, ROOT, 'x'))
		expect(isCaptureError(failure)).toBe(true)
		expect(failure).toMatchObject({ code: 'USAGE', message: expect.stringContaining(reason) })
	})

	it('names the usage line in a refusal that teaches the command', () => {
		const failure = readThrown(() => readCaptureRegistryArguments(['pages:mail'], ROOT, 'x'))
		expect(failure).toMatchObject({
			message: expect.stringContaining(
				'Usage: capture registry [--variant <name>]... [--mode <name>] [--config <file>]',
			),
		})
	})
})

describe('readCaptureInputs', () => {
	it('expands the patterns to regular files only, sorted, each with its content hash', () => {
		const scratch = createScratch({ prefix: 'inputs-' })
		try {
			scratch.write('src/b.ts', 'second')
			scratch.write('src/a.ts', 'first')
			scratch.write('src/sub/c.ts', 'third')
			scratch.write('docs/x.md', 'outside the patterns')
			const inputs = readCaptureInputs(scratch.path, ['src/**', 'missing/**'])
			expect(Object.keys(inputs)).toEqual(['src/a.ts', 'src/b.ts', 'src/sub/c.ts'])
			expect(inputs).toEqual({
				'src/a.ts': computeCaptureHash('first'),
				'src/b.ts': computeCaptureHash('second'),
				'src/sub/c.ts': computeCaptureHash('third'),
			})
		} finally {
			scratch.destroy()
		}
	})

	it('names a file once when two patterns match it, and reads nothing for an empty population', () => {
		const scratch = createScratch({ prefix: 'inputs-' })
		try {
			scratch.write('src/a.ts', 'first')
			expect(Object.keys(readCaptureInputs(scratch.path, ['src/**', 'src/a.ts']))).toEqual([
				'src/a.ts',
			])
			expect(readCaptureInputs(scratch.path, ['none/**'])).toEqual({})
		} finally {
			scratch.destroy()
		}
	})

	it('digests each file through the supplied handler', () => {
		const scratch = createScratch({ prefix: 'inputs-' })
		try {
			scratch.write('src/a.ts', 'first')
			expect(
				readCaptureInputs(scratch.path, ['src/a.ts'], (bytes) => `${String(bytes.length)}`),
			).toEqual({
				'src/a.ts': '5',
			})
		} finally {
			scratch.destroy()
		}
	})
})

describe('writeCaptureDocument', () => {
	it('writes the document and a newline, creating each missing directory, and leaves no temporary file', () => {
		const scratch = createScratch({ prefix: 'document-' })
		try {
			const path = resolve(scratch.path, 'tmp/captures/states/registry.json')
			writeCaptureDocument(path, { version: 1, receipts: [] })
			expect(readFileSync(path, 'utf8')).toBe('{"version":1,"receipts":[]}\n')
			expect(readdirSync(resolve(scratch.path, 'tmp/captures/states'))).toEqual(['registry.json'])
		} finally {
			scratch.destroy()
		}
	})

	it('replaces an existing document whole', () => {
		const scratch = createScratch({ prefix: 'document-' })
		try {
			const path = resolve(scratch.path, 'registry.json')
			writeCaptureDocument(path, { value: 'a much longer first document' })
			writeCaptureDocument(path, { value: 'short' })
			expect(readFileSync(path, 'utf8')).toBe('{"value":"short"}\n')
			expect(readdirSync(scratch.path)).toEqual(['registry.json'])
		} finally {
			scratch.destroy()
		}
	})

	it('keeps the earlier bytes and leaves no temporary file when the signal has fired', () => {
		const scratch = createScratch({ prefix: 'document-' })
		try {
			const path = resolve(scratch.path, 'registry.json')
			writeCaptureDocument(path, { value: 'earlier' })
			const failure = readThrown(() =>
				writeCaptureDocument(path, { value: 'later' }, AbortSignal.abort(new Error('interrupted'))),
			)
			expect(failure).toMatchObject({ message: 'interrupted' })
			expect(readFileSync(path, 'utf8')).toBe('{"value":"earlier"}\n')
			expect(readdirSync(scratch.path)).toEqual(['registry.json'])
			expect(existsSync(`${path}.tmp`)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
})
