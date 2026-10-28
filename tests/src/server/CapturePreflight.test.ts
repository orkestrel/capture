import { existsSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseJSON } from '@orkestrel/contract'
import { createScratch, supportsDirectoryLinks } from '@orkestrel/test/server'
import {
	createCapturePreflight,
	decodeCapturePicture,
	readCaptureReaderArguments,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import { SCOPED_FINDING, TALL_FINDING } from '../../fixtures/capture/Checks.js'
import { ReaderFixture } from '../../fixtures/capture/ReaderFixture.js'
import {
	BOARD,
	FIXTURE_TIMEOUT,
	UNIFORM_DECLARATIONS,
	MAIL,
	MIXED_PICTURES,
	READER_COMMANDS,
	READER_ENDINGS,
	READER_CHECK_REFUSALS,
	READER_CONFIG,
	READER_JOURNEYS,
	VARIANTS,
	createReaderWrapper,
	readFixtureManifest,
	withEnvironment,
} from '../../setupServer.js'

const CHECKS = resolve(import.meta.dirname, '../../fixtures/capture/Checks.ts')

it.each(READER_COMMANDS)(
	'H1s retains declared focused output variants through %s',
	async (command) => {
		const fixture = new ReaderFixture()
		try {
			fixture.seed()
			await fixture.capture({ variants: [...VARIANTS], picture: true })
			const result = await fixture.run(command, [
				'examples:files',
				'--variant',
				'light-320',
				...(command === 'contact-sheets' ? ['--output', 'tmp/focused-output'] : []),
			])
			expect(result.status === 0 ? 0 : result.stderr).toBe(0)
			expect(result.stdout).toContain('files-reading--light-320.png')
			expect(result.stdout).not.toContain('files-reading--dark-320.png')
		} finally {
			fixture.destroy()
		}
	},
	FIXTURE_TIMEOUT,
)

it(
	'H1s retains geometry and thumbnails after judging full decoded frames',
	async () => {
		const fixture = new ReaderFixture()
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', picture: true })
			const { reader } = readCaptureReaderArguments(
				['pages:mail', '--variant', 'light-390', '--checks', CHECKS],
				fixture.root,
				{ config: READER_CONFIG, journeys: READER_JOURNEYS },
			)
			const result = await createCapturePreflight(reader).check()
			expect(result.issues).not.toContain('missing decoded pixels')
			expect(result.images.length).toBeGreaterThan(0)
			for (const image of result.images) {
				expect('pixels' in image.picture).toBe(false)
				expect(image).toHaveProperty('thumbnail')
			}
		} finally {
			fixture.destroy()
		}
	},
	FIXTURE_TIMEOUT,
)

// The variable the reader sets while it inspects the wrapper.
const FLAG = 'CAPTURE'

it(
	'H1r refuses an outside journeys root and selector usage through both readers',
	async () => {
		const fixture = new ReaderFixture()
		const outside = createScratch({ prefix: 'capture-journeys-outside-' })
		try {
			fixture.seed()
			for (const command of READER_COMMANDS) {
				const args = command === 'preflight' ? [] : ['--output', 'tmp/refused-sheets']
				const unknown = await fixture.run(command, ['missing', ...args])
				expect(unknown.status).toBe(64)
				expect(unknown.stderr).toContain('selector: received "missing"')
				const run = await fixture.run(command, ['all', '--journeys', outside.path, ...args])
				expect(run.status).toBe(1)
				expect(run.stderr).toContain('outside')
			}
		} finally {
			fixture.destroy()
			outside.destroy()
		}
	},
	FIXTURE_TIMEOUT,
)

