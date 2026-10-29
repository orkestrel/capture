import {
	isCaptureDestination,
	isCaptureHash,
	isCaptureHashes,
	isCapturePath,
	isCapturePattern,
	isCaptureRequest,
	isCaptureRun,
	isCaptureSegment,
	isCaptureSelector,
	isCaptureStoredManifest,
} from '@src/core'
import { createHostileValues } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	CAPTURE_COLLECTION_FIXTURE,
	CAPTURE_GUARD_CASES,
	FIXTURE_HASH,
	REFUSED_PATHS,
	createDestinationFixture,
	createIdentityFixture,
	createManifestFixture,
	createRequestFixture,
	createRunFixture,
} from '../../setup.js'

describe('capture guards', () => {
	it('accepts a selected journey request and final identity while retaining malformed-stage refusals', () => {
		const identity = createIdentityFixture({ stage: 'selected' })
		const request = createRequestFixture({
			...identity,
			command: 'journey',
			variants: ['light-390', 'dark-390'],
		})
		expect(isCaptureRequest(request)).toBe(true)
		expect(isCaptureRun(createRunFixture({ identity, request }))).toBe(true)
		expect(isCaptureRequest({ ...request, stage: '../selected' })).toBe(false)
	})
	it.each(CAPTURE_GUARD_CASES)('%s accepts its positive control', (_name, guard, positive) => {
		expect(guard(positive)).toBe(true)
	})

	for (const [name, guard, , negatives] of CAPTURE_GUARD_CASES) {
		it.each(negatives)(`${name} refuses %s`, (_label, value) => {
			expect(guard(value)).toBe(false)
		})
	}

	it('accepts a stored manifest with and without collection receipts and refuses a malformed one', () => {
		expect(isCaptureStoredManifest(createManifestFixture())).toBe(true)
		const manifest = { ...createManifestFixture(), collections: [CAPTURE_COLLECTION_FIXTURE] }
		expect(isCaptureStoredManifest(manifest)).toBe(true)
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
	const guards = CAPTURE_GUARD_CASES.map(([name, guard]) => [name, guard] as const)

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
		const predicates = [
			isCapturePath,
			isCapturePattern,
			isCaptureSegment,
			isCaptureSelector,
			isCaptureHash,
			isCaptureHashes,
			isCaptureStoredManifest,
		]
		for (const value of hostile) {
			for (const guard of predicates) expect(typeof guard(value)).toBe('boolean')
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
