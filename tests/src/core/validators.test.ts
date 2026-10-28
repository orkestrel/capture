import {
	isCaptureArtifact,
	isCaptureBox,
	isCaptureCollection,
	isCaptureDeclaration,
	isCaptureDestination,
	isCaptureDigest,
	isCaptureEntry,
	isCaptureGeometry,
	isCaptureHash,
	isCaptureHashes,
	isCaptureIdentity,
	isCaptureLookup,
	isCaptureLookupJournal,
	isCaptureManifest,
	isCapturePath,
	isCapturePattern,
	isCaptureReceipt,
	isCaptureRegistry,
	isCaptureRequest,
	isCaptureRun,
	isCaptureSegment,
	isCaptureSelector,
	isCaptureSources,
	isCaptureStamp,
	isCaptureStoredManifest,
} from '@src/core'
import { createHostileValues } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	FIXTURE_HASH,
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
} from '../../setup.js'

const COLLECTION = {
	project: 'journey:light-390',
	registry: FIXTURE_HASH,
	variant: 'light-390',
	inputs: { patterns: [], files: {}, digest: FIXTURE_HASH },
	run: { file: 'tmp/runs/a.json', digest: FIXTURE_HASH },
	report: { file: 'tmp/runs/a-report.json', digest: FIXTURE_HASH },
}

// Each row pairs a guard with a value it accepts and the edits that must make it refuse. A row
// whose edit still passes means the guard stopped reading that field.
const ROWS: ReadonlyArray<
	readonly [string, (value: unknown) => boolean, unknown, ReadonlyArray<readonly [string, unknown]>]
