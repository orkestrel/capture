import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { requireValue, waitForCondition } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { CAPTURE_DEFAULTS, CAPTURE_USAGE } from '@src/server'
import { afterAll, describe, expect, it } from 'vitest'
import { ComposedFixture } from '../../fixtures/capture/ComposedFixture.js'
import {
	BIN_REFUSALS,
	COMPOSED_DIRECTORY,
	FIXTURE_TIMEOUT,
	SUPPORTS_GROUP_SIGNAL,
	readFixtureManifest,
} from '../../setupServer.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BUILT = resolve(ROOT, 'dist/bin/main.js')

// The executable runs in a workspace the real runner, engine, and readers can drive: its built-in
// wrapper path and request directory are the ones the fixture carries and its stand-in reads.
const fixture = new ComposedFixture({
	config: CAPTURE_DEFAULTS.config,
	requests: CAPTURE_DEFAULTS.requests,
})

afterAll(() => fixture.destroy())

function execute(args: readonly string[], environment: Readonly<Record<string, string>> = {}) {
	const child = spawnSync(process.execPath, [BUILT, ...args], {
		cwd: fixture.root,
		env: { ...process.env, ...environment },
		encoding: 'utf8',
		windowsHide: true,
		timeout: 60_000,
	})
	if (child.error !== undefined) throw child.error
	return { status: child.status, stdout: child.stdout, stderr: child.stderr }
}