it.runIf(supportsDirectoryLinks())(
	'H1r refuses a journeys root redirected outside the workspace',
	async () => {
		const fixture = new ReaderFixture()
		const outside = createScratch({ prefix: 'capture-journeys-root-' })
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', picture: true })
			renameSync(resolve(fixture.root, 'tmp/journey'), resolve(outside.path, 'journey'))
			symlinkSync(
				resolve(outside.path, 'journey'),
				resolve(fixture.root, 'tmp/journey'),
				'junction',
			)
			for (const command of READER_COMMANDS) {
				const args = command === 'preflight' ? [] : ['--output', 'tmp/refused-sheets']
				const run = await fixture.run(command, ['pages:mail', '--variant', 'light-390', ...args])
				expect(run.status).toBe(1)
				expect(run.stderr).toContain('outside')
			}
		} finally {
			fixture.destroy()
			outside.destroy()
		}
	},
	FIXTURE_TIMEOUT,
)

describe('H1 shared reader judgment', { timeout: FIXTURE_TIMEOUT }, () => {
	it.each(READER_COMMANDS)(
		'retains artifact and host-check refusals through %s',
		async (command) => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed()
				const run = await fixture.capture({
					selector: 'pages:mail',
					picture: true,
					journal: 'foreign',
				})
				const args = ['pages:mail', '--variant', 'light-390']
				const coverage = await fixture.run(command, [...args, ...sheetsFor(command, 'coverage')])
				expect(coverage.status).toBe(1)
				expect(coverage.stdout).toContain('does not cover its record')
				const artifact = `tmp/journey/runs/${run.request.id}/${run.request.stage}/light-390.txt`
				fixture.write(artifact, 'changed\n')
				const changed = await fixture.run(command, [...args, ...sheetsFor(command, 'changed')])
				expect(changed.status).toBe(1)
				expect(changed.stdout).toContain('differs from its record')
				rmSync(resolve(fixture.root, artifact))
				const missing = await fixture.run(command, [...args, ...sheetsFor(command, 'missing')])
				expect(missing.status).toBe(1)
				expect(missing.stdout).toContain('Cannot read judged journey artifact')
				await fixture.capture({ selector: 'pages:mail', case: MAIL, picture: MIXED_PICTURES })
				const checked = await fixture.run(command, [
					...args,
					'--checks',
					CHECKS,
					...sheetsFor(command, 'checked'),
				])
				expect(checked.status).toBe(1)
				expect(checked.stdout).toContain(TALL_FINDING)
				for (const { file, message } of READER_CHECK_REFUSALS) {
					const malformed = await fixture.run(command, [
						...args,
						'--checks',
						file,
						...sheetsFor(command, 'malformed'),
					])
					expect(malformed.status).toBe(1)
					expect(malformed.stderr).toContain(message)
					expect(malformed.stdout).toBe('')
				}
			} finally {
				fixture.destroy()
			}
		},
	)

	it.each(READER_ENDINGS)('reads artifact coverage with terminator %j', async (ending) => {
		const fixture = new ReaderFixture()
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', picture: true, ending })
			const result = await fixture.run('preflight', ['pages:mail', '--variant', 'light-390'])
			expect(result).toMatchObject({ status: 0, stderr: '' })
		} finally {
			fixture.destroy()
		}
	})

	it.runIf(supportsDirectoryLinks())(
		'refuses a physically escaped artifact through a real link',
		async () => {
			const fixture = new ReaderFixture()
			const outside = createScratch({ prefix: 'capture-artifact-outside-' })
			try {
				fixture.seed()
				const run = await fixture.capture({ selector: 'pages:mail', picture: true })
				const artifact = `tmp/journey/runs/${run.request.id}/${run.request.stage}/light-390.txt`
				outside.write('frames/light-390.txt', fixture.read(artifact).toString('utf8'))
				const directory = `tmp/journey/runs/${run.request.id}/${run.request.stage}`
				renameSync(resolve(fixture.root, directory), resolve(fixture.root, `${directory}-original`))
				symlinkSync(resolve(outside.path, 'frames'), resolve(fixture.root, directory), 'junction')
				const result = await fixture.run('preflight', ['pages:mail', '--variant', 'light-390'])
				expect(result.status).toBe(1)
				expect(result.stdout).toContain('outside the journeys directory')
			} finally {
				fixture.destroy()
				outside.destroy()
			}
		},
	)
})

