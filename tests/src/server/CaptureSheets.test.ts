import * as core from '@src/core'
import * as server from '@src/server'
import { existsSync, mkdirSync, renameSync, readdirSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { createScratch, supportsDirectoryLinks } from '@orkestrel/test/server'
import { CaptureSheets, decodeCapturePicture } from '@src/server'
import { describe, expect, it } from 'vitest'
import {
	readCaptureSheetIndex,
	ReaderFixture,
	FIXTURE_TIMEOUT,
	MAIL,
	MIXED_PICTURES,
	READER_CONFIG,
	READER_JOURNEYS,
	VARIANTS,
} from '../../setupServer.js'
const REFUSAL = 'Contact sheets require a new contained directory'

describe('CaptureSheets over a real wrapper and real frames', { timeout: FIXTURE_TIMEOUT }, () => {
	it('H1x flags a partial final thumbnail row at the height limit', async () => {
		const fixture = new ReaderFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({
				selector: 'pages:mail',
				case: MAIL,
				picture: {
					'mail-screen': { width: 641, height: 1201 },
				},
			})
			const result = await fixture.run('contact-sheets', [
				'pages:mail',
				'--case',
				MAIL,
				'--variant',
				'light-390',
				'--output',
				'tmp/edge-sheets',
			])
			expect(result.status).toBe(0)
			const text = JSON.stringify(readCaptureSheetIndex(fixture, 'tmp/edge-sheets'))
			expect(text).toContain('"factor":3,"clipped":true')
			expect(fixture.read('tmp/edge-sheets/index.md').toString('utf8')).toContain(
				'source 641 x 1201; displayed 214 x 400; clipped',
			)
		} finally {
			fixture.destroy()
		}
	})
	it.runIf(supportsDirectoryLinks())(
		'H1r revalidates the sheet parent at directory creation',
		async () => {
			const fixture = new ReaderFixture({ core, server })
			const outside = createScratch({ prefix: 'capture-sheet-write-' })
			const reads: string[] = []
			const errors: string[] = []
			try {
				fixture.seed()
				await fixture.capture({ selector: 'pages:mail', picture: true })
				const parent = resolve(fixture.root, 'tmp/sheet-parent')
				mkdirSync(parent)
				const sheets = new CaptureSheets({
					reader: {
						root: fixture.root,
						config: resolve(fixture.root, READER_CONFIG),
						journeys: resolve(fixture.root, READER_JOURNEYS),
						selection: { selector: 'pages:mail', variants: ['light-390'] },
						stdout: () => undefined,
						stderr: (text) => errors.push(text),
					},
					get output() {
						reads.push('output')
						if (reads.length === 2) {
							renameSync(parent, resolve(outside.path, 'moved'))
							symlinkSync(resolve(outside.path, 'moved'), parent, 'junction')
						}
						return resolve(parent, 'sheets')
					},
				})
				expect(await sheets.execute()).toBe(1)
				expect(reads).toHaveLength(2)
				expect(errors.join('')).toContain(REFUSAL)
				expect(readdirSync(resolve(outside.path, 'moved'))).toEqual([])
			} finally {
				fixture.destroy()
				outside.destroy()
			}
		},
	)
	it.runIf(supportsDirectoryLinks())(
		'refuses output inside a capture directory reached through an alias',
		async () => {
			const fixture = new ReaderFixture({ core, server })
			try {
				fixture.seed()
				await fixture.capture({ selector: 'pages:mail', picture: true })
				symlinkSync(
					resolve(fixture.root, 'tmp/captures/states/pages'),
					resolve(fixture.root, 'tmp/alias'),
					'junction',
				)
				const run = await fixture.run('contact-sheets', [
					'pages:mail',
					'--variant',
					'light-390',
					'--output',
					'tmp/alias/sheets',
				])
				expect(run.status).toBe(1)
				expect(run.stderr).toContain(REFUSAL)
				expect(existsSync(resolve(fixture.root, 'tmp/alias/sheets'))).toBe(false)
			} finally {
				fixture.destroy()
			}
		},
	)
	it('writes sparse auxiliary-portfolio sheets and indexes the full source dimensions', async () => {
		const fixture = new ReaderFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ selector: 'examples:files', picture: true })
			const result = await fixture.run('contact-sheets', [
				'examples:files',
				'--portfolio',
				'files-focused',
				'--state',
				'files-reading',
				'--variant',
				'light-320',
				'--output',
				'tmp/sheets',
			])
			expect({
				code: result.status,
				failure: result.status === 0 ? undefined : result.stdout + result.stderr,
			}).toEqual({
				code: 0,
				failure: undefined,
			})
			expect(result.stdout.startsWith('SHEETS ')).toBe(true)
			expect(result.stdout).toContain(
				'"file":"tmp/captures/files-focused/files-reading--light-320.png"',
			)
			expect(result.stdout).toContain('"project":"journey:light-390"')
			expect(result.stdout).not.toContain('dark-320')
			expect(result.stdout).not.toContain('board-screen')
			expect(result.stdout).toContain('"width":128,"height":128')
			expect(result.stdout).toContain('"acceptance":false')
			const sheet = decodeCapturePicture(fixture.read('tmp/sheets/sheet-001.png'))
			expect([sheet.width, sheet.height]).toEqual([128, 128])
			expect(fixture.read('tmp/sheets/index.json').toString('utf8')).toContain('files-focused')
		} finally {
			fixture.destroy()
		}
	})

	it('writes mixed observations and source dimensions into the sheet documents', async () => {
		const fixture = new ReaderFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', case: MAIL, picture: MIXED_PICTURES })
			const screen = 'tmp/captures/states/pages/mail-screen--light-390.png'
			const reader = 'tmp/captures/states/pages/mail-reader--light-390.png'
			const observation = 'Mixed framing: states/pages:mail@128: page, viewport'
			const result = await fixture.run('contact-sheets', [
				'pages:mail',
				'--case',
				MAIL,
				'--variant',
				'light-390',
				'--output',
				'tmp/mixed-sheets',
			])
			expect(result.status).toBe(0)
			const json = fixture.read('tmp/mixed-sheets/index.json').toString('utf8')
			const markdown = fixture.read('tmp/mixed-sheets/index.md').toString('utf8')
			expect(json).toContain('"mixed": [')
			expect(json).toContain(observation)
			expect(json).toContain(screen)
			expect(json).toContain(reader)
			expect(markdown).toContain('# Contact sheets')
			expect(markdown).toContain('Iteration evidence only.')
			expect(markdown).toContain('## Mixed observations')
			expect(markdown).toContain(`- ${observation}`)
			expect(markdown).toContain('## sheet-001.png')
			expect(markdown).toContain('![sheet-001.png](sheet-001.png)')
			expect(markdown).toContain(screen)
			expect(markdown).toContain(reader)
			expect(markdown).toContain('source 128 x 256')
			expect(markdown).toContain('source 128 x 128')
			expect(markdown).toContain('producer journey:light-390')
			expect(decodeCapturePicture(fixture.read('tmp/mixed-sheets/sheet-001.png')).height).toBe(256)
		} finally {
			fixture.destroy()
		}
	})

	it('states that a uniform selection reports no mixed geometry', async () => {
		const fixture = new ReaderFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', picture: true })
			const result = await fixture.run('contact-sheets', [
				'pages:mail',
				'--variant',
				'light-390',
				'--output',
				'tmp/uniform-sheets',
			])
			expect(result.status).toBe(0)
			expect(fixture.read('tmp/uniform-sheets/index.md').toString('utf8')).toContain(
				'No mixed geometry reported for this selection.',
			)
		} finally {
			fixture.destroy()
		}
	})

	it('shrinks wide frames by a whole factor and clips tall ones at the height limit', async () => {
		const fixture = new ReaderFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({
				selector: 'pages:mail',
				case: MAIL,
				picture: {
					'mail-screen': { width: 128, height: 900 },
					'mail-reader': { width: 700, height: 300 },
				},
			})
			const result = await fixture.run('contact-sheets', [
				'pages:mail',
				'--case',
				MAIL,
				'--variant',
				'light-390',
				'--output',
				'tmp/shrunk-sheets',
			])
			expect(result.status).toBe(0)
			const text = JSON.stringify(readCaptureSheetIndex(fixture, 'tmp/shrunk-sheets'))
			expect(text).toContain('"factor":1,"clipped":true')
			expect(text).toContain('"displayed":{"width":128,"height":400}')
			expect(text).toContain('"factor":3,"clipped":false')
			expect(text).toContain('"displayed":{"width":234,"height":100}')
			expect(fixture.read('tmp/shrunk-sheets/index.md').toString('utf8')).toContain('; clipped')
		} finally {
			fixture.destroy()
		}
	})

	it('pairs the groups of one portfolio, owner, and state into rows of two', async () => {
		const fixture = new ReaderFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ variants: [...VARIANTS], picture: true })
			const result = await fixture.run('contact-sheets', ['all', '--output', 'tmp/all-sheets'])
			expect(result.status).toBe(0)
			const index = readCaptureSheetIndex(fixture, 'tmp/all-sheets')
			const sheets = index.sheets
			if (!Array.isArray(sheets)) throw new Error('Missing sheets')
			expect(sheets).toHaveLength(1)
			const rows: unknown = sheets[0]?.rows
			if (!Array.isArray(rows)) throw new Error('Missing rows')
			// Five states: mail-screen, mail-reader, mail-quotes, board-screen, and files-reading.
			expect(rows.map((row: unknown) => (Array.isArray(row) ? row.length : -1))).toEqual([2, 2, 1])
			expect(result.stdout.match(/"displayed":/gu)).toHaveLength(18)
			expect(existsSync(resolve(fixture.root, 'tmp/all-sheets/sheet-002.png'))).toBe(false)
		} finally {
			fixture.destroy()
		}
	})

	it.each([
		{ title: 'a directory that exists', output: 'tmp/existing-sheets', prepare: true },
		{ title: 'a directory outside the workspace', output: '../outside-sheets', prepare: false },
		{
			title: 'a directory inside a selected capture directory',
			output: 'tmp/captures/states/pages/sheets',
			prepare: false,
		},
		{
			title: 'a directory whose parent does not exist',
			output: 'tmp/missing-parent/sheets',
			prepare: false,
		},
	])('refuses $title before writing anything', async ({ output, prepare }) => {
		const fixture = new ReaderFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', picture: true })
			if (prepare) fixture.write(`${output}/keep.txt`, 'present before\n')
			const result = await fixture.run('contact-sheets', [
				'pages:mail',
				'--variant',
				'light-390',
				'--output',
				output,
			])
			expect(result.status).toBe(output === '../outside-sheets' ? 64 : 1)
			expect(result.stderr).toContain(
				output === '../outside-sheets' ? '--output resolves outside' : REFUSAL,
			)
			expect(result.stdout).toBe('')
			expect(existsSync(resolve(fixture.root, output, 'index.json'))).toBe(false)
			// The directory exists only where the case made it first: a refusal creates none of its own.
			expect(existsSync(resolve(fixture.root, output))).toBe(prepare)
			// A fresh directory beside the refusals still writes.
			const accepted = await fixture.run('contact-sheets', [
				'pages:mail',
				'--variant',
				'light-390',
				'--output',
				'tmp/accepted-sheets',
			])
			expect(accepted.status).toBe(0)
			expect(existsSync(resolve(fixture.root, 'tmp/accepted-sheets/sheet-001.png'))).toBe(true)
		} finally {
			fixture.destroy()
		}
	})
})
