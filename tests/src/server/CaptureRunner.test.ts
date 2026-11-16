import * as core from '@src/core'
import * as server from '@src/server'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { isRunning } from '@orkestrel/test/server'
import { isCaptureRun } from '@src/core'
import {
	CAPTURE_COMMAND_NAMES,
	CAPTURE_OWNER_FILE,
	CAPTURE_REFUSAL_LIMIT,
	CAPTURE_RUNS_DIRECTORY,
	createCaptureRunner,
} from '@src/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
	readCaptureChildModes,
	readCaptureInvocationId,
	readCaptureStageRequest,
	readCaptureTagFilter,
	removeCaptureFixtureFile,
	readCaptureChildReceipt,
	readCaptureRecoveries,
	readCaptureRunnerStatuses,
	ComposedFixture,
	readExitedPid,
	startSleeper,
	stopFixtureChild,
	BOARD,
	CAPTURE_DOCUMENT_FAULTS,
	CAPTURE_STALE_STATUSES,
	editCaptureFreshness,
	COMPOSED_DIRECTORY,
	COMPOSED_FIRST,
	COMPOSED_OWNERS,
	FIXTURE_TIMEOUT,
	readCaptureHeld,
	MAIL,
	QUOTED,
	READER_FINAL,
	RUNNER_COMMANDS,
	RUNNER_REFUSALS,
	SUPPORTS_GROUP_SIGNAL,
	VARIANTS,
	readFixtureManifest,
	downgradeCaptureFixture,
} from '../../setupServer.js'
// A stage line is printed only when an execution child is about to start; discovery prints none.
const STAGE_LINE = /^(?:journey|capture) (?:selected|narrow|rest):/mu
const INTEGRITY = 'INTEGRITY '

it(
	'H1v bounds a changed-owner case before plan resolution or execution',
	async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			expect((await fixture.refresh()).code).toBe(0)
			fixture.write('src/mail/view.ts', '// changed mail source\n')
			for (const command of ['journey', 'capture'] as const) {
				for (const plan of [true, false]) {
					const before = fixture.stages.length
					const run = await fixture.run(command, [
						'--changed',
						'HEAD',
						'--case',
						BOARD,
						...(plan ? ['--plan'] : []),
					])
					expect({ command, plan, code: run.code, stages: fixture.stages.length - before }).toEqual(
						{ command, plan, code: 64, stages: 0 },
					)
					expect(run.stderr).toContain('--case')
					expect(run.stderr).toContain(MAIL)
					expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
				}
			}
		} finally {
			fixture.destroy()
		}
	},
	FIXTURE_TIMEOUT,
)

it(
	'H1v scopes exact cases to the selected owner before every execution stage',
	async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			expect((await fixture.refresh()).code).toBe(0)
			for (const command of ['journey', 'capture', 'stale'] as const) {
				const before = fixture.stages.length
				const result = await fixture.run(command, ['pages:mail', '--case', BOARD])
				expect({ command, code: result.code, stages: fixture.stages.length - before }).toEqual({
					command,
					code: 64,
					stages: 0,
				})
				expect(result.stderr).toContain(BOARD)
				expect(result.stderr).toContain(MAIL)
				expect(readCaptureHeld(fixture.root)).toEqual([])
			}
			expect((await fixture.run('journey', ['pages:mail', '--case', MAIL])).code).toBe(0)
			expect(fixture.stages.length).toBeGreaterThan(0)
		} finally {
			fixture.destroy()
		}
	},
	FIXTURE_TIMEOUT,
)

it(
	'H1t refuses a case without a registry with the refresh command before any stage',
	async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			const result = await fixture.run('journey', ['pages:mail', '--case', 'no such case'])
			expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining('capture registry') })
			expect(result.stderr).toContain('Missing accepted registry')
			expect(result.stderr).not.toContain('ENOENT')
			expect(fixture.stages).toEqual([])
			expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
		} finally {
			fixture.destroy()
		}
	},
	FIXTURE_TIMEOUT,
)

it('keeps a stale evidence refusal at exit 1', async () => {
	const fixture = new ComposedFixture({ core, server })
	try {
		const run = await fixture.run('stale', ['all'])
		expect(run.code).toBe(1)
		expect(run.stderr).toContain('Missing accepted registry')
	} finally {
		fixture.destroy()
	}
})

it(
	'H1r maps selector errors to usage in every runner command and Git failures to exit 1',
	async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			expect((await fixture.refresh()).code).toBe(0)
			for (const command of ['stale', 'journey', 'capture'] as const) {
				const run = await fixture.run(command, ['missing'])
				expect({ command, code: run.code, stderr: run.stderr }).toMatchObject({
					command,
					code: 64,
					stderr: expect.stringContaining('selector: received "missing"'),
				})
			}
			for (const command of ['journey', 'capture'] as const) {
				const run = await fixture.run(command, ['--changed', 'missing-ref', '--plan'])
				expect({ command, code: run.code, stderr: run.stderr }).toMatchObject({
					command,
					code: 1,
					stderr: expect.stringContaining('Git read failed'),
				})
			}
		} finally {
			fixture.destroy()
		}
	},
	FIXTURE_TIMEOUT,
)