function sheetsFor(command: string, name: string): readonly string[] {
	return command === 'contact-sheets' ? ['--output', `tmp/${name}`] : []
}

function describeRun(run: {
	readonly status: number
	readonly stdout: string
	readonly stderr: string
}) {
	return {
		code: run.status,
		failure: run.status === 0 ? undefined : run.stdout + run.stderr,
	}
}

describe(
	'CapturePreflight over a real wrapper and real frames',
	{ timeout: FIXTURE_TIMEOUT },
	() => {
		it.each(READER_COMMANDS)(
			'classifies collection-only desktop images through %s',
			async (command) => {
				const fixture = new ReaderFixture()
				try {
					fixture.seed({ variants: ['light-390', 'dark-390'] })
					await fixture.capture({
						command: 'journey',
						selector: 'examples:files',
						variants: ['light-390'],
					})
					const desktop = await fixture.capture({
						command: 'journey',
						selector: 'examples:files',
						variants: ['light-1280'],
					})
					expect(desktop.lookups).toEqual([])
					const declared = await fixture.engine.read({
						selector: 'pages:mail',
						variants: ['light-1280'],
					})
					expect(declared.entries.map((entry) => entry.state).toSorted()).toEqual([
						'mail-quotes',
						'mail-reader',
						'mail-screen',
					])
					const result = await fixture.run(command, [
						'pages:mail',
						'--variant',
						'light-1280',
						...sheetsFor(command, 'desktop-sheets'),
					])
					expect({ status: result.status, stderr: result.stderr }).toEqual({
						status: 1,
						stderr: '',
					})
					expect(result.stdout).toContain('"status":"missing"')
					expect(result.stdout).toContain('mail-screen--light-1280.png')
				} finally {
					fixture.destroy()
				}
			},
		)

		it('executes the preflight on one state without broadening its image or artifact population', async () => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed()
				await fixture.capture({
					selector: 'pages:mail',
					case: MAIL,
					state: 'mail-reader',
					picture: true,
				})
				const result = await fixture.run('preflight', [
					'pages:mail',
					'--state',
					'mail-reader',
					'--variant',
					'light-390',
				])
				expect(describeRun(result)).toEqual({ code: 0, failure: undefined })
				expect(result.stdout).toContain(
					'"file":"tmp/captures/states/pages/mail-reader--light-390.png"',
				)
				expect(result.stdout).toContain('"acceptance":false')
				expect(result.stdout).not.toContain('board-screen')
				expect(result.stdout).not.toContain('mail-screen')
				expect(result.stdout).not.toContain('dark-390')
				expect(result.stdout).toContain('"width":128,"height":128')
			} finally {
				fixture.destroy()
			}
		})

		it('keeps the whole population when variants are omitted, auxiliary portfolio included', async () => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed()
				await fixture.capture({ variants: [...VARIANTS], picture: true })
				const whole = await fixture.run('preflight', ['all'])
				expect(describeRun(whole)).toEqual({ code: 0, failure: undefined })
				expect(whole.stdout.match(/"bytes":/gu)).toHaveLength(18)
				expect(whole.stdout).toContain('files-reading--dark-320.png')
				expect(whole.stdout).toContain('board-screen--dark-1280.png')
			} finally {
				fixture.destroy()
			}
		})

		it('reads the judged scoped artifact when no complete artifact exists and refuses its changed bytes', async () => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed()
				const run = await fixture.capture({ selector: 'pages:mail', picture: true })
				rmSync(resolve(fixture.root, 'tmp/journey/light-390.txt'))
				const args = ['pages:mail', '--variant', 'light-390']
				expect(describeRun(await fixture.run('preflight', args))).toEqual({
					code: 0,
					failure: undefined,
				})
				const artifact = `tmp/journey/runs/${run.request.id}/${run.request.stage}/light-390.txt`
				expect(fixture.read('tmp/journey/light-390-scoped.txt')).toEqual(fixture.read(artifact))
				fixture.write(
					artifact,
					`${fixture.read(artifact).toString('utf8')}appended after the run\n`,
				)
				const changed = await fixture.run('preflight', args)
				expect(changed.status).toBe(1)
				expect(changed.stdout).toContain(
					`Judged journey artifact differs from its record: ${artifact}`,
				)
			} finally {
				fixture.destroy()
			}
		})

		it('judges the artifact its stamps name, and reports one that covers neither its record nor its case', async () => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed()
				await fixture.capture({ selector: 'pages:mail', picture: true })
				const args = ['pages:mail', '--variant', 'light-390']
				expect((await fixture.run('preflight', args)).status).toBe(0)
				const run = await fixture.capture({
					selector: 'pages:mail',
					picture: true,
					journal: 'foreign',
				})
				const artifact = `tmp/journey/runs/${run.request.id}/${run.request.stage}/light-390.txt`
				const foreign = await fixture.run('preflight', args)
				expect(foreign.status).toBe(1)
				expect(foreign.stdout).toContain(
					`Judged journey artifact does not cover its record: ${artifact}`,
				)
				expect(foreign.stdout).toContain(
					`Judged journey artifact does not cover ${MAIL}: ${artifact}`,
				)
			} finally {
				fixture.destroy()
			}
		})

		it('keeps each invocation artifact so two scoped stamps of one variant both pass', async () => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed()
				const mail = await fixture.capture({ selector: 'pages:mail', picture: true })
				const board = await fixture.capture({ selector: 'examples:board', picture: true })
				for (const selector of ['pages:mail', 'examples:board']) {
					const result = await fixture.run('preflight', [selector, '--variant', 'light-390'])
					expect({ selector, ...describeRun(result) }).toEqual({
						selector,
						code: 0,
						failure: undefined,
					})
				}
				const first = `tmp/journey/runs/${mail.request.id}/${mail.request.stage}/light-390.txt`
				const second = `tmp/journey/runs/${board.request.id}/${board.request.stage}/light-390.txt`
				for (const [run, artifact] of [
					[mail, first],
					[board, second],
				] as const) {
					const file = `tmp/captures/states/runs/${run.request.id}/${run.request.stage}/light-390.json`
					expect(parseJSON(fixture.read(file).toString('utf8'))).toMatchObject({
						artifact: { file: artifact },
					})
				}
				expect(fixture.read(first).toString('utf8')).toContain(`case-ran=${MAIL}`)
				expect(fixture.read(second).toString('utf8')).toContain(`case-ran=${BOARD}`)
				expect(fixture.read('tmp/journey/light-390-scoped.txt')).toEqual(fixture.read(second))
			} finally {
				fixture.destroy()
			}
		})

		it('reads a standalone root alone and keeps its direct images unstamped', async () => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed({ vue: true, variants: ['light-390'] })
				const result = await fixture.run('preflight', [
					'vue',
					'--portfolio',
					'vue',
					'--variant',
					'light-390',
				])
				expect(result.status).toBe(1)
				expect(result.stdout).toContain('tmp/captures/vue/vue-home--light-390.png')
				expect(result.stdout).toContain('"status":"unstamped"')
				expect(result.stdout).toContain('Judged frame has no stamped run record')
				expect(result.stdout).not.toContain('tmp/captures/states')
				expect(existsSync(resolve(fixture.root, 'tmp/captures/vue/manifest.json'))).toBe(false)
				// A selector that names the standalone root reads it without the portfolio flag.
				const named = await fixture.run('preflight', ['vue', '--variant', 'light-390'])
				expect(named.status).toBe(1)
				expect(named.stdout).toContain('tmp/captures/vue/vue-home--light-390.png')
				// A primary selector never reaches the standalone root's frames.
				const primary = await fixture.run('preflight', ['pages:mail', '--variant', 'light-390'])
				expect(primary.status).toBe(1)
				expect(primary.stderr).toContain('Prepare the explicit complete-registry refresh')
			} finally {
				fixture.destroy()
			}
		})

		it.each(READER_COMMANDS)(
			'refuses an out-of-scope state through %s before any output',
			async (command) => {
				const fixture = new ReaderFixture()
				try {
					fixture.seed()
					const result = await fixture.run(command, [
						'pages:mail',
						'--state',
						'board-screen',
						...sheetsFor(command, 'refused-sheets'),
					])
					expect(result.status).toBe(1)
					expect(result.stderr).toContain('Prepare the explicit complete-registry refresh')
					expect(result.stdout).toBe('')
					expect(existsSync(resolve(fixture.root, 'tmp/refused-sheets'))).toBe(false)
					expect(readFixtureManifest(fixture.root)).toBeUndefined()
				} finally {
					fixture.destroy()
				}
			},
		)

		it('keeps tiny, corrupt, and missing image refusals beside encoded positive controls', async () => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed()
				const args = ['pages:mail', '--state', 'mail-reader', '--variant', 'light-390']
				await fixture.capture({ selector: 'pages:mail', case: MAIL, state: 'mail-reader' })
				const tiny = await fixture.run('preflight', args)
				expect(tiny.status).toBe(1)
				expect(tiny.stdout).toContain('Image under 4 KB')
				await fixture.capture({
					selector: 'pages:mail',
					case: MAIL,
					state: 'mail-reader',
					picture: true,
				})
				expect((await fixture.run('preflight', args)).status).toBe(0)
				const file = 'tmp/captures/states/pages/mail-reader--light-390.png'
				const corrupt = Buffer.from(fixture.read(file))
				corrupt[33] = (corrupt[33] ?? 0) ^ 1
				fixture.write(file, corrupt)
				const broken = await fixture.run('preflight', args)
				expect(broken.status).toBe(1)
				expect(broken.stdout).toContain('Cannot read image')
				rmSync(resolve(fixture.root, file))
				const missing = await fixture.run('contact-sheets', [
					...args,
					'--output',
					'tmp/missing-sheets',
				])
				expect(missing.status).toBe(1)
				expect(missing.stdout).toContain('"status":"missing"')
				const mark = decodeCapturePicture(fixture.read('tmp/missing-sheets/sheet-001.png'))
				expect([mark.width, mark.height, ...mark.pixels.slice(0, 3)]).toEqual([
					160, 20, 220, 20, 20,
				])
				await fixture.capture({
					selector: 'pages:mail',
					case: MAIL,
					state: 'mail-reader',
					picture: true,
				})
				expect((await fixture.run('preflight', args)).status).toBe(0)
			} finally {
				fixture.destroy()
			}
		})
	},
)

