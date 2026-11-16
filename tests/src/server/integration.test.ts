import * as core from '@src/core'
import * as server from '@src/server'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { requireValue } from '@orkestrel/test'
import { isCaptureLookupJournal } from '@src/core'
import { afterAll, describe, expect, it } from 'vitest'
import {
	CAPTURE_CLOSURE_COMMANDS,
	CAPTURE_CLOSURE_CONDITIONS,
	CAPTURE_CLOSURE_DEPTH,
	CAPTURE_CLOSURE_FLAGS,
	CAPTURE_CLOSURE_ROOTS,
	CAPTURE_CLOSURE_TIMEOUT,
	CaptureClosureWorkspaces,
	buildCaptureClosureMatrix,
	classifyCaptureClosureLine,
	executeCaptureClosure,
	resolveCaptureClosureCommands,
	readCaptureIntegrityReports,
	readCaptureIntegrationStatuses,
	ComposedFixture,
	COMPOSED_DIRECTORY,
	COMPOSED_FIRST,
	FIXTURE_FAULT_MESSAGES,
	FIXTURE_TIMEOUT,
	readCaptureHeld,
	countCaptureChildren,
	downgradeCaptureFixture,
	VARIANTS,
	readFixtureManifest,
} from '../../setupServer.js'
const LOOKUPS = `${COMPOSED_DIRECTORY}/lookups.json`
// Every child the runner spawns announces its process id, so the count tells discovery's one child from an execution child.

// One workspace serves the ordered cases: the registry exists before any stage can stamp, a journey
// publishes the lookups a state selection reads, and a capture stamps the manifest the readings use.
// Vitest runs a file's cases in order, so each case starts from what the one before it left.
const fixture = new ComposedFixture({ core, server })

afterAll(() => fixture.destroy())

