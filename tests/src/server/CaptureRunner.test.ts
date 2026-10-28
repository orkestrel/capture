import { readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { isRunning } from '@orkestrel/test/server'
import { isCaptureRun } from '@src/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ComposedFixture } from '../../fixtures/capture/ComposedFixture.js'
import {
	readExitedPid,
	startSleeper,
	stopFixtureChild,
} from '../../fixtures/capture/ProcessFixture.js'
import {
	BOARD,
	COMPOSED_DIRECTORY,
	COMPOSED_FIRST,
	COMPOSED_OWNERS,
	FIXTURE_TIMEOUT,
	MAIL,
	QUOTED,
	READER_CLOSING,
	RUNNER_COMMANDS,
	RUNNER_REFUSALS,
	SUPPORTS_GROUP_SIGNAL,
	VARIANTS,
	readFixtureManifest,
} from '../../setupServer.js'

// A stage line is printed only when an execution child is about to start; discovery prints none.
const STAGE_LINE = /^(?:journey|capture) (?:selected|narrow|rest):/mu
const INTEGRITY = 'INTEGRITY '

function readInvocation(stdout: string): string {
	return /runs[\\/]([0-9a-f-]{36})[\\/]/u.exec(stdout)?.[1] ?? ''
}

function readRequest(fixture: ComposedFixture, stdout: string, stage: string, variant: string) {
	const record: unknown = parseJSON(
		fixture
			.read(`${COMPOSED_DIRECTORY}/runs/${readInvocation(stdout)}/${stage}/${variant}.json`)
			.toString('utf8'),
	)
	return isCaptureRun(record) ? record.request : undefined
}

function readHeld(fixture: ComposedFixture): readonly string[] {
	return readdirSync(resolve(fixture.root, fixture.requests)).filter((name) =>
		name.startsWith('journey-selection'),
	)
}

function readFilter(args: readonly string[] = []): string | undefined {
	return args[args.indexOf('--tags-filter') + 1]
}

function rmFile(fixture: ComposedFixture, file: string): void {
	rmSync(resolve(fixture.root, file), { force: true })
}

function readReceipt(fixture: ComposedFixture): unknown {
	return parseJSON(fixture.read('receipt.json').toString('utf8'))
}

function readStatuses(stdout: string): readonly unknown[] {
	const line = stdout.split('\n').find((entry) => entry.startsWith(INTEGRITY))
	const reading: unknown = parseJSON(line?.slice(INTEGRITY.length) ?? '')
	return isRecord(reading) && Array.isArray(reading.entries)
		? reading.entries.map((entry: unknown) => (isRecord(entry) ? entry.status : undefined))
		: []
}

// One seeded workspace serves the command-line and process cases that only read it: the registry
// exists before any stage can stamp, and the runner and the engine are the real ones throughout.
const base = new ComposedFixture()

beforeAll(() => base.seed(), FIXTURE_TIMEOUT)

afterAll(() => base.destroy())

// Each execution discovers a wrapper through a real child, runs real stages, and removes a scratch
// workspace, so the default five-second budget is thin on a contended host.
describe.each(RUNNER_COMMANDS)(
	'CaptureRunner %s command',
	{ timeout: FIXTURE_TIMEOUT },
	(command) => {
		const stage = command === 'journey' ? 'selected' : 'narrow'
		it.each(RUNNER_REFUSALS)(
			'refuses $title before any execution child starts',
			async (refusal) => {
				const run = await base.run(command, refusal.args)
				expect(run.code).toBe(64)
				expect(run.stdout + run.stderr).toContain(refusal.message)
				expect(run.stdout).not.toMatch(STAGE_LINE)
				expect(readHeld(base)).toEqual([])
			},
		)

		it('lists every declared owner, ancestors included, when no selector is given', async () => {
			const run = await base.run(command, [])
			expect(run.code).toBe(64)
			expect(run.stderr.split(/\r\n|\n/u)).toEqual(expect.arrayContaining([...COMPOSED_OWNERS]))
			expect(run.stderr).toContain(command === 'capture' ? 'capture frames' : 'capture journey')
		})

		it('writes the exact request, keeps a quoted case whole, tees output, and withdraws the request', async () => {
			const run = await base.run(command, [
				'pages:mail',
				'--variant',
				COMPOSED_FIRST,
				'--case',
				QUOTED,
			])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			const request = readRequest(base, run.stdout, stage, COMPOSED_FIRST)
			expect(request).toMatchObject({
				version: 1,
				stage,
				command,
				selector: 'pages:mail',
				case: QUOTED,
				variants: [COMPOSED_FIRST],
				config: base.config,
				pid: process.pid,
			})
			const args = request?.args ?? []
			expect(args.slice(args.indexOf('--project'), args.indexOf('--project') + 2)).toEqual([
				'--project',
				`journey:${COMPOSED_FIRST}`,
			])
			// The anchored pattern is read by a second mechanism, a regular expression engine, so it must
			// match each of the two names exactly and nothing that merely resembles them.
			const pattern = new RegExp(args[args.indexOf('-t') + 1] ?? '', 'u')
			expect(pattern.test(QUOTED)).toBe(true)
			expect(pattern.test(READER_CLOSING)).toBe(true)
			expect(pattern.test(`${QUOTED} extra`)).toBe(false)
			expect(pattern.test(`x${READER_CLOSING}`)).toBe(false)
			expect(run.stdout).toMatch(/^pid=\d+\n/mu)
			expect(
				base.read(`${base.requests}/runs/${readInvocation(run.stdout)}/${command}-${stage}.log`),
			).toBeDefined()
			expect(readHeld(base)).toEqual([])
			expect(readReceipt(base)).toMatchObject({ requests: resolve(base.root, base.requests) })
		})

		it('runs journeys in one selected stage and frames in narrow then rest stages', async () => {
			const run = await base.run(command, ['pages:mail'])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			const lines = run.stdout.split(/\r\n|\n/u).filter((line) => STAGE_LINE.test(line))
			expect(lines).toHaveLength(command === 'journey' ? 1 : 2)
			expect(lines[0]).toContain(
				command === 'journey'
					? `journey selected: ${VARIANTS.join(', ')};`
					: `capture narrow: ${COMPOSED_FIRST};`,
			)
			expect(
				run.stdout.split(/\r\n|\n/u).filter((line) => line.startsWith(INTEGRITY)),
			).toHaveLength(command === 'journey' ? 1 : 2)
			const requests = (command === 'journey' ? VARIANTS : []).map((variant) =>
				readRequest(base, run.stdout, 'selected', variant),
			)
			expect(
				requests.map((request) => [request?.variants, request?.args.includes('--bail=1')]),
			).toEqual(command === 'journey' ? VARIANTS.map(() => [VARIANTS, true]) : [])
			const rest = `capture rest: ${VARIANTS.filter((variant) => variant !== COMPOSED_FIRST).join(', ')};`
			expect(lines.slice(1).map((line) => line.includes(rest))).toEqual(
				command === 'journey' ? [] : [true],
			)
			for (const variant of VARIANTS)
				expect(run.stdout).toMatch(
					new RegExp(`journey:${variant}: \\d+ owner-bearing passed cases`, 'u'),
				)
		})

		it('adds no variant the caller did not select, and runs a lone non-first variant in one stage', async () => {
			const run = await base.run(command, ['pages:mail', '--variant', 'dark-390'])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			expect(run.stdout).toContain(
				`${command} ${command === 'journey' ? 'selected' : 'rest'}: dark-390;`,
			)
			expect(run.stdout).not.toContain(`${command} narrow:`)
		})

		it('selects an owner and its capture tag, and the union of declared scopes for all', async () => {
			const owner = await base.run(command, ['examples:files', '--variant', COMPOSED_FIRST])
			const all = await base.run(command, ['all', '--variant', COMPOSED_FIRST])
			const filters = [owner, all].map((run) =>
				readFilter(readRequest(base, run.stdout, stage, COMPOSED_FIRST)?.args),
			)
			expect(filters).toEqual(
				command === 'journey'
					? ['owner:examples:files', '(owner:pages || owner:examples)']
					: [
							'owner:examples:files && examples:files',
							'(owner:pages || owner:examples) && (pages || examples)',
						],
			)
		})

		it('removes the request on a failed child, runs no later stage, and exits 1', async () => {
			const run = await base.run(command, ['pages:mail'], {
				environment: { CAPTURE_PRODUCER_MODE: 'failed-child' },
			})
			expect(run.code).toBe(1)
			expect(run.stdout).toContain(`${command} ${stage}:`)
			expect(run.stdout).not.toContain(`${command} rest:`)
			expect(readHeld(base)).toEqual([])
		})

		it('exits 1 when no requested project held applicable work', async () => {
			const run = await base.run(command, [
				'examples:files',
				'--variant',
				'light-1280',
				'--variant',
				'dark-390',
			])
			expect(run.code).toBe(1)
			expect(run.stderr).toContain('Empty selected workload')
			expect(readHeld(base)).toEqual([])
		})

		it('keeps applicable variants when the first variant held no work', async () => {
			const fixture = new ComposedFixture({ first: 'light-1280' })
			try {
				fixture.seed()
				const run = await fixture.run(command, ['examples:files'])
				expect(run.code === 0 ? 0 : run.stderr).toBe(0)
				const expected =
					command === 'capture'
						? {
								present: [
									'light-1280 is inapplicable; the rest stage carries examples:files when requested',
									'capture narrow: light-1280;',
									'capture rest: dark-1280, light-390, dark-390;',
								],
								absent: [],
							}
						: { present: [`journey selected: ${VARIANTS.join(', ')};`], absent: ['rest stage'] }
				for (const text of expected.present) expect(run.stdout).toContain(text)
				for (const text of expected.absent) expect(run.stdout).not.toContain(text)
			} finally {
				fixture.destroy()
			}
		})
	},
)

describe('CaptureRunner process contract', { timeout: FIXTURE_TIMEOUT }, () => {
	it('refuses a changed plan without an accepted registry and prints the exact refresh command', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			const run = await fixture.run('journey', ['--changed', 'HEAD', '--plan'])
			expect(run.code).toBe(64)
			expect(run.stderr).toContain(
				'Missing accepted registry; run the explicit complete-registry refresh',
			)
			expect(run.stderr).toContain(`NEXT capture registry --config '${fixture.config}'`)
			expect(fixture.stages).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('prints a changed plan with exact commands and starts no execution child', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			fixture.seed()
			fixture.write('src/mail/a view.ts', '// untracked own\n')
			const run = await fixture.run('journey', [
				'--changed',
				'HEAD',
				'--plan',
				'--variant',
				COMPOSED_FIRST,
			])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			expect(fixture.stages).toEqual([])
			expect(run.stdout).toContain(
				'CHANGE {"path":"src/mail/a view.ts","classification":"own","owners":["pages:mail"]}',
			)
			expect(run.stdout).toContain(
				`COMMAND capture journey pages:mail --variant ${COMPOSED_FIRST} --config '${fixture.config}'`,
			)
			expect(run.stdout).toContain('"notrun":["pages:mail"]')
			expect(run.stdout).toContain('--plan starts no execution child')
			expect(run.stdout).not.toMatch(STAGE_LINE)
		} finally {
			fixture.destroy()
		}
	})

	it('refuses shared inputs in plans and runs, lists the paths, and prints own and full journey commands', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			fixture.seed()
			fixture.write('src/mail/view.ts', '// own\n')
			fixture.write('src/shared/theme.ts', '// shared\n')
			fixture.write('behavior/journeys.ts', '// test\n')
			for (const flags of [[], ['--plan']]) {
				const run = await fixture.run('capture', [
					'--changed',
					'HEAD',
					'--variant',
					COMPOSED_FIRST,
					...flags,
				])
				expect(run.code).toBe(64)
				expect(run.stderr).toContain('every destination reads them')
				expect(run.stderr).toContain('src/shared/theme.ts')
				expect(run.stderr).toContain('behavior/journeys.ts')
				expect(run.stdout).toContain(
					`NEXT capture frames pages:mail --variant ${COMPOSED_FIRST} --config '${fixture.config}'`,
				)
				expect(run.stdout).toContain(
					`NEXT capture journey all --variant ${COMPOSED_FIRST} --config '${fixture.config}'`,
				)
				expect(fixture.stages).toEqual([])
			}
		} finally {
			fixture.destroy()
		}
	})

	it('reports no journey input for an unchanged source tree and lists outside paths without running', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			fixture.seed()
			const unchanged = await fixture.run('journey', ['--changed', 'HEAD'])
			expect(unchanged.code).toBe(1)
			expect(unchanged.stdout).toContain('No journey input changed')
			fixture.write('outside.ts', '// outside\n')
			const outside = await fixture.run('journey', ['--changed', 'HEAD', '--plan'])
			expect(outside.code).toBe(0)
			expect(outside.stdout).toContain(
				'CHANGE {"path":"outside.ts","classification":"outside","owners":[]}',
			)
			expect(outside.stdout).toContain('No journey input changed')
			expect(fixture.stages).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('refuses unknown refs and selector-plus-changed before execution', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			fixture.seed()
			const unknown = await fixture.run('journey', ['--changed', 'missing-ref', '--plan'])
			expect(unknown.code).toBe(64)
			expect(unknown.stderr).toContain('fatal:')
			const mixed = await fixture.run('journey', ['pages:mail', '--changed', 'HEAD'])
			expect(mixed.code).toBe(64)
			expect(mixed.stderr).toContain('A selector cannot be combined with --changed')
			expect(fixture.stages).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('prints a refused plan when state lookup would refuse the ordinary frame command', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			fixture.seed()
			fixture.write('src/mail/view.ts', '// changed\n')
			const run = await fixture.run('capture', [
				'--changed',
				'HEAD',
				'--plan',
				'--state',
				'mail-reader',
				'--variant',
				COMPOSED_FIRST,
			])
			expect(run.code).toBe(64)
			expect(run.stdout).toContain('"classification":"own"')
			expect(run.stdout).toContain('COMMAND capture frames pages:mail')
			expect(fixture.stages).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('runs separate owner invocations in stable order and retains each record', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/board/view.ts', '// board\n')
			fixture.write('src/mail/view.ts', '// mail\n')
			const run = await fixture.run('journey', ['--changed', 'HEAD', '--variant', 'light-1280'])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			expect(fixture.stages.map((request) => request.selector)).toEqual([
				'examples:board',
				'pages:mail',
			])
			expect(new Set(fixture.stages.map((request) => request.id)).size).toBe(2)
			for (const request of fixture.stages) {
				expect(request.stage).toBe('selected')
				expect(request.variants).toEqual(['light-1280'])
				expect(
					isCaptureRun(
						parseJSON(
							fixture
								.read(`${COMPOSED_DIRECTORY}/runs/${request.id}/selected/light-1280.json`)
								.toString('utf8'),
						),
					),
				).toBe(true)
			}
			expect(run.stdout).toContain(
				'"passed":["examples:board","pages:mail"],"failed":[],"notrun":[]',
			)
		} finally {
			fixture.destroy()
		}
	})

	it('stops a changed run at the first red owner and names the owners not run and their exact commands', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/board/view.ts', '// board\n')
			fixture.write('src/mail/view.ts', '// mail\n')
			const run = await fixture.run('journey', ['--changed', 'HEAD', '--variant', 'light-1280'], {
				environment: { CAPTURE_PRODUCER_MODE: 'failed-child' },
			})
			expect(run.code).toBe(1)
			expect(fixture.stages.map((request) => request.selector)).toEqual(['examples:board'])
			expect(run.stdout).toContain(
				'"run":["examples:board"],"passed":[],"failed":["examples:board"],"notrun":["pages:mail"]',
			)
			expect(run.stdout).toContain('stopped at the first red owner')
			expect(run.stdout).toContain(
				`NEXT capture journey pages:mail --variant light-1280 --config '${fixture.config}'`,
			)
		} finally {
			fixture.destroy()
		}
	})

	it('keeps the narrow then rest stages when changed frames select an owner', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			fixture.seed()
			fixture.write('src/mail/view.ts', '// own\n')
			const run = await fixture.run('capture', ['--changed', 'HEAD'])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			expect(fixture.stages.map((request) => request.stage)).toEqual(['narrow', 'rest'])
			expect(fixture.stages.map((request) => request.selector)).toEqual([
				'pages:mail',
				'pages:mail',
			])
		} finally {
			fixture.destroy()
		}
	})

	it('interrupts a changed owner, stops its process tree, and leaves the next owner unrun', async () => {
		const fixture = new ComposedFixture({ committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/board/view.ts', '// board\n')
			fixture.write('src/mail/view.ts', '// mail\n')
			const run = await fixture.run('journey', ['--changed', 'HEAD', '--variant', 'light-1280'], {
				environment: { CAPTURE_PRODUCER_MODE: 'hang' },
				interrupt: 'emit',
			})
			expect(run.code).toBe(1)
			expect(fixture.stages.map((request) => request.selector)).toEqual(['examples:board'])
			expect(fixture.readReady().filter((pid) => isRunning(pid))).toEqual([])
			expect(run.stdout).toContain('"notrun":["pages:mail"],"reason":"interrupted"')
			expect(readHeld(fixture)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('removes an inherited capture variable under journey', async () => {
		const run = await base.run('journey', ['pages:mail', '--variant', COMPOSED_FIRST], {
			environment: { Capture: '1' },
		})
		expect(run.code === 0 ? 0 : run.stderr).toBe(0)
		expect(readReceipt(base)).toMatchObject({ capture: [], parent: process.pid })
	})

	it('replaces an inherited capture variable with one CAPTURE under capture', async () => {
		const run = await base.run('capture', ['pages:mail', '--variant', COMPOSED_FIRST], {
			environment: { Capture: 'old' },
		})
		expect(run.code === 0 ? 0 : run.stderr).toBe(0)
		expect(readReceipt(base)).toMatchObject({ capture: [['CAPTURE', '1']], parent: process.pid })
	})

	it('refuses journey state projection before any execution child starts', async () => {
		const run = await base.run('journey', ['pages:mail', '--state', 'mail-reader'])
		expect(run.code).toBe(64)
		expect(run.stderr).toContain("Unknown option '--state'")
		expect(run.stdout).not.toMatch(STAGE_LINE)
	})

	it('resolves a state through the real engine and selects its declaring case without widening', async () => {
		const journey = await base.run('journey', ['pages:mail', '--variant', COMPOSED_FIRST])
		expect(journey.code === 0 ? 0 : journey.stderr).toBe(0)
		const run = await base.run('capture', [
			'pages:mail',
			'--state',
			'mail-reader',
			'--variant',
			COMPOSED_FIRST,
		])
		expect(run.code === 0 ? 0 : run.stderr).toBe(0)
		expect(run.stdout).toContain(`capture narrow: ${COMPOSED_FIRST}; pages:mail (case-scoped);`)
		expect(readRequest(base, run.stdout, 'narrow', COMPOSED_FIRST)).toMatchObject({
			state: 'mail-reader',
			case: MAIL,
			variants: [COMPOSED_FIRST],
		})
	})

	it('passes an explicit case with its state so the engine can refuse a disagreement', async () => {
		const run = await base.run('capture', [
			'pages:mail',
			'--state',
			'mail-reader',
			'--case',
			BOARD,
			'--variant',
			COMPOSED_FIRST,
		])
		expect(run.code).toBe(64)
		expect(run.stderr).toContain('outside selector/case')
		expect(run.stdout).not.toMatch(STAGE_LINE)
		expect(readHeld(base)).toEqual([])
	})

	it('preserves a live runner request, prunes a dead one and its temporary file, and removes its own', async () => {
		const live = await startSleeper()
		const held = `${base.requests}/journey-selection-${String(live.pid)}`
		const dead = `${base.requests}/journey-selection-${String(await readExitedPid())}`
		try {
			base.write(`${held}.json`, 'live request bytes\n')
			base.write(`${held}.json.tmp`, 'live temporary bytes\n')
			base.write(`${dead}.json`, 'dead request bytes\n')
			base.write(`${dead}.json.tmp`, 'dead temporary bytes\n')
			const run = await base.run('journey', ['pages:mail', '--variant', COMPOSED_FIRST])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			const names = readdirSync(resolve(base.root, base.requests))
			expect(base.read(`${held}.json`).toString('utf8')).toBe('live request bytes\n')
			expect(base.read(`${held}.json.tmp`).toString('utf8')).toBe('live temporary bytes\n')
			expect(
				names.filter((name) => name.startsWith(`journey-selection-${String(process.pid)}`)),
			).toEqual([])
			const deadName = dead.slice(dead.lastIndexOf('/') + 1)
			expect(names).not.toContain(`${deadName}.json`)
			expect(names).not.toContain(`${deadName}.json.tmp`)
		} finally {
			await stopFixtureChild(live)
			for (const name of [held, dead])
				for (const suffix of ['.json', '.json.tmp']) rmFile(base, name + suffix)
		}
	})

	it('ends the recorded child and its descendant on an interrupt, withdraws the request, and restores the handlers', async () => {
		const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]
		const manifest = readFixtureManifest(base.root)
		const run = await base.run('capture', ['pages:mail', '--variant', COMPOSED_FIRST], {
			environment: { CAPTURE_PRODUCER_MODE: 'hang' },
			interrupt: 'emit',
		})
		expect(run.code).toBe(1)
		expect(run.stdout).not.toContain('capture rest:')
		const pids = base.readReady()
		expect(pids).toHaveLength(2)
		expect(pids.filter((pid) => isRunning(pid))).toEqual([])
		expect(readHeld(base)).toEqual([])
		expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before)
		expect(readFixtureManifest(base.root)).toBe(manifest)
	})

	// Windows has no signal a process group can receive, so a real signal reaches the installed
	// handler only on a POSIX host. This reading signals the runner's own process, which on POSIX runs
	// the handler instead of ending the process; the process-group reading through the built
	// executable waits for a POSIX host, and until one runs this case it is an unrun limit.
	it.runIf(SUPPORTS_GROUP_SIGNAL)(
		'ends the recorded child and its descendant on a real SIGINT',
		async () => {
			const run = await base.run('journey', ['pages:mail', '--variant', COMPOSED_FIRST], {
				environment: { CAPTURE_PRODUCER_MODE: 'hang' },
				interrupt: 'signal',
			})
			expect(run.code).toBe(1)
			expect(base.readReady().filter((pid) => isRunning(pid))).toEqual([])
			expect(readHeld(base)).toEqual([])
		},
	)
})

describe('CaptureRunner wrapper refusals', { timeout: FIXTURE_TIMEOUT }, () => {
	it('resolves a labeled-object project name and refuses an unsupported one before any execution child', async () => {
		const fixture = new ComposedFixture()
		try {
			fixture.seed()
			const labeled = await fixture.run('journey', ['pages:mail', '--variant', COMPOSED_FIRST])
			expect(labeled.code === 0 ? 0 : labeled.stderr).toBe(0)
			fixture.write(
				fixture.config,
				fixture
					.read(fixture.config)
					.toString('utf8')
					.replaceAll('"label":"journey:', '"label":42,"was":"journey:'),
			)
			const run = await fixture.run('journey', ['pages:mail', '--variant', COMPOSED_FIRST])
			expect(run.code).toBe(1)
			expect(run.stderr).toContain(
				'Unsupported journey project name: expected a string or an object with a string label',
			)
			expect(run.stdout).not.toMatch(STAGE_LINE)
			expect(readHeld(fixture)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('refuses wrapper projects that disagree on a host declaration before any execution child', async () => {
		const fixture = new ComposedFixture()
		try {
			fixture.seed()
			fixture.write(
				fixture.config,
				fixture.read(fixture.config).toString('utf8').replace(READER_CLOSING, 'closes another run'),
			)
			const run = await fixture.run('journey', ['pages:mail'])
			expect(run.code).toBe(1)
			expect(run.stderr).toContain('Host project integrity declarations disagree')
			expect(run.stdout).not.toMatch(STAGE_LINE)
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a wrapper that sits outside the repository before discovering it', async () => {
		const run = await base.run('journey', [
			'pages:mail',
			'--config',
			resolve(base.root, '..', 'outside.config.ts'),
		])
		expect(run.code).toBe(64)
		expect(run.stderr).toContain('Config must be a contained repository path')
		expect(run.stdout).toBe('')
	})

	it('refuses a wrapper that does not exist before any child starts', async () => {
		const run = await base.run('journey', ['pages:mail', '--config', 'configs/missing.config.ts'])
		expect(run.code).toBe(64)
		expect(run.stderr).toContain('Cannot find the journey wrapper')
		expect(run.stdout).toBe('')
	})

	it('refuses a wrapper that never answers, naming it, and starts no execution child', async () => {
		const run = await base.run('journey', ['pages:mail'], {
			environment: { CAPTURE_PRODUCER_DISCOVERY: 'silent' },
		})
		expect(run.code).toBe(1)
		expect(run.stderr).toContain('answered no discovery request')
		expect(run.stdout).not.toMatch(STAGE_LINE)
		expect(readHeld(base)).toEqual([])
	})

	it('refuses a wrapper whose answer is a replay of another exchange, and starts no execution child', async () => {
		const run = await base.run('journey', ['pages:mail'], {
			environment: { CAPTURE_PRODUCER_DISCOVERY: 'replay' },
		})
		expect(run.code).toBe(1)
		expect(run.stderr).toContain('answers another challenge')
		expect(run.stdout).not.toMatch(STAGE_LINE)
	})

	it('ends a wrapper that hangs at the deadline and refuses it without any execution child', async () => {
		const run = await base.run('journey', ['pages:mail'], {
			environment: { CAPTURE_PRODUCER_DISCOVERY: 'hang' },
			deadline: 1_500,
		})
		expect(run.code).toBe(1)
		expect(run.stderr).toContain('did not finish within')
		expect(run.stdout).not.toMatch(STAGE_LINE)
		expect(readHeld(base)).toEqual([])
	})
})

describe('CaptureRunner stale command', { timeout: FIXTURE_TIMEOUT }, () => {
	it('exits 0 for current frames, 1 for a noncurrent frame, and starts no execution child', async () => {
		const fixture = new ComposedFixture()
		try {
			fixture.seed()
			await fixture.capture({ variants: [...VARIANTS] })
			const current = await fixture.run('stale', ['pages:mail', '--variant', COMPOSED_FIRST])
			expect(current.code).toBe(0)
			expect(new Set(readStatuses(current.stdout))).toEqual(new Set(['current']))
			expect(current.stdout).not.toMatch(STAGE_LINE)
			fixture.write('src/mail/view.ts', '// edited after the capture\n')
			const noncurrent = await fixture.run('stale', ['pages:mail', '--variant', COMPOSED_FIRST])
			expect(noncurrent.code).toBe(1)
			expect(new Set(readStatuses(noncurrent.stdout))).toEqual(new Set(['stale-own']))
			expect(noncurrent.stdout).not.toMatch(STAGE_LINE)
		} finally {
			fixture.destroy()
		}
	})

	it('refuses an invalid reading with exit 64 and a missing selector with the usage', async () => {
		const invalid = await base.run('stale', ['pages:unknown'])
		expect(invalid.code).toBe(64)
		expect(invalid.stderr).toContain('Empty or unknown selector')
		const bare = await base.run('stale', [])
		expect(bare.code).toBe(64)
		expect(bare.stderr).toContain('capture stale <selector>')
	})

	it('refuses a wrapper-declared variant the registry never attested when the variant is omitted', async () => {
		const attested = VARIANTS.filter((variant) => variant !== 'light-1280')
		const fixture = new ComposedFixture()
		const control = new ComposedFixture()
		try {
			fixture.seed({ variants: attested })
			await fixture.capture({ variants: attested })
			control.seed()
			await control.capture({ variants: [...VARIANTS] })
			for (const args of [['examples:board'], ['examples:files', '--portfolio', 'files-focused']]) {
				const current = await control.run('stale', args)
				expect({
					args,
					code: current.code,
					failure: current.code === 0 ? undefined : current.stdout + current.stderr,
				}).toEqual({
					args,
					code: 0,
					failure: undefined,
				})
				const refused = await fixture.run('stale', args)
				expect({ args, code: refused.code, reading: refused.stdout.includes(INTEGRITY) }).toEqual({
					args,
					code: 64,
					reading: false,
				})
				expect(refused.stderr).toContain('Unattested declared variant: light-1280')
			}
			const explicit = await fixture.run('stale', ['examples:board', '--variant', COMPOSED_FIRST])
			expect({
				code: explicit.code,
				failure: explicit.code === 0 ? undefined : explicit.stdout + explicit.stderr,
			}).toEqual({
				code: 0,
				failure: undefined,
			})
		} finally {
			fixture.destroy()
			control.destroy()
		}
	})

	it('checks primary and auxiliary Files frames through the runner when the variant is omitted', async () => {
		const fixture = new ComposedFixture()
		try {
			fixture.seed({ population: 'files' })
			await fixture.capture({ population: 'files', variants: [...VARIANTS] })
			const current = await fixture.run('stale', ['examples:files'])
			expect({
				code: current.code,
				failure: current.code === 0 ? undefined : current.stdout + current.stderr,
			}).toEqual({
				code: 0,
				failure: undefined,
			})
			for (const file of [
				'tmp/captures/states/examples/files-empty--light-390.png',
				'tmp/captures/states/examples/files-empty--dark-1280.png',
				'tmp/captures/files-focused/files-reading--light-320.png',
				'tmp/captures/files-focused/files-reading--dark-320.png',
			])
				expect(current.stdout).toContain(`"file":"${file}","state"`)
			rmFile(fixture, 'tmp/captures/states/examples/files-empty--light-390.png')
			const missing = await fixture.run('stale', ['examples:files'])
			expect(missing.code).toBe(1)
			expect(missing.stdout).toContain(
				'"file":"tmp/captures/states/examples/files-empty--light-390.png","state":"files-empty","variant":"light-390","status":"missing"',
			)
			const focused = await fixture.run('stale', ['examples:files', '--portfolio', 'files-focused'])
			expect({ code: focused.code, primary: focused.stdout.includes('files-empty') }).toEqual({
				code: 0,
				primary: false,
			})
			expect((await fixture.run('stale', ['examples:board'])).code).toBe(0)
		} finally {
			fixture.destroy()
		}
	})

	it('keeps stale all to the browser scopes and reports Vue only under its own selection', async () => {
		const fixture = new ComposedFixture()
		try {
			fixture.seed()
			await fixture.capture({ variants: [...VARIANTS] })
			fixture.seed({ vue: true })
			const browser = await fixture.run('stale', ['all'])
			expect({
				code: browser.code,
				failure: browser.code === 0 ? undefined : browser.stdout + browser.stderr,
			}).toEqual({
				code: 0,
				failure: undefined,
			})
			expect(browser.stdout).toContain('files-reading--dark-320.png')
			expect(browser.stdout).not.toContain('vue-home')
			for (const args of [['vue'], ['all', '--portfolio', 'vue']]) {
				const vue = await fixture.run('stale', args)
				expect(vue.code).toBe(1)
				expect(vue.stdout).toContain(
					'"file":"tmp/captures/vue/vue-home--light-390.png","state":"vue-home","variant":"light-390","status":"unstamped"',
				)
				expect(vue.stdout).not.toContain('tmp/captures/states')
			}
		} finally {
			fixture.destroy()
		}
	})
})
