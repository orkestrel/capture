import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCaptureRunner } from '@src/server'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	CAPTURE_REAL_SERVER,
	CAPTURE_REAL_VITEST,
	CAPTURE_REAL_CONFIG,
	CAPTURE_REAL_REQUESTS,
	CAPTURE_REAL_WRAPPER,
	CAPTURE_REAL_SILENT,
	createCaptureRealWorkspace,
	executeCaptureRealDiscovery,
	readCaptureFixtureFiles,
	countCaptureChildren,
	requireCaptureBuild,
	FIXTURE_TIMEOUT,
} from '../../setupServer.js'
beforeAll(() => requireCaptureBuild())

// The wrapper a consumer would write: it answers the discovery request first, ahead of the output
// initialization, the setup file, and the test files, and returns the empty configuration once it
// has answered. Outside discovery it initializes an output file and names a test and a setup file,
// each of which records itself, so the proofs below can see what a real Vitest touched.
// Each case starts a real Vitest, which loads the wrapper through Vite's runner loader.
describe('discovery through a real Vitest and a real wrapper', { timeout: FIXTURE_TIMEOUT }, () => {
	it('is built, so the wrapper imports the same package a consumer installs', () => {
		expect(
			existsSync(CAPTURE_REAL_SERVER)
				? CAPTURE_REAL_SERVER
				: 'run `npm run build` before this proof',
		).toBe(CAPTURE_REAL_SERVER)
		expect(
			existsSync(CAPTURE_REAL_VITEST) ? CAPTURE_REAL_VITEST : 'install vitest before this proof',
		).toBe(CAPTURE_REAL_VITEST)
	})

	it('round-trips the host data of the wrapper to the runner, which lists the owners the wrapper declares', async () => {
		const scratch = createCaptureRealWorkspace(CAPTURE_REAL_WRAPPER)
		try {
			const result = await executeCaptureRealDiscovery(createCaptureRunner, scratch.path, [])
			expect(result.code).toBe(64)
			for (const owner of ['app', 'app:mail'])
				expect(result.stderr).toContain(JSON.stringify(owner))
			const runs = readCaptureFixtureFiles(scratch.path, `${CAPTURE_REAL_REQUESTS}/runs`)
			expect(runs).toEqual([])
		} finally {
			scratch.destroy()
		}
	})

	it('collects no test, runs no setup file, initializes no output, and starts no stage', async () => {
		const scratch = createCaptureRealWorkspace(CAPTURE_REAL_WRAPPER)
		try {
			const result = await executeCaptureRealDiscovery(createCaptureRunner, scratch.path, [
				'app:mail',
			])
			// A selector the wrapper declares passes discovery and meets the registry check next, so the only child is the discovery one.
			expect(countCaptureChildren(result.stdout)).toBe(1)
			for (const file of ['collected.txt', 'setup.txt', 'initialized.txt'])
				expect(scratch.has(file)).toBe(false)
			expect(scratch.has('out')).toBe(false)
			expect(
				scratch.has(`${CAPTURE_REAL_REQUESTS}/journey-selection-${String(process.pid)}.json`),
			).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('shows the same wrapper initializing and collecting when it is not asked for a description', () => {
		const scratch = createCaptureRealWorkspace(CAPTURE_REAL_WRAPPER)
		try {
			const child = spawnSync(
				process.execPath,
				[
					resolve(scratch.path, 'node_modules/vitest/vitest.mjs'),
					'list',
					'--filesOnly',
					'--config',
					resolve(scratch.path, CAPTURE_REAL_CONFIG),
					'--configLoader',
					'runner',
				],
				{ cwd: scratch.path, encoding: 'utf8', windowsHide: true, timeout: 60_000 },
			)
			// The control: without a request the wrapper does its other work, so the proof above could fail.
			expect(scratch.has('initialized.txt')).toBe(true)
			expect(child.stdout).toContain('sentinel.test.ts')
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a wrapper that never answers, naming it, and starts no stage', async () => {
		const scratch = createCaptureRealWorkspace(CAPTURE_REAL_SILENT)
		try {
			const result = await executeCaptureRealDiscovery(createCaptureRunner, scratch.path, [
				'app:mail',
			])
			expect(result.code).toBe(1)
			expect(countCaptureChildren(result.stdout)).toBe(1)
			const runs = readCaptureFixtureFiles(scratch.path, `${CAPTURE_REAL_REQUESTS}/runs`)
			expect(
				readCaptureFixtureFiles(scratch.path, `${CAPTURE_REAL_REQUESTS}/runs/${runs[0] ?? ''}`),
			).not.toContain('description.json')
			for (const file of ['collected.txt', 'initialized.txt']) expect(scratch.has(file)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
})