describe('CapturePreflight mixed observations', { timeout: FIXTURE_TIMEOUT }, () => {
	it.each(UNIFORM_DECLARATIONS)(
		'judges uniform scopes with $title while retaining freshness, coverage, and host checks for every scope',
		async ({ uniform, observations }) => {
			const fixture = new ReaderFixture()
			try {
				const variants = ['light-390', 'dark-390']
				fixture.write(READER_CONFIG, createReaderWrapper(fixture.root, variants, uniform))
				fixture.seed({ variants })
				await fixture.capture({
					variants: ['light-390'],
					picture: {
						'mail-screen': { width: 128, height: 256 },
						'board-screen': { width: 128, height: 256 },
					},
				})
				await fixture.capture({ variants: ['dark-390'], picture: true })
				const result = await fixture.run('preflight', [
					'all',
					'--variant',
					'light-390',
					'--variant',
					'dark-390',
					'--checks',
					CHECKS,
				])
				expect({ status: result.status, stderr: result.stderr }).toEqual({
					status: 1,
					stderr: '',
				})
				const board = 'tmp/captures/states/examples/board-screen--light-390.png'
				const mail = 'tmp/captures/states/pages/mail-screen--light-390.png'
				expect(parseJSON(result.stdout.slice('READER '.length))).toMatchObject({
					mixed: observations,
					freshness: {
						entries: expect.arrayContaining([
							expect.objectContaining({ file: board, status: 'current' }),
							expect.objectContaining({ file: mail, status: 'current' }),
						]),
					},
					sizes: expect.arrayContaining([
						expect.objectContaining({ file: board, width: 128, height: 256 }),
						expect.objectContaining({ file: mail, width: 128, height: 256 }),
					]),
					issues: [`${TALL_FINDING}: ${mail}`, `${TALL_FINDING}: ${board}`],
					acceptance: false,
				})
			} finally {
				fixture.destroy()
			}
		},
	)

	it.each(READER_COMMANDS)(
		'reports mixed page-sized and viewport-sized images through %s without making the mixture fatal',
		async (command) => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed()
				await fixture.capture({ selector: 'pages:mail', case: MAIL, picture: MIXED_PICTURES })
				const screen = 'tmp/captures/states/pages/mail-screen--light-390.png'
				const reader = 'tmp/captures/states/pages/mail-reader--light-390.png'
				expect(fixture.read(screen).length).toBeGreaterThan(4000)
				expect(fixture.read(reader).length).toBeGreaterThan(4000)
				expect(decodeCapturePicture(fixture.read(screen)).height).toBe(256)
				expect(decodeCapturePicture(fixture.read(reader)).height).toBe(128)
				const observation = 'Mixed framing: states/pages:mail@128: page, viewport'
				const result = await fixture.run(command, [
					'pages:mail',
					'--case',
					MAIL,
					'--variant',
					'light-390',
					...sheetsFor(command, 'mixed-sheets'),
				])
				expect(describeRun(result)).toEqual({ code: 0, failure: undefined })
				expect(result.stdout).toContain(`"mixed":[${JSON.stringify(observation)}]`)
				expect(result.stdout).toContain('"issues":[]')
				expect(result.stdout).toContain('"acceptance":false')
				expect(result.stdout).toContain(screen)
				expect(result.stdout).toContain(reader)
				expect(result.stdout).toContain('"width":128,"height":256')
				expect(result.stdout).toContain('"width":128,"height":128')
				expect(result.stdout).not.toContain('mail-quotes')
				expect(result.stdout).not.toContain('dark-390')
			} finally {
				fixture.destroy()
			}
		},
	)

	it('reports changed ordinary geometry and its restoration without inferring framing intent', async () => {
		const fixture = new ReaderFixture()
		try {
			fixture.seed()
			const anchor = fixture.read(fixture.options.registry)
			const picture = {
				'mail-screen': { width: 128, height: 256 },
				'mail-reader': { width: 128, height: 256 },
				'mail-quotes': { width: 128, height: 256 },
			}
			const file = 'tmp/captures/states/pages/mail-quotes--light-390.png'
			const args = ['pages:mail', '--variant', 'light-390']
			await fixture.capture({ selector: 'pages:mail', picture })
			const before = await fixture.run('preflight', args)
			expect(describeRun(before)).toEqual({ code: 0, failure: undefined })
			expect(before.stdout).toContain('"mixed":[]')
			expect(decodeCapturePicture(fixture.read(file)).height).toBe(256)

			// A fresh real capture keeps image provenance current while its dimensions change.
			await fixture.capture({
				selector: 'pages:mail',
				picture: { ...picture, 'mail-quotes': { width: 128, height: 128 } },
			})
			const changed = await fixture.run('preflight', args)
			expect(describeRun(changed)).toEqual({ code: 0, failure: undefined })
			expect(changed.stdout).toContain(
				'"mixed":["Mixed framing: states/pages:mail@128: page, viewport"]',
			)
			expect(changed.stdout).toContain('"issues":[]')
			expect(changed.stdout).toContain('"acceptance":false')
			expect(changed.stdout).toContain(file)
			expect(changed.stdout).toContain('"width":128,"height":128')
			expect(decodeCapturePicture(fixture.read(file)).height).toBe(128)
			expect(
				(
					await fixture.engine.check({ selector: 'pages:mail', variants: ['light-390'] })
				).entries.map((entry) => entry.status),
			).toEqual(['current', 'current', 'current'])

			await fixture.capture({ selector: 'pages:mail', picture })
			const restored = await fixture.run('preflight', args)
			expect(describeRun(restored)).toEqual({ code: 0, failure: undefined })
			expect(restored.stdout).toContain('"mixed":[]')
			expect(restored.stdout).toContain('"issues":[]')
			expect(decodeCapturePicture(fixture.read(file)).height).toBe(256)
			expect(fixture.read(fixture.options.registry)).toEqual(anchor)
		} finally {
			fixture.destroy()
		}
	})

	it('groups frames by portfolio and owner, so one owner mixing sizes does not taint another', async () => {
		const fixture = new ReaderFixture()
		try {
			fixture.seed()
			await fixture.capture({
				variants: ['light-390'],
				picture: {
					'mail-screen': { width: 128, height: 256 },
					'board-screen': { width: 128, height: 256 },
				},
			})
			const result = await fixture.run('preflight', ['all', '--variant', 'light-390'])
			expect(describeRun(result)).toEqual({ code: 0, failure: undefined })
			expect(result.stdout).toContain(
				'"mixed":["Mixed framing: states/pages:mail@128: page, viewport"]',
			)
			expect(result.stdout).not.toContain('Mixed framing: states/examples:board')
			expect(result.stdout).not.toContain('Mixed framing: files-focused')
		} finally {
			fixture.destroy()
		}
	})
})

