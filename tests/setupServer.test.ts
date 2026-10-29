import * as core from '@src/core'
import * as server from '@src/server'
import { spawn } from 'node:child_process'
import { existsSync, utimesSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { crc32, inflateSync } from 'node:zlib'
import { isArray, isRecord, parseJSON } from '@orkestrel/contract'
import {
	captureError,
	createHostileValues,
	waitForCondition,
	waitForAbort,
	waitForDelay,
} from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { createTimeout } from '@orkestrel/timeout'
import { isCaptureRun, readCaptureReport } from '@src/core'
import {
	decodeCapturePicture,
	CAPTURE_OWNER_FILE,
	readCaptureProject,
	readCaptureRequest,
	readCaptureViewport,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import { createDeclarationFixture, createRequestFixture } from './setup.js'
import {
	CAPTURE_TRANSPORT,
	writeCaptureTransport,
	prepareCaptureDiscovery,
	launchCaptureDiscovery,
	readCaptureDiscoveryAnswer,
	prepareCaptureProducer,
	launchCaptureProducer,
	readCaptureWrapperProjects,
	IntegrityFixture,
	readConsumerReport,
	CaptureConsumer,
	CAPTURE_WORKSPACE_ROOT,
	readCaptureHeld,
	requireCaptureBuild,
	importCaptureBuild,
	waitForCaptureStatus,
	stopCaptureTree,
	runCaptureOwnershipRace,
	leaveCaptureTemporary,
	countCaptureChildren,
	BEHAVIOR,
	BIN_REFUSALS,
	BOARD,
	BRAND_DRIVER,
	BRAND_ENTRIES,
	BRAND_EXPECTED,
	COMPOSED_DIRECTORY,
	COMPOSED_FIRST,
	COMPOSED_OWNERS,
	COMPOSED_PRODUCER,
	FILES,
	FIXTURE_DISCOVERY_FAULTS,
	FIXTURE_DISCOVERY_MESSAGES,
	FIXTURE_FAULTS,
	FIXTURE_FAULT_MESSAGES,
	FIXTURE_GEOMETRY,
	FIXTURE_TIMEOUT,
	UNIFORM_DECLARATIONS,
	INVALID_PICTURE_WIDTHS,
	MAIL,
	MIXED_PICTURES,
	PNG,
	QUOTED,
	READER_COMMANDS,
	READER_CONFIG,
	READER_STANDALONE,
	REGISTRY_REFUSALS,
	RUNNER_FINAL,
	RUNNER_COMMANDS,
	RUNNER_REFUSALS,
	RUNNER_REQUESTS,
	SUPPORTS_GROUP_SIGNAL,
	VARIANTS,
	WIRE_CONFIG,
	WIRE_OWNERS,
	WIRE_VARIANTS,
	createComposedWrapper,
	createProjectFixture,
	createReaderWrapper,
	createStandIn,
	createWireOptions,
	createWireRequest,
	encodeFixturePicture,
	fixtureDeclarations,
	fixtureDestinations,
	isFixtureDiscovery,
	isFixturePicture,
	isFixtureRequest,
	isFixtureWrite,
	readFixtureManifest,
	withEnvironment,
	writeFixtureDescription,
} from './setupServer.js'
describe('H1 shared infrastructure', () => {
	it('X7 round 4 stops a real detached fixture and returns false once it has exited', async () => {
		const child = spawn(
			process.execPath,
			[resolve(import.meta.dirname, 'fixtures/capture/Sleeper.ts')],
			{
				detached: true,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'ignore'],
			},
		)
		const pid = child.pid
		if (pid === undefined) throw new Error('Detached fixture has no pid')
		const stdout: string[] = []
		child.stdout.setEncoding('utf8').on('data', (text: string) => stdout.push(text))
		try {
			await waitForCondition('the detached fixture reports ready', () =>
				stdout.join('').includes('ready'),
			)
			expect(isRunning(pid)).toBe(true)
			expect(await stopCaptureTree(pid)).toBe(true)
			expect(isRunning(pid)).toBe(false)
			expect(await stopCaptureTree(pid)).toBe(false)
		} finally {
			if (isRunning(pid)) await stopCaptureTree(pid)
		}
	})
	it('X7 round 3 creates an absent scratch parent before constructing an integrity fixture', () => {
		const scratch = createScratch({ prefix: 'capture-parent-' })
		const parent = resolve(scratch.path, 'absent', 'tmp')
		try {
			expect(existsSync(parent)).toBe(false)
			const fixture = new IntegrityFixture({ core, server }, parent)
			try {
				expect(fixture.root.startsWith(parent)).toBe(true)
				expect(existsSync(resolve(fixture.root, 'src/mail/view.ts'))).toBe(true)
			} finally {
				fixture.destroy()
			}
		} finally {
			scratch.destroy()
		}
	})
	it('X7 round 3 waits for a complete status record after a partial JSON write', async () => {
		const scratch = createScratch({ prefix: 'capture-status-' })
		const file = scratch.write('status.json', '{')
		const record = { owner: process.pid, pid: process.pid, published: true }
		const complete = waitForDelay(20).then(() =>
			scratch.write('status.json', JSON.stringify(record)),
		)
		try {
			await expect(waitForCaptureStatus(file, ['owner', 'pid'])).resolves.toEqual(record)
		} finally {
			await complete
			scratch.destroy()
		}
	})
	it('X7 loads the built CaptureInvocation constructor when the build is current', async () => {
		const { CaptureInvocation } = await importCaptureBuild()
		const built = await import(
			pathToFileURL(resolve(CAPTURE_WORKSPACE_ROOT, 'dist/src/server/index.js')).href
		)
		expect(typeof CaptureInvocation).toBe('function')
		expect(CaptureInvocation).toBe(built.CaptureInvocation)
	})
	it('H1w refuses a stale consumer build before creating its workspace', () => {
		requireCaptureBuild()
		const built = resolve(CAPTURE_WORKSPACE_ROOT, 'dist/bin/main.js')
		const original = statSync(built)
		try {
			utimesSync(built, 1, 1)
			expect(() => {
				const consumer = new CaptureConsumer()
				consumer.destroy()
			}).toThrow('npm run build')
		} finally {
			utimesSync(built, original.atime, original.mtime)
		}
	})
	it(
		'H1w stops a hung consumer tree when its test signal times out',
		async () => {
			const timeout = createTimeout({ ms: 100 })
			const consumer = new CaptureConsumer(timeout.signal)
			const ready = resolve(consumer.root, 'hung-child.json')
			writeFileSync(
				resolve(consumer.root, 'journey.config.ts'),
				"import { writeFileSync } from 'node:fs'\nwriteFileSync('hung-child.json', JSON.stringify({ pid: process.pid, parent: process.ppid }))\nsetInterval(() => undefined, 1000)\nawait new Promise(() => undefined)\nexport default {}\n",
			)
			const execution = consumer.execute(['registry'])
			try {
				const record = await waitForCaptureStatus(ready, ['parent', 'pid'])
				if (
					!isRecord(record) ||
					typeof record.pid !== 'number' ||
					typeof record.parent !== 'number'
				)
					throw new Error('Missing hung child pids')
				const parent = record.parent
				const pid = record.pid
				try {
					expect(isRunning(parent)).toBe(true)
					expect(isRunning(pid)).toBe(true)
					timeout.start()
					await waitForAbort(timeout.signal)
					await waitForCondition(
						'the consumer and its hung child exit on timeout',
						() => !isRunning(parent) && !isRunning(pid),
						{ budget: 5000 },
					)
					expect(await execution).toMatchObject({ aborted: true })
				} finally {
					if (isRunning(parent)) await stopCaptureTree(parent)
					if (isRunning(pid)) await stopCaptureTree(pid)
				}
			} finally {
				await execution.catch(() => undefined)
				timeout.clear()
				consumer.destroy()
			}
		},
		FIXTURE_TIMEOUT,
	)
	it('H1v refuses a stale process fixture build and accepts a current one', () => {
		const scratch = createScratch({ prefix: 'capture-build-age-' })
		try {
			expect(() => requireCaptureBuild(scratch.path)).toThrow('npm run build')
			scratch.write('dist/bin/main.js', '')
			scratch.write('src/server/leaf.ts', '')
			utimesSync(resolve(scratch.path, 'src/server/leaf.ts'), 2, 2)
			utimesSync(resolve(scratch.path, 'dist/bin/main.js'), 1, 1)
			expect(() => requireCaptureBuild(scratch.path)).toThrow('npm run build')
			utimesSync(resolve(scratch.path, 'dist/bin/main.js'), 3, 3)
			expect(() => requireCaptureBuild(scratch.path)).not.toThrow()
		} finally {
			scratch.destroy()
		}
	})
	it(
		'H1s collects every claim and waits for all real contenders to exit',
		async () => {
			const scratch = createScratch({ prefix: 'capture-race-helper-' })
			try {
				scratch.ensure('requests')
				const outcomes = await runCaptureOwnershipRace(scratch.path, 'requests')
				expect(outcomes).toHaveLength(12)
				expect(outcomes.every((outcome) => outcome === 'released')).toBe(true)
				const pid = await leaveCaptureTemporary(scratch.path, 'requests')
				expect(scratch.read(`requests/${CAPTURE_OWNER_FILE}.${String(pid)}.crashed.tmp`)).toContain(
					'crashed-owner',
				)
			} finally {
				scratch.destroy()
			}
		},
		FIXTURE_TIMEOUT,
	)
	it('reads request holders from the explicit request directory without changing them', () => {
		const scratch = createScratch({ prefix: 'capture-held-' })
		try {
			scratch.write('requests/journey-selection-42.json', 'held')
			scratch.write('requests/journey-selection-42.json.tmp', 'pending')
			scratch.write('requests/unrelated.txt', 'other')
			scratch.write(`requests/${CAPTURE_OWNER_FILE}`, 'owner')
			scratch.write(`requests/${CAPTURE_OWNER_FILE}.42.claim.tmp`, 'temporary')
			expect(readCaptureHeld(scratch.path, 'requests').toSorted()).toEqual([
				CAPTURE_OWNER_FILE,
				`${CAPTURE_OWNER_FILE}.42.claim.tmp`,
				'journey-selection-42.json',
				'journey-selection-42.json.tmp',
			])
			expect(scratch.read('requests/journey-selection-42.json')).toBe('held')
		} finally {
			scratch.destroy()
		}
	})
	it('counts only complete child announcements across LF and CRLF', () => {
		expect(countCaptureChildren('pid=42\r\npid=43\nprefix pid=44\npid=bad\n')).toBe(2)
		expect(countCaptureChildren('')).toBe(0)
	})
})

describe('fixtureDeclarations', () => {
	it('declares the five browser cases with the files case eligible for two variants only', () => {
		expect(fixtureDeclarations('light-390').map((entry) => entry.case)).toEqual([
			MAIL,
			QUOTED,
			BOARD,
			FILES,
			BEHAVIOR,
		])
		expect(
			fixtureDeclarations('light-390')
				.filter((entry) => !entry.eligible)
				.map((entry) => entry.case),
		).toEqual([])
		expect(
			fixtureDeclarations('dark-390')
				.filter((entry) => !entry.eligible)
				.map((entry) => entry.case),
		).toEqual([FILES])
		expect(fixtureDeclarations('dark-1280').every((entry) => entry.eligible)).toBe(true)
	})

	it('declares one separate Vue case on request', () => {
		expect(fixtureDeclarations('light-390', true)).toEqual([
			{
				case: 'vue fixture home',
				owner: 'vue:home',
				variant: 'light-390',
				eligible: true,
				states: ['vue-home'],
			},
		])
	})
})

describe('fixtureDestinations', () => {
	it('maps each eligible state to its portfolio path and leaves ineligible cases out', () => {
		expect(
			fixtureDestinations(fixtureDeclarations('dark-390'))
				.map((entry) => entry.file)
				.toSorted(),
		).toEqual([
			'tmp/captures/states/examples/board-screen--dark-390.png',
			'tmp/captures/states/pages/mail-quotes--dark-390.png',
			'tmp/captures/states/pages/mail-reader--dark-390.png',
			'tmp/captures/states/pages/mail-screen--dark-390.png',
		])
	})

	it('moves the focused state to the auxiliary portfolio at the narrow viewport of its producer', () => {
		expect(
			fixtureDestinations(fixtureDeclarations('light-390')).filter(
				(entry) => entry.state === 'files-reading',
			),
		).toMatchObject([
			{
				portfolio: 'files-focused',
				variant: 'light-320',
				project: 'journey:light-390',
				file: 'tmp/captures/files-focused/files-reading--light-320.png',
			},
		])
	})

	it('maps the Vue case to its flat portfolio and refuses an owner without a part', () => {
		expect(fixtureDestinations(fixtureDeclarations('light-390', true))).toMatchObject([
			{
				portfolio: 'vue',
				project: 'vue:light-390',
				file: 'tmp/captures/vue/vue-home--light-390.png',
			},
		])
		expect(() => fixtureDestinations([createDeclarationFixture({ owner: 'pages' })])).toThrow(
			'Invalid fixture owner',
		)
	})
})

describe('isFixtureWrite', () => {
	it('accepts a complete transport with each optional field', () => {
		expect(isFixtureWrite(CAPTURE_TRANSPORT)).toBe(true)
		expect(
			isFixtureWrite({
				...CAPTURE_TRANSPORT,
				request: createRequestFixture(),
				fault: 'identity',
				population: 'partial',
				journal: 'foreign',
				ending: '\r\n',
				vue: true,
				duplicate: false,
			}),
		).toBe(true)
	})

	it.each([
		['a missing report', { ...CAPTURE_TRANSPORT, report: undefined }],
		['a non-boolean capture flag', { ...CAPTURE_TRANSPORT, capture: 'yes' }],
		['a record path that is not text', { ...CAPTURE_TRANSPORT, records: { 'light-390': 1 } }],
		['an unknown fault', { ...CAPTURE_TRANSPORT, fault: 'unknown' }],
		['an unknown population', { ...CAPTURE_TRANSPORT, population: 'everything' }],
		['an unknown journal', { ...CAPTURE_TRANSPORT, journal: 'missing' }],
		['an unknown artifact terminator', { ...CAPTURE_TRANSPORT, ending: '\r' }],
		[
			'a request without a selector',
			{ ...CAPTURE_TRANSPORT, request: { ...createRequestFixture(), selector: 1 } },
		],
		['a non-text variant', { ...CAPTURE_TRANSPORT, variants: ['light-390', 7] }],
	])('refuses %s', (_name, value) => {
		expect(isFixtureWrite(value)).toBe(false)
	})

	it('stays total over hostile values', () => {
		for (const value of createHostileValues()) {
			expect(isFixtureWrite(value)).toBe(false)
			expect(isFixtureRequest(value)).toBe(false)
		}
	})
})

describe('isFixtureRequest', () => {
	it('accepts the request fixture and refuses each field the writer reads when it is wrong', () => {
		expect(isFixtureRequest(createRequestFixture())).toBe(true)
		expect(isFixtureRequest(createRequestFixture({ case: 'inbox', state: 'inbox' }))).toBe(true)
		for (const bad of [
			{ version: 2 },
			{ id: 1 },
			{ pid: '1' },
			{ command: 'stale' },
			{ variants: 'light-390' },
			{ args: [1] },
			{ case: 1 },
		])
			expect(isFixtureRequest({ ...createRequestFixture(), ...bad })).toBe(false)
	})
})

describe('writeFixtureOutputs', { timeout: FIXTURE_TIMEOUT }, () => {
	it('writes a passing reporter, a complete final record, and the frames of every eligible state', () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			const result = writeCaptureTransport(fixture, createRequestFixture)
			expect(result).toEqual({ code: 0, signal: null })
			const report = readCaptureReport(
				parseJSON(fixture.read('tmp/out/report.json').toString('utf8')),
			)
			expect(report.assertions.map((entry) => entry.case)).toEqual([
				MAIL,
				QUOTED,
				BOARD,
				FILES,
				BEHAVIOR,
			])
			const run = parseJSON(fixture.read('tmp/out/light-390.json').toString('utf8'))
			if (!isCaptureRun(run)) throw new Error('Missing final record')
			expect(run.complete).toBe(true)
			expect(run.entries).toHaveLength(5)
			for (const entry of run.entries) expect(fixture.read(entry.file)).toEqual(PNG)
		} finally {
			fixture.destroy()
		}
	})

	it('heads a capture artifact complete once every state-placing case ran, and scoped otherwise', () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			const artifact = 'tmp/journey/runs/run-1/narrow/light-390.txt'
			for (const [request, header] of [
				[{ selector: 'all' }, 'coverage=complete'],
				[{ selector: 'pages:mail' }, 'coverage=scoped'],
				[{ selector: 'pages:mail', case: MAIL }, 'coverage=case-scoped'],
			] as const) {
				expect(
					writeCaptureTransport(fixture, createRequestFixture, {
						capture: true,
						request: createRequestFixture({ command: 'capture', args: [], ...request }),
					}),
				).toEqual({ code: 0, signal: null })
				expect(fixture.read(artifact).toString('utf8').split('\n')).toContain(header)
			}
		} finally {
			fixture.destroy()
		}
	})

	it('writes no frame when it is not capturing and none for a stale-image fault', () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			writeCaptureTransport(fixture, createRequestFixture, { capture: false })
			expect(existsSync(resolve(fixture.root, 'tmp/captures/states'))).toBe(false)
			writeCaptureTransport(fixture, createRequestFixture, { fault: 'stale-image' })
			expect(existsSync(resolve(fixture.root, 'tmp/captures/states'))).toBe(false)
		} finally {
			fixture.destroy()
		}
	})

	it('injects the record and exit faults the engine refuses', () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			const failed = writeCaptureTransport(fixture, createRequestFixture, {
				fault: 'failed-child',
			})
			expect(failed.code).toBe(7)
			writeCaptureTransport(fixture, createRequestFixture, { fault: 'invalid-record' })
			expect(fixture.read('tmp/out/light-390.json').toString('utf8')).toBe('{')
			const signal = writeCaptureTransport(fixture, createRequestFixture, { fault: 'signal' })
			expect(signal).not.toEqual({ code: 0, signal: null })
		} finally {
			fixture.destroy()
		}
	})

	it('omits the last variant record for a missing-record fault', () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			expect(
				writeCaptureTransport(fixture, createRequestFixture, {
					variants: ['light-390', 'dark-390'],
					records: { 'light-390': 'tmp/out/light.json', 'dark-390': 'tmp/out/dark.json' },
					capture: false,
					fault: 'missing-record',
				}),
			).toEqual({ code: 0, signal: null })
			expect(existsSync(resolve(fixture.root, 'tmp/out/light.json'))).toBe(true)
			expect(existsSync(resolve(fixture.root, 'tmp/out/dark.json'))).toBe(false)
		} finally {
			fixture.destroy()
		}
	})
})