// One seeded workspace serves the command-line and process cases that only read it: the registry
// exists before any stage can stamp, and the runner and the engine are the real ones throughout.
const base = new ComposedFixture({ core, server })

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
				expect(readCaptureHeld(base.root, base.requests)).toEqual([])
			},
		)

		it('lists every declared owner, ancestors included, when no selector is given', async () => {
			const run = await base.run(command, [])
			expect(run.code).toBe(64)
			for (const owner of COMPOSED_OWNERS) expect(run.stderr).toContain(JSON.stringify(owner))
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
			const request = readCaptureStageRequest(base, run.stdout, stage, COMPOSED_FIRST)
			expect(request).toMatchObject({
				version: core.CAPTURE_VERSION,
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
			expect(pattern.test(READER_FINAL)).toBe(true)
			expect(pattern.test(`${QUOTED} extra`)).toBe(false)
			expect(pattern.test(`x${READER_FINAL}`)).toBe(false)
			expect(run.stdout).toMatch(/^pid=\d+\n/mu)
			const id = readCaptureInvocationId(run.stdout)
			expect(base.read(`${base.requests}/runs/${id}/${command}-${stage}.log`)).toBeDefined()
			expect(readCaptureHeld(base.root, base.requests)).toEqual([])
			expect(readCaptureChildReceipt(base)).toMatchObject({
				requests: resolve(base.root, base.requests),
			})
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
				readCaptureStageRequest(base, run.stdout, 'selected', variant),
			)
			expect(
				requests.map((request) => [request?.variants, request?.args.includes('--bail=1')]),
			).toEqual(command === 'journey' ? VARIANTS.map(() => [VARIANTS, true]) : [])
			const id = readCaptureInvocationId(run.stdout)
			expect(
				requests.map((request) => request?.args.filter((arg) => arg.includes('progress'))),
			).toEqual(
				requests.map(() => [
					`--outputFile.progress=${resolve(base.root, base.requests, 'runs', id, 'selected.progress.jsonl')}`,
				]),
			)
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

		it('runs every selected case under --no-bail and names the stage progress file in the request', async () => {
			const run = await base.run(command, ['pages:mail', '--variant', COMPOSED_FIRST, '--no-bail'])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			const args = readCaptureStageRequest(base, run.stdout, stage, COMPOSED_FIRST)?.args ?? []
			expect(args.filter((arg) => arg.startsWith('--bail'))).toEqual([])
			expect(args).toContain(
				`--outputFile.progress=${resolve(base.root, base.requests, 'runs', readCaptureInvocationId(run.stdout), `${stage}.progress.jsonl`)}`,
			)
			expect(run.stdout).toContain(`NEXT capture journey all --variant ${COMPOSED_FIRST} --config`)
		})

		it('selects an owner and its capture tag, and the union of declared scopes for all', async () => {
			const owner = await base.run(command, ['examples:files', '--variant', COMPOSED_FIRST])
			const all = await base.run(command, ['all', '--variant', COMPOSED_FIRST])
			const filters = [owner, all].map((run) => {
				const request = readCaptureStageRequest(base, run.stdout, stage, COMPOSED_FIRST)
				return readCaptureTagFilter(request?.args)
			})
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
			expect(readCaptureHeld(base.root, base.requests)).toEqual([])
		})

		it('prints the failed stage status and the owner command after a failed child', async () => {
			const run = await base.run(command, ['pages:mail'], {
				environment: { CAPTURE_PRODUCER_MODE: 'failed-child' },
			})
			const id = readCaptureInvocationId(run.stdout)
			const name = CAPTURE_COMMAND_NAMES[command]
			const report = resolve(base.root, base.requests, CAPTURE_RUNS_DIRECTORY, id)
			const status = {
				selector: 'pages:mail',
				run: [stage],
				passed: [],
				failed: [stage],
				notrun: command === 'journey' ? [] : ['rest'],
				reason: 'stage failed; no later stage ran',
			}
			// Each child prints its own process id, so only the line's position is fixed.
			expect({
				code: run.code,
				stdout: run.stdout.replaceAll(/^pid=\d+$/gmu, 'pid=CHILD'),
				stderr: run.stderr,
			}).toEqual({
				code: 1,
				stdout: [
					'pid=CHILD',
					`${command} ${stage}: ${command === 'journey' ? VARIANTS.join(', ') : COMPOSED_FIRST}; pages:mail; report=${resolve(report, `${command}-${stage}.json`)}; records=${COMPOSED_DIRECTORY}/${CAPTURE_RUNS_DIRECTORY}/${id}/${stage}/<variant>.json`,
					'pid=CHILD',
					`STAGES ${JSON.stringify(status)}`,
					`NEXT capture ${name} pages:mail --config '${base.config}'`,
					'',
				].join('\n'),
				stderr: `Capture stage child did not exit successfully\nExecution stopped after stages: ${stage}; no later stage ran.\n`,
			})
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
			// Rerunning the same selection holds the same empty workload, so no line names it.
			expect(readCaptureRecoveries(run)).toEqual({ code: 1, stdout: [], stderr: [] })
			expect(readCaptureHeld(base.root, base.requests)).toEqual([])
		})

		it('keeps applicable variants when the first variant held no work', async () => {
			const fixture = new ComposedFixture({ core, server }, { first: 'light-1280' })
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
	it('H1s retains a declared focused output variant through stale', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ variants: [...VARIANTS] })
			const result = await fixture.run('stale', ['examples:files', '--variant', 'light-320'])
			expect(result.code === 0 ? 0 : result.stderr).toBe(0)
			expect(result.stdout).toContain('files-reading--light-320.png')
		} finally {
			fixture.destroy()
		}
	})
	it('H1s keeps the decided usage exit when release fails', async () => {
		const fixture = new ComposedFixture({ core, server })
		const errors: string[] = []
		try {
			const code = await createCaptureRunner({
				command: 'journey',
				root: fixture.root,
				requests: fixture.requests,
				config: fixture.config,
				argv: ['missing'],
				stdout: () => undefined,
				stderr: (text) => {
					errors.push(text)
					if (text.includes('selector: received')) {
						const marker = resolve(fixture.root, fixture.requests, CAPTURE_OWNER_FILE)
						rmSync(marker)
						mkdirSync(marker)
					}
				},
			}).execute()
			expect(code).toBe(64)
			expect(errors.join('')).toContain('Capture cleanup failed')
		} finally {
			fixture.destroy()
		}
	})
	it('H1s treats a plan-derived owner missing from wrapper tags as HOST', async () => {
		const options = { committed: true, config: 'outside.config.ts' }
		const fixture = new ComposedFixture({ core, server }, options)
		try {
			fixture.seed()
			fixture.write(
				fixture.config,
				fixture
					.read(fixture.config)
					.toString('utf8')
					.replaceAll('owner:pages:mail', 'owner:pages:other'),
			)
			fixture.write('src/mail/view.ts', '// changed own input\n')
			const result = await fixture.run('journey', ['--changed', 'HEAD', '--plan'])
			expect(result.stderr).toContain('Unknown owner')
			expect(result.code).toBe(1)
		} finally {
			fixture.destroy()
		}
	})
	it('H1s caps the usage selector list with a remainder count', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			const owners = Array.from(
				{ length: CAPTURE_REFUSAL_LIMIT + 3 },
				(_, index) => `owner:pages:item-${String(index)}`,
			)
			fixture.write(
				fixture.config,
				fixture
					.read(fixture.config)
					.toString('utf8')
					.replaceAll(
						'"tags":[',
						`"tags":[${owners.map((name) => JSON.stringify({ name })).join(',')},`,
					),
			)
			const usage = await fixture.run('journey', [])
			expect(usage.code).toBe(64)
			expect(usage.stderr).toContain('more')
			expect(usage.stderr).not.toContain('pages:item-9')
		} finally {
			fixture.destroy()
		}
	})
	it('H1s caps shared-input paths with a remainder count', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed()
			for (const index of Array.from({ length: CAPTURE_REFUSAL_LIMIT + 3 }, (_, value) => value))
				fixture.write(`src/shared/input-${String(index)}.ts`, '// shared\n')
			const shared = await fixture.run('journey', ['--changed', 'HEAD', '--plan'])
			expect(shared.stderr).toContain('more')
			expect(shared.stderr).not.toContain('src/shared/input-9.ts')
		} finally {
			fixture.destroy()
		}
	})
	it('refuses a changed plan without an accepted registry and prints the exact refresh command', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			const run = await fixture.run('journey', ['--changed', 'HEAD', '--plan'])
			expect(run.code).toBe(1)
			expect(run.stderr).toContain(
				'Missing accepted registry; run the explicit complete-registry refresh',
			)
			expect(run.stderr.split('\n').filter((line) => line.startsWith('NEXT '))).toEqual([
				`NEXT capture registry --config '${fixture.config}'`,
			])
			expect(fixture.stages).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('prints a changed plan with exact commands and starts no execution child', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
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
		const fixture = new ComposedFixture({ core, server }, { committed: true })
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
		const fixture = new ComposedFixture({ core, server }, { committed: true })
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
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed()
			const unknown = await fixture.run('journey', ['--changed', 'missing-ref', '--plan'])
			expect(unknown.code).toBe(1)
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
		const fixture = new ComposedFixture({ core, server }, { committed: true })
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
			expect(run.code).toBe(1)
			expect(run.stdout).toContain('"classification":"own"')
			expect(run.stdout).toContain('COMMAND capture frames pages:mail')
			expect(fixture.stages).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('runs separate owner invocations in stable order and retains each record', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
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
		const fixture = new ComposedFixture({ core, server }, { committed: true })
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
		const fixture = new ComposedFixture({ core, server }, { committed: true })
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
		const fixture = new ComposedFixture({ core, server }, { committed: true })
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
			expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('removes an inherited capture variable under journey', async () => {
		const run = await base.run('journey', ['pages:mail', '--variant', COMPOSED_FIRST], {
			environment: { Capture: '1' },
		})
		expect(run.code === 0 ? 0 : run.stderr).toBe(0)
		expect(readCaptureChildReceipt(base)).toMatchObject({ capture: [], parent: process.pid })
	})

	it('replaces an inherited capture variable with one CAPTURE under capture', async () => {
		const run = await base.run('capture', ['pages:mail', '--variant', COMPOSED_FIRST], {
			environment: { Capture: 'old' },
		})
		expect(run.code === 0 ? 0 : run.stderr).toBe(0)
		expect(readCaptureChildReceipt(base)).toMatchObject({
			capture: [['CAPTURE', '1']],
			parent: process.pid,
		})
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
		expect(readCaptureStageRequest(base, run.stdout, 'narrow', COMPOSED_FIRST)).toMatchObject({
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
		expect(run.stderr).toContain('Unknown case; --case:')
		expect(run.stdout).not.toMatch(STAGE_LINE)
		expect(readCaptureHeld(base.root, base.requests)).toEqual([])
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
				for (const suffix of ['.json', '.json.tmp']) removeCaptureFixtureFile(base, name + suffix)
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
		expect(readCaptureHeld(base.root, base.requests)).toEqual([])
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
			expect(readCaptureHeld(base.root, base.requests)).toEqual([])
		},
	)

	it.each([
		{ argv: ['--mode', 'vue'], mode: 'vue' },
		{ argv: ['--mode=vue'], mode: 'vue' },
		{ argv: [], mode: 'test' },
	])('hands mode $mode from $argv to the discovery child and each execution child', async (row) => {
		const fixture = new ComposedFixture({ core, server })
		try {
			fixture.seed()
			const before = readCaptureChildModes(fixture).length
			const prior = fixture.stages.length
			const run = await fixture.run('journey', ['pages:mail', ...row.argv])
			expect(run.code === 0 ? 0 : run.stderr).toBe(0)
			const modes = readCaptureChildModes(fixture).slice(before)
			expect(modes.filter((child) => child.phase === 'discovery')).toEqual([
				{ phase: 'discovery', mode: row.mode },
			])
			const stages = modes.filter((child) => child.phase === 'stage')
			expect(stages).toHaveLength(fixture.stages.length - prior)
			expect(stages.length).toBeGreaterThan(0)
			for (const child of stages) expect(child.mode).toBe(row.mode)
		} finally {
			fixture.destroy()
		}
	})

	it.each([
		{ argv: ['--mode', 'vue'], mode: 'vue' },
		{ argv: [], mode: 'test' },
	])('hands mode $mode from $argv to the discovery child of stale', async (row) => {
		const fixture = new ComposedFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ variants: [...VARIANTS] })
			const before = readCaptureChildModes(fixture).length
			const run = await fixture.run('stale', [
				'pages:mail',
				'--variant',
				COMPOSED_FIRST,
				...row.argv,
			])
			expect(run.code).toBe(0)
			expect(readCaptureChildModes(fixture).slice(before)).toEqual([
				{ phase: 'discovery', mode: row.mode },
			])
		} finally {
			fixture.destroy()
		}
	})
})