describe('CapturePreflight host checks', { timeout: FIXTURE_TIMEOUT }, () => {
	it('appends what each check module reader finds, and nothing when the frames pass', async () => {
		const fixture = new ReaderFixture()
		try {
			fixture.seed()
			await fixture.capture({ variants: [...VARIANTS], picture: true })
			const args = ['pages:mail', '--variant', 'light-390', '--checks', CHECKS]
			const complete = await fixture.run('preflight', args)
			expect(describeRun(complete)).toEqual({ code: 0, failure: undefined })
			expect(complete.stdout).not.toContain(TALL_FINDING)
			expect(complete.stdout).not.toContain(SCOPED_FINDING)
			await fixture.capture({ selector: 'pages:mail', case: MAIL, picture: MIXED_PICTURES })
			const mixed = await fixture.run('preflight', [
				'pages:mail',
				'--case',
				MAIL,
				'--variant',
				'light-390',
				'--checks',
				CHECKS,
			])
			expect(mixed.status).toBe(1)
			const report: unknown = parseJSON(mixed.stdout.slice(mixed.stdout.indexOf('{')))
			expect(report).toMatchObject({
				issues: [
					`${TALL_FINDING}: tmp/captures/states/pages/mail-screen--light-390.png`,
					`${SCOPED_FINDING}: tmp/captures/states/pages/mail-screen--light-390.png`,
					`${SCOPED_FINDING}: tmp/captures/states/pages/mail-reader--light-390.png`,
				],
			})
		} finally {
			fixture.destroy()
		}
	})

	it('passes no picture to a check when the image cannot be read, and still reports the image', async () => {
		const fixture = new ReaderFixture()
		try {
			fixture.seed()
			await fixture.capture({ variants: [...VARIANTS], picture: true })
			rmSync(resolve(fixture.root, 'tmp/captures/states/pages/mail-reader--light-390.png'))
			const result = await fixture.run('preflight', [
				'pages:mail',
				'--state',
				'mail-reader',
				'--variant',
				'light-390',
				'--checks',
				CHECKS,
			])
			expect(result.status).toBe(1)
			expect(result.stdout).toContain('Cannot read image')
			expect(result.stdout).not.toContain(TALL_FINDING)
		} finally {
			fixture.destroy()
		}
	})

	it.each(READER_CHECK_REFUSALS)(
		'refuses $title before printing a report',
		async ({ file, message }) => {
			const fixture = new ReaderFixture()
			try {
				fixture.seed()
				await fixture.capture({ selector: 'pages:mail', picture: true })
				const result = await fixture.run('preflight', [
					'pages:mail',
					'--variant',
					'light-390',
					'--checks',
					file,
				])
				expect(result.status).toBe(1)
				expect(result.stderr).toContain(message)
				expect(result.stdout).toBe('')
			} finally {
				fixture.destroy()
			}
		},
	)
})