describe('readFixtureManifest', { timeout: FIXTURE_TIMEOUT }, () => {
	it('answers undefined before the first capture and the exact text after it', () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			expect(readFixtureManifest(fixture.root)).toBeUndefined()
			fixture.write('tmp/captures/states/manifest.json', '{"exact":true}\n')
			expect(readFixtureManifest(fixture.root)).toBe('{"exact":true}\n')
		} finally {
			fixture.destroy()
		}
	})
})

describe('fixture fault table', () => {
	it('names a refusal for every fault the child can inject', () => {
		expect(Object.keys(FIXTURE_FAULT_MESSAGES).toSorted()).toEqual([...FIXTURE_FAULTS].toSorted())
	})
})

describe('withEnvironment', () => {
	it('sets each variable for the callback and restores a present and an absent one afterwards', async () => {
		const present = 'CAPTURE_SETUP_PRESENT'
		const absent = 'CAPTURE_SETUP_ABSENT'
		process.env[present] = 'before'
		try {
			const seen = await withEnvironment({ [present]: 'during', [absent]: 'set' }, async () => [
				process.env[present],
				process.env[absent],
			])
			expect(seen).toEqual(['during', 'set'])
			expect(process.env[present]).toBe('before')
			expect(absent in process.env).toBe(false)
		} finally {
			delete process.env[present]
		}
	})

	it('restores the environment and rethrows when the callback fails', async () => {
		const name = 'CAPTURE_SETUP_FAILURE'
		const failure = new Error('callback failed')
		await expect(
			withEnvironment({ [name]: 'during' }, async () => {
				throw failure
			}),
		).rejects.toBe(failure)
		expect(name in process.env).toBe(false)
	})
})

