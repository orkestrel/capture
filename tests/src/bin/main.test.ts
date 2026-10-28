import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { CAPTURE_DEFAULTS, CAPTURE_USAGE } from '@src/server'
import { afterAll, describe, expect, it } from 'vitest'
import { ComposedFixture } from '../../fixtures/capture/ComposedFixture.js'
import {
	BIN_REFUSALS,
	COMPOSED_DIRECTORY,
	FIXTURE_TIMEOUT,
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
		expect(existsSync(BUILT), 'run `npm run build` before this proof').toBe(true)
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
			expect(run.stdout).toBe('')
		},
	)

	it('prints the whole usage text beside a refused command', () => {
		const run = execute(['frobnicate'])
		expect(run.stderr).toContain(CAPTURE_USAGE)
	})

	it('refuses a freshness reading before the registry exists, with the refresh command named', () => {
		const run = execute(['stale', 'pages:mail', '--variant', 'light-390'])
		expect(run.status).toBe(64)
		expect(run.stderr).toContain(
			'Missing accepted registry; run the explicit complete-registry refresh',
		)
	})

	it('refreshes the registry, runs a journey, captures frames, and reads them as current', () => {
		const registry = execute(['registry'])
		expect(registry.status, registry.stderr).toBe(0)
		expect(registry.stdout).toContain('REGISTRY {')
		expect(existsSync(resolve(fixture.root, COMPOSED_DIRECTORY, 'registry.json'))).toBe(true)
		const journey = execute(['journey', 'pages:mail', '--variant', 'light-390'])
		expect(journey.status, journey.stderr).toBe(0)
		expect(journey.stdout).toContain('journey narrow: light-390; pages:mail;')
		expect(readFixtureManifest(fixture.root)).toBeUndefined()
		const frames = execute(['frames', 'pages:mail', '--variant', 'light-390'], {
			CAPTURE_PRODUCER_PICTURE: '1',
		})
		expect(frames.status, frames.stderr).toBe(0)
		expect(frames.stdout).toContain('capture narrow: light-390; pages:mail;')
		expect(readFixtureManifest(fixture.root)).toBeDefined()
		const stale = execute(['stale', 'pages:mail', '--variant', 'light-390'])
		expect(stale.status, stale.stdout).toBe(0)
		expect(stale.stdout.match(/"status":"current"/gu)).toHaveLength(3)
	})

	it('reads the captured frames through the preflight and writes their contact sheets', () => {
		const preflight = execute(['preflight', 'pages:mail', '--variant', 'light-390'])
		expect(preflight.status, preflight.stderr).toBe(0)
		expect(preflight.stdout).toContain('READER ')
		const sheets = execute([
			'sheets',
			'pages:mail',
			'--variant',
			'light-390',
			'--output',
			'tmp/sheets',
		])
		expect(sheets.status, sheets.stderr).toBe(0)
		expect(existsSync(resolve(fixture.root, 'tmp/sheets/sheet-001.png'))).toBe(true)
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
})