describe('bin entry', { timeout: FIXTURE_TIMEOUT }, () => {
	it('is built, opens with the interpreter line, and names the executable the manifest publishes', () => {
		expect(existsSync(BUILT) ? BUILT : 'run `npm run build` before this proof').toBe(BUILT)
		expect(readFileSync(BUILT, 'utf8')).toMatch(/^#!\/usr\/bin\/env node\r?\n/u)
		const manifest: unknown = parseJSON(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
		expect(isRecord(manifest) && isRecord(manifest.bin) ? manifest.bin.capture : undefined).toBe(
			'dist/bin/main.js',
		)
	})

	it.each(BIN_REFUSALS)(
		'refuses $title as usage on the error stream with exit 64',
		({ argv, reason }) => {
			const run = execute(argv)
			expect(run.status).toBe(64)
			expect(run.stderr).toContain(reason)
			// A refusal after discovery prints the discovery child's id and no report or stage line.
			expect(run.stdout.replaceAll(/^pid=\d+\r?\n/gmu, '')).toBe('')
		},
	)

	it('prints the whole usage text beside a refused command', () => {
		const run = execute(['frobnicate'])
		expect(run.stderr).toContain(CAPTURE_USAGE)
		expect(run.stderr).toContain('journey --changed <ref> [--plan]')
		expect(run.stderr).toContain('frames --changed <ref> [--plan]')
		expect(run.stderr).toContain('no execution child starts')
	})

	it('refuses changed selection combined with a selector and rejects repeated or empty equals flags', () => {
		for (const argv of [
			['journey', 'pages:mail', '--changed', 'HEAD'],
			['frames', '--changed='],
			['journey', '--changed', 'HEAD', '--changed', 'HEAD'],
			['frames', '--changed', 'HEAD', '--plan', '--plan'],
		]) {
			const before = fixture.stages.length
			const run = execute(argv)
			expect(run.status).toBe(64)
			expect(fixture.stages).toHaveLength(before)
			expect(run.stderr).toContain('NEXT capture')
		}
	})

	it('refuses a freshness reading before the registry exists, with the refresh command named', () => {
		const run = execute(['stale', 'pages:mail', '--variant', 'light-390'])
		expect(run.status).toBe(1)
		expect(run.stderr).toContain(
			'Missing accepted registry; run the explicit complete-registry refresh',
		)
	})

	it('refreshes the registry, runs a journey, captures frames, and reads them as current', () => {
		const registry = execute(['registry'])
		expect(registry.status === 0 ? 0 : registry.stderr).toBe(0)
		expect(registry.stdout).toContain('REGISTRY {')
		expect(existsSync(resolve(fixture.root, COMPOSED_DIRECTORY, 'registry.json'))).toBe(true)
		const journey = execute(['journey', 'pages:mail', '--variant', 'light-390'])
		expect(journey.status === 0 ? 0 : journey.stderr).toBe(0)
		expect(journey.stdout).toContain('journey selected: light-390; pages:mail;')
		expect(readFixtureManifest(fixture.root)).toBeUndefined()
		const frames = execute(['frames', 'pages:mail', '--variant', 'light-390'], {
			CAPTURE_PRODUCER_PICTURE: '1',
		})
		expect(frames.status === 0 ? 0 : frames.stderr).toBe(0)
		expect(frames.stdout).toContain('capture narrow: light-390; pages:mail;')
		expect(readFixtureManifest(fixture.root)).toBeDefined()
		const stale = execute(['stale', 'pages:mail', '--variant', 'light-390'])
		expect(stale.status === 0 ? 0 : stale.stdout).toBe(0)
		expect(stale.stdout.match(/"status":"current"/gu)).toHaveLength(3)
	})

	it('reads the captured frames through the preflight and writes their contact sheets', () => {
		const preflight = execute(['preflight', 'pages:mail', '--variant', 'light-390'])
		expect(preflight.status === 0 ? 0 : preflight.stderr).toBe(0)
		expect(preflight.stdout).toContain('READER ')
		const sheets = execute([
			'sheets',
			'pages:mail',
			'--variant',
			'light-390',
			'--output',
			'tmp/sheets',
		])
		expect(sheets.status === 0 ? 0 : sheets.stderr).toBe(0)
		expect(existsSync(resolve(fixture.root, 'tmp/sheets/sheet-001.png'))).toBe(true)
	})

	it('H1r maps unknown and empty selectors to exit 64 under every command', () => {
		for (const command of ['journey', 'frames', 'stale', 'preflight', 'sheets', 'registry']) {
			for (const selector of ['missing', '']) {
				const run = execute([
					command,
					selector,
					...(command === 'sheets' ? ['--output', 'tmp/refused-selection'] : []),
				])
				expect({ command, selector, status: run.status, stderr: run.stderr }).toMatchObject({
					command,
					selector,
					status: 64,
				})
				expect(run.stderr).not.toBe('')
			}
		}
	})

	it('H1r maps Git plan failures to exit 1 through the built command', () => {
		for (const command of ['journey', 'frames']) {
			const run = execute([command, '--changed', 'missing-ref', '--plan'])
			expect({ command, status: run.status, stderr: run.stderr }).toMatchObject({
				command,
				status: 1,
				stderr: expect.stringContaining('Git read failed'),
			})
		}
	})
	it('H1s maps an unknown variant to usage under every command before and after registry authentication', () => {
		const isolated = new ComposedFixture({
			config: CAPTURE_DEFAULTS.config,
			requests: CAPTURE_DEFAULTS.requests,
		})
		try {
			for (const authenticated of [false, true]) {
				if (authenticated) {
					const registry = spawnSync(process.execPath, [BUILT, 'registry'], {
						cwd: isolated.root,
						encoding: 'utf8',
						windowsHide: true,
						timeout: 60_000,
					})
					if (registry.status !== 0) throw new Error(registry.stderr || 'Registry refresh failed')
				}
				for (const command of ['journey', 'frames', 'stale', 'preflight', 'sheets', 'registry']) {
					const child = spawnSync(
						process.execPath,
						[
							BUILT,
							command,
							...(command === 'registry' ? [] : ['all']),
							'--variant',
							'unknown-variant',
							...(command === 'sheets' ? ['--output', 'tmp/refused-variant'] : []),
						],
						{ cwd: isolated.root, encoding: 'utf8', windowsHide: true, timeout: 60_000 },
					)
					expect({ command, status: child.status, stderr: child.stderr }).toMatchObject({
						command,
						status: 64,
						stderr: expect.stringContaining('variant'),
					})
				}
			}
		} finally {
			isolated.destroy()
		}
	})

	it('exits 1 for a stage whose child fails, leaving the manifest untouched', () => {
		const before = readFixtureManifest(fixture.root)
		const run = execute(['frames', 'pages:mail', '--variant', 'light-390'], {
			CAPTURE_PRODUCER_MODE: 'failed-child',
		})
		expect(run.status).toBe(1)
		expect(run.stderr).toContain('Capture stage child did not exit successfully')
		expect(readFixtureManifest(fixture.root)).toBe(before)
	})

	it('plans changed work through the executable without starting any execution child', () => {
		const original = fixture.read('src/mail/view.ts')
		const stages = fixture.stages.length
		try {
			fixture.write('src/mail/view.ts', '// changed for planning\n')
			for (const argv of [
				['journey', '--changed', 'HEAD', '--plan', '--variant', 'light-390'],
				['journey', '--changed=HEAD', '--plan', '--variant=light-390'],
			]) {
				const run = execute(argv)
				expect(run.status === 0 ? 0 : run.stderr).toBe(0)
				expect(fixture.stages).toHaveLength(stages)
				expect(run.stdout).toContain('"classification":"own","owners":["pages:mail"]')
				expect(run.stdout).toContain('COMMAND capture journey pages:mail --variant light-390')
			}
		} finally {
			fixture.write('src/mail/view.ts', original)
		}
	})
})

// A terminal's Ctrl+C reaches every process in the foreground group, so this reading starts the
// executable as the leader of its own group and signals the group. Windows has no signal a process
// group can receive; its console reading is taken in a terminal.
describe.runIf(SUPPORTS_GROUP_SIGNAL)(
	'bin entry under a process-group interrupt',
	{ timeout: FIXTURE_TIMEOUT },
	() => {
		it('ends the stage child and its descendant, starts no later stage, and leaves the manifest and requests as they were', async () => {
			const before = readFixtureManifest(fixture.root)
			rmSync(resolve(fixture.root, 'ready.json'), { force: true })
			const child = spawn(process.execPath, [BUILT, 'frames', 'pages:mail'], {
				cwd: fixture.root,
				env: { ...process.env, CAPTURE_PRODUCER_MODE: 'hang' },
				detached: true,
				windowsHide: true,
			})
			const stdout: string[] = []
			child.stdout.setEncoding('utf8').on('data', (text: string) => stdout.push(text))
			const exited = once(child, 'exit')
			await waitForCondition(
				'the stage child reports ready',
				() => fixture.readReady().length > 0,
				{
					budget: 30_000,
				},
			)
			const pids = fixture.readReady()
			const leader = requireValue(child.pid)
			process.kill(-leader, 'SIGINT')
			const [code] = await exited
			expect(code).toBe(1)
			await waitForCondition(
				'the stage child and its descendant have exited',
				() => pids.every((pid) => !isRunning(pid)),
				{ budget: 20_000 },
			)
			expect(stdout.join('')).toContain('capture narrow:')
			expect(stdout.join('')).not.toContain('capture rest:')
			expect(
				readdirSync(resolve(fixture.root, fixture.requests)).filter((name) =>
					name.startsWith('journey-selection'),
				),
			).toEqual([])
			expect(readFixtureManifest(fixture.root)).toBe(before)
		})
	},
)