describe('wire fixtures', () => {
	const ARGV = ['run.ts', '--flag']

	it('builds a request every wrapper check accepts, carrying the process id and arguments given', () => {
		const scratch = createScratch({ prefix: 'wire-' })
		try {
			scratch.write('journey-selection-77.json', JSON.stringify(createWireRequest(77, ARGV)))
			expect(readCaptureRequest(createWireOptions(scratch.path, 77, ARGV))).toMatchObject({
				pid: 77,
				args: ARGV,
				config: WIRE_CONFIG,
				command: 'capture',
				selector: 'app:mail',
				variants: ['compact'],
			})
		} finally {
			scratch.destroy()
		}
	})

	it('replaces a patched field and omits a field patched to undefined', () => {
		const record = createWireRequest(77, ARGV, { selector: 'tools', stage: undefined, extra: 1 })
		expect(record).toMatchObject({ selector: 'tools', extra: 1 })
		expect('stage' in record).toBe(false)
	})

	it('names the wrapper path, owners, and variants the request fixtures validate against', () => {
		expect(createWireOptions('/workspace/requests', 5, ARGV)).toEqual({
			ppid: 5,
			argv: ARGV,
			directory: '/workspace/requests',
			config: WIRE_CONFIG,
			owners: [...WIRE_OWNERS],
			variants: [...WIRE_VARIANTS],
		})
	})

	it('builds a project configuration the runner reads, with overrides replacing and undefined omitting', () => {
		expect(readCaptureProject(createProjectFixture())).toMatchObject({
			name: 'bench:wide',
			first: 'compact',
		})
		expect(readCaptureProject(createProjectFixture({ provide: { first: 'wide' } }))).toMatchObject({
			first: 'wide',
		})
		const missing = createProjectFixture({ provide: { final: undefined } })
		expect(captureError(() => readCaptureProject(missing))).toMatchObject({ code: 'HOST' })
	})
})

