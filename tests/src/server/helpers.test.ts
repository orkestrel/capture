import type { CaptureDestination } from '@src/core'
import type { CaptureImageResult, CaptureProducer } from '@src/server'
import { spawnSync } from 'node:child_process'
import {
	existsSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	truncateSync,
	writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'
import { parseJSON, preview } from '@orkestrel/contract'
import { createScratch, supportsDirectoryLinks } from '@orkestrel/test/server'
import {
	CAPTURE_ERROR_CODES,
	CaptureError,
	isCaptureError,
	isCaptureLookupJournal,
} from '@src/core'
import {
	CAPTURE_DEFAULTS,
	answerCaptureDiscovery,
	buildCaptureArguments,
	buildCaptureChangePlan,
	buildCaptureDigest,
	buildCaptureLookupJournal,
	buildCaptureDiscoveryConfig,
	buildCaptureFilter,
	buildCaptureIntegrityOptions,
	buildCaptureRegistry,
	buildCaptureRequestRefusal,
	collectCaptureErrors,
	scanCaptureFrames,
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
	readCaptureOptions,
	CAPTURE_COMMAND_OPTIONS,
	requireCaptureProjects,
	resolveCaptureRelative,
	resolveCaptureRequests,
	resolveCaptureStages,
	resolveCaptureVariants,
	renderCaptureCommand,
	shrinkCapturePicture,
	unfilterCaptureRow,
	writeCaptureDocument,
	resolveCaptureSheetIdentity,
	splitCapturePages,
	matchesCaptureFile,
	mergeCaptureLookups,
	requireCaptureContained,
	requireCaptureArgument,
	matchesCaptureTransient,
	resolveCapturePhysical,
	readCaptureAncestor,
	resolveCaptureExit,
	describeCaptureFault,
	CAPTURE_PNG_LIMITS,
	readCaptureImage,
	requireCaptureImageSize,
	readCaptureSeparator,
	readCaptureTitles,
	readCaptureVariants,
	describeCaptureMembers,
	describeCaptureOutput,
	requireCaptureSelection,
	CAPTURE_MESSAGE_LIMIT,
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
	createRegistryFixture,
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
	RUNNER_FINAL,
	UNFILTER_CASES,
	WIRE_BYTES,
	WIRE_CONFIG,
	WIRE_REFUSALS,
	createProjectFixture,
	createWireOptions,
	createWireRequest,
	withEnvironment,
	THUMBNAIL_FEATURES,
	createThumbnailPicture,
	averageThumbnailPicture,
} from '../../setupServer.js'

function createSolid(width: number, height: number, value: number) {
	return { width, height, pixels: new Uint8Array(width * height * 3).fill(value) }
}

describe('H1 extracted pure leaves', () => {
	it('H1w derives encoded PNG bytes from one immutable set of decoded bounds', () => {
		expect(CAPTURE_PNG_LIMITS.bytes).toBe(
			Math.ceil((4 * CAPTURE_PNG_LIMITS.pixels + CAPTURE_PNG_LIMITS.side) * 1.2),
		)
		expect(Object.isFrozen(CAPTURE_PNG_LIMITS)).toBe(true)
		expect(CAPTURE_PNG_LIMITS.bytes).toBe(100_820_583)
	})
	it('maps usage to 64 and every other refusal to 1', () => {
		for (const code of CAPTURE_ERROR_CODES)
			expect(resolveCaptureExit(new CaptureError('refused', { code }))).toBe(
				code === 'USAGE' ? 64 : 1,
			)
		expect(resolveCaptureExit(new Error('I/O failed'))).toBe(1)
	})
	it('describes member differences and bounded values directly', () => {
		const fault = describeCaptureFault(
			'root',
			{ unexpected: 'x'.repeat(200) },
			'{ required: string }',
			['required'],
			['required'],
		)
		expect(fault).toContain('root: received object')
		expect(fault).toContain(preview('x'.repeat(200)))
		expect(fault).toContain('missing: ["required"]')
		expect(fault).toContain('unexpected: ["unexpected"]')
	})
	it('groups sheet identity by portfolio, owner and state independently of variant', () => {
		const entry = createDestinationFixture()
		expect(resolveCaptureSheetIdentity(entry)).toBe('["states","pages:mail","inbox"]')
		expect(resolveCaptureSheetIdentity({ ...entry, variant: 'other' })).toBe(
			resolveCaptureSheetIdentity(entry),
		)
		expect(resolveCaptureSheetIdentity({ ...entry, state: 'other' })).not.toBe(
			resolveCaptureSheetIdentity(entry),
		)
	})
	it('partitions consecutive sheet pages without losing their order or members', () => {
		expect(splitCapturePages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
		expect(splitCapturePages([], 2)).toEqual([])
	})
	it('merges lookup identities with incoming entries replacing the previous identity', () => {
		const previous = createLookupFixture()
		const incoming = { ...previous, time: '2026-10-28T00:00:00.000Z' }
		expect(mergeCaptureLookups([previous], [incoming])).toEqual([incoming])
		expect(mergeCaptureLookups([previous], [])).toEqual([previous])
		expect(() => mergeCaptureLookups([previous, previous], [])).toThrow(
			'inherited lookup identities',
		)
		expect(() => mergeCaptureLookups([], [incoming, incoming])).toThrow(
			'incoming lookup identities',
		)
	})
	it('compares every physical snapshot fact and refuses a missing current snapshot', () => {
		const previous = {
			file: 'a.png',
			image: { digest: FIXTURE_HASH, size: 10, modified: 20 },
			changed: 30,
		}
		expect(matchesCaptureFile(previous, previous)).toBe(true)
		expect(matchesCaptureFile(previous, undefined)).toBe(false)
		for (const image of [
			{ ...previous.image, digest: 'different' },
			{ ...previous.image, size: 11 },
			{ ...previous.image, modified: 21 },
		])
			expect(matchesCaptureFile(previous, { ...previous, image })).toBe(false)
		expect(matchesCaptureFile(previous, { ...previous, changed: 31 })).toBe(false)
	})
	it('resolves physical ancestors and refuses an escaped destination before any creation', () => {
		const scratch = createScratch({ prefix: 'capture-physical-' })
		try {
			const path = resolve(scratch.path, 'missing/new')
			expect(readCaptureAncestor(path)).toBe(scratch.path)
			expect(resolveCapturePhysical(path)).toBe(path)
			expect(requireCaptureContained(scratch.path, path)).toBe(path)
			expect(() =>
				requireCaptureContained(scratch.path, resolve(scratch.path, '../outside/new')),
			).toThrow('outside')
		} finally {
			scratch.destroy()
		}
	})
})

describe('H1 agent-facing refusals', () => {
	it('H1r caps every listed population and gives the declared variant candidates', () => {
		const members = Object.fromEntries(
			Array.from({ length: 2000 }, (_, index) => [`key${String(index)}`, 'x'.repeat(200)]),
		)
		const fault = describeCaptureFault(
			'root',
			members,
			'a bounded record',
			Object.keys(members),
			Object.keys(members),
			[],
		)
		expect(fault.length).toBeLessThan(10_000)
		expect(fault).toContain('1984 more')
		const project = readCaptureProject(createProjectFixture())
		const unknown = readThrown(() => resolveCaptureVariants(['absent'], [project]))
		expect(unknown).toMatchObject({
			message: expect.stringContaining(
				`valid candidates: [${project.variants.map(preview).join(',')}]`,
			),
		})
	})
	it('H1r caps member lists directly at, below, and past their display limit', () => {
		expect(describeCaptureMembers([])).toBe('[]')
		expect(describeCaptureMembers(Array.from({ length: 15 }, () => 'a'))).not.toContain('more')
		expect(describeCaptureMembers(Array.from({ length: 16 }, () => 'a'))).not.toContain('more')
		expect(describeCaptureMembers(Array.from({ length: 17 }, () => 'a'))).toContain('1 more')
	})
	it('H1r gives every same-class refusal a key, preview, shape, and candidates', () => {
		const variant = 'bad/name'
		const state = 'bad/state'
		const registry = readThrown(() =>
			readCaptureRegistryArguments(['--variant', variant], process.cwd(), 'vite.config.ts'),
		)
		const selected = readThrown(() =>
			readCaptureArguments(['all', '--state', state], 'capture', process.cwd(), 'vite.config.ts'),
		)
		const project = readThrown(() =>
			readCaptureProject(createProjectFixture({ provide: { variants: [{ name: variant }] } })),
		)
		for (const [error, key, value] of [
			[registry, '--variant[0]', variant],
			[selected, '--state', state],
			[project, 'test.provide.variants[0].name', variant],
		] as const) {
			expect(error).toMatchObject({
				message: expect.stringContaining(`${key}: received ${preview(value)}`),
			})
			expect(error).toMatchObject({ message: expect.stringContaining('expected ') })
			expect(error).toMatchObject({
				message: expect.stringMatching(/valid candidates: \["|valid values come from/u),
			})
		}
	})
	it('names and caps the invalid variant value at its argument key', () => {
		const value = 'bad\n' + 'x'.repeat(200)
		const fault = readThrown(() =>
			readCaptureArguments(['all', '--variant', value], 'journey', process.cwd(), 'vite.config.ts'),
		)
		expect(fault).toMatchObject({ code: 'USAGE' })
		if (!(fault instanceof Error)) throw new Error('Missing refusal')
		expect(fault.message).toContain('--variant[0]')
		expect(fault.message).toContain(preview(value))
		expect(fault.message).toContain('expected')
		expect(fault.message).toContain('valid candidates')
		expect(fault.message).not.toContain(value)
	})
	it('reports every missing and unexpected root member with the indexed key path', () => {
		const fault = readThrown(() => readCapturePortfolios([{ typo: true, extra: 42 }], 'portfolios'))
		if (!(fault instanceof Error)) throw new Error('Missing refusal')
		for (const text of [
			'portfolios[0]',
			'received object',
			'expected',
			'valid candidates',
			'missing: ["portfolio","directory","scoped"]',
			'unexpected: ["typo","extra"]',
		])
			expect(fault.message).toContain(text)
	})
	it('reports all absent bounded host fields in one refusal', () => {
		const fault = readThrown(() =>
			readCaptureProject(
				createProjectFixture({
					provide: { directory: undefined, record: undefined, inputs: undefined },
				}),
			),
		)
		if (!(fault instanceof Error)) throw new Error('Missing refusal')
		for (const text of [
			'test.provide',
			'directory',
			'record',
			'inputs',
			'received',
			'expected',
			'valid candidates',
			'missing:',
			'unexpected:',
		])
			expect(fault.message).toContain(text)
	})
	it('reports every missing and unexpected description field', () => {
		const fault = readThrown(() =>
			readCaptureDescription(
				{ extra: true, typo: 42 },
				{ id: 'a', nonce: 'b', config: 'vite.config.ts', parent: 1, pid: 2 },
			),
		)
		if (!(fault instanceof Error)) throw new Error('Missing refusal')
		for (const text of [
			'description',
			'received object',
			'expected',
			'valid candidates',
			'missing: ["version","id","nonce","config","parent","pid","projects"]',
			'unexpected: ["extra","typo"]',
		])
			expect(fault.message).toContain(text)
	})
	it('caps unknown selectors and names every declared candidate', () => {
		const selector = 'pages:' + 'bad\n'.repeat(100)
		const fault = describeCaptureSelectorFault(selector, ['pages', 'pages:mail']) ?? ''
		expect(fault).toContain('selector')
		expect(fault).toContain(preview(selector))
		expect(fault).toContain('valid candidates: ["all","pages","pages:mail"]')
		expect(fault).not.toContain(selector)
	})
})

function createImportInput(
	overrides: Partial<Parameters<typeof buildCaptureRegistry>[0][number]> = {},
) {
	const report = JSON.stringify(createVitestFixture())
	return {
		receipt: createReceiptFixture({
			report: {
				file: 'tmp/captures/states/runs/run-1/journey-selected.json',
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

describe('readCaptureOptions', () => {
	it('retains repeated variants, standard equals values, and flag positions', () => {
		const parsed = readCaptureOptions(
			['--variant=wide', 'app', '--variant', 'phone', '--case=-draft'],
			CAPTURE_COMMAND_OPTIONS.journey,
			'Usage: capture journey <selector>',
		)
		expect(parsed.values).toEqual({ variant: ['wide', 'phone'], case: '-draft' })
		expect(parsed.positionals).toEqual(['app'])
		expect(
			parsed.tokens.filter((token) => token.kind === 'option').map((token) => token.name),
		).toEqual(['variant', 'variant', 'case'])
	})

	it.each([
		['--plan', '--plan'],
		['--plan=true'],
		['--case=', 'app'],
		['--config', ''],
		['--case', '-draft'],
		['--case=a', '--case', 'b'],
		['--', 'app'],
		['app', '--'],
		['--unknown=value'],
	])('refuses ambiguous or malformed options %j with command usage', (...argv) => {
		const error = readThrown(() =>
			readCaptureOptions(
				argv,
				CAPTURE_COMMAND_OPTIONS.journey,
				'Usage: capture journey <selector>',
			),
		)
		expect(error).toMatchObject({
			code: 'USAGE',
			message: expect.stringContaining('Usage: capture journey <selector>'),
		})
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
	it('H1t bounds physical input at the RGBA encoding allowance before joining compressed chunks', () => {
		const maximum = 4 * CAPTURE_PNG_LIMITS.pixels + CAPTURE_PNG_LIMITS.side
		expect(CAPTURE_PNG_LIMITS.bytes).toBeGreaterThan(maximum)
		expect(CAPTURE_PNG_LIMITS.bytes).toBeLessThan(maximum * 1.25)
		const scratch = createScratch({ prefix: 'capture-h1t-byte-bound-' })
		try {
			const png = createPngBytes({ width: 1, height: 1, rows: [[0, 1, 2, 3]] })
			const padding = encodeCaptureChunk(
				'tEXt',
				Buffer.alloc(CAPTURE_PNG_LIMITS.bytes - png.length - 12),
			)
			writeFileSync(
				resolve(scratch.path, 'boundary.png'),
				Buffer.concat([png.subarray(0, 33), padding, png.subarray(33)]),
			)
			const bytes = readCaptureImage(resolve(scratch.path, 'boundary.png'))
			expect(bytes.length).toBe(CAPTURE_PNG_LIMITS.bytes)
			expect([...decodeCapturePicture(bytes).pixels]).toEqual([1, 2, 3])
			truncateSync(resolve(scratch.path, 'boundary.png'), CAPTURE_PNG_LIMITS.bytes + 1)
			expect(() => readCaptureImage(resolve(scratch.path, 'boundary.png'))).toThrow('file budget')
			const oversized = Buffer.alloc(CAPTURE_PNG_LIMITS.bytes + 1)
			expect(() => decodeCapturePicture(oversized)).toThrow('file budget')
		} finally {
			scratch.destroy()
		}
	})
	it('H1s admits the pixel boundary and refuses a frame one pixel over', () => {
		expect(() =>
			decodeCapturePicture(createPngBytes({ width: 32768, height: 640, rows: [[0, 1, 2, 3]] })),
		).toThrow('scanline length differs')
		expect(() =>
			decodeCapturePicture(createPngBytes({ width: 2781, height: 7541, rows: [[0, 1, 2, 3]] })),
		).toThrow('pixel budget')
	})
	it('H1s refuses the high-ratio full RGBA stream before inflation', () => {
		const width = 11585
		const height = 11585
		const png = Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			encodeCaptureChunk(
				'IHDR',
				Buffer.concat([
					encodeCaptureWord(width),
					encodeCaptureWord(height),
					Buffer.from([8, 6, 0, 0, 0]),
				]),
			),
			encodeCaptureChunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))),
			encodeCaptureChunk('IEND', Buffer.alloc(0)),
		])
		expect(png.length).toBeLessThan(1024 * 1024)
		const started = performance.now()
		expect(() => decodeCapturePicture(png)).toThrow('pixel budget')
		expect(performance.now() - started).toBeLessThan(1000)
	}, 60_000)
	it('H1r admits high-density full-page frames and many data chunks', () => {
		for (const [width, height] of [
			[2880, 6000],
			[1170, 15000],
		] as const) {
			const raw = Buffer.alloc((width * 4 + 1) * height)
			const png = Buffer.concat([
				Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
				encodeCaptureChunk(
					'IHDR',
					Buffer.concat([
						encodeCaptureWord(width),
						encodeCaptureWord(height),
						Buffer.from([8, 6, 0, 0, 0]),
					]),
				),
				encodeCaptureChunk('IDAT', deflateSync(raw)),
				encodeCaptureChunk('IEND', Buffer.alloc(0)),
			])
			expect(decodeCapturePicture(png)).toMatchObject({ width, height })
		}
	}, 60_000)
	it('H1r admits a valid encoder stream split across many nonempty data chunks', () => {
		const png = encodeCapturePicture(createSolid(128, 128, 42), false)
		const payload = png.subarray(41, png.length - 16)
		const chunks = Array.from({ length: Math.ceil(payload.length / 16) }, (_, index) =>
			encodeCaptureChunk('IDAT', payload.subarray(index * 16, (index + 1) * 16)),
		)
		expect(chunks.length).toBeGreaterThan(1024)
		expect(
			decodeCapturePicture(
				Buffer.concat([
					png.subarray(0, 33),
					...chunks,
					encodeCaptureChunk('IEND', Buffer.alloc(0)),
				]),
			),
		).toEqual(createSolid(128, 128, 42))
	})
	it('refuses dimensions above the independent pixel budget before inflation', () => {
		const png = createPngBytes({ width: 32768, height: 641, rows: [[0, 1, 2, 3]] })
		expect(() => decodeCapturePicture(png)).toThrow('pixel budget')
		for (const height of [639, 640])
			expect(() =>
				decodeCapturePicture(createPngBytes({ width: 32768, height, rows: [[0, 1, 2, 3]] })),
			).toThrow('scanline length differs')
		const narrow = createPngBytes({ width: 1, height: 131_073, rows: [[0, 1, 2, 3]] })
		expect(() => decodeCapturePicture(narrow)).toThrow('dimension budget')
		for (const height of [131_071, 131_072])
			expect(() =>
				decodeCapturePicture(createPngBytes({ width: 1, height, rows: [[0, 1, 2, 3]] })),
			).toThrow('scanline length differs')
	})

	it('admits valid PNGs with many ancillary chunks', () => {
		const png = createPngBytes({ width: 1, height: 1, rows: [[0, 1, 2, 3]] })
		const chunks = Array.from({ length: 1024 }, () => encodeCaptureChunk('tEXt', Buffer.alloc(0)))
		expect([
			...decodeCapturePicture(Buffer.concat([png.subarray(0, 33), ...chunks, png.subarray(33)]))
				.pixels,
		]).toEqual([1, 2, 3])
		const bounded = Buffer.concat([png.subarray(0, 33), ...chunks.slice(0, 1021), png.subarray(33)])
		expect([...decodeCapturePicture(bounded).pixels]).toEqual([1, 2, 3])
	})
	it('H1r bounds file bytes before reading a sparse oversized image', () => {
		for (const size of [CAPTURE_PNG_LIMITS.bytes - 1, CAPTURE_PNG_LIMITS.bytes])
			expect(() => requireCaptureImageSize(size)).not.toThrow()
		expect(() => requireCaptureImageSize(CAPTURE_PNG_LIMITS.bytes + 1)).toThrow('file budget')
		const scratch = createScratch({ prefix: 'capture-image-bound-' })
		try {
			scratch.write('huge.png', '')
			truncateSync(resolve(scratch.path, 'huge.png'), CAPTURE_PNG_LIMITS.bytes + 1)
			expect(() => readCaptureImage(resolve(scratch.path, 'huge.png'))).toThrow('file budget')
			scratch.write('small.png', 'small physical image bytes')
			expect(readCaptureImage(resolve(scratch.path, 'small.png')).toString('utf8')).toBe(
				'small physical image bytes',
			)
		} finally {
			scratch.destroy()
		}
	})
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

describe('H1v ownership and path boundaries', () => {
	it('accepts contained supplied paths and refuses outside values as usage', () => {
		const scratch = createScratch({ prefix: 'capture-path-flag-' })
		try {
			expect(
				requireCaptureArgument(scratch.path, resolve(scratch.path, 'checks.ts'), '--checks'),
			).toBe(resolve(scratch.path, 'checks.ts'))
			expect(() =>
				requireCaptureArgument(scratch.path, resolve(scratch.path, '../checks.ts'), '--checks'),
			).toThrow(expect.objectContaining({ code: 'USAGE' }))
		} finally {
			scratch.destroy()
		}
	})
	it('recognizes each transient host error without treating permanent errors as contention', () => {
		for (const platform of ['win32', 'linux'] as const)
			for (const code of ['EPERM', 'EACCES', 'EBUSY', 'EMFILE'])
				expect(matchesCaptureTransient(Object.assign(new Error(code), { code }), platform)).toBe(
					platform === 'win32' || ['EBUSY', 'EMFILE'].includes(code),
				)
		for (const value of [
			new Error('no code'),
			Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }),
			{ code: 'EBUSY' },
			null,
		])
			expect(matchesCaptureTransient(value)).toBe(false)
	})
	it('caps exact-case candidates and states the omitted count', () => {
		const text = describeCaptureFault(
			'--case',
			'unknown case',
			'a declared case',
			Array.from({ length: 200 }, (_, index) => `case-${String(index)}`),
		)
		expect(text).toContain('--case: received "unknown case"')
		expect(text).toContain('case-0')
		expect(text).not.toContain('case-199')
		expect(text).toMatch(/\d+ more/u)
	})
})

describe('shrinkCapturePicture', () => {
	it.each(THUMBNAIL_FEATURES)(
		'H1w computes exact area averages for %s at factors 9 and 17',
		(feature) => {
			for (const factor of [9, 17]) {
				const source = createThumbnailPicture(feature, 643, 645)
				const actual = shrinkCapturePicture(source, factor, 400)
				const reference = averageThumbnailPicture(source, factor, 400)
				expect([actual.width, actual.height]).toEqual([reference.width, reference.height])
				expect(
					Math.max(
						...actual.pixels.map((value, index) =>
							Math.abs(value - (reference.pixels[index] ?? 0)),
						),
					),
				).toBeLessThanOrEqual(1)
				expect(reference.pixels.some((value) => value > 1)).toBe(true)
			}
		},
	)
	it('H1w retains every pixel of a partial edge block with its true divisor', () => {
		const source = createSolid(19, 19, 0)
		source.pixels.fill(255, (18 * 19 + 18) * 3)
		const actual = shrinkCapturePicture(source, 9, 400)
		expect([actual.width, actual.height]).toEqual([3, 3])
		expect([...actual.pixels.slice(-3)]).toEqual([255, 255, 255])
		expect([...actual.pixels.slice(0, -3)]).toEqual(new Array(24).fill(0))
	})
	it('H1w bounds the largest accepted frame thumbnail at 1000 ms', () => {
		const source = createThumbnailPicture('speckle', 5120, 4096)
		const started = performance.now()
		const thumbnail = shrinkCapturePicture(source, 16, 400)
		const elapsed = performance.now() - started
		process.stdout.write(`H1w 5120x4096 exact thumbnail durationMs=${elapsed.toFixed(2)}\n`)
		expect(elapsed).toBeLessThan(1000)
		expect([thumbnail.width, thumbnail.height]).toEqual([320, 256])
	})
	it('H1v preserves a thin bright edge above factor four', () => {
		const source = createSolid(8, 8, 0)
		for (const row of new Array(8).keys()) source.pixels.fill(255, row * 24, row * 24 + 3)
		const [red] = shrinkCapturePicture(source, 8, 8).pixels
		expect(Math.abs((red ?? -1) - 32)).toBeLessThanOrEqual(8)
	})
	it('H1v preserves solid strips shorter than the reduction factor', () => {
		const result = shrinkCapturePicture(createSolid(400, 10, 85), 20, 400)
		expect([result.width, result.height]).toEqual([20, 1])
		expect(new Set(result.pixels)).toEqual(new Set([85]))
	})
	it('H1t bounds thumbnail work for the 131072 by 160 frame', () => {
		const source = createSolid(131072, 160, 85)
		const started = performance.now()
		const thumbnail = shrinkCapturePicture(source, 410, 400)
		expect(performance.now() - started).toBeLessThan(1000)
		expect([thumbnail.width, thumbnail.height]).toEqual([320, 1])
		expect([...thumbnail.pixels]).toEqual(new Array(320 * 3).fill(85))
	})
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
		expect([tiny.width, tiny.height, ...tiny.pixels]).toEqual([1, 1, 5, 5, 5])
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
	it('puts every journey variant in one explicitly named stage without adding the first variant', () => {
		expect(resolveCaptureStages(['wide', 'phone'], 'compact', 'journey')).toEqual([
			{ name: 'selected', variants: ['wide', 'phone'] },
		])
		expect(resolveCaptureStages([], 'compact', 'journey')).toEqual([])
	})
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
		expect(resolveCaptureStages(variants, first, 'capture')).toEqual(expected)
	})
})

describe('resolveCaptureVariants', () => {
	it('H1s validates wrapper selections before evidence is needed', () => {
		const project = readCaptureProject(createProjectFixture())
		expect(() => requireCaptureSelection('app', [project.variant], [project])).not.toThrow()
		expect(() => requireCaptureSelection('all', [], [project])).not.toThrow()
		expect(() => requireCaptureSelection('all', [], [project], [], 'missing-portfolio')).toThrow(
			expect.objectContaining({ code: 'USAGE' }),
		)
		for (const selector of ['', 'missing'])
			expect(() => requireCaptureSelection(selector, [], [project])).toThrow(
				expect.objectContaining({ code: 'USAGE' }),
			)
		expect(() => requireCaptureSelection('app', ['missing'], [project])).toThrow(
			expect.objectContaining({ code: 'USAGE' }),
		)
		expect(() =>
			requireCaptureSelection('app', ['focused-output'], [project], ['focused-output']),
		).not.toThrow()
	})
	it('H1s reads only contained schema-valid output variant candidate hints', () => {
		const scratch = createScratch({ prefix: 'capture-variant-hints-' })
		try {
			const file = resolve(scratch.path, 'registry.json')
			expect(readCaptureVariants(scratch.path, file)).toEqual([])
			scratch.write('registry.json', 'invalid json')
			expect(readCaptureVariants(scratch.path, file)).toEqual([])
			scratch.write(
				'registry.json',
				JSON.stringify(
					createRegistryFixture({
						entries: [createDestinationFixture({ variant: 'focused-output' })],
					}),
				),
			)
			expect(readCaptureVariants(scratch.path, file)).toEqual(['focused-output'])
			expect(readCaptureVariants(resolve(scratch.path, 'child'), file)).toEqual([])
		} finally {
			scratch.destroy()
		}
	})
	it('H1s caps external output at its boundary and counts omitted characters', () => {
		for (const size of [CAPTURE_MESSAGE_LIMIT - 1, CAPTURE_MESSAGE_LIMIT])
			expect(describeCaptureOutput('x'.repeat(size))).toBe('x'.repeat(size))
		expect(describeCaptureOutput('x'.repeat(CAPTURE_MESSAGE_LIMIT + 1))).toBe(
			`${'x'.repeat(CAPTURE_MESSAGE_LIMIT)}… 1 more characters`,
		)
	})
	it('keeps declaration order, narrows explicitly, and refuses unknown or unbacked variants', () => {
		const project = readCaptureProject(
			createProjectFixture({ provide: { variants: [{ name: 'wide' }], first: 'wide' } }),
		)
		expect(resolveCaptureVariants([], [project])).toEqual(project.variants)
		expect(resolveCaptureVariants([project.variant], [project])).toEqual([project.variant])
		expect(() => resolveCaptureVariants(['unknown'], [project])).toThrow('Unknown variant')
		expect(() => resolveCaptureVariants([], [{ ...project, variants: ['absent'] }])).toThrow(
			'no journey project',
		)
		expect(() => resolveCaptureVariants([], [])).toThrow('no journey variants')
	})
})

describe('buildCaptureChangePlan', () => {
	it('gives shared and test patterns precedence, preserves exact path ownership, and reduces at colon boundaries', () => {
		const entries = [
			createDestinationFixture({
				part: 'mail',
				sources: { own: ['src/mail/**'], shared: ['src/shared/**'], tests: ['tests/**'] },
			}),
			createDestinationFixture({
				part: 'mail',
				section: 'inbox',
				sources: { own: ['src/mail/inbox/**'], shared: [], tests: [] },
			}),
			createDestinationFixture({
				part: 'mailbox',
				sources: { own: ['src/mailbox/**', 'src/shared/**', 'tests/**'], shared: [], tests: [] },
			}),
		]
		const plan = buildCaptureChangePlan(
			[
				'src/mail/inbox/view.ts',
				'src/mailbox/view.ts',
				'src/shared/view.ts',
				'tests/view.ts',
				'README.md',
				'README.md',
			],
			entries,
		)
		expect(plan.owners).toEqual(['pages:mail', 'pages:mailbox'])
		expect(plan.changes).toEqual([
			{ path: 'README.md', classification: 'outside', owners: [] },
			{
				path: 'src/mail/inbox/view.ts',
				classification: 'own',
				owners: ['pages:mail', 'pages:mail:inbox'],
			},
			{ path: 'src/mailbox/view.ts', classification: 'own', owners: ['pages:mailbox'] },
			{
				path: 'src/shared/view.ts',
				classification: 'shared',
				owners: ['pages:mail', 'pages:mail:inbox', 'pages:mailbox'],
			},
			{
				path: 'tests/view.ts',
				classification: 'shared',
				owners: ['pages:mail', 'pages:mail:inbox', 'pages:mailbox'],
			},
		])
	})

	it('returns an empty plan when no paths changed', () => {
		expect(buildCaptureChangePlan([], [createDestinationFixture()])).toEqual({
			changes: [],
			owners: [],
		})
	})
})

describe('renderCaptureCommand', () => {
	it('uses equals form for dash-leading values in a printed next command', () => {
		const root = process.cwd()
		const parsed = readCaptureArguments(
			['app', '--case=-draft', '--config=-wrapper.ts'],
			'journey',
			root,
			'default.ts',
		)
		expect(renderCaptureCommand('journey', parsed, 'app', root)).toBe(
			"capture journey app '--case=-draft' '--config=-wrapper.ts'",
		)
	})
	it('prints executable names and preserves every effective selection flag without changed or plan', () => {
		const root = process.cwd()
		expect(
			renderCaptureCommand(
				'capture',
				{
					config: resolve(root, 'configs/journey.ts'),
					variants: ['light-390', 'dark-390'],
					changed: 'HEAD',
					plan: true,
					case: 'mail shows inbox',
					state: 'inbox',
				},
				'pages:mail',
				root,
			),
		).toBe(
			"capture frames pages:mail --variant light-390 --variant dark-390 --case 'mail shows inbox' --state inbox --config configs/journey.ts",
		)
	})

	it('quotes a shell-sensitive case and wrapper path in the host shell syntax', () => {
		const root = process.cwd()
		const command = renderCaptureCommand(
			'journey',
			{
				config: resolve(root, 'wrapper with spaces.ts'),
				variants: [],
				case: "mail's $value `text`",
			},
			'pages:mail',
			root,
		)
		expect(command).toBe(
			process.platform === 'win32'
				? "capture journey pages:mail --case 'mail''s $value `text`' --config 'wrapper with spaces.ts'"
				: "capture journey pages:mail --case 'mail'\\''s $value `text`' --config 'wrapper with spaces.ts'",
		)
	})
})

describe('readCaptureArguments changed selection', () => {
	it('accepts equals-form changed selection while retaining plan semantics', () => {
		expect(
			readCaptureArguments(
				['--changed=HEAD', '--plan', '--variant=wide'],
				'journey',
				process.cwd(),
				'journey.ts',
			),
		).toEqual({ config: resolve('journey.ts'), changed: 'HEAD', plan: true, variants: ['wide'] })
	})
	it('combines one changed ref with plan and repeated distinct variants', () => {
		expect(
			readCaptureArguments(
				['--changed', 'HEAD', '--plan', '--variant', 'light-390', '--variant', 'dark-390'],
				'journey',
				process.cwd(),
				'journey.ts',
			),
		).toEqual({
			config: resolve('journey.ts'),
			changed: 'HEAD',
			plan: true,
			variants: ['light-390', 'dark-390'],
		})
	})

	it('refuses malformed, repeated, misplaced, or missing changed and plan flags', () => {
		for (const argv of [
			['--changed'],
			['--changed='],
			['--changed', 'HEAD', '--changed', 'HEAD'],
			['--changed', 'HEAD', '--plan', '--plan'],
			['--plan'],
			['--plan=true'],
			['pages:mail', '--changed', 'HEAD'],
			['--changed', 'HEAD', 'pages:mail'],
			['--changed', 'HEAD', '--unknown'],
			['--changed', '--plan'],
		]) {
			const error = readThrown(() =>
				readCaptureArguments(argv, 'journey', process.cwd(), 'journey.ts'),
			)
			expect(isCaptureError(error) ? error.code : undefined).toBe('USAGE')
		}
		expect(() =>
			readCaptureArguments(['--changed', 'HEAD'], 'stale', process.cwd(), 'journey.ts'),
		).toThrow("Unknown option '--changed'")
	})
})

describe('buildCaptureArguments', () => {
	const BASE = {
		entry: resolve('node_modules/vitest/vitest.mjs'),
		config: '/workspace/fixture with spaces.config.ts',
		report: '/workspace/var/requests/runs/a/journey-selected.json',
		projects: ['bench:compact', 'bench:wide'],
		filter: 'owner:app:mail && app:mail',
		final: RUNNER_FINAL,
	}

	it('builds the exact argument array, one element per value, with every project in order', () => {
		expect(buildCaptureArguments(BASE)).toEqual([
			resolve('node_modules/vitest/vitest.mjs'),
			'run',
			'--config',
			'/workspace/fixture with spaces.config.ts',
			'--configLoader',
			'runner',
			'--no-cache',
			'--bail=1',
			'--reporter=dot',
			'--reporter=json',
			'--outputFile.json=/workspace/var/requests/runs/a/journey-selected.json',
			'--project',
			'bench:compact',
			'--project',
			'bench:wide',
			'--tags-filter',
			'owner:app:mail && app:mail',
		])
	})

	it('adds one anchored pattern for an exact case and the final case', () => {
		const exact = 'retains \'mail\' [reader] + "quotes"'
		const args = buildCaptureArguments({ ...BASE, case: exact })
		const pattern = new RegExp(args[args.indexOf('-t') + 1] ?? '', 'u')
		expect(args.slice(-2, -1)).toEqual(['-t'])
		expect(pattern.test(exact)).toBe(true)
		expect(pattern.test(RUNNER_FINAL)).toBe(true)
		expect(pattern.test(`${exact} too`)).toBe(false)
		expect(pattern.test('retains mail reader quotes')).toBe(false)
		expect(args.filter((argument) => argument === '-t')).toHaveLength(1)
	})
	it('H1r uses only the installed major separator without broadening literal spaces', () => {
		const args = buildCaptureArguments({
			...BASE,
			entry: resolve('node_modules/vitest/vitest.mjs'),
			case: 'outer inner',
		})
		const pattern = new RegExp(args[args.indexOf('-t') + 1] ?? '', 'u')
		expect(pattern.test('outer inner')).toBe(true)
		expect(pattern.test('outer > inner')).toBe(false)
	})
	it('H1s wraps an unreadable Vitest manifest as a HOST refusal', () => {
		const scratch = createScratch({ prefix: 'capture-manifest-refusal-' })
		try {
			expect(() => readCaptureSeparator(resolve(scratch.path, 'vitest.mjs'))).toThrow(
				expect.objectContaining({ code: 'HOST' }),
			)
			scratch.write('package.json', '{')
			expect(() => readCaptureSeparator(resolve(scratch.path, 'vitest.mjs'))).toThrow(
				expect.objectContaining({ code: 'HOST' }),
			)
		} finally {
			scratch.destroy()
		}
	})
	it('H1s names the source of candidates before discovery instead of placeholders', () => {
		for (const run of [
			() =>
				readCaptureArguments(
					['all', '--variant', 'bad/name'],
					'journey',
					'/repo',
					'vite.config.ts',
				),
			() =>
				readCaptureArguments(['all', '--state', 'bad/name'], 'capture', '/repo', 'vite.config.ts'),
			() => readCaptureRegistryArguments(['--variant', 'bad/name'], '/repo', 'vite.config.ts'),
		]) {
			const error = readThrown(run)
			expect(error instanceof Error ? error.message : '').not.toMatch(
				/<wrapper-declared|<case-declared/u,
			)
			expect(error instanceof Error ? error.message : '').toContain('valid values come from')
		}
	})
	it('H1r reads each supported installed major and refuses an unsupported manifest', () => {
		const scratch = createScratch({ prefix: 'capture-vitest-major-' })
		try {
			const entry = resolve(scratch.path, 'node_modules/vitest/vitest.mjs')
			scratch.write('node_modules/vitest/package.json', JSON.stringify({ version: '4.1.12' }))
			expect(readCaptureSeparator(entry)).toBe(' ')
			scratch.write('node_modules/vitest/package.json', JSON.stringify({ version: '5.0.5' }))
			expect(readCaptureSeparator(entry)).toBe(' > ')
			const args = buildCaptureArguments({
				...BASE,
				entry,
				case: 'outer suite inner case',
				titles: { 'outer suite inner case': ['outer suite', 'inner case'] },
			})
			const pattern = new RegExp(args[args.indexOf('-t') + 1] ?? '', 'u')
			expect(pattern.test('outer suite > inner case')).toBe(true)
			expect(pattern.test('outer suite inner case')).toBe(false)
			scratch.write('node_modules/vitest/package.json', JSON.stringify({ version: '6.0.0' }))
			expect(() => readCaptureSeparator(entry)).toThrow('vitest.version: received "6.0.0"')
		} finally {
			scratch.destroy()
		}
	})
	it.each(['4.1.12', '5.0.5'])(
		'H1v reads Vitest %s space-joined JSON reporter titles and refuses altered bytes',
		(version) => {
			const scratch = createScratch({ prefix: `capture-case-titles-${version}-` })
			try {
				const report = JSON.stringify({
					numTotalTests: 1,
					success: true,
					testResults: [
						{
							name: '/workspace/tests/journey.test.ts',
							assertionResults: [
								{
									fullName: 'tests/journey.test.ts outer suite inner case',
									ancestorTitles: ['tests/journey.test.ts', 'outer suite'],
									title: 'inner case',
									status: 'passed',
									duration: 1,
									failureMessages: [],
								},
							],
						},
					],
				})
				scratch.write('report.json', report)
				const receipt = createReceiptFixture({
					report: { file: 'report.json', digest: computeCaptureHash(report) },
				})
				scratch.write(
					'registry.json',
					JSON.stringify(createRegistryFixture({ receipts: [receipt] })),
				)
				expect(readCaptureTitles(scratch.path, resolve(scratch.path, 'registry.json'))).toEqual({
					'tests/journey.test.ts outer suite inner case': [
						'tests/journey.test.ts',
						'outer suite',
						'inner case',
					],
				})
				scratch.write('report.json', `${report}\n`)
				expect(() =>
					readCaptureTitles(scratch.path, resolve(scratch.path, 'registry.json')),
				).toThrow('digest differs')
			} finally {
				scratch.destroy()
			}
		},
	)

	it('selects an exact nested case and final case through a real nested Vitest run', () => {
		const scratch = createScratch({ prefix: 'capture-selection-' })
		try {
			const entry = resolve(process.env.CAPTURE_VITEST_ENTRY ?? 'node_modules/vitest/vitest.mjs')
			const testModule = pathToFileURL(resolve(dirname(entry), 'dist/index.js')).href
			const decoy = ['outer suite', 'inner [group]', 'exact (case)'].join(
				readCaptureSeparator(entry) === ' ' ? ' > ' : ' ',
			)
			scratch.write(
				'nested.test.ts',
				`import { describe, it, expect } from ${JSON.stringify(testModule)}\nit(${JSON.stringify(decoy)}, () => { throw new Error('selected the other major separator') }); describe('outer suite', () => { describe('inner [group]', () => { it('exact (case)', () => expect(true).toBe(true)); it('exact (case) extra', () => { throw new Error('selected an inexact case') }); it('final case', () => expect(true).toBe(true)); it('other', () => { throw new Error('broadened selection') }) }) })\n`,
			)
			scratch.write(
				'vite.config.ts',
				`export default { root: ${JSON.stringify(scratch.path)}, test: { include: ['nested.test.ts'] } }\n`,
			)
			const args = buildCaptureArguments({
				...BASE,
				entry,
				case: 'outer suite inner [group] exact (case)',
				final: 'outer suite inner [group] final case',
				titles: {
					'outer suite inner [group] exact (case)': [
						'outer suite',
						'inner [group]',
						'exact (case)',
					],
					'outer suite inner [group] final case': ['outer suite', 'inner [group]', 'final case'],
				},
			})
			const pattern = args[args.indexOf('-t') + 1]
			if (pattern === undefined) throw new Error('No exact-case pattern')
			const run = spawnSync(
				process.execPath,
				[
					entry,
					'run',
					'--config',
					resolve(scratch.path, 'vite.config.ts'),
					'--configLoader',
					'runner',
					'-t',
					pattern,
					'--reporter=json',
					`--outputFile.json=${resolve(scratch.path, 'report.json')}`,
				],
				{ encoding: 'utf8', windowsHide: true, timeout: 30_000 },
			)
			expect({ code: run.status, stderr: run.stderr }).toEqual({ code: 0, stderr: '' })
			expect(parseJSON(scratch.read('report.json') ?? '')).toMatchObject({
				numPassedTests: 2,
				numPendingTests: 3,
			})
		} finally {
			scratch.destroy()
		}
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
		expect(failure).toMatchObject({ code: 'USAGE', message: expect.stringContaining(message) })
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
		const fault = describeCaptureSelectorFault(selector, SELECTORS)
		expect(fault).toContain(`Unknown ${label}: ${JSON.stringify(segment)}`)
		expect(fault).toContain(`selector: received ${JSON.stringify(selector)}`)
		expect(fault).toContain('obsolete owner paths are not aliases')
		expect(fault).toContain('valid candidates: ["all","app","app:mail","tools"]')
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

	it('refuses every field a root does not declare', () => {
		expect(() =>
			readCapturePortfolios(
				[{ portfolio: 'frames', directory: 'out/frames', scoped: true, extra: 1 }],
				'portfolios',
			),
		).toThrow('unexpected: ["extra"]')
	})

	it('names the subject in a refusal for a missing list', () => {
		expect(
			readThrown(() => readCapturePortfolios(undefined, 'standalone portfolios')),
		).toMatchObject({
			message: expect.stringContaining('The wrapper provides no standalone portfolios'),
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
	it('preserves absent, empty, and declared uniform scopes', () => {
		expect(readCaptureProject(createProjectFixture()).uniform).toBeUndefined()
		expect(readCaptureProject(createProjectFixture({ provide: { uniform: [] } })).uniform).toEqual(
			[],
		)
		expect(
			readCaptureProject(
				createProjectFixture({ provide: { uniform: ['pages', 'examples:board'] } }),
			).uniform,
		).toEqual(['pages', 'examples:board'])
	})

	it('reads a string name, the tags, and every host declaration', () => {
		expect(readCaptureProject(createProjectFixture())).toEqual({
			name: 'bench:wide',
			variant: 'wide',
			tags: ['owner:app', 'app'],
			variants: ['wide', 'compact'],
			directory: '/workspace/out/frames',
			record: 'out/frames/runs/direct-1/wide.json',
			inputs: ['lib/**'],
			final: RUNNER_FINAL,
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
		{ title: 'a different final case', patch: { final: 'another final case' } },
		{ title: 'a different first variant', patch: { first: 'wide' } },
		{ title: 'an empty uniform declaration instead of absence', patch: { uniform: [] } },
		{ title: 'an added uniform declaration', patch: { uniform: ['pages'] } },
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

	it('compares uniform scopes as populations and refuses different or omitted scopes', () => {
		const first = { ...FIRST, uniform: ['pages', 'examples'] }
		expect(requireCaptureProjects([first, { ...SECOND, uniform: ['examples', 'pages'] }])).toBe(
			first,
		)
		expect(
			requireCaptureProjects([
				{ ...FIRST, uniform: [] },
				{ ...SECOND, uniform: [] },
			]),
		).toEqual({
			...FIRST,
			uniform: [],
		})
		expect(
			readThrown(() => requireCaptureProjects([first, { ...SECOND, uniform: ['pages'] }])),
		).toMatchObject({ code: 'HOST', message: 'Host project integrity declarations disagree' })
		expect(readThrown(() => requireCaptureProjects([first, SECOND]))).toMatchObject({
			code: 'HOST',
			message: 'Host project integrity declarations disagree',
		})
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
	it('accepts equals values after the leading selector and retains each selected variant', () => {
		const command = readCaptureReaderArguments(
			['app', '--variant=wide', '--variant=phone', '--case=-draft', '--output=sheets'],
			ROOT,
			DEFAULTS,
		)
		expect(command.reader.selection).toEqual({
			selector: 'app',
			variants: ['wide', 'phone'],
			case: '-draft',
		})
		expect(command.output).toBe(resolve(ROOT, 'sheets'))
	})

	it.each([
		['--variant=wide', 'app'],
		['app', '--'],
		['app', '--output='],
		['app', '--plan'],
		['app', '--output=a', '--output=b'],
	])('keeps reader positional and option refusals for %j', (...argv) => {
		expect(readThrown(() => readCaptureReaderArguments(argv, ROOT, DEFAULTS))).toMatchObject({
			code: 'USAGE',
		})
	})

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
		{ title: 'no arguments', argv: [], message: 'Usage: capture sheets <selector>' },
		{
			title: 'a flag where the selector belongs',
			argv: ['--variant', 'wide'],
			message: 'Usage: capture sheets <selector>',
		},
		{
			title: 'an unknown flag',
			argv: ['app', '--mode', 'vue'],
			message: "Unknown option '--mode'",
		},
		{
			title: 'a second positional argument',
			argv: ['app', 'tools'],
			message: 'Usage: capture sheets <selector>',
		},
		{
			title: 'a flag with no value',
			argv: ['app', '--variant'],
			message: "Option '--variant <value>' argument missing",
		},
		{
			title: 'a flag followed by a flag',
			argv: ['app', '--variant', '--state', 'x'],
			message: "Option '--variant' argument is ambiguous",
		},
		{ title: 'a blank value', argv: ['app', '--case', ''], message: 'Missing value: --case' },
		{
			title: 'a repeated state',
			argv: ['app', '--state', 'a', '--state', 'b'],
			message: 'Repeated option: --state',
		},
		{
			title: 'a repeated output',
			argv: ['app', '--output', 'a', '--output', 'b'],
			message: 'Repeated option: --output',
		},
		{
			title: 'a repeated checks module',
			argv: ['app', '--checks', 'a.ts', '--checks', 'b.ts'],
			message: 'Repeated option: --checks',
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

describe('scanCaptureFrames', () => {
	const PRODUCERS: readonly CaptureProducer[] = [
		{ project: 'journey:light-390', name: 'light-390', width: 390, height: 844 },
		{ project: 'journey:light-1280', name: 'light-1280', width: 1280, height: 800 },
	]

	function createImage(
		state: string,
		width: number,
		height: number,
		overrides: Partial<CaptureDestination> = {},
	): CaptureImageResult {
		const entry = createDestinationFixture({
			state,
			file: `tmp/captures/states/pages/${state}--${overrides.variant ?? 'light-390'}.png`,
			...overrides,
		})
		return {
			entry,
			picture: { width, height },
			thumbnail: createSolid(width, height, 0),
			digest: state,
			size: 4096,
		}
	}

	it('names the kinds a group mixes, in the order the frames arrive', () => {
		expect(
			scanCaptureFrames([createImage('long', 390, 2000), createImage('fit', 390, 844)], PRODUCERS),
		).toEqual(['Mixed framing: states/pages:mail@390: page, viewport'])
		expect(
			scanCaptureFrames(
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
			scanCaptureFrames([createImage('a', 390, 844), createImage('b', 390, 844)], PRODUCERS),
		).toEqual([])
		expect(
			scanCaptureFrames([createImage('a', 390, 2000), createImage('b', 390, 3000)], PRODUCERS),
		).toEqual([])
		expect(scanCaptureFrames([], PRODUCERS)).toEqual([])
	})

	it('leaves an auxiliary output variant out of its producer group', () => {
		expect(
			scanCaptureFrames(
				[createImage('fit', 390, 844), createImage('aux', 320, 2000, { variant: 'light-320' })],
				PRODUCERS,
			),
		).toEqual([])
	})

	it('groups by owner, so each owner is judged alone', () => {
		const board = { part: 'board' }
		expect(
			scanCaptureFrames(
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
			scanCaptureFrames(
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
			scanCaptureFrames(
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
			scanCaptureFrames(
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
			scanCaptureFrames(
				[createImage('a', 390, 844), createImage('b', 390, 2000, { project: 'journey:absent' })],
				PRODUCERS,
			),
		).toEqual([])
	})
})

describe('collectCaptureIdentical', () => {
	function createImage(file: string, digest: string): CaptureImageResult {
		return {
			entry: createDestinationFixture({ file }),
			picture: { width: 1, height: 1 },
			thumbnail: createSolid(1, 1, 0),
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

	it('carries uniform scopes through the discovery description', () => {
		const description = readCaptureDescription(
			createDescription({
				projects: [{ test: createProjectFixture({ provide: { uniform: ['pages', 'examples'] } }) }],
			}),
			EXPECTED,
		)
		expect(description.projects.at(0)?.project.uniform).toEqual(['pages', 'examples'])
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
			message: 'missing: ["pid"]',
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
			message: expect.stringContaining('The host description is malformed'),
		})
	})

	it('refuses an expectation that names no discovery child', () => {
		const failure = readThrown(() =>
			readCaptureDescription(createDescription(), { ...EXPECTED, pid: undefined }),
		)
		expect(failure).toMatchObject({
			code: 'HOST',
			message: expect.stringContaining(
				'The host description was not written by the discovery child',
			),
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
	it('accepts equals values and keeps a dash-leading mode in the argument vector', () => {
		expect(
			readCaptureRegistryArguments(
				['--mode=-custom', '--variant=wide', '--variant=phone', '--config=alternate.ts'],
				process.cwd(),
				'default.ts',
			),
		).toEqual({ mode: '-custom', variants: ['wide', 'phone'], config: resolve('alternate.ts') })
	})

	it.each([['--mode='], ['--mode=a', '--mode=b'], ['--'], ['--plan'], ['--variant=wide', 'app']])(
		'retains registry refusals for %j',
		(...argv) => {
			expect(
				readThrown(() => readCaptureRegistryArguments(argv, process.cwd(), 'default.ts')),
			).toMatchObject({ code: 'USAGE' })
		},
	)
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
	it.runIf(supportsDirectoryLinks())('refuses an input read through an outside junction', () => {
		const scratch = createScratch({ prefix: 'capture-inputs-' })
		const outside = createScratch({ prefix: 'capture-inputs-outside-' })
		try {
			outside.write('source.ts', 'outside')
			symlinkSync(outside.path, resolve(scratch.path, 'src'), 'junction')
			expect(() => readCaptureInputs(scratch.path, ['src/source.ts'])).toThrow('outside')
		} finally {
			scratch.destroy()
			outside.destroy()
		}
	})
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
	it('preserves prior bytes and cleans temporary siblings after serialization or rename fails', () => {
		const scratch = createScratch({ prefix: 'document-failure-' })
		try {
			const path = resolve(scratch.path, 'registry.json')
			writeCaptureDocument(path, { value: 'earlier' })
			const circular: Record<string, unknown> = {}
			circular.self = circular
			expect(() => writeCaptureDocument(path, circular)).toThrow(TypeError)
			expect(scratch.read('registry.json')).toBe('{"value":"earlier"}\n')
			scratch.ensure('directory')
			scratch.write('directory/sentinel.txt', 'kept')
			expect(() =>
				writeCaptureDocument(resolve(scratch.path, 'directory'), { value: 'later' }),
			).toThrow(/EISDIR|EPERM|EEXIST|ENOTEMPTY|EACCES/u)
			expect(scratch.read('directory/sentinel.txt')).toBe('kept')
			expect(scratch.names().toSorted()).toEqual(['directory', 'registry.json'])
		} finally {
			scratch.destroy()
		}
	})
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