describe('CaptureRunner wrapper refusals', { timeout: FIXTURE_TIMEOUT }, () => {
	it('resolves a labeled-object project name and refuses an unsupported one before any execution child', async () => {
		const fixture = new ComposedFixture({ core, server })
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
			expect(readCaptureHeld(fixture.root, fixture.requests)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('refuses wrapper projects that disagree on a host declaration before any execution child', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			fixture.seed()
			fixture.write(
				fixture.config,
				fixture.read(fixture.config).toString('utf8').replace(READER_FINAL, 'closes another run'),
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
		expect(run.stderr).toContain('--config resolves outside the repository')
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
		expect(readCaptureHeld(base.root, base.requests)).toEqual([])
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
		expect(readCaptureHeld(base.root, base.requests)).toEqual([])
	})
})

describe('CaptureRunner stale command', { timeout: FIXTURE_TIMEOUT }, () => {
	it('exits 0 for current frames, 1 for a noncurrent frame, and starts no execution child', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ variants: [...VARIANTS] })
			const current = await fixture.run('stale', ['pages:mail', '--variant', COMPOSED_FIRST])
			expect(current.code).toBe(0)
			expect(new Set(readCaptureRunnerStatuses(current.stdout))).toEqual(new Set(['current']))
			expect(current.stdout).not.toMatch(STAGE_LINE)
			fixture.write('src/mail/view.ts', '// edited after the capture\n')
			const noncurrent = await fixture.run('stale', ['pages:mail', '--variant', COMPOSED_FIRST])
			expect(noncurrent.code).toBe(1)
			const statuses = readCaptureRunnerStatuses(noncurrent.stdout)
			expect(new Set(statuses)).toEqual(new Set(['stale-own']))
			expect(noncurrent.stdout).not.toMatch(STAGE_LINE)
		} finally {
			fixture.destroy()
		}
	})

	it('refuses an invalid selector with exit 64 and a missing selector with the usage', async () => {
		const invalid = await base.run('stale', ['pages:unknown'])
		expect(invalid.code).toBe(64)
		expect(invalid.stderr).toContain('selector: received')
		const bare = await base.run('stale', [])
		expect(bare.code).toBe(64)
		expect(bare.stderr).toContain('capture stale <selector>')
	})

	it('refuses a wrapper-declared variant the registry never attested when the variant is omitted', async () => {
		const attested = VARIANTS.filter((variant) => variant !== 'light-1280')
		const fixture = new ComposedFixture({ core, server })
		const control = new ComposedFixture({ core, server })
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
				expect({ args, code: refused.code, reported: refused.stdout.includes(INTEGRITY) }).toEqual({
					args,
					code: 1,
					reported: false,
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
		const fixture = new ComposedFixture({ core, server })
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
			removeCaptureFixtureFile(fixture, 'tmp/captures/states/examples/files-empty--light-390.png')
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
		const fixture = new ComposedFixture({ core, server })
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

// Each row reads every NEXT line of one runner outcome on both streams; the version refusals are
// read in the following describe block.
describe('CaptureRunner NEXT lines', { timeout: FIXTURE_TIMEOUT }, () => {
	const config = `--config '${base.config}'`
	const flags = `--variant light-1280 ${config}`

	it('prints no NEXT line after a usage refusal', async () => {
		expect(readCaptureRecoveries(await base.run('journey', ['missing']))).toEqual({
			code: 64,
			stdout: [],
			stderr: [],
		})
	})

	it('prints no NEXT line on either stream after a refused changed selection under HOST', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed()
			const run = await fixture.run('journey', ['--changed', 'missing-ref'])
			expect(run.stderr).toContain('Git read failed')
			expect(readCaptureRecoveries(run)).toEqual({ code: 1, stdout: [], stderr: [] })
		} finally {
			fixture.destroy()
		}
	})

	it('prints the owner command on stdout after a failed stage in a single run', async () => {
		const run = await base.run('capture', ['pages:mail'], {
			environment: { CAPTURE_PRODUCER_MODE: 'failed-child' },
		})
		expect(readCaptureRecoveries(run)).toEqual({
			code: 1,
			stdout: [`NEXT capture frames pages:mail ${config}`],
			stderr: [],
		})
	})

	it('prints the complete journey with the run variant on stdout after a passing single run', async () => {
		const run = await base.run('journey', ['pages:mail', '--variant', COMPOSED_FIRST])
		expect(readCaptureRecoveries(run)).toEqual({
			code: 0,
			stdout: [`NEXT capture journey all --variant ${COMPOSED_FIRST} ${config}`],
			stderr: [],
		})
	})

	it('prints no NEXT line after a passing complete journey, whose closing command is itself', async () => {
		expect(readCaptureRecoveries(await base.run('journey', ['all']))).toEqual({
			code: 0,
			stdout: [],
			stderr: [],
		})
	})

	it('prints a failed owner command once on stdout after a changed run with one failed owner', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/mail/view.ts', '// mail\n')
			const run = await fixture.run('journey', ['--changed', 'HEAD', '--variant', 'light-1280'], {
				environment: { CAPTURE_PRODUCER_MODE: 'failed-child' },
			})
			expect(readCaptureRecoveries(run)).toEqual({
				code: 1,
				stdout: [`NEXT capture journey pages:mail ${flags}`],
				stderr: [],
			})
		} finally {
			fixture.destroy()
		}
	})

	it('prints the failed then the unrun owner command once each on stdout after a changed run with two owners', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/board/view.ts', '// board\n')
			fixture.write('src/mail/view.ts', '// mail\n')
			const run = await fixture.run('journey', ['--changed', 'HEAD', '--variant', 'light-1280'], {
				environment: { CAPTURE_PRODUCER_MODE: 'failed-child' },
			})
			expect(readCaptureRecoveries(run)).toEqual({
				code: 1,
				stdout: [
					`NEXT capture journey examples:board ${flags}`,
					`NEXT capture journey pages:mail ${flags}`,
				],
				stderr: [],
			})
		} finally {
			fixture.destroy()
		}
	})

	it('prints only the failed owner command on stdout when an earlier owner of a changed run passed', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/board/view.ts', '// board\n')
			fixture.write('src/mail/view.ts', '// mail\n')
			const stdout: string[] = []
			const stderr: string[] = []
			const code = await createCaptureRunner({
				command: 'journey',
				root: fixture.root,
				config: fixture.config,
				requests: fixture.requests,
				argv: ['--changed', 'HEAD', '--variant', 'light-1280'],
				stdout: (text) => {
					stdout.push(text)
					// The first owner has passed; an unreadable manifest refuses the next owner's stage.
					if (text.startsWith('STAGES ') && text.includes('"selector":"examples:board"'))
						fixture.write(`${COMPOSED_DIRECTORY}/manifest.json`, '{')
				},
				stderr: (text) => stderr.push(text),
			}).execute()
			expect(stdout.join('')).toContain('"passed":["examples:board"],"failed":["pages:mail"]')
			expect(
				readCaptureRecoveries({ code, stdout: stdout.join(''), stderr: stderr.join('') }),
			).toEqual({
				code: 1,
				stdout: [`NEXT capture journey pages:mail ${flags}`],
				stderr: [],
			})
		} finally {
			fixture.destroy()
		}
	})

	it('prints the complete journey with the run flags once on stdout after a passing changed run', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/board/view.ts', '// board\n')
			fixture.write('src/mail/view.ts', '// mail\n')
			const run = await fixture.run('journey', ['--changed', 'HEAD', '--variant', 'light-1280'])
			expect(readCaptureRecoveries(run)).toEqual({
				code: 0,
				stdout: [`NEXT capture journey all ${flags}`],
				stderr: [],
			})
		} finally {
			fixture.destroy()
		}
	})

	it('prints the complete journey on stdout when no journey input changed', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed()
			const run = await fixture.run('journey', ['--changed', 'HEAD'])
			expect(run.stdout).toContain('No journey input changed')
			expect(readCaptureRecoveries(run)).toEqual({
				code: 1,
				stdout: [`NEXT capture journey all ${config}`],
				stderr: [],
			})
		} finally {
			fixture.destroy()
		}
	})

	it('prints each owner command once on stdout for a changed plan', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/board/view.ts', '// board\n')
			fixture.write('src/mail/view.ts', '// mail\n')
			const run = await fixture.run('journey', [
				'--changed',
				'HEAD',
				'--plan',
				'--variant',
				'light-1280',
			])
			expect(readCaptureRecoveries(run)).toEqual({
				code: 0,
				stdout: [
					`NEXT capture journey examples:board ${flags}`,
					`NEXT capture journey pages:mail ${flags}`,
				],
				stderr: [],
			})
		} finally {
			fixture.destroy()
		}
	})

	it('prints each owner command then the complete journey on stdout after a shared-input refusal', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed()
			fixture.write('src/mail/view.ts', '// own\n')
			fixture.write('src/shared/theme.ts', '// shared\n')
			const run = await fixture.run('journey', ['--changed', 'HEAD', '--variant', 'light-1280'])
			expect(readCaptureRecoveries(run)).toEqual({
				code: 64,
				stdout: [`NEXT capture journey pages:mail ${flags}`, `NEXT capture journey all ${flags}`],
				stderr: [],
			})
		} finally {
			fixture.destroy()
		}
	})
})