describe('the runner fixtures', () => {
	it('names each command-line refusal once, with the text the runner must raise', () => {
		expect(new Set(RUNNER_REFUSALS.map((refusal) => refusal.title)).size).toBe(
			RUNNER_REFUSALS.length,
		)
		expect(RUNNER_REFUSALS.every((refusal) => refusal.message !== '')).toBe(true)
		expect(RUNNER_REFUSALS.filter((refusal) => refusal.args.length === 0)).toHaveLength(1)
		expect(RUNNER_COMMANDS).toEqual(['journey', 'capture'])
	})

	it('declares a request directory and a final case that carry what a hidden default could hide', () => {
		expect(RUNNER_REQUESTS).toBe('var/requests')
		expect(RUNNER_FINAL).toMatch(/[[\]().*+]/u)
	})

	it('reads a group signal as deliverable only off Windows', () => {
		expect(SUPPORTS_GROUP_SIGNAL).toBe(process.platform !== 'win32')
	})
})

describe('PNG', () => {
	it.each([
		{ name: 'IHDR', offset: 8, length: 13 },
		{ name: 'IDAT', offset: 33, length: 11 },
		{ name: 'IEND', offset: 56, length: 0 },
	])('carries a $name chunk whose checksum zlib agrees with', ({ name, offset, length }) => {
		expect(PNG.readUInt32BE(offset)).toBe(length)
		expect(PNG.subarray(offset + 4, offset + 8).toString('latin1')).toBe(name)
		const stored = PNG.readUInt32BE(offset + 8 + length)
		expect(crc32(PNG.subarray(offset + 4, offset + 8 + length))).toBe(stored)
	})

	it('ends at its last chunk', () => {
		expect(PNG.length).toBe(68)
	})

	it('inflates to one opaque white grey-and-alpha pixel', () => {
		expect([...inflateSync(PNG.subarray(41, 52))]).toEqual([1, 255, 255])
	})
})