> = [
	[
		'isCaptureSources',
		isCaptureSources,
		createSourcesFixture(),
		[
			['a traversing own pattern', createSourcesFixture({ own: ['../x'] })],
			['a backslash shared pattern', createSourcesFixture({ shared: ['src\\core'] })],
			['a non-array tests member', { ...createSourcesFixture(), tests: 'tests/setup.ts' }],
			['a missing member', { own: [], shared: [] }],
		],
	],
	[
		'isCaptureIdentity',
		isCaptureIdentity,
		createIdentityFixture(),
		[
			['a zero pid', createIdentityFixture({ pid: 0 })],
			['a fractional pid', createIdentityFixture({ pid: 1.5 })],
			['a spaced stage', createIdentityFixture({ stage: 'rest stage' })],
			['an escaping config', createIdentityFixture({ config: '../vite.config.ts' })],
			['a reserved device id', createIdentityFixture({ id: 'nul/x' })],
		],
	],
	[
		'isCaptureRequest',
		isCaptureRequest,
		createRequestFixture(),
		[
			['another version', { ...createRequestFixture(), version: 2 }],
			['an unknown command', { ...createRequestFixture(), command: 'stale' }],
			['no variants', createRequestFixture({ variants: [] })],
			['a repeated-separator selector', createRequestFixture({ selector: 'pages::mail' })],
			['a blank case', createRequestFixture({ case: '  ' })],
			['a journey carrying a state', createRequestFixture({ command: 'journey', state: 'inbox' })],
			['a non-string argument', { ...createRequestFixture(), args: [1] }],
		],
	],
	[
		'isCaptureDeclaration',
		isCaptureDeclaration,
		createDeclarationFixture(),
		[
			['a blank case', createDeclarationFixture({ case: ' ' })],
			['an owner with an empty segment', createDeclarationFixture({ owner: 'pages:' })],
			['a non-boolean eligibility', { ...createDeclarationFixture(), eligible: 'yes' }],
			['a spaced state', createDeclarationFixture({ states: ['two words'] })],
		],
	],
	[
		'isCaptureDestination',
		isCaptureDestination,
		createDestinationFixture(),
		[
			['an escaping file', createDestinationFixture({ file: '../escape.png' })],
			['an empty project', createDestinationFixture({ project: '' })],
			['a spaced section', createDestinationFixture({ section: 'a b' })],
			['a blank case', createDestinationFixture({ case: '' })],
			['invalid sources', { ...createDestinationFixture(), sources: { own: [] } }],
		],
	],
	[
		'isCaptureEntry',
		isCaptureEntry,
		{ ...createDestinationFixture(), duration: 0 },
		[
			['a negative duration', { ...createDestinationFixture(), duration: -1 }],
			['a non-finite duration', { ...createDestinationFixture(), duration: Number.NaN }],
			['no duration', createDestinationFixture()],
		],
	],
	[
		'isCaptureArtifact',
		isCaptureArtifact,
		{ file: 'tmp/runs/a/light-390.txt', digest: FIXTURE_HASH },
		[
			['an absolute file', { file: '/runs/a.txt', digest: FIXTURE_HASH }],
			['a short digest', { file: 'tmp/runs/a.txt', digest: 'abc' }],
		],
	],
	[
		'isCaptureRun',
		isCaptureRun,
		createRunFixture(),
		[
			['another version', createRunFixture({ version: 2 })],
			['an unparsable time', createRunFixture({ time: 'yesterday' })],
			['a request without an identity', createRunFixture({ request: createRequestFixture() })],
			['an identity without a request', createRunFixture({ identity: createIdentityFixture() })],
			['a malformed artifact', { ...createRunFixture(), artifact: { file: 'a', digest: 'x' } }],
			['a spaced variant', createRunFixture({ variant: 'light 390' })],
		],
	],
	[
		'isCaptureDigest',
		isCaptureDigest,
		{ patterns: ['src/**'], files: { 'src/a.ts': FIXTURE_HASH }, digest: FIXTURE_HASH },
		[
			['no digest', { patterns: [], files: {} }],
			[
				'a case-colliding file pair',
				{
					patterns: [],
					files: { 'A.ts': FIXTURE_HASH, 'a.ts': FIXTURE_HASH },
					digest: FIXTURE_HASH,
				},
			],
			['a bad file hash', { patterns: [], files: { 'a.ts': 'x' }, digest: FIXTURE_HASH }],
		],
	],
	[
		'isCaptureReceipt',
		isCaptureReceipt,
		createReceiptFixture(),
		[
			['an unparsable time', createReceiptFixture({ time: 'x' })],
			['a malformed report', { ...createReceiptFixture(), report: { file: 'a', digest: 'x' } }],
			['a non-boolean completeness', { ...createReceiptFixture(), complete: 1 }],
		],
	],
	[
		'isCaptureRegistry',
		isCaptureRegistry,
		createRegistryFixture(),
		[
			['another version', createRegistryFixture({ version: 2 })],
			['a malformed receipt', { ...createRegistryFixture(), receipts: [{}] }],
			['a short digest', createRegistryFixture({ digest: 'abc' })],
		],
	],
	[
		'isCaptureLookup',
		isCaptureLookup,
		createLookupFixture(),
		[
			['a short registry digest', createLookupFixture({ registry: 'abc' })],
			['a blank case', createLookupFixture({ case: ' ' })],
			[
				'a malformed run',
				{ ...createLookupFixture(), run: { file: '../a', digest: FIXTURE_HASH } },
			],
		],
	],
	[
		'isCaptureLookupJournal',
		isCaptureLookupJournal,
		{
			version: 1,
			manifest: FIXTURE_HASH,
			inputs: { [FIXTURE_HASH]: createLookupFixture().inputs },
			lookups: [{ ...createLookupFixture(), inputs: FIXTURE_HASH }],
		},
		[
			['another version', { version: 2, inputs: {}, lookups: [] }],
			['a short manifest digest', { version: 1, manifest: 'abc', inputs: {}, lookups: [] }],
			['a malformed collection', { version: 1, collections: [{}], inputs: {}, lookups: [] }],
			['a malformed lookup', { version: 1, inputs: {}, lookups: [{}] }],
			['a missing input table', { version: 1, lookups: [] }],
			['a short table digest', { version: 1, inputs: { abc: {} }, lookups: [] }],
			[
				'a malformed input map',
				{ version: 1, inputs: { [FIXTURE_HASH]: { '../escape': FIXTURE_HASH } }, lookups: [] },
			],
			[
				'an embedded lookup input map',
				{ version: 1, inputs: {}, lookups: [createLookupFixture()] },
			],
			[
				'a short input reference',
				{ version: 1, inputs: {}, lookups: [{ ...createLookupFixture(), inputs: 'abc' }] },
			],
		],
	],
	[
		'isCaptureStamp',
		isCaptureStamp,
		createStampFixture(),
		[
			['a short commit', createStampFixture({ commit: 'abc123' })],
			[
				'an empty image',
				createStampFixture({ image: { digest: FIXTURE_HASH, size: 0, modified: 1 } }),
			],
			[
				'a negative modification time',
				createStampFixture({ image: { digest: FIXTURE_HASH, size: 1, modified: -1 } }),
			],
			['an escaping dirty path', createStampFixture({ dirty: ['../x'] })],
			['an unparsable time', createStampFixture({ time: 'x' })],
		],
	],
	[
		'isCaptureManifest',
		isCaptureManifest,
		createManifestFixture(),
		[
			['another version', createManifestFixture({ version: 2 })],
			['a malformed stamp', { ...createManifestFixture(), entries: { 'pages/a.png': {} } }],
			[
				'an escaping stamp key',
				{ ...createManifestFixture(), entries: { '../a.png': createStampFixture() } },
			],
		],
	],
	[
		'isCaptureCollection',
		isCaptureCollection,
		COLLECTION,
		[
			['a blank project', { ...COLLECTION, project: ' ' }],
			['a malformed report', { ...COLLECTION, report: { file: 'a', digest: 'x' } }],
			['an escaping run file', { ...COLLECTION, run: { file: '../a.json', digest: FIXTURE_HASH } }],
			['an undigested input population', { ...COLLECTION, inputs: { patterns: [], files: {} } }],
		],
	],
	[
		'isCaptureGeometry',
		isCaptureGeometry,
		{ name: 'light-390', width: 390, height: 844 },
		[
			['a zero width', { name: 'light-390', width: 0, height: 844 }],
			['a spaced name', { name: 'light 390', width: 390, height: 844 }],
			['a missing height', { name: 'light-390', width: 390 }],
			['a string width', { name: 'light-390', width: '390', height: 844 }],
		],
	],
	[
		'isCaptureBox',
		isCaptureBox,
		{ x: 0, y: 64, width: 390, height: 780 },
		[
			['a zero height', { x: 0, y: 64, width: 390, height: 0 }],
			['an infinite x', { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 }],
		],
	],
]

