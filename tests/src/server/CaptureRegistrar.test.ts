import type { CaptureReceipt, CaptureRegistry } from '@src/core'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, symlinkSync, watch } from 'node:fs'
import { resolve } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { requireValue, waitForCondition, waitForDelay } from '@orkestrel/test'
import { createScratch, isRunning, supportsDirectoryLinks } from '@orkestrel/test/server'
import { isCaptureRegistry } from '@src/core'
import { CaptureRegistrar } from '@src/server'
import { describe, expect, it } from 'vitest'
import { ComposedFixture } from '../../fixtures/capture/ComposedFixture.js'
import {
	readExitedPid,
	startSleeper,
	stopFixtureChild,
} from '../../fixtures/capture/ProcessFixture.js'
import {
	COMPOSED_DIRECTORY,
	COMPOSED_REQUESTS,
	FIXTURE_TIMEOUT,
	readCaptureHeld,
	REGISTRY_REFUSALS,
	VARIANTS,
} from '../../setupServer.js'

const REGISTRY = `${COMPOSED_DIRECTORY}/registry.json`
const SUMMARY = 'REGISTRY '

it.runIf(supportsDirectoryLinks())(
	'H1r rechecks registry containment after stage children redirect its root',
	async () => {
		const fixture = new ComposedFixture()
		const outside = createScratch({ prefix: 'capture-registry-redirect-' })
		const events: string[] = []
		const watcher = watch(outside.path, { recursive: true }, (_event, name) =>
			events.push(String(name)),
		)
		try {
			fixture.write(
				'node_modules/vitest/vitest.mjs',
				`${fixture.read('node_modules/vitest/vitest.mjs').toString('utf8')}\nimport { existsSync, renameSync, symlinkSync } from 'node:fs'\nif (process.argv.includes('journey:dark-390') && existsSync(${JSON.stringify(resolve(fixture.root, COMPOSED_DIRECTORY))}) && !existsSync(${JSON.stringify(resolve(outside.path, 'moved'))})) { renameSync(${JSON.stringify(resolve(fixture.root, COMPOSED_DIRECTORY))}, ${JSON.stringify(resolve(outside.path, 'moved'))}); symlinkSync(${JSON.stringify(resolve(outside.path, 'moved'))}, ${JSON.stringify(resolve(fixture.root, COMPOSED_DIRECTORY))}, 'junction') }\n`,
			)
			const run = await fixture.refresh()
			await waitForDelay(20)
			expect(fixture.stages).toHaveLength(4)
			expect(run.code).toBe(1)
			expect(run.stderr).toContain('outside')
			expect(events.filter((name) => name.includes('.candidate'))).toEqual([])
		} finally {
			watcher.close()
			fixture.destroy()
			outside.destroy()
		}
	},
	FIXTURE_TIMEOUT,
)

function readRegistry(fixture: ComposedFixture): CaptureRegistry {
	const registry: unknown = parseJSON(fixture.read(REGISTRY).toString('utf8'))
	if (!isCaptureRegistry(registry)) throw new Error('The published registry fails its own guard')
	return registry
}

function readReceipt(registry: CaptureRegistry, variant: string): CaptureReceipt {
	return requireValue(
		registry.receipts.find((receipt) => receipt.variant === variant),
		`The registry holds no receipt for ${variant}`,
	)
}

function readSummary(stdout: string): unknown {
	const line = requireValue(
		stdout.split('\n').find((text) => text.startsWith(SUMMARY)),
		'The refresh printed no summary line',
	)
	return parseJSON(line.slice(SUMMARY.length))
}

