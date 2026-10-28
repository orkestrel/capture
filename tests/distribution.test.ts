import {
	// These exports remain available to proofs emitted by earlier scaffold releases.
	buildDistributionCases,
	createDistributionSuite,
	readDistributionJSON,
	runDistributionNode,
	writeDistributionFile,
} from './setupDistribution.js'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BRAND_DRIVER, BRAND_EXPECTED } from './setupServer.js'

const DISTRIBUTION_SUITE = createDistributionSuite()

beforeAll(() => DISTRIBUTION_SUITE.start())

afterAll(() => DISTRIBUTION_SUITE.destroy())

describe('installed package consumer', () => {
	for (const row of buildDistributionCases(DISTRIBUTION_SUITE)) {
		it(`${row.label}`, async (context) => {
			const observation = await row.observe(context)
			expect(observation.actual).toStrictEqual(observation.expected)
		})
	}
	it('publishes no browser face this proof cannot drive [requires the registry]', (context) => {
		const faces = DISTRIBUTION_SUITE.read(context).entries.filter((entry) => entry.browsable)
		expect(faces.map((entry) => entry.subpath)).toStrictEqual([])
	})
})

describe('installed capture executable and peers', () => {
	it('publishes the executable the manifest names, with its interpreter line [requires the registry]', (context) => {
		const stage = DISTRIBUTION_SUITE.read(context)
		const manifest = readDistributionJSON(join(stage.installed, 'package.json'))
		const bin =
			typeof manifest === 'object' && manifest !== null && 'bin' in manifest
				? manifest.bin
				: undefined
		expect(bin).toStrictEqual({ capture: 'dist/bin/main.js' })
		const entry = join(stage.installed, 'dist/bin/main.js')
		expect(existsSync(entry)).toBe(true)
		expect(readFileSync(entry, 'utf8')).toMatch(/^#!\/usr\/bin\/env node\r?\n/u)
		const link = process.platform === 'win32' ? 'capture.cmd' : 'capture'
		expect(existsSync(join(stage.consumer, 'node_modules', '.bin', link))).toBe(true)
	})

	it('runs the installed executable, which refuses a missing command as usage [requires the registry]', (context) => {
		const stage = DISTRIBUTION_SUITE.read(context)
		const run = runDistributionNode([join(stage.installed, 'dist/bin/main.js')], stage.consumer)
		expect(run.status).toBe(64)
		expect(run.stderr).toContain('No command given')
		expect(run.stderr).toContain('Usage: capture <command> [arguments]')
	})

	it('declares vite and vitest as peers, and the install resolves a pair that satisfies them [requires the registry]', (context) => {
		const stage = DISTRIBUTION_SUITE.read(context)
		const manifest = readDistributionJSON(join(stage.installed, 'package.json'))
		const peers =
			typeof manifest === 'object' && manifest !== null && 'peerDependencies' in manifest
				? manifest.peerDependencies
				: undefined
		expect(peers).toStrictEqual({ vite: '^8.3.5', vitest: '^4.1.12' })
		const versions = ['vite', 'vitest'].map((name) => {
			const installed = readDistributionJSON(
				join(stage.consumer, 'node_modules', name, 'package.json'),
			)
			return typeof installed === 'object' && installed !== null && 'version' in installed
				? String(installed.version).split('.')[0]
				: undefined
		})
		expect(versions).toStrictEqual(['8', '4'])
	})
})

describe('installed CaptureError brand', () => {
	it('is recognized across the import and require entries and across a copy at a second path [requires the registry]', (context) => {
		const stage = DISTRIBUTION_SUITE.read(context)
		const copy = join(stage.consumer, 'second', 'capture')
		cpSync(stage.installed, copy, { recursive: true })
		writeDistributionFile(join(stage.consumer, 'brand.mjs'), BRAND_DRIVER)
		const run = runDistributionNode(
			[join(stage.consumer, 'brand.mjs'), stage.installed, copy],
			stage.consumer,
		)
		expect(run.stderr).toBe('')
		expect(run.status).toBe(0)
		expect(JSON.parse(run.stdout)).toStrictEqual(BRAND_EXPECTED)
	})
})
