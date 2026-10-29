import * as core from '@src/core'
import * as server from '@src/server'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createScratch } from '@orkestrel/test/server'
import {
	CAPTURE_DEFAULTS,
	CAPTURE_USAGE,
	CaptureCLI,
	createCaptureCLI,
	CaptureInvocation,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import {
	ComposedFixture,
	FIXTURE_TIMEOUT,
	withEnvironment,
	readCaptureHeld,
	BOARD,
	MAIL,
	readCaptureRuns,
	CAPTURE_USAGE_CASES,
} from '../../setupServer.js'
describe('CaptureCLI', { timeout: FIXTURE_TIMEOUT }, () => {
	it.each(['registry', 'journey'])(
		'X7 leaves runs unchanged for %s usage after discovery',
		async (command) => {
			const fixture = new ComposedFixture(
				{ core, server },
				{
					config: CAPTURE_DEFAULTS.config,
					requests: CAPTURE_DEFAULTS.requests,
					committed: true,
				},
			)
			const errors: string[] = []
			const cli = new CaptureCLI({
				root: fixture.root,
				stdout: () => undefined,
				stderr: (text) => errors.push(text),
			})
			try {
				if (command === 'journey') {
					fixture.seed()
					fixture.write('src/shared/input-0.ts', '// shared\n')
				}
				const retained = `${fixture.requests}/runs/earlier-run/discovery.log`
				fixture.write(retained, 'earlier evidence')
				const before = readCaptureRuns(fixture.root, fixture.requests)
				expect(
					await cli.execute(
						command === 'registry'
							? ['registry', '--variant', 'nope']
							: ['journey', '--changed', 'HEAD', '--plan'],
					),
				).toBe(64)
				expect(errors.join('')).toContain(
					command === 'registry' ? 'Unknown variant' : 'Shared journey inputs cannot be narrowed',
				)
				expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
				expect(readCaptureRuns(fixture.root, fixture.requests)).toEqual(before)
				expect(fixture.read(retained).toString('utf8')).toBe('earlier evidence')
			} finally {
				fixture.destroy()
			}
		},
	)
	it('X7 retains the changed-selection discovery directory on exit 1', async () => {
		const fixture = new ComposedFixture(
			{ core, server },
			{
				config: CAPTURE_DEFAULTS.config,
				requests: CAPTURE_DEFAULTS.requests,
				committed: true,
			},
		)
		try {
			const before = readCaptureRuns(fixture.root, fixture.requests)
			const cli = new CaptureCLI({
				root: fixture.root,
				stdout: () => undefined,
				stderr: () => undefined,
			})
			expect(await cli.execute(['journey', '--changed', 'HEAD', '--plan'])).toBe(1)
			const added = readCaptureRuns(fixture.root, fixture.requests).filter(
				(name) => !before.includes(name),
			)
			expect(added).toHaveLength(1)
			expect(
				added.every((name) =>
					existsSync(resolve(fixture.root, fixture.requests, 'runs', name, 'discovery.log')),
				),
			).toBe(true)
			expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})
	it('H1x leaves runs unchanged after every usage refusal in every command', async () => {
		const fixture = new ComposedFixture(
			{ core, server },
			{
				config: CAPTURE_DEFAULTS.config,
				requests: CAPTURE_DEFAULTS.requests,
			},
		)
		const cli = new CaptureCLI({
			root: fixture.root,
			stdout: () => undefined,
			stderr: () => undefined,
		})
		try {
			expect(await cli.execute(['registry'])).toBe(0)
			const before = readCaptureRuns(fixture.root, fixture.requests)
			for (const command of ['journey', 'frames', 'stale', 'registry', 'preflight', 'sheets']) {
				for (const args of CAPTURE_USAGE_CASES) {
					expect(
						await cli.execute([
							command,
							...args,
							...(command === 'sheets' ? ['--output', 'tmp/usage-sheets'] : []),
						]),
						`${command}: ${args.join(' ')}`,
					).toBe(64)
					expect(readCaptureRuns(fixture.root, fixture.requests)).toEqual(before)
					expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
				}
			}
			expect(await cli.execute(['journey', 'pages:mail'])).toBe(0)
			expect(readCaptureRuns(fixture.root, fixture.requests)).toHaveLength(before.length + 1)
		} finally {
			fixture.destroy()
		}
	})
	it('H1x retains discovery logs for exit-1 evidence refusals', async () => {
		const fixture = new ComposedFixture(
			{ core, server },
			{
				config: CAPTURE_DEFAULTS.config,
				requests: CAPTURE_DEFAULTS.requests,
			},
		)
		const cli = new CaptureCLI({
			root: fixture.root,
			stdout: () => undefined,
			stderr: () => undefined,
		})
		try {
			for (const command of ['journey', 'frames', 'stale', 'preflight', 'sheets']) {
				const before = readCaptureRuns(fixture.root, fixture.requests)
				expect(
					await cli.execute([
						command,
						'pages:mail',
						...(command === 'sheets' ? ['--output', 'tmp/no-registry-sheets'] : []),
					]),
				).toBe(1)
				const delta = readCaptureRuns(fixture.root, fixture.requests).filter(
					(name) => !before.includes(name),
				)
				expect(delta).toHaveLength(1)
				expect(
					delta.every((name) =>
						existsSync(resolve(fixture.root, fixture.requests, 'runs', name, 'discovery.log')),
					),
				).toBe(true)
				expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
			}
		} finally {
			fixture.destroy()
		}
	})
	it('H1w classifies unavailable absolute path roots as usage before sheet preflight', async () => {
		const fixture = new ComposedFixture(
			{ core, server },
			{
				config: CAPTURE_DEFAULTS.config,
				requests: CAPTURE_DEFAULTS.requests,
			},
		)
		const errors: string[] = []
		const cli = new CaptureCLI({
			root: fixture.root,
			stdout: () => undefined,
			stderr: (text) => errors.push(text),
		})
		// Windows can name an unavailable drive; POSIX has one absolute root and uses a missing outside ancestor.
		const value =
			process.platform === 'win32'
				? 'Z:\\capture-unavailable\\checks.ts'
				: '/capture-unavailable-root/checks.ts'
		try {
			for (const command of ['journey', 'frames', 'stale', 'registry', 'preflight', 'sheets']) {
				for (const flag of [
					'config',
					...(['preflight', 'sheets'].includes(command) ? ['journeys', 'checks'] : []),
					...(command === 'sheets' ? ['output'] : []),
				]) {
					expect(
						await cli.execute([
							command,
							...(command === 'registry' ? [] : ['pages:mail']),
							`--${flag}`,
							value,
							...(command === 'sheets' && flag !== 'output' ? ['--output', 'tmp/ok'] : []),
						]),
					).toBe(64)
					expect(errors.at(-1)).toContain(`--${flag}`)
					expect(errors.at(-1)).toContain('capture-unavailable')
					expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
				}
			}
			expect(readCaptureRuns(fixture.root, fixture.requests)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})
	it('H1v refuses another owner case under every command with no stage or marker', async () => {
		const fixture = new ComposedFixture(
			{ core, server },
			{
				config: CAPTURE_DEFAULTS.config,
				requests: CAPTURE_DEFAULTS.requests,
			},
		)
		const errors: string[] = []
		const cli = new CaptureCLI({
			root: fixture.root,
			stdout: () => undefined,
			stderr: (text) => errors.push(text),
		})
		try {
			expect(await cli.execute(['registry'])).toBe(0)
			for (const command of ['journey', 'frames', 'stale', 'preflight', 'sheets']) {
				const before = fixture.stages.length
				expect(
					await cli.execute([
						command,
						'pages:mail',
						'--case',
						BOARD,
						...(command === 'sheets' ? ['--output', 'tmp/foreign-case'] : []),
					]),
				).toBe(64)
				expect(errors.at(-1)).toContain(BOARD)
				expect(errors.at(-1)).toContain(MAIL)
				expect(fixture.stages.length).toBe(before)
				expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
			}
			expect(await cli.execute(['journey', 'pages:mail', '--case', MAIL])).toBe(0)
		} finally {
			fixture.destroy()
		}
	})
	it('H1v treats outside path flags as usage after refusing a held marker first', async () => {
		const fixture = new ComposedFixture(
			{ core, server },
			{
				config: CAPTURE_DEFAULTS.config,
				requests: CAPTURE_DEFAULTS.requests,
			},
		)
		const outside = createScratch({ prefix: 'capture-flag-outside-' })
		const errors: string[] = []
		const cli = new CaptureCLI({
			root: fixture.root,
			stdout: () => undefined,
			stderr: (text) => errors.push(text),
		})
		const owner = new CaptureInvocation({
			command: 'journey',
			root: fixture.root,
			requests: fixture.requests,
			stdout: () => undefined,
			stderr: () => undefined,
		})
		try {
			expect((await fixture.refresh()).code).toBe(0)
			for (const command of ['journey', 'frames', 'stale', 'registry', 'preflight', 'sheets']) {
				for (const flag of [
					'config',
					...(['preflight', 'sheets'].includes(command) ? ['journeys', 'checks'] : []),
					...(command === 'sheets' ? ['output'] : []),
				]) {
					const args = [
						command,
						...(command === 'registry' ? [] : ['pages:mail']),
						`--${flag}`,
						outside.path,
						...(command === 'sheets' && flag !== 'output' ? ['--output', 'tmp/refused-path'] : []),
					]
					owner.prepare()
					expect({
						command,
						flag,
						code: await cli.execute(args),
						message: errors.at(-1),
					}).toMatchObject({ code: 1, message: expect.stringContaining('Another runner holds') })
					await owner.release()
					expect({ command, flag, code: await cli.execute(args) }).toEqual({
						command,
						flag,
						code: 64,
					})
					expect(errors.at(-1)).toContain('outside')
					expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
				}
			}
		} finally {
			await owner.release()
			fixture.destroy()
			outside.destroy()
		}
	})
	it('routes missing-command usage only to the injected diagnostic writer', async () => {
		const stdout: string[] = []
		const stderr: string[] = []
		const code = await new CaptureCLI({
			stdout: (text) => stdout.push(text),
			stderr: (text) => stderr.push(text),
		}).execute([])
		expect(code).toBe(64)
		expect(stdout).toEqual([])
		expect(stderr.join('')).toBe(`No command given.\n${CAPTURE_USAGE}\n`)
	})

	it('is what the factory creates', () => {
		expect(createCaptureCLI()).toBeInstanceOf(CaptureCLI)
	})

	it.each([
		{ argv: ['journey', 'app', '--state=inbox'], flag: '--state' },
		{ argv: ['frames', 'app', '--portfolio=states'], flag: '--portfolio' },
		{ argv: ['stale', '--changed=HEAD'], flag: '--changed' },
		{ argv: ['preflight', 'app', '--output=sheets'], flag: '--output' },
		{ argv: ['sheets', 'app'], flag: '--output' },
		{ argv: ['registry', '--plan'], flag: '--plan' },
		{ argv: ['journey', '--changed=HEAD', '--plan', '--plan'], flag: '--plan' },
	])('refuses $argv before discovery in a workspace with no wrapper', async ({ argv, flag }) => {
		const scratch = createScratch({ prefix: 'cli-refusal-' })
		const stdout: string[] = []
		const stderr: string[] = []
		try {
			const code = await new CaptureCLI({
				root: scratch.path,
				stdout: (text) => stdout.push(text),
				stderr: (text) => stderr.push(text),
			}).execute(argv)
			expect(code).toBe(64)
			expect(stdout).toEqual([])
			expect(stderr.join('')).toContain(flag)
			expect(stderr.join('')).not.toContain('Cannot find')
			expect(readCaptureHeld(scratch.path, CAPTURE_DEFAULTS.requests)).toEqual([])
		} finally {
			scratch.destroy()
		}
	})

	it('routes every command report through the injected writers and retains exit codes', async () => {
		const fixture = new ComposedFixture(
			{ core, server },
			{
				config: CAPTURE_DEFAULTS.config,
				requests: CAPTURE_DEFAULTS.requests,
			},
		)
		const stdout: string[] = []
		const stderr: string[] = []
		const cli = new CaptureCLI({
			root: fixture.root,
			stdout: (text) => stdout.push(text),
			stderr: (text) => stderr.push(text),
		})
		try {
			expect(await cli.execute(['registry'])).toBe(0)
			expect(stdout.join('')).toContain('REGISTRY ')
			expect(await cli.execute(['journey', '--variant=light-390', 'pages:mail'])).toBe(0)
			expect(stdout.join('')).toContain('journey selected:')
			expect(
				await withEnvironment({ CAPTURE_PRODUCER_PICTURE: '1' }, () =>
					cli.execute(['frames', 'pages:mail', '--variant=light-390']),
				),
			).toBe(0)
			expect(stdout.join('')).toContain('INTEGRITY ')
			expect(await cli.execute(['stale', 'pages:mail', '--variant=light-390'])).toBe(0)
			expect(await cli.execute(['preflight', 'pages:mail', '--variant=light-390'])).toBe(0)
			expect(stdout.join('')).toContain('READER ')
			expect(
				await cli.execute(['sheets', 'pages:mail', '--variant=light-390', '--output=tmp/sheets']),
			).toBe(0)
			expect(stdout.join('')).toContain('SHEETS ')
			expect(stderr).toEqual([])
			expect(
				await withEnvironment({ CAPTURE_PRODUCER_MODE: 'failed-child' }, () =>
					cli.execute(['frames', 'pages:mail', '--variant=light-390']),
				),
			).toBe(1)
			expect(stderr.join('')).toContain('Capture stage child did not exit successfully')
		} finally {
			fixture.destroy()
		}
	})
})