describe('isFixturePicture', () => {
	it.each([true, false, MIXED_PICTURES, { 'mail-screen': { width: 1, height: 2048 } }])(
		'accepts %j',
		(value) => {
			expect(isFixturePicture(value)).toBe(true)
		},
	)

	it.each([
		{ 'mail-screen': { width: 0, height: 128 } },
		{ 'mail-screen': { width: 2049, height: 128 } },
		{ 'mail-screen': { width: 1.5, height: 128 } },
		{ 'mail-screen': { width: 128, height: 0 } },
		{ 'mail-screen': { width: 128, height: 2049 } },
		{ 'mail-screen': { width: 128 } },
		{ 'mail-screen': 3 },
		{},
		[],
		null,
		'picture',
	])('refuses %j', (value) => {
		expect(isFixturePicture(value)).toBe(false)
	})

	it('is total over hostile values', () => {
		for (const value of createHostileValues())
			expect(typeof isFixturePicture(value)).toBe('boolean')
	})

	it('is part of the transport guard', () => {
		const base = { variants: ['light-390'], report: 'r.json', records: {}, capture: true }
		expect(isFixtureWrite({ ...base, picture: MIXED_PICTURES })).toBe(true)
		expect(isFixtureWrite({ ...base, picture: { 'mail-screen': { width: 0, height: 1 } } })).toBe(
			false,
		)
	})
})

describe('encodeFixturePicture', () => {
	it('encodes a frame the decoder reads back at the requested size, above the reader floor', () => {
		const bytes = encodeFixturePicture(FIXTURE_GEOMETRY, 'mail-screen', 'light-390')
		expect(bytes.length).toBeGreaterThan(4000)
		const picture = decodeCapturePicture(bytes)
		expect([picture.width, picture.height]).toEqual([128, 128])
		expect(picture.pixels.length).toBe(128 * 128 * 3)
		const tall = decodeCapturePicture(
			encodeFixturePicture({ width: 128, height: 256 }, 'mail-screen', 'light-390'),
		)
		expect([tall.width, tall.height]).toEqual([128, 256])
	})

	it('derives its pixels from the state and the variant, so no two frames are identical', () => {
		const base = encodeFixturePicture(FIXTURE_GEOMETRY, 'mail-screen', 'light-390')
		expect(encodeFixturePicture(FIXTURE_GEOMETRY, 'mail-screen', 'light-390')).toEqual(base)
		expect(encodeFixturePicture(FIXTURE_GEOMETRY, 'mail-reader', 'light-390')).not.toEqual(base)
		expect(encodeFixturePicture(FIXTURE_GEOMETRY, 'mail-screen', 'dark-390')).not.toEqual(base)
	})
})

describe('the picture option of the producer child', { timeout: FIXTURE_TIMEOUT }, () => {
	it('writes the requested geometry per state and the default for the rest', async () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', case: MAIL, picture: MIXED_PICTURES })
			const screen = decodeCapturePicture(
				fixture.read('tmp/captures/states/pages/mail-screen--light-390.png'),
			)
			const reader = decodeCapturePicture(
				fixture.read('tmp/captures/states/pages/mail-reader--light-390.png'),
			)
			expect([screen.width, screen.height]).toEqual([128, 256])
			expect([reader.width, reader.height]).toEqual([128, 128])
		} finally {
			fixture.destroy()
		}
	})

	it('keeps the tiny default frame without a picture and for a false picture', async () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', case: MAIL })
			expect(fixture.read('tmp/captures/states/pages/mail-screen--light-390.png')).toEqual(PNG)
			await fixture.capture({ selector: 'pages:mail', case: MAIL, picture: false })
			expect(fixture.read('tmp/captures/states/pages/mail-screen--light-390.png')).toEqual(PNG)
		} finally {
			fixture.destroy()
		}
	})

	it.each(INVALID_PICTURE_WIDTHS)(
		'refuses invalid fixture pixel width %s before publication beside a valid restoration',
		async (width) => {
			const fixture = new IntegrityFixture({ core, server })
			try {
				fixture.seed()
				const anchor = fixture.read(fixture.options.registry)
				await expect(
					fixture.capture({
						selector: 'pages:mail',
						case: MAIL,
						picture: { 'mail-screen': { width, height: 128 } },
					}),
				).rejects.toThrow('Invalid private fixture transport')
				expect(readFixtureManifest(fixture.root)).toBeUndefined()
				await fixture.capture({
					selector: 'pages:mail',
					case: MAIL,
					picture: { 'mail-screen': { width: 128, height: 256 } },
				})
				const file = 'tmp/captures/states/pages/mail-screen--light-390.png'
				expect(fixture.read(file).length).toBeGreaterThan(4000)
				expect(decodeCapturePicture(fixture.read(file)).height).toBe(256)
				expect(
					(
						await fixture.engine.check({
							selector: 'pages:mail',
							case: MAIL,
							variants: ['light-390'],
						})
					).entries.every((entry) => entry.status === 'current'),
				).toBe(true)
				expect(fixture.read(fixture.options.registry)).toEqual(anchor)
			} finally {
				fixture.destroy()
			}
		},
	)

	it('refuses geometry for an undeclared fixture state without adding an output', async () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			fixture.seed()
			await expect(
				fixture.capture({
					selector: 'pages:mail',
					case: MAIL,
					picture: { 'mail-unknown': { width: 128, height: 128 } },
				}),
			).rejects.toThrow('Fixture geometry names an undeclared state')
			expect(readFixtureManifest(fixture.root)).toBeUndefined()
			expect(
				existsSync(resolve(fixture.root, 'tmp/captures/states/pages/mail-unknown--light-390.png')),
			).toBe(false)
			await fixture.capture({ selector: 'pages:mail', case: MAIL, picture: true })
			expect(
				(
					await fixture.engine.check({
						selector: 'pages:mail',
						case: MAIL,
						variants: ['light-390'],
					})
				).entries.every((entry) => entry.status === 'current'),
			).toBe(true)
		} finally {
			fixture.destroy()
		}
	})
})

