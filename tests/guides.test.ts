// The consumer-side guides-parity entry runs `@orkestrel/guide` against this repository's own
// `guides/README.md` manifest. The constants that follow are this package's own, as is the
// executed section that closes the file.

import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['text', 'ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** The one guide this package sources, whose tagline the README pitch equals. */
const GUIDE_SPEC = 'guides/capture.md'
/** The package identity that binds its manifest, module map, and README pitch. */
const PACKAGE_NAME = '@orkestrel/capture'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({
	[PACKAGE_NAME]: 'src/core',
	'@orkestrel/capture/server': 'src/server',
	'@src/core': 'src/core',
	'@src/server': 'src/server',
})
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * Interning is for a declaration a consumer cannot construct from values they already hold, and
 * this package has none yet: the empty list is the healthy state, and the assertion that follows
 * it fails when a name here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md', 'package.json'],
	modules: MODULES,
	languages: FENCE_LANGUAGES,
	language: EXAMPLE_LANGUAGE,
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, rows }) => {
	const { isRecord, parseJSON } = await import('@orkestrel/contract')
	const { computeSymbolKey, findMissingSymbols } = await import('@orkestrel/guide')
	const { requireValue } = await import('@orkestrel/test')
	const core = await import('@src/core')
	const { describe, expect, it } = await import('vitest')
	const manifest = parseJSON(requireValue(files['package.json'], 'Missing inventory: package.json'))
	if (!isRecord(manifest)) throw new Error('Invalid package manifest: package.json')

	it('manifest lists at least one guide', () => {
		expect(report.input).toEqual([])
		expect(rows.length).toBeGreaterThan(0)
		expect(rows.map((row) => row.entry.spec)).toContain(GUIDE_SPEC)
	})

	it('opens the README with the guide tagline', () => {
		expect(manifest.name).toBe(PACKAGE_NAME)
		expect(report.pitch).toEqual([])
	})

	for (const { entry, guide, source } of rows) {
		describe(`${entry.concept}`, () => {
			it('uses only listed fence languages', () => {
				expect(report.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('extracts a non-empty documented surface', () => {
				expect(guide.surface().length).toBeGreaterThan(0)
			})

			it('carries a summary for every documented and declared symbol', () => {
				expect(guide.surface().filter((symbol) => symbol.summary === undefined)).toEqual([])
				expect(source.surface().filter((symbol) => symbol.summary === undefined)).toEqual([])
			})

			it('re-exports every direct declaration that is not named internal', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
			})

			it('names no symbol internal that the barrel already exports', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
			})

			it('re-exports only direct declarations', () => {
				expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
			})

			it('documents every barrel export', () => {
				expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
			})

			it('documents only barrel exports', () => {
				expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
			})

			it('exposes no hidden module-scope declarations', () => {
				expect(source.hidden().map(computeSymbolKey)).toEqual([])
			})

			it('documents a populated method group', () => {
				expect(report.sections.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('keeps behavioral interfaces and implementing classes in parity', () => {
				expect(report.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
				expect(report.declarations.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('keeps every compared summary and example equal to its source', () => {
				expect(report.drift.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('documents an example for every Surface function', () => {
				expect(report.examples.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
				expect(report.examples.functions.filter((finding) => finding.spec === entry.spec)).toEqual(
					[],
				)
			})

			it('documents an example for every method', () => {
				expect(report.examples.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('imports only real exports in every ```ts fence', () => {
				expect(report.imports.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('resolves every relative link', () => {
				expect(report.links.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('links only to test files that exist', () => {
				expect(report.tests.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})
		})
	}

	// This package's own section. Every check above reads a name, and a name that resolves proves
	// nothing about the sentence beside it, so the flagship fence is transcribed here and each
	// value its comments claim is asserted. Change the fence, change the transcription.
	describe('guides fences', () => {
		it('returns the values the flagship fence claims', () => {
			expect(core.matchesCaptureSelector('pages:mail', 'pages')).toBe(true)
			expect(core.matchesCaptureSelector('pages:mailbox', 'pages:mail')).toBe(false)
			expect(core.resolveCaptureStatus(['stale-own', 'missing'])).toBe('missing')
			expect(core.readCaptureDirty('R  src/new.ts\0src/old.ts\0')).toEqual([
				'src/new.ts',
				'src/old.ts',
			])
			expect(core.isCapturePath('../escape.png')).toBe(false)
		})

		it('ships registry metadata and a README that are not the scaffold default', () => {
			expect(manifest).toMatchObject({
				name: PACKAGE_NAME,
				description: expect.not.stringContaining('The @orkestrel/capture package.'),
			})
			expect(requireValue(files['README.md'], 'Missing file: README.md')).not.toContain(
				'The @orkestrel/capture package.',
			)
		})

		it('keeps the guide fence and this transcription on the same calls', () => {
			const guide = requireValue(files[GUIDE_SPEC], `Missing file: ${GUIDE_SPEC}`)
			for (const call of [
				"matchesCaptureSelector('pages:mail', 'pages') // true",
				"matchesCaptureSelector('pages:mailbox', 'pages:mail') // false",
				"resolveCaptureStatus(['stale-own', 'missing']) // 'missing'",
				"readCaptureDirty('R  src/new.ts\\0src/old.ts\\0') // ['src/new.ts', 'src/old.ts']",
				"isCapturePath('../escape.png') // false",
			]) {
				expect(guide).toContain(call)
			}
		})
	})
})
