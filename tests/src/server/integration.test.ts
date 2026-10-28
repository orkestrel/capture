import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { requireValue } from '@orkestrel/test'
import { isCaptureLookupJournal } from '@src/core'
import { afterAll, describe, expect, it } from 'vitest'
import { ComposedFixture } from '../../fixtures/capture/ComposedFixture.js'
import {
	COMPOSED_DIRECTORY,
	COMPOSED_FIRST,
	COMPOSED_REQUESTS,
	FIXTURE_FAULT_MESSAGES,
	FIXTURE_TIMEOUT,
	VARIANTS,
	readFixtureManifest,
} from '../../setupServer.js'

const LOOKUPS = `${COMPOSED_DIRECTORY}/lookups.json`
const PREFIX = 'INTEGRITY '
// Every child the runner spawns announces its process id, so the count tells discovery's one child from an execution child.
const CHILD_LINE = /^pid=\d+$/gmu

function countChildren(stdout: string): number {
	return stdout.match(CHILD_LINE)?.length ?? 0
}

function readIntegrity(stdout: string): readonly unknown[] {
	return stdout
		.split('\n')
		.filter((line) => line.startsWith(PREFIX))
		.map((line) => parseJSON(line.slice(PREFIX.length)))
}

function readStatuses(stdout: string): readonly unknown[] {
	const report = requireValue(readIntegrity(stdout).at(0), 'The stale command printed no reading')
	if (!isRecord(report) || !Array.isArray(report.entries))
		throw new Error('The stale reading carries no entries')
	return report.entries.map((entry: unknown) => (isRecord(entry) ? entry.status : undefined))
}

function readHeld(fixture: ComposedFixture): readonly string[] {
	return readdirSync(resolve(fixture.root, COMPOSED_REQUESTS)).filter((name) =>
		name.startsWith('journey-selection'),
	)
}

// One workspace serves the ordered cases: the registry exists before any stage can stamp, a journey
// publishes the lookups a state selection reads, and a capture stamps the manifest the readings use.
// Vitest runs a file's cases in order, so each case starts from what the one before it left.
const fixture = new ComposedFixture()

afterAll(() => fixture.destroy())

describe('runner over the real engine', { timeout: FIXTURE_TIMEOUT }, () => {
	it('refuses a stage before the registry exists, and starts no child', async () => {
		const run = await fixture.run('journey', ['pages:mail'])
		expect(run.code).toBe(64)
		expect(run.stderr).toContain(
			'Missing accepted registry; run the explicit complete-registry refresh',
		)
		expect(countChildren(run.stdout)).toBe(1)
		expect(readFixtureManifest(fixture.root)).toBeUndefined()
		expect(readHeld(fixture)).toEqual([])
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
		const reports = readIntegrity(run.stdout)
		expect(reports).toHaveLength(1)
		expect(countChildren(run.stdout)).toBe(2)
		for (const report of reports)
			expect(report).toMatchObject({ command: 'journey', stamps: 0, lookups: expect.any(Number) })
		expect(readFixtureManifest(fixture.root)).toBeUndefined()
		const journal: unknown = parseJSON(fixture.read(LOOKUPS).toString('utf8'))
		if (!isCaptureLookupJournal(journal)) throw new Error('Invalid journey lookup journal')
		expect(journal.lookups.length).toBeGreaterThan(0)
		expect(Object.keys(journal.inputs)).toHaveLength(1)
		expect(journal.lookups.every((entry) => journal.inputs[entry.inputs] !== undefined)).toBe(true)
		expect(readHeld(fixture)).toEqual([])
	})

	it('reads every frame of a selected owner as missing before any capture', async () => {
		const run = await fixture.run('stale', ['pages:mail'])
		expect(run.code).toBe(1)
		const statuses = readStatuses(run.stdout)
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
		expect(new Set(readStatuses(stale.stdout))).toEqual(new Set(['current']))
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
			expect(readHeld(fixture)).toEqual([])
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
		expect(countChildren(refused.stdout)).toBe(1)
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
		expect(readHeld(fixture)).toEqual([])
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
		expect(new Set(readStatuses(run.stdout))).toEqual(new Set(['stale-own']))
	})
})