describe('runner over the real engine', { timeout: FIXTURE_TIMEOUT }, () => {
	it('refuses a stage before the registry exists, and starts no child', async () => {
		const run = await fixture.run('journey', ['pages:mail'])
		expect(run.code).toBe(1)
		expect(run.stderr).toContain(
			'Missing accepted registry; run the explicit complete-registry refresh',
		)
		expect(countCaptureChildren(run.stdout)).toBe(1)
		expect(readFixtureManifest(fixture.root)).toBeUndefined()
		expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
	})

	it('refreshes the registry, which the engine then reads for every producing variant', async () => {
		const run = await fixture.refresh()
		expect(run.code === 0 ? 0 : run.stderr).toBe(0)
		const read = await fixture.engine.read({ selector: 'all' })
		expect(read.entries.length).toBeGreaterThan(0)
	})

	it('runs every selected variant together and publishes lookups but stamps no frame', async () => {
		const run = await fixture.run('journey', ['all'])
		expect(run.code === 0 ? 0 : run.stderr).toBe(0)
		expect(run.stdout).toContain(`journey selected: ${VARIANTS.join(', ')}; all;`)
		expect(run.stdout).toContain('"stage":"selected"')
		expect(run.stdout).toMatch(/journey:light-390: \d+ owner-bearing passed cases/u)
		const reports = readCaptureIntegrityReports(run.stdout)
		expect(reports).toHaveLength(1)
		expect(countCaptureChildren(run.stdout)).toBe(2)
		for (const report of reports)
			expect(report).toMatchObject({ command: 'journey', stamps: 0, lookups: expect.any(Number) })
		expect(readFixtureManifest(fixture.root)).toBeUndefined()
		const journal: unknown = parseJSON(fixture.read(LOOKUPS).toString('utf8'))
		if (!isCaptureLookupJournal(journal)) throw new Error('Invalid journey lookup journal')
		expect(journal.lookups.length).toBeGreaterThan(0)
		expect(Object.keys(journal.populations)).toHaveLength(1)
		expect(journal.lookups.every((entry) => journal.populations[entry.inputs] !== undefined)).toBe(
			true,
		)
		expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
	})

	it('reads every frame of a selected owner as missing before any capture', async () => {
		const run = await fixture.run('stale', ['pages:mail'])
		expect(run.code).toBe(1)
		const statuses = readCaptureIntegrationStatuses(run.stdout)
		expect(statuses).toHaveLength(12)
		expect(new Set(statuses)).toEqual(new Set(['missing']))
	})

	it('stamps exactly the selected owner on a capture, and reads those frames as current', async () => {
		const run = await fixture.run('capture', ['pages:mail'])
		expect(run.code === 0 ? 0 : run.stderr).toBe(0)
		expect(run.stdout).toContain(`capture narrow: ${COMPOSED_FIRST}; pages:mail;`)
		const manifest: unknown = parseJSON(
			requireValue(readFixtureManifest(fixture.root), 'No manifest'),
		)
		const entries =
			isRecord(manifest) && isRecord(manifest.entries) ? Object.values(manifest.entries) : []
		expect(entries).toHaveLength(12)
		expect(new Set(entries.map((entry) => (isRecord(entry) ? entry.scope : undefined)))).toEqual(
			new Set(['pages']),
		)
		const stale = await fixture.run('stale', ['pages:mail'])
		expect(stale.code === 0 ? 0 : stale.stdout).toBe(0)
		expect(new Set(readCaptureIntegrationStatuses(stale.stdout))).toEqual(new Set(['current']))
	})

	it.each(['failed-child', 'invalid-record', 'identity', 'artifact', 'complete'] as const)(
		'leaves the manifest bytes and the request directory untouched when a capture child injects %s',
		async (fault) => {
			const before = readFixtureManifest(fixture.root)
			const run = await fixture.run('capture', ['pages:mail', '--variant', COMPOSED_FIRST], {
				environment: { CAPTURE_PRODUCER_MODE: fault },
			})
			expect(run.code).toBe(1)
			expect(run.stderr).toContain(FIXTURE_FAULT_MESSAGES[fault])
			expect(readFixtureManifest(fixture.root)).toBe(before)
			expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
		},
	)

	it('leaves the lookup journal bytes untouched when a journey child fails', async () => {
		const before = fixture.read(LOOKUPS)
		const run = await fixture.run('journey', ['pages:mail', '--variant', COMPOSED_FIRST], {
			environment: { CAPTURE_PRODUCER_MODE: 'failed-child' },
		})
		expect(run.code).toBe(1)
		expect(run.stderr).toContain(FIXTURE_FAULT_MESSAGES['failed-child'])
		expect(fixture.read(LOOKUPS).equals(before)).toBe(true)
	})

	it('refuses an unresolvable state with the exact refresh command, then captures a resolvable one', async () => {
		const refused = await fixture.run('capture', [
			'pages:mail',
			'--state',
			'no-such-state',
			'--variant',
			COMPOSED_FIRST,
		])
		expect(refused.code).toBe(64)
		expect(refused.stderr).toContain(
			`Refresh explicitly with: capture journey pages:mail --variant ${COMPOSED_FIRST}`,
		)
		expect(countCaptureChildren(refused.stdout)).toBe(1)
		const run = await fixture.run('capture', [
			'pages:mail',
			'--state',
			'mail-reader',
			'--variant',
			COMPOSED_FIRST,
		])
		expect(run.code === 0 ? 0 : run.stderr).toBe(0)
		expect(run.stdout).toContain(`capture narrow: ${COMPOSED_FIRST}; pages:mail (case-scoped);`)
	})

	it('ends the running child on an interrupt and leaves the manifest bytes untouched', async () => {
		const before = readFixtureManifest(fixture.root)
		const run = await fixture.run('capture', ['pages:mail', '--variant', COMPOSED_FIRST], {
			environment: { CAPTURE_PRODUCER_MODE: 'hang' },
			interrupt: 'emit',
		})
		expect(run.code).toBe(1)
		expect(readFixtureManifest(fixture.root)).toBe(before)
		expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
		expect(existsSync(resolve(fixture.root, 'ready.json'))).toBe(true)
	})

	it('reads the frames of an owner as stale once a source it attributes to them changes', async () => {
		// The refused captures above rewrote some frames without stamping them, and an unstamped frame
		// outranks a stale one, so a clean capture comes first.
		const capture = await fixture.run('capture', ['pages:mail'])
		expect(capture.code === 0 ? 0 : capture.stderr).toBe(0)
		fixture.write('src/mail/view.ts', '// edited after the capture\n')
		const run = await fixture.run('stale', ['pages:mail'])
		expect(run.code).toBe(1)
		expect(new Set(readCaptureIntegrationStatuses(run.stdout))).toEqual(new Set(['stale-own']))
	})
})

describe('a journeys-only workspace capture 0.0.9 wrote', { timeout: FIXTURE_TIMEOUT }, () => {
	it('names the removal and the refresh commands on each refusal, and recovers through them', async () => {
		const earlier = new ComposedFixture({ core, server })
		try {
			expect((await earlier.refresh()).code).toBe(0)
			expect((await earlier.run('journey', ['all'])).code).toBe(0)
			expect(readFixtureManifest(earlier.root)).toBeUndefined()
			downgradeCaptureFixture(earlier.root, COMPOSED_DIRECTORY)
			const registry = `${COMPOSED_DIRECTORY}/registry.json`
			const manifest = `${COMPOSED_DIRECTORY}/manifest.json`
			const refresh = 'then refresh explicitly with: capture registry, then capture frames all'
			const version = `is not version ${String(core.CAPTURE_VERSION)}, and no other version is converted`

			const stale = await earlier.run('stale', ['all'])
			expect(stale.code).toBe(1)
			expect(stale.stderr).toContain(
				`Registry version 1 at ${registry} ${version}. Remove ${registry}, ${manifest}, and ${LOOKUPS}, ${refresh}`,
			)
			expect(stale.stderr).not.toContain('Invalid accepted registry schema or digest')

			const stages = earlier.stages.length
			const refused = await earlier.refresh()
			expect(refused.code).toBe(1)
			expect(refused.stderr).toContain(
				`Lookup journal version 1 at ${LOOKUPS} ${version}. Remove ${LOOKUPS}, ${refresh}`,
			)
			expect(refused.stderr).not.toContain('inspect and repair')
			expect(earlier.stages).toHaveLength(stages)

			for (const file of [registry, manifest, LOOKUPS])
				rmSync(resolve(earlier.root, file), { force: true })
			const recovered = await earlier.refresh()
			expect(recovered.code === 0 ? 0 : recovered.stderr).toBe(0)
			const frames = await earlier.run('capture', ['all'])
			expect(frames.code === 0 ? 0 : frames.stderr).toBe(0)
			const current = await earlier.run('stale', ['all'])
			expect(current.code === 0 ? 0 : current.stdout).toBe(0)
			expect(new Set(readCaptureIntegrationStatuses(current.stdout))).toEqual(new Set(['current']))
		} finally {
			earlier.destroy()
		}
	})
})