describe('capture guards', () => {
	it.each(ROWS)('%s accepts its positive control', (_name, guard, positive) => {
		expect(guard(positive)).toBe(true)
	})

	for (const [name, guard, , negatives] of ROWS) {
		it.each(negatives)(`${name} refuses %s`, (_label, value) => {
			expect(guard(value)).toBe(false)
		})
	}

	it('accepts a stored manifest with and without collection receipts and refuses a malformed one', () => {
		expect(isCaptureStoredManifest(createManifestFixture())).toBe(true)
		expect(isCaptureStoredManifest({ ...createManifestFixture(), collections: [COLLECTION] })).toBe(
			true,
		)
		expect(isCaptureStoredManifest({ ...createManifestFixture(), collections: [{}] })).toBe(false)
		expect(isCaptureStoredManifest({ ...createManifestFixture(), version: 2 })).toBe(false)
	})

	it('accepts a destination with and without its optional section', () => {
		expect(isCaptureDestination(createDestinationFixture())).toBe(true)
		expect(isCaptureDestination(createDestinationFixture({ section: 'inbox' }))).toBe(true)
		expect(isCaptureDestination(createDestinationFixture({ section: 'a b' }))).toBe(false)
	})
})

describe('capture path vocabulary', () => {
	it.each(REFUSED_PATHS)('refuses %j as a path and as a segment', (path) => {
		expect(isCapturePath(path)).toBe(false)
		expect(isCaptureSegment(path)).toBe(false)
	})

	it('accepts a portable relative path and refuses nothing it should keep', () => {
		expect(isCapturePath('tmp/captures/states/pages/inbox--light-390.png')).toBe(true)
		expect(isCapturePath('a')).toBe(true)
		expect(isCapturePath('tmp/.hidden/x.png')).toBe(true)
	})

	it('accepts glob wildcards in a pattern and refuses traversal, backslashes, and device names', () => {
		expect(isCapturePattern('src/**')).toBe(true)
		expect(isCapturePattern('src/*.{ts,vue}')).toBe(true)
		expect(isCapturePattern('src/?x.ts')).toBe(true)
		expect(isCapturePath('src/*.ts')).toBe(false)
		for (const pattern of ['../src/**', 'src//x', 'src\\x', 'src/NUL', 'src/a.', '', 'src/a|b']) {
			expect(isCapturePattern(pattern)).toBe(false)
		}
	})

	it('accepts a canonical segment and a colon-separated selector and refuses the rest', () => {
		for (const segment of ['light-390', 'inbox', 'a_b', 'A1']) {
			expect(isCaptureSegment(segment)).toBe(true)
		}
		for (const segment of ['', '-x', '_x', 'a b', 'a/b', 'a.b', 'a:b', 'é']) {
			expect(isCaptureSegment(segment)).toBe(false)
		}
		expect(isCaptureSelector('pages')).toBe(true)
		expect(isCaptureSelector('reference:components:modal')).toBe(true)
		for (const selector of ['', 'pages:', ':pages', 'pages::mail', 'pages:a b', 42, undefined]) {
			expect(isCaptureSelector(selector)).toBe(false)
		}
	})

	it('accepts only lowercase sixty-four-character hexadecimal digests', () => {
		expect(isCaptureHash(FIXTURE_HASH)).toBe(true)
		for (const digest of [
			'A'.repeat(64),
			'a'.repeat(63),
			'a'.repeat(65),
			'g'.repeat(64),
			7,
			null,
		]) {
			expect(isCaptureHash(digest)).toBe(false)
		}
	})

	it('accepts a portable hash map and refuses a bad key, a bad digest, or a case-folded duplicate', () => {
		expect(isCaptureHashes({})).toBe(true)
		expect(isCaptureHashes({ 'src/a.ts': FIXTURE_HASH, 'src/b.ts': FIXTURE_HASH })).toBe(true)
		expect(isCaptureHashes({ '../a.ts': FIXTURE_HASH })).toBe(false)
		expect(isCaptureHashes({ 'a.ts': 'x' })).toBe(false)
		expect(isCaptureHashes({ 'A.ts': FIXTURE_HASH, 'a.ts': FIXTURE_HASH })).toBe(false)
		expect(isCaptureHashes([])).toBe(false)
	})
})