describe('createReaderWrapper', () => {
	it.each(UNIFORM_DECLARATIONS)('preserves $title in every project', ({ uniform }) => {
		const wrapper = createReaderWrapper('/workspace', ['light-390'], uniform)
		const projects = readCaptureWrapperProjects(wrapper)
		if (!isRecord(projects) || !isRecord(projects.test) || !isArray(projects.test.projects))
			throw new Error('Missing projects')
		for (const project of projects.test.projects)
			expect(readCaptureProject(isRecord(project) ? project.test : undefined).uniform).toEqual(
				uniform,
			)
	})

	it('declares one project per producing variant with the host data every project shares', () => {
		const projects = readCaptureWrapperProjects(createReaderWrapper('/workspace'))
		if (!isRecord(projects) || !isRecord(projects.test) || !isArray(projects.test.projects))
			throw new Error('Missing projects')
		expect(projects.test.projects).toHaveLength(VARIANTS.length)
		const first: unknown = projects.test.projects[0]
		expect(readCaptureProject(isRecord(first) ? first.test : undefined)).toMatchObject({
			name: `journey:${VARIANTS[0]}`,
			variant: VARIANTS[0],
			first: VARIANTS[0],
			variants: [...VARIANTS],
			standalone: [READER_STANDALONE],
		})
	})

	it('declares only the producing variants it is given', () => {
		const projects = readCaptureWrapperProjects(createReaderWrapper('/workspace', ['dark-390']))
		if (!isRecord(projects) || !isRecord(projects.test) || !isArray(projects.test.projects))
			throw new Error('Missing projects')
		expect(projects.test.projects).toHaveLength(1)
		expect(READER_CONFIG).toBe('fixture with spaces.config.ts')
		expect(READER_COMMANDS).toEqual(['preflight', 'contact-sheets'])
	})
})

describe('createComposedWrapper', () => {
	it('declares one project per producing variant, each with the owner tags and the shared host data', () => {
		const text = createComposedWrapper('/workspace')
		const projects: unknown = parseJSON(text.slice('export default '.length))
		if (!isRecord(projects) || !isRecord(projects.test) || !isArray(projects.test.projects))
			throw new Error('Missing projects')
		expect(projects.test.projects).toHaveLength(VARIANTS.length)
		for (const [index, project] of projects.test.projects.entries()) {
			expect(readCaptureProject(isRecord(project) ? project.test : undefined)).toMatchObject({
				name: `journey:${VARIANTS[index]}`,
				variant: VARIANTS[index],
				first: COMPOSED_FIRST,
				variants: [...VARIANTS],
				tags: COMPOSED_OWNERS.map((owner) => `owner:${owner}`),
				directory: resolve('/workspace', COMPOSED_DIRECTORY),
			})
		}
	})

	it('declares the viewport geometry the readers read for every variant', () => {
		const text = createComposedWrapper('/workspace')
		const projects: unknown = parseJSON(text.slice('export default '.length))
		if (!isRecord(projects) || !isRecord(projects.test) || !isArray(projects.test.projects))
			throw new Error('Missing projects')
		const first: unknown = projects.test.projects[0]
		expect(readCaptureViewport(isRecord(first) ? first.test : undefined)).toEqual({
			name: VARIANTS[0],
			width: 128,
			height: 128,
		})
	})

	it('stages the variant it is given first in every project, and COMPOSED_FIRST by default', () => {
		for (const [text, expected] of [
			[createComposedWrapper('/workspace', 'dark-1280'), 'dark-1280'],
			[createComposedWrapper('/workspace'), COMPOSED_FIRST],
		] as const) {
			const projects: unknown = parseJSON(text.slice('export default '.length))
			if (!isRecord(projects) || !isRecord(projects.test) || !isArray(projects.test.projects))
				throw new Error('Missing projects')
			const firsts = projects.test.projects.map((project: unknown) =>
				isRecord(project) ? readCaptureProject(project.test).first : undefined,
			)
			expect(firsts).toEqual(VARIANTS.map(() => expected))
		}
	})
})