// Each cell runs its command, follows every NEXT line it prints in order, and reruns it until it
// prints none. A cell with no first-run event shares no process state, so those cells run concurrently.
// An event cell sets the process environment and emits SIGINT to every attached runner, so those run
// one at a time.
describe('CaptureRunner recovery closure', { timeout: CAPTURE_CLOSURE_TIMEOUT }, () => {
	const matrix = buildCaptureClosureMatrix()
	const workspaces = new CaptureClosureWorkspaces({ core, server })

	afterAll(() => workspaces.destroy())

	it('runs every cell the fixture reaches, the findings cells included, and names why it skips each other cell', () => {
		const titles = matrix.cells.map((cell) => cell.title)
		const product =
			CAPTURE_CLOSURE_CONDITIONS.length *
			CAPTURE_CLOSURE_ROOTS.length *
			CAPTURE_CLOSURE_FLAGS.length *
			CAPTURE_CLOSURE_COMMANDS.length
		expect({
			cells: new Set([...titles, ...matrix.skipped.map((skip) => skip.title)]).size,
			reasons: [...new Set(matrix.skipped.map((skip) => skip.reason))].toSorted(),
		}).toEqual({
			cells: product,
			reasons: [
				'a standalone root has no stamping route, so it holds no stamp or lookup to go stale',
				'a standalone selection starts no stage child',
				'stale starts no stage child',
				'the command refuses the flag while it reads its arguments, before any child starts',
			],
		})
		expect(titles.length + matrix.skipped.length).toBe(product)
		expect(titles).toEqual(
			expect.arrayContaining([
				'interrupt in discovery, primary root: journey pages:mail',
				'interrupt in discovery, primary root: frames pages:mail',
				'absent registry, standalone root: stale vue',
				'lagging registry, standalone root: stale vue',
				'unattested variant, primary root: stale pages:mail --variant light-1280',
				'unattested variant, primary root: frames pages:mail --variant light-1280 --state mail-screen',
				'stale-own, primary root: stale pages:mail --state mail-screen',
				'stale-shared, primary root: stale pages:mail --state mail-screen',
				'absent registry, standalone root: journey vue --case vue fixture home',
				'unauthenticated registry, primary root: frames pages:mail --no-bail',
				'unparsable registry, primary root: stale pages:mail --portfolio states',
				'failed child, primary root: frames pages:mail --no-bail',
			]),
		)
	})

	describe.each([
		{ group: 'cells without a first-run event', concurrent: true },
		{ group: 'cells with a first-run event', concurrent: false },
	])('$group', ({ concurrent }) => {
		it.each(matrix.cells.filter((entry) => (entry.execution === undefined) === concurrent))(
			'$title',
			{ concurrent },
			async (cell) => {
				const workspace = await workspaces.open(cell)
				try {
					const trace = await executeCaptureClosure(workspace, cell)
					const last = requireValue(trace.steps.at(-1), 'The closure ran no step')
					// The trace rides along as text, so a red cell's diff shows every run it made.
					expect({
						repeated: trace.repeated,
						converged: last.code === 0 || last.next.length === 0,
						// Each run that did not pass prints exactly the commands the ruling gives its
						// condition, its own command with every flag after an interrupt or a failed child.
						commands: trace.steps
							.filter((step) => step.code !== 0)
							.filter(
								(step) =>
									JSON.stringify(
										step.next.map((line) => classifyCaptureClosureLine(line, cell)).toSorted(),
									) !== JSON.stringify(resolveCaptureClosureCommands(step, cell)),
							)
							.map((step) => ({ next: step.next, refusal: step.refusal })),
						// Each followed command passes, prints lines the walk follows, or refuses with a
						// condition the ruling gives no command.
						follows: trace.steps
							.flatMap((step) => step.follows)
							.filter(
								(follow) =>
									follow.code !== 0 &&
									(follow.next.length > 0
										? follow.depth === CAPTURE_CLOSURE_DEPTH
										: resolveCaptureClosureCommands(follow, cell).length > 0),
							)
							.map((follow) => follow.line),
						trace: JSON.stringify(trace),
					}).toEqual({
						repeated: false,
						converged: true,
						commands: [],
						follows: [],
						trace: expect.any(String),
					})
				} finally {
					workspace.destroy()
				}
			},
		)
	})
})
