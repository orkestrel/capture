import { createScratch } from '@orkestrel/test/server'
import { CAPTURE_DEFAULTS, CAPTURE_USAGE, CaptureCLI, createCaptureCLI } from '@src/server'
import { describe, expect, it } from 'vitest'
import { ComposedFixture } from '../../fixtures/capture/ComposedFixture.js'
import { FIXTURE_TIMEOUT, withEnvironment } from '../../setupServer.js'

describe('CaptureCLI', { timeout: FIXTURE_TIMEOUT }, () => {
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
			expect(scratch.has(CAPTURE_DEFAULTS.requests)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('routes every command report through the injected writers and retains exit codes', async () => {
		const fixture = new ComposedFixture({
			config: CAPTURE_DEFAULTS.config,
			requests: CAPTURE_DEFAULTS.requests,
		})
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