describe('capture guard totality', () => {
	const proxy = new Proxy(
		{},
		{
			get: () => {
				throw new Error('Hostile getter')
			},
			has: () => {
				throw new Error('Hostile has')
			},
			ownKeys: () => {
				throw new Error('Hostile keys')
			},
		},
	)
	const cyclic: Record<string, unknown> = {}
	cyclic.self = cyclic
	cyclic.entries = cyclic
	cyclic.registry = cyclic
	const hostile: readonly unknown[] = [
		...createHostileValues(),
		proxy,
		cyclic,
		undefined,
		null,
		[],
		0,
		Number.NaN,
		'manifest',
	]
	const guards = ROWS.map(([name, guard]) => [name, guard] as const)

	it('feeds the guards values a naive reader cannot survive', () => {
		// The negative control: a reader that stringifies its input throws on part of this corpus, so
		// a corpus every guard survives is a corpus that could have failed them.
		const failures = hostile.filter((value) => {
			try {
				JSON.stringify(value)
				return false
			} catch {
				return true
			}
		})
		expect(failures.length).toBeGreaterThan(0)
	})

	it.each(guards)('%s stays total and refuses every hostile value', (_name, guard) => {
		for (const value of hostile) {
			expect(guard(value)).toBe(false)
		}
	})

	it('keeps the remaining guards total over the same corpus, answering a boolean and never throwing', () => {
		const remaining = [
			isCapturePath,
			isCapturePattern,
			isCaptureSegment,
			isCaptureSelector,
			isCaptureHash,
			isCaptureHashes,
			isCaptureStoredManifest,
		]
		for (const value of hostile) {
			for (const guard of remaining) expect(typeof guard(value)).toBe('boolean')
		}
	})

	it('refuses every hostile value that is not itself a valid name', () => {
		// The word `manifest` in the corpus is a valid path, pattern, segment, and selector, so the
		// refusals read the corpus without it, and a positive control below reads it alone.
		for (const value of hostile.filter((entry) => entry !== 'manifest')) {
			expect(isCapturePath(value)).toBe(false)
			expect(isCapturePattern(value)).toBe(false)
			expect(isCaptureSegment(value)).toBe(false)
			expect(isCaptureSelector(value)).toBe(false)
			expect(isCaptureHash(value)).toBe(false)
			// An empty record is a valid hash map, so this guard is held to totality above, not to refusal.
			expect(isCaptureStoredManifest(value)).toBe(false)
		}
	})

	it('accepts the corpus word that is a valid name as a name and still refuses it as evidence', () => {
		for (const guard of [isCapturePath, isCapturePattern, isCaptureSegment, isCaptureSelector])
			expect(guard('manifest')).toBe(true)
		expect(isCaptureHash('manifest')).toBe(false)
		expect(isCaptureHashes('manifest')).toBe(false)
		expect(isCaptureStoredManifest('manifest')).toBe(false)
	})
})