// Each row reads the NEXT lines of a refusal whose condition has a clearing command, runs that
// command, and reruns the refused invocation; the control reruns it with no refresh in between.
describe('CaptureRunner recoveries', { timeout: FIXTURE_TIMEOUT }, () => {
	const config = `--config '${base.config}'`
	const registry = `NEXT capture registry ${config}`

	it.each(RUNNER_COMMANDS)(
		'prints the registry refresh on stdout when %s finds no registry, and the refresh clears it',
		async (command) => {
			const fixture = new ComposedFixture({ core, server })
			try {
				const first = await fixture.run(command, ['pages:mail'])
				const control = await fixture.run(command, ['pages:mail'])
				expect(readCaptureRecoveries(first)).toEqual({ code: 1, stdout: [registry], stderr: [] })
				expect([control.stderr, readCaptureRecoveries(control)]).toEqual([
					first.stderr,
					readCaptureRecoveries(first),
				])
				expect((await fixture.refresh()).code).toBe(0)
				const rerun = await fixture.run(command, ['pages:mail'])
				expect(rerun.code === 0 ? 0 : rerun.stderr).toBe(0)
			} finally {
				fixture.destroy()
			}
		},
	)

	it('prints the registry refresh on stderr when stale finds no registry, and the refresh clears it', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			const first = await fixture.run('stale', ['pages:mail'])
			const control = await fixture.run('stale', ['pages:mail'])
			expect(readCaptureRecoveries(first)).toEqual({ code: 1, stdout: [], stderr: [registry] })
			expect([control.stderr, readCaptureRecoveries(control)]).toEqual([
				first.stderr,
				readCaptureRecoveries(first),
			])
			expect((await fixture.refresh()).code).toBe(0)
			// The refreshed registry declares frames no run has captured, which the frames line clears.
			const read = await fixture.run('stale', ['pages:mail'])
			expect({ stderr: read.stderr, next: readCaptureRecoveries(read) }).toEqual({
				stderr: '',
				next: { code: 1, stdout: [`NEXT capture frames pages:mail ${config}`], stderr: [] },
			})
			expect((await fixture.run('capture', ['pages:mail'])).code).toBe(0)
			expect((await fixture.run('stale', ['pages:mail'])).code).toBe(0)
		} finally {
			fixture.destroy()
		}
	})

	it('prints the registry refresh alone on stderr when a case is checked with no registry', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			const args = ['pages:mail', '--case', MAIL]
			const first = await fixture.run('journey', args)
			const control = await fixture.run('journey', args)
			expect(readCaptureRecoveries(first)).toEqual({ code: 1, stdout: [], stderr: [registry] })
			expect([control.stderr, readCaptureRecoveries(control)]).toEqual([
				first.stderr,
				readCaptureRecoveries(first),
			])
			expect((await fixture.refresh()).code).toBe(0)
			const rerun = await fixture.run('journey', args)
			expect(rerun.code === 0 ? 0 : rerun.stderr).toBe(0)
		} finally {
			fixture.destroy()
		}
	})

	it.each([{ flags: [] }, { flags: ['--plan'] }])(
		'prints the registry refresh alone on stderr when a changed selection $flags finds no registry',
		async ({ flags }) => {
			const fixture = new ComposedFixture({ core, server }, { committed: true })
			try {
				fixture.write('src/mail/view.ts', '// changed mail source\n')
				const args = ['--changed', 'HEAD', ...flags]
				const first = await fixture.run('journey', args)
				const control = await fixture.run('journey', args)
				expect(readCaptureRecoveries(first)).toEqual({ code: 1, stdout: [], stderr: [registry] })
				expect([control.stderr, readCaptureRecoveries(control)]).toEqual([
					first.stderr,
					readCaptureRecoveries(first),
				])
				expect((await fixture.refresh()).code).toBe(0)
				const rerun = await fixture.run('journey', args)
				expect(rerun.code === 0 ? 0 : rerun.stderr).toBe(0)
			} finally {
				fixture.destroy()
			}
		},
	)

	it('prints the registry refresh after an invalid registry on each stream, and the refresh clears it', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			fixture.write(`${COMPOSED_DIRECTORY}/registry.json`, '{"version":2,"receipts":"none"}')
			const journey = await fixture.run('journey', ['pages:mail'])
			const stale = await fixture.run('stale', ['pages:mail'])
			expect(journey.stdout).toContain('"reason":"refused before execution"')
			expect([readCaptureRecoveries(journey), readCaptureRecoveries(stale)]).toEqual([
				{ code: 1, stdout: [registry], stderr: [] },
				{ code: 1, stdout: [], stderr: [registry] },
			])
			expect((await fixture.refresh()).code).toBe(0)
			const rerun = await fixture.run('journey', ['pages:mail'])
			expect(rerun.code === 0 ? 0 : rerun.stderr).toBe(0)
		} finally {
			fixture.destroy()
		}
	})

	it('prints the registry refresh after an unattested declared variant, and the refresh clears the refusal', async () => {
		const attested = VARIANTS.filter((variant) => variant !== 'light-1280')
		const fixture = new ComposedFixture({ core, server })
		try {
			fixture.seed({ variants: attested })
			await fixture.capture({ variants: attested })
			const first = await fixture.run('stale', ['examples:board'])
			const control = await fixture.run('stale', ['examples:board'])
			expect(first.stderr).toContain('Unattested declared variant: light-1280')
			expect(readCaptureRecoveries(first)).toEqual({ code: 1, stdout: [], stderr: [registry] })
			expect([control.stderr, readCaptureRecoveries(control)]).toEqual([
				first.stderr,
				readCaptureRecoveries(first),
			])
			expect((await fixture.refresh()).code).toBe(0)
			const read = await fixture.run('stale', ['examples:board'])
			expect({ stderr: read.stderr, next: readCaptureRecoveries(read) }).toEqual({
				stderr: '',
				next: { code: 1, stdout: [`NEXT capture frames examples:board ${config}`], stderr: [] },
			})
			expect((await fixture.run('capture', ['examples:board'])).code).toBe(0)
			expect((await fixture.run('stale', ['examples:board'])).code).toBe(0)
		} finally {
			fixture.destroy()
		}
	})

	it('prints the owner journey on stderr after a stale state lookup, and the journey clears it', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			fixture.seed()
			const args = ['pages:mail', '--state', 'mail-reader']
			const first = await fixture.run('capture', args)
			const control = await fixture.run('capture', args)
			expect(first.stderr).toContain('Missing or stale state lookup')
			expect(readCaptureRecoveries(first)).toEqual({
				code: 1,
				stdout: [],
				stderr: [`NEXT capture journey pages:mail ${config}`],
			})
			expect([control.stderr, readCaptureRecoveries(control)]).toEqual([
				first.stderr,
				readCaptureRecoveries(first),
			])
			expect((await fixture.run('journey', ['pages:mail'])).code).toBe(0)
			const rerun = await fixture.run('capture', args)
			expect(rerun.code === 0 ? 0 : rerun.stderr).toBe(0)
		} finally {
			fixture.destroy()
		}
	})

	it.each(CAPTURE_DOCUMENT_FAULTS)(
		'prints no NEXT line after $title, and names the file',
		async (row) => {
			const fixture = new ComposedFixture({ core, server })
			try {
				fixture.seed()
				expect((await fixture.run('journey', ['pages:mail'])).code).toBe(0)
				fixture.write(`${COMPOSED_DIRECTORY}/${row.file}`, row.text)
				const run = await fixture.run('capture', ['pages:mail'])
				expect(run.stderr).toContain(`${COMPOSED_DIRECTORY}/${row.file}`)
				expect(readCaptureRecoveries(run)).toEqual({ code: 1, stdout: [], stderr: [] })
			} finally {
				fixture.destroy()
			}
		},
	)

	it('reaches the SUMMARY and names the unrun owner after a host refusal between the owners of a changed run', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/board/view.ts', '// board\n')
			fixture.write('src/mail/view.ts', '// mail\n')
			const requests = resolve(fixture.root, fixture.requests)
			const stdout: string[] = []
			const stderr: string[] = []
			const code = await createCaptureRunner({
				command: 'journey',
				root: fixture.root,
				config: fixture.config,
				requests: fixture.requests,
				argv: ['--changed', 'HEAD', '--variant', 'light-1280'],
				stdout: (text) => {
					stdout.push(text)
					// The first owner has passed; the next owner's request directory is a file.
					if (text.startsWith('STAGES ') && text.includes('"selector":"examples:board"')) {
						rmSync(requests, { recursive: true, force: true })
						writeFileSync(requests, 'not a directory\n')
					}
				},
				stderr: (text) => stderr.push(text),
			}).execute()
			const run = { code, stdout: stdout.join(''), stderr: stderr.join('') }
			expect(run.stderr).toContain('Capture request directory is unavailable')
			expect(fixture.stages.map((request) => request.selector)).toEqual(['examples:board'])
			expect(run.stdout).toContain(
				`SUMMARY ${JSON.stringify({ run: ['examples:board'], passed: ['examples:board'], failed: ['pages:mail'], notrun: ['pages:mail'], reason: 'stopped at the first red owner' })}\n`,
			)
			expect(readCaptureRecoveries(run)).toEqual({
				code: 1,
				stdout: [`NEXT capture journey pages:mail --variant light-1280 ${config}`],
				stderr: [],
			})
		} finally {
			fixture.destroy()
		}
	})

	it('prints the same complete journey after a passing single run and a passing changed run with --variant and --mode', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/mail/view.ts', '// mail\n')
			const flags = ['--variant', 'light-1280', '--mode', 'vue']
			const single = await fixture.run('journey', ['pages:mail', ...flags])
			const changed = await fixture.run('journey', ['--changed', 'HEAD', ...flags])
			const complete = {
				code: 0,
				stdout: [`NEXT capture journey all --variant light-1280 --mode vue ${config}`],
				stderr: [],
			}
			expect([readCaptureRecoveries(single), readCaptureRecoveries(changed)]).toEqual([
				complete,
				complete,
			])
		} finally {
			fixture.destroy()
		}
	})

	it.each(CAPTURE_STALE_STATUSES)(
		'prints the frames refresh without --variant after the %s reading, and the frames run clears it',
		async (status) => {
			const fixture = new ComposedFixture({ core, server })
			try {
				fixture.seed()
				expect((await fixture.run('capture', ['all'])).code).toBe(0)
				editCaptureFreshness(fixture, status)
				const args = ['pages:mail', '--variant', COMPOSED_FIRST]
				const first = await fixture.run('stale', args)
				expect(readCaptureRunnerStatuses(first.stdout)).toContain(status)
				expect(readCaptureRecoveries(first)).toEqual({
					code: 1,
					stdout: [`NEXT capture frames pages:mail ${config}`],
					stderr: [],
				})
				// The frames line follows the report it recovers.
				expect(
					first.stdout
						.trimEnd()
						.split('\n')
						.slice(-2)
						.map((line) => line.slice(0, line.indexOf(' '))),
				).toEqual(['INTEGRITY', 'NEXT'])
				expect((await fixture.run('capture', ['pages:mail'])).code).toBe(0)
				expect((await fixture.run('stale', args)).code).toBe(0)
			} finally {
				fixture.destroy()
			}
		},
	)

	it('prints no frames line after an orphan-only, a standalone, or a current reading', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			fixture.seed()
			expect((await fixture.run('capture', ['all'])).code).toBe(0)
			const current = await fixture.run('stale', ['pages:mail'])
			fixture.write(
				'tmp/captures/states/pages/unknown--light-390.png',
				fixture.read('tmp/captures/states/pages/mail-screen--light-390.png'),
			)
			const orphan = await fixture.run('stale', ['pages', '--variant', COMPOSED_FIRST])
			fixture.seed({ vue: true })
			const standalone = await fixture.run('stale', ['vue'])
			expect(
				[orphan, standalone].map((run) => new Set(readCaptureRunnerStatuses(run.stdout))),
			).toEqual([new Set(['current', 'orphan']), new Set(['unstamped'])])
			expect([current, orphan, standalone].map((run) => readCaptureRecoveries(run))).toEqual([
				{ code: 0, stdout: [], stderr: [] },
				{ code: 1, stdout: [], stderr: [] },
				{ code: 1, stdout: [], stderr: [] },
			])
		} finally {
			fixture.destroy()
		}
	})

	it('prints the stale refusal, then the stage line, then its NEXT line', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			const run = await fixture.run('stale', ['pages:mail'])
			expect({ code: run.code, stderr: run.stderr }).toEqual({
				code: 1,
				stderr: `Missing accepted registry; run the explicit complete-registry refresh\nNo execution child ran; the command was refused before execution.\n${registry}\n`,
			})
		} finally {
			fixture.destroy()
		}
	})
})