describe('createStandIn', () => {
	it('bakes in the primary directory only, then loads the producer by its file URL', () => {
		const text = createStandIn()
		expect(text).toContain(
			`process.env.CAPTURE_PRODUCER_DIRECTORY = ${JSON.stringify(COMPOSED_DIRECTORY)}`,
		)
		expect(text).not.toContain('CAPTURE_PRODUCER_REQUESTS')
		expect(text).toContain(`await import(${JSON.stringify(pathToFileURL(COMPOSED_PRODUCER).href)})`)
		expect(existsSync(COMPOSED_PRODUCER)).toBe(true)
	})
})
describe('the producer child of a composed workspace', { timeout: FIXTURE_TIMEOUT }, () => {
	const REQUESTS = 'tmp/requests'
	const DIRECTORY = 'tmp/captures/states'

	it('writes the reporter and the final record of the stage its parent requested, capture-free for a journey', () => {
		const scratch = createScratch({ prefix: 'producer-' })
		try {
			const { report, args } = prepareCaptureProducer(scratch, 'journey', createRequestFixture)
			const child = launchCaptureProducer(scratch, {}, args)
			expect(child.status === 0 ? 0 : child.stderr).toBe(0)
			expect(
				readCaptureReport(parseJSON(scratch.read(report) ?? '')).assertions.length,
			).toBeGreaterThan(0)
			const run: unknown = parseJSON(
				scratch.read(`${DIRECTORY}/runs/run-1/narrow/light-390.json`) ?? '',
			)
			expect(isCaptureRun(run)).toBe(true)
			expect(isCaptureRun(run) ? run.entries : undefined).toEqual([])
			expect(scratch.has('ready.json')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('writes frames for a capture and a larger picture on request', () => {
		const scratch = createScratch({ prefix: 'producer-' })
		try {
			const { args } = prepareCaptureProducer(scratch, 'capture', createRequestFixture)
			const child = launchCaptureProducer(scratch, { CAPTURE_PRODUCER_PICTURE: '1' }, args)
			expect(child.status === 0 ? 0 : child.stderr).toBe(0)
			const run: unknown = parseJSON(
				scratch.read(`${DIRECTORY}/runs/run-1/narrow/light-390.json`) ?? '',
			)
			const entries = isCaptureRun(run) ? run.entries : []
			expect(entries.length).toBeGreaterThan(0)
			for (const entry of entries) expect(scratch.has(entry.file)).toBe(true)
		} finally {
			scratch.destroy()
		}
	})

	it('injects the protocol fault the environment names', () => {
		const scratch = createScratch({ prefix: 'producer-' })
		try {
			const { args } = prepareCaptureProducer(scratch, 'journey', createRequestFixture)
			const environment = { CAPTURE_PRODUCER_MODE: 'failed-child' }
			const child = launchCaptureProducer(scratch, environment, args)
			expect(child.status).toBe(7)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a parent that wrote no request', () => {
		const scratch = createScratch({ prefix: 'producer-' })
		try {
			const child = launchCaptureProducer(scratch)
			expect(child.status).not.toBe(0)
			expect(child.stderr).toContain('journey-selection')
		} finally {
			scratch.destroy()
		}
	})

	it('reports ready and then stays alive until it is ended, in hang mode', async () => {
		const scratch = createScratch({ prefix: 'producer-' })
		const { args } = prepareCaptureProducer(scratch, 'journey', createRequestFixture)
		const child = spawn(process.execPath, [COMPOSED_PRODUCER, ...args], {
			cwd: scratch.path,
			env: {
				...process.env,
				CAPTURE_REQUESTS: resolve(scratch.path, REQUESTS),
				CAPTURE_PRODUCER_DIRECTORY: DIRECTORY,
				CAPTURE_PRODUCER_MODE: 'hang',
			},
			stdio: 'ignore',
			windowsHide: true,
		})
		try {
			const ready = await waitForCaptureStatus(resolve(scratch.path, 'ready.json'), ['pid'])
			expect(isRecord(ready) ? ready.pid : undefined).toBe(child.pid)
			expect(child.exitCode).toBeNull()
		} finally {
			child.kill()
			await waitForCondition(
				'the producer has exited',
				() => child.exitCode !== null || child.signalCode !== null,
				{
					budget: 20_000,
				},
			)
			scratch.destroy()
		}
	})
})

describe('the discovery answer of a composed workspace', { timeout: FIXTURE_TIMEOUT }, () => {
	const REQUESTS = 'tmp/requests'
	const REQUEST = { id: 'run-1', nonce: 'nonce-1', config: READER_CONFIG }

	it('writes the projects of the wrapper, unjudged, with the echoes of the request, its parent, and itself', () => {
		const scratch = createScratch({ prefix: 'discovery-' })
		try {
			const child = launchCaptureDiscovery(scratch, prepareCaptureDiscovery(scratch))
			expect(child.status === 0 ? 0 : child.stderr).toBe(0)
			const description = readCaptureDiscoveryAnswer(scratch)
			expect(description).toMatchObject({ version: 1, ...REQUEST, parent: process.pid })
			expect(isRecord(description) ? description.pid : undefined).toEqual(expect.any(Number))
			const projects = isRecord(description) ? description.projects : undefined
			expect(isArray(projects) ? projects.length : 0).toBe(VARIANTS.length)
			expect(scratch.has('ready.json')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('keeps its fault table complete: one refusal text per fault', () => {
		expect(Object.keys(FIXTURE_DISCOVERY_MESSAGES).toSorted()).toEqual(
			[...FIXTURE_DISCOVERY_FAULTS].toSorted(),
		)
	})

	it.each([
		{ fault: 'replay', field: 'nonce', expected: 'replayed' },
		{ fault: 'other-invocation', field: 'id', expected: 'foreign' },
		{ fault: 'other-config', field: 'config', expected: 'other.config.ts' },
		{ fault: 'empty', field: 'projects', expected: [] },
	])('injects the $fault fault into the $field it echoes', ({ fault, field, expected }) => {
		const scratch = createScratch({ prefix: 'discovery-' })
		try {
			const child = launchCaptureDiscovery(scratch, prepareCaptureDiscovery(scratch), fault)
			expect(child.status === 0 ? 0 : child.stderr).toBe(0)
			const description = readCaptureDiscoveryAnswer(scratch)
			expect(isRecord(description) ? description[field] : undefined).toEqual(expected)
		} finally {
			scratch.destroy()
		}
	})

	it('injects a parent that is not the process which spawned it', () => {
		const scratch = createScratch({ prefix: 'discovery-' })
		try {
			const config = prepareCaptureDiscovery(scratch)
			const child = launchCaptureDiscovery(scratch, config, 'other-parent')
			expect(child.status === 0 ? 0 : child.stderr).toBe(0)
			const written = readCaptureDiscoveryAnswer(scratch)
			expect(isRecord(written) ? written.parent : undefined).not.toBe(process.pid)
		} finally {
			scratch.destroy()
		}
	})

	it('injects a writer that is not the child the runner spawned, and keeps the real parent', () => {
		const scratch = createScratch({ prefix: 'discovery-' })
		try {
			const config = prepareCaptureDiscovery(scratch)
			const child = launchCaptureDiscovery(scratch, config, 'other-child')
			const written = readCaptureDiscoveryAnswer(scratch)
			expect(isRecord(written) ? written.pid : undefined).not.toBe(child.pid)
			expect(isRecord(written) ? written.parent : undefined).toBe(process.pid)
		} finally {
			scratch.destroy()
		}
	})

	it('exits 7 after writing the answer when it is told to fail', () => {
		const scratch = createScratch({ prefix: 'discovery-' })
		try {
			const child = launchCaptureDiscovery(scratch, prepareCaptureDiscovery(scratch), 'failed')
			expect(child.status).toBe(7)
			expect(scratch.has(`${REQUESTS}/runs/run-1/description.json`)).toBe(true)
		} finally {
			scratch.destroy()
		}
	})

	it('exits cleanly and writes nothing when it is told to stay silent', () => {
		const scratch = createScratch({ prefix: 'discovery-' })
		try {
			const child = launchCaptureDiscovery(scratch, prepareCaptureDiscovery(scratch), 'silent')
			expect(child.status === 0 ? 0 : child.stderr).toBe(0)
			expect(scratch.has(`${REQUESTS}/runs/run-1/description.json`)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
	it('writes an unreadable document when it is told to malform the answer', () => {
		const scratch = createScratch({ prefix: 'discovery-' })
		try {
			launchCaptureDiscovery(scratch, prepareCaptureDiscovery(scratch), 'malformed')
			expect(scratch.read(`${REQUESTS}/runs/run-1/description.json`)).toBe('{')
		} finally {
			scratch.destroy()
		}
	})

	it('reports ready and then stays alive until it is ended, when it is told to hang', async () => {
		const scratch = createScratch({ prefix: 'discovery-' })
		const config = prepareCaptureDiscovery(scratch)
		const child = spawn(
			process.execPath,
			[COMPOSED_PRODUCER, 'list', '--filesOnly', '--config', config],
			{
				cwd: scratch.path,
				env: {
					...process.env,
					CAPTURE_REQUESTS: resolve(scratch.path, REQUESTS),
					CAPTURE_PRODUCER_DISCOVERY: 'hang',
				},
				stdio: 'ignore',
				windowsHide: true,
			},
		)
		try {
			await waitForCaptureStatus(resolve(scratch.path, 'ready.json'), ['pid'])
			expect(child.exitCode).toBeNull()
			expect(scratch.has(`${REQUESTS}/runs/run-1/description.json`)).toBe(false)
		} finally {
			child.kill()
			await waitForCondition(
				'the producer has exited',
				() => child.exitCode !== null || child.signalCode !== null,
				{ budget: 20_000 },
			)
			scratch.destroy()
		}
	})

	it('writes through writeFixtureDescription for a wrapper that declares factories and promises', async () => {
		const scratch = createScratch({ prefix: 'discovery-' })
		try {
			const project = { test: { name: 'journey:wide' } }
			scratch.write(
				'wrapper.config.mjs',
				`export default { test: { projects: [() => (${JSON.stringify(project)}), Promise.resolve(${JSON.stringify(project)}), ${JSON.stringify(project)}] } }\n`,
			)
			await writeFixtureDescription({
				request: REQUEST,
				config: resolve(scratch.path, 'wrapper.config.mjs'),
				requests: resolve(scratch.path, REQUESTS),
			})
			const description = readCaptureDiscoveryAnswer(scratch)
			expect(isRecord(description) ? description.projects : undefined).toEqual([
				project,
				project,
				project,
			])
		} finally {
			scratch.destroy()
		}
	})

	it('reads a discovery request only when it carries a phase, an identity, and a challenge', () => {
		expect(isFixtureDiscovery({ phase: 'discover', ...REQUEST })).toBe(true)
		for (const patch of [
			{ phase: 'execute' },
			{ phase: undefined },
			{ id: 1 },
			{ nonce: undefined },
			{ config: undefined },
		])
			expect(isFixtureDiscovery({ phase: 'discover', ...REQUEST, ...patch })).toBe(false)
		for (const value of createHostileValues()) expect(isFixtureDiscovery(value)).toBe(false)
	})
})
describe('registry and executable fixtures', () => {
	it('pairs every registry refusal with a fault the producer can inject', () => {
		for (const { fault } of REGISTRY_REFUSALS) expect(FIXTURE_FAULTS).toContain(fault)
	})

	it('names the brand entries the driver loads and prints one observation per claim', () => {
		expect(BRAND_ENTRIES).toEqual({
			import: 'dist/src/core/index.js',
			require: 'dist/src/core/index.cjs',
		})
		expect(BRAND_DRIVER).toContain(BRAND_ENTRIES.import)
		expect(BRAND_DRIVER).toContain(BRAND_ENTRIES.require)
		expect(Object.keys(BRAND_EXPECTED)).toEqual([
			'distinct',
			'own',
			'copyReadsInstalled',
			'installedReadsCopy',
			'requireReadsImport',
			'importReadsRequire',
			'subclass',
			'lookAlike',
			'proxy',
			'branded',
		])
	})

	it('lists distinct executable refusals, each with text to find', () => {
		expect(new Set(BIN_REFUSALS.map((entry) => entry.title)).size).toBe(BIN_REFUSALS.length)
		expect(BIN_REFUSALS.every((entry) => entry.reason !== '')).toBe(true)
	})
})

it('reads one named consumer report through LF and CRLF output', () => {
	for (const ending of ['\n', '\r\n'])
		expect(
			readConsumerReport(['child output', 'READER {"issues":[]}', ''].join(ending), 'READER'),
		).toEqual({ issues: [] })
})

it('refuses missing, malformed, and non-record consumer reports', () => {
	for (const text of ['', 'READER {', 'READER []', 'OTHER {}'])
		expect(() => readConsumerReport(text, 'READER')).toThrow('Missing READER report')
})