describe('CapturePreflight wrapper refusals', { timeout: FIXTURE_TIMEOUT }, () => {
	it('refuses projects that disagree on uniform scopes before printing a report', async () => {
		const fixture = new ReaderFixture()
		try {
			fixture.write(
				READER_CONFIG,
				createReaderWrapper(fixture.root, VARIANTS, ['pages']).replace(
					'"uniform":["pages"]',
					'"uniform":["examples"]',
				),
			)
			const result = await fixture.run('preflight', ['all'])
			expect(result).toEqual({
				status: 1,
				stdout: '',
				stderr: expect.stringContaining('Host project integrity declarations disagree'),
			})
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a wrapper path outside the repository', async () => {
		const fixture = new ReaderFixture()
		try {
			const result = await fixture.run('preflight', [
				'pages:mail',
				'--config',
				'../outside.config.ts',
			])
			expect(result.status).toBe(64)
			expect(result.stderr).toContain('Reader config must be a contained repository path')
		} finally {
			fixture.destroy()
		}
	})

	it.each([
		{
			title: 'a wrapper that declares no projects',
			text: () => 'export default {}\n',
			message: 'The wrapper declares no projects',
		},
		{
			title: 'projects that disagree on a host declaration',
			text: (root: string) =>
				createReaderWrapper(root).replace('fixture journeys close the run', 'another final case'),
			message: 'Host project integrity declarations disagree',
		},
		{
			title: 'a project whose variants carry no geometry',
			text: (root: string) => createReaderWrapper(root).replaceAll('"width"', '"wide"'),
			message: 'A reader project declares no viewport geometry',
		},
	])('refuses $title', async ({ text, message }) => {
		const fixture = new ReaderFixture()
		try {
			fixture.write(READER_CONFIG, text(fixture.root))
			const result = await fixture.run('preflight', ['pages:mail'])
			expect(result.status).toBe(1)
			expect(result.stderr).toContain(message)
			expect(result.stdout).toBe('')
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a destination whose producing project the wrapper does not declare', async () => {
		const fixture = new ReaderFixture()
		try {
			// The wrapper is one of the bounded inputs, so each wrapper is seeded before it is read.
			fixture.write(READER_CONFIG, createReaderWrapper(fixture.root, ['light-1280', 'dark-1280']))
			fixture.seed()
			const result = await fixture.run('preflight', ['pages:mail', '--variant', 'light-390'])
			expect(result.status).toBe(1)
			expect(result.stderr).toContain('Authenticated destination has no actual wrapper project')
			fixture.write(READER_CONFIG, createReaderWrapper(fixture.root))
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', variants: ['light-390'] })
			expect(
				(await fixture.run('preflight', ['pages:mail', '--variant', 'light-390'])).status,
			).toBe(1)
		} finally {
			fixture.destroy()
		}
	})

	it('leaves the inherited capture variable of this process alone while the wrapper is discovered', async () => {
		const fixture = new ReaderFixture()
		try {
			fixture.seed()
			const args = ['pages:mail', '--variant', 'light-390']
			await withEnvironment({ [FLAG]: 'inherited' }, async () => {
				await fixture.run('preflight', args)
				expect(process.env[FLAG]).toBe('inherited')
			})
			delete process.env[FLAG]
			await fixture.run('preflight', args)
			expect(process.env[FLAG]).toBeUndefined()
		} finally {
			fixture.destroy()
		}
	})
})