describe('CaptureRunner version refusals', { timeout: FIXTURE_TIMEOUT }, () => {
	const registry = `${COMPOSED_DIRECTORY}/registry.json`
	const manifest = `${COMPOSED_DIRECTORY}/manifest.json`
	const lookups = `${COMPOSED_DIRECTORY}/lookups.json`
	const version = `is not version ${String(core.CAPTURE_VERSION)}, and no other version is converted`
	const refresh = 'then refresh explicitly with: capture registry, then capture frames all'
	const refused = 'No execution child ran; the command was refused before execution.\n'

	it('passes a version refusal through a changed selection with its own recovery alone', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			expect((await fixture.refresh()).code).toBe(0)
			expect((await fixture.run('journey', ['all'])).code).toBe(0)
			downgradeCaptureFixture(fixture.root, COMPOSED_DIRECTORY)
			fixture.write('src/mail/view.ts', '// changed mail source\n')
			const before = fixture.stages.length
			for (const flags of [[], ['--plan']]) {
				const run = await fixture.run('journey', ['--changed', 'HEAD', ...flags])
				expect({ code: run.code, stderr: run.stderr }).toEqual({
					code: 1,
					stderr: `Registry version 1 at ${registry} ${version}. Remove ${registry}, ${manifest}, and ${lookups}, ${refresh}\n${refused}`,
				})
				expect(run.stdout).not.toContain('NEXT ')
			}
			expect(fixture.stages).toHaveLength(before)
		} finally {
			fixture.destroy()
		}
	})

	it('prints a version refusal with no NEXT line on stale, a case-scoped journey, and an owner run', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			expect((await fixture.refresh()).code).toBe(0)
			expect((await fixture.run('journey', ['all'])).code).toBe(0)
			downgradeCaptureFixture(fixture.root, COMPOSED_DIRECTORY)
			const before = fixture.stages.length
			const stale = await fixture.run('stale', ['all'])
			expect({ code: stale.code, stderr: stale.stderr }).toEqual({
				code: 1,
				stderr: `Registry version 1 at ${registry} ${version}. Remove ${registry}, ${manifest}, and ${lookups}, ${refresh}\n${refused}`,
			})
			const [absolute, held, journal] = [registry, manifest, lookups].map((file) =>
				resolve(fixture.root, file),
			)
			const scoped = await fixture.run('journey', ['pages:mail', '--case', MAIL])
			expect({ code: scoped.code, stderr: scoped.stderr }).toEqual({
				code: 1,
				stderr: `Registry version 1 at ${String(absolute)} ${version}. Remove ${String(absolute)}, ${String(held)}, and ${String(journal)}, ${refresh}\n${refused}`,
			})
			const owner = await fixture.run('journey', ['pages:mail'])
			expect({ code: owner.code, stderr: owner.stderr }).toEqual({
				code: 1,
				stderr: `Registry version 1 at ${registry} ${version}. Remove ${registry}, ${manifest}, and ${lookups}, ${refresh}\n${refused}`,
			})
			expect(owner.stdout).toContain('"reason":"refused before execution"')
			for (const run of [stale, scoped, owner]) expect(run.stdout).not.toContain('NEXT ')
			expect(fixture.stages).toHaveLength(before)
		} finally {
			fixture.destroy()
		}
	})

	it('ends a changed run at the version refusal an owner run meets, with no NEXT line', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			expect((await fixture.refresh()).code).toBe(0)
			expect((await fixture.run('capture', ['all'])).code).toBe(0)
			const document: unknown = parseJSON(readFixtureManifest(fixture.root) ?? '')
			const written = isRecord(document) ? document : {}
			expect(written).toMatchObject({ version: core.CAPTURE_VERSION })
			fixture.write(manifest, JSON.stringify({ ...written, version: 1 }))
			fixture.write('src/mail/view.ts', '// changed mail source\n')
			const before = fixture.stages.length
			const run = await fixture.run('journey', ['--changed', 'HEAD'])
			expect({ code: run.code, stderr: run.stderr }).toEqual({
				code: 1,
				stderr: `Manifest version 1 at ${manifest} ${version}. Remove ${manifest} and its lookup journal, ${refresh}\n${refused}`,
			})
			expect(run.stdout).toContain('COMMAND capture journey pages:mail')
			expect(run.stdout).not.toContain('NEXT ')
			expect(fixture.stages).toHaveLength(before)
		} finally {
			fixture.destroy()
		}
	})

	it('names the stages an earlier owner ran when a later owner of a changed run meets a version refusal', async () => {
		const fixture = new ComposedFixture({ core, server }, { committed: true })
		try {
			fixture.seed({ variants: ['light-1280'] })
			fixture.write('src/board/view.ts', '// board\n')
			fixture.write('src/mail/view.ts', '// mail\n')
			const stdout: string[] = []
			const stderr: string[] = []
			const code = await createCaptureRunner({
				command: 'journey',
				root: fixture.root,
				config: fixture.config,
				requests: fixture.requests,
				argv: ['--changed', 'HEAD', '--variant', 'light-1280'],
				stdout: (text) => {
					stdout.push(text)
					// The first owner's stage status arrives after it passed and before the next owner starts.
					if (text.startsWith('STAGES ') && text.includes('"selector":"examples:board"'))
						downgradeCaptureFixture(fixture.root, COMPOSED_DIRECTORY)
				},
				stderr: (text) => stderr.push(text),
			}).execute()
			expect({ code, stderr: stderr.join('') }).toEqual({
				code: 1,
				stderr: `Registry version 1 at ${registry} ${version}. Remove ${registry}, ${manifest}, and ${lookups}, ${refresh}\nExecution stopped after stages: selected; no later stage ran.\n`,
			})
			expect(fixture.stages.map((request) => request.selector)).toEqual(['examples:board'])
			expect(stdout.join('')).toContain(
				'STAGES {"selector":"pages:mail","run":[],"passed":[],"failed":[],"notrun":["selected"],"reason":"refused before execution"}\n',
			)
			expect(stdout.join('')).not.toContain('SUMMARY ')
			// The earlier owner passed, and the refusal still carries its own recovery alone.
			expect(
				readCaptureRecoveries({ code, stdout: stdout.join(''), stderr: stderr.join('') }),
			).toEqual({ code: 1, stdout: [], stderr: [] })
		} finally {
			fixture.destroy()
		}
	})
})