// Each case spawns a Git repository and one Node producer per variant, which the default budget leaves thin.
describe('CaptureRegistrar', { timeout: FIXTURE_TIMEOUT }, () => {
	it('refuses an outside publication root before a producer writes', async () => {
		const fixture = new ComposedFixture()
		const outside = createScratch({ prefix: 'capture-publication-' })
		try {
			fixture.write(
				fixture.config,
				fixture
					.read(fixture.config)
					.toString('utf8')
					.replaceAll(
						JSON.stringify(resolve(fixture.root, COMPOSED_DIRECTORY)),
						JSON.stringify(resolve(outside.path, 'new-root')),
					),
			)
			const run = await fixture.refresh([], {
				environment: { CAPTURE_PRODUCER_DIRECTORY: resolve(outside.path, 'new-root') },
			})
			expect(run.code).toBe(1)
			expect(fixture.stages).toEqual([])
			expect(readdirSync(outside.path)).toEqual([])
		} finally {
			fixture.destroy()
			outside.destroy()
		}
	})

	it.runIf(supportsDirectoryLinks())(
		'refuses a redirected publication ancestor before a producer writes',
		async () => {
			const fixture = new ComposedFixture()
			const outside = createScratch({ prefix: 'capture-publication-link-' })
			try {
				fixture.write('tmp/keep.txt', 'inside')
				symlinkSync(outside.path, resolve(fixture.root, 'tmp/captures'), 'junction')
				const run = await fixture.refresh()
				expect(run.code).toBe(1)
				expect(fixture.stages).toEqual([])
				expect(readdirSync(outside.path)).toEqual([])
			} finally {
				fixture.destroy()
				outside.destroy()
			}
		},
	)
	it('publishes one receipt per producing variant from a complete capture-free journey each', async () => {
		const fixture = new ComposedFixture()
		try {
			const run = await fixture.refresh()
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			const registry = readRegistry(fixture)
			expect(registry.receipts.map((receipt) => receipt.variant)).toEqual([...VARIANTS])
			for (const receipt of registry.receipts) {
				expect(receipt.complete).toBe(true)
				expect(receipt.registry.length).toBeGreaterThan(0)
				expect(receipt.inputs).toEqual(fixture.hashes())
				expect(receipt.report.file).toMatch(
					new RegExp(`^${COMPOSED_REQUESTS}/runs/[^/]+/registry-${receipt.variant}\\.json$`, 'u'),
				)
				expect(receipt.report.digest).toBe(
					createHash('sha256').update(fixture.read(receipt.report.file)).digest('hex'),
				)
			}
			expect(readSummary(run.stdout)).toEqual({
				file: REGISTRY,
				digest: registry.digest,
				variants: [...VARIANTS],
				refreshed: [...VARIANTS],
				entries: registry.entries.length,
			})
		} finally {
			fixture.destroy()
		}
	})

	it('runs capture-free: no frame is written, no candidate or request remains', async () => {
		const fixture = new ComposedFixture()
		try {
			const run = await fixture.refresh()
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			const directory = resolve(fixture.root, COMPOSED_DIRECTORY)
			expect(readdirSync(directory).toSorted()).toEqual(['registry.json', 'runs'])
			expect(existsSync(resolve(directory, 'pages'))).toBe(false)
			expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('publishes a registry the engine reads back for a selected owner', async () => {
		const fixture = new ComposedFixture()
		try {
			const run = await fixture.refresh()
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			const read = await fixture.engine.read({ selector: 'pages:mail' })
			expect(read.registry).toBe(readRegistry(fixture).digest)
			expect(read.entries.length).toBeGreaterThan(0)
		} finally {
			fixture.destroy()
		}
	})

	it.each(REGISTRY_REFUSALS)(
		'refuses a producer that injects $fault and publishes nothing',
		async ({ fault, reason }) => {
			const fixture = new ComposedFixture()
			try {
				const run = await fixture.refresh([], { environment: { CAPTURE_PRODUCER_MODE: fault } })
				expect(run.code).toBe(1)
				expect(run.stderr).toContain(reason)
				expect(existsSync(resolve(fixture.root, REGISTRY))).toBe(false)
				expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
			} finally {
				fixture.destroy()
			}
		},
	)

	it('keeps the earlier registry bytes when a later refresh fails', async () => {
		const fixture = new ComposedFixture()
		try {
			expect((await fixture.refresh()).code).toBe(0)
			const before = fixture.read(REGISTRY)
			const run = await fixture.refresh([], {
				environment: { CAPTURE_PRODUCER_MODE: 'failed-child' },
			})
			expect(run.code).toBe(1)
			expect(fixture.read(REGISTRY).equals(before)).toBe(true)
		} finally {
			fixture.destroy()
		}
	})

	it('refreshes only the named variants and keeps the other receipts as they were', async () => {
		const fixture = new ComposedFixture()
		try {
			expect((await fixture.refresh()).code).toBe(0)
			const first = readRegistry(fixture)
			const run = await fixture.refresh(['--variant', 'dark-390'])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			const next = readRegistry(fixture)
			expect(next.receipts.map((receipt) => receipt.variant).toSorted()).toEqual(
				[...VARIANTS].toSorted(),
			)
			for (const variant of VARIANTS.filter((name) => name !== 'dark-390'))
				expect(readReceipt(next, variant)).toEqual(readReceipt(first, variant))
			expect(readReceipt(next, 'dark-390').report.file).not.toBe(
				readReceipt(first, 'dark-390').report.file,
			)
			expect(readSummary(run.stdout)).toMatchObject({
				refreshed: ['dark-390'],
				digest: next.digest,
			})
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a partial refresh whose kept receipt names an altered reporter, before any journey runs', async () => {
		const fixture = new ComposedFixture()
		try {
			expect((await fixture.refresh()).code).toBe(0)
			const before = fixture.read(REGISTRY)
			const file = readReceipt(readRegistry(fixture), 'light-1280').report.file
			fixture.write(file, `${fixture.read(file).toString('utf8')} `)
			const run = await fixture.refresh(['--variant', 'dark-390'])
			expect(run.code).toBe(1)
			expect(run.stderr).toContain(
				'Registry receipt requires an uncapped successful exit and unchanged report',
			)
			expect(run.stdout).not.toContain('registry registry-dark-390')
			expect(fixture.read(REGISTRY).equals(before)).toBe(true)
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a partial refresh beside a registry it cannot read, naming the full refresh', async () => {
		const fixture = new ComposedFixture()
		try {
			fixture.write(REGISTRY, '{"version":1}\n')
			const run = await fixture.refresh(['--variant', 'dark-390'])
			expect(run.code).toBe(1)
			expect(run.stderr).toContain('refresh every producing variant to replace it')
			expect((await fixture.refresh()).code).toBe(0)
			expect(readRegistry(fixture).receipts).toHaveLength(VARIANTS.length)
		} finally {
			fixture.destroy()
		}
	})

	it('refuses while another runner holds a request file, and prunes the file of a dead one', async () => {
		const fixture = new ComposedFixture()
		const sleeper = await startSleeper()
		try {
			const held = `${COMPOSED_REQUESTS}/journey-selection-${String(sleeper.pid)}.json`
			fixture.write(held, 'held')
			const refused = await fixture.refresh()
			expect(refused.code).toBe(1)
			expect(refused.stderr).toContain(
				`Another runner holds this workspace (process ${String(sleeper.pid)})`,
			)
			expect(existsSync(resolve(fixture.root, REGISTRY))).toBe(false)
			expect(fixture.read(held).toString('utf8')).toBe('held')
			const dead = `${COMPOSED_REQUESTS}/journey-selection-${String(await readExitedPid())}.json`
			fixture.write(dead, 'dead')
			await stopFixtureChild(sleeper)
			const accepted = await fixture.refresh()
			expect(accepted.code === 0 ? 0 : accepted.stderr).toBe(0)
			expect(existsSync(resolve(fixture.root, dead))).toBe(false)
			expect(existsSync(resolve(fixture.root, held))).toBe(false)
		} finally {
			sleeper.kill()
			fixture.destroy()
		}
	})

	it('ends the running child on an interrupt and publishes nothing', async () => {
		const fixture = new ComposedFixture()
		try {
			const before = process.listenerCount('SIGINT')
			const run = await fixture.refresh([], {
				environment: { CAPTURE_PRODUCER_MODE: 'hang' },
				interrupt: 'emit',
			})
			expect(run.code).toBe(1)
			expect(run.stderr).toContain('Runner interrupted')
			const pids = fixture.readReady()
			expect(pids).toHaveLength(2)
			await waitForCondition('the registry child and its descendant have exited', () =>
				pids.every((pid) => !isRunning(pid)),
			)
			expect(existsSync(resolve(fixture.root, REGISTRY))).toBe(false)
			expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
			expect(process.listenerCount('SIGINT')).toBe(before)
		} finally {
			fixture.destroy()
		}
	})

	it.each([['--mode', 'vue'], ['--mode=vue']])(
		'forwards the mode to the wrapper process through the recorded request',
		async (...argv) => {
			const fixture = new ComposedFixture()
			try {
				const run = await fixture.refresh(argv)
				expect(run.code === 0 ? 0 : run.stderr).toBe(0)
				const registry = readRegistry(fixture)
				const id = requireValue(
					readReceipt(registry, 'light-1280').report.file.split('/').at(3),
					'The report path names no invocation',
				)
				const record: unknown = parseJSON(
					fixture
						.read(`${COMPOSED_DIRECTORY}/runs/${id}/registry-light-1280/light-1280.json`)
						.toString('utf8'),
				)
				const args = isRecord(record) && isRecord(record.request) ? record.request.args : undefined
				expect(Array.isArray(args) ? args.slice(2, 6) : args).toEqual([
					'--config',
					resolve(fixture.root, 'fixture with spaces.config.ts'),
					'--mode',
					'vue',
				])
			} finally {
				fixture.destroy()
			}
		},
	)

	it('refuses an unknown variant and a selector as usage before it starts any journey', async () => {
		const fixture = new ComposedFixture()
		try {
			const unknown = await fixture.refresh(['--variant', 'nope'])
			expect(unknown.code).toBe(64)
			expect(unknown.stderr).toContain('--variant: received "nope"')
			const selector = await fixture.refresh(['pages:mail'])
			expect(selector.code).toBe(64)
			expect(selector.stderr).toContain('the registry command takes no selector')
			expect(existsSync(resolve(fixture.root, REGISTRY))).toBe(false)
		} finally {
			fixture.destroy()
		}
	})

	it('is constructed from values it holds', () => {
		const registrar = new CaptureRegistrar({
			root: process.cwd(),
			config: 'none.config.ts',
			requests: COMPOSED_REQUESTS,
			argv: [],
		})
		expect(registrar).toBeInstanceOf(CaptureRegistrar)
	})
})
