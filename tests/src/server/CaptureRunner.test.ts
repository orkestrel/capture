import { resolve } from 'node:path'
import { requireValue } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { isCaptureError } from '@src/core'
import { describe, expect, it } from 'vitest'
import { RunnerFixture } from '../../fixtures/capture/RunnerFixture.js'
import {
	FIXTURE_TIMEOUT,
	RUNNER_CASE,
	RUNNER_CLOSING,
	RUNNER_COMMANDS,
	RUNNER_DIRECTORY,
	RUNNER_INPUTS,
	RUNNER_PORTFOLIOS,
	RUNNER_REFUSALS,
	RUNNER_REQUESTS,
	RUNNER_STANDALONE,
	SUPPORTS_GROUP_SIGNAL,
	readRunnerReceipt,
} from '../../setupServer.js'

// Each execution loads a Vite configuration, spawns real Node children, and removes a scratch
// workspace, so the default five-second budget is thin on a contended host.
describe('CaptureRunner process contract', { timeout: FIXTURE_TIMEOUT }, () => {
	it('resolves a labeled-object project name and passes it to --project', async () => {
		const run = await RunnerFixture.execute('journey', ['app:mail', '--variant', 'compact'], {
			environment: { CAPTURE_FIXTURE_NAME: 'labeled' },
		})
		expect(run.code).toBe(0)
		const { args, request } = readRunnerReceipt(run)
		expect(args.slice(args.indexOf('--project'), args.indexOf('--project') + 2)).toEqual([
			'--project',
			'bench:compact',
		])
		expect(request.variants).toEqual(['compact'])
	})

	it('refuses an unsupported project name before spawning', async () => {
		const run = await RunnerFixture.execute('journey', ['app:mail', '--variant', 'compact'], {
			environment: { CAPTURE_FIXTURE_NAME: 'unsupported' },
		})
		expect(run.code).toBe(1)
		expect(run.stderr).toContain(
			'Unsupported journey project name: expected a string or an object with a string label',
		)
		expect(run.receipt).toBeUndefined()
		expect(run.request).toBe(false)
	})

	it('refuses wrapper projects that disagree on a host declaration before spawning', async () => {
		const run = await RunnerFixture.execute('journey', ['app:mail'], {
			environment: { CAPTURE_FIXTURE_DISAGREE: 'phone' },
		})
		expect(run.code).toBe(1)
		expect(run.stderr).toContain('Host project integrity declarations disagree')
		expect(run.receipt).toBeUndefined()
		expect(run.engines).toEqual([])
	})

	it('refuses a wrapper that sits outside the repository before loading it', async () => {
		const run = await RunnerFixture.execute('journey', [
			'app:mail',
			'--config',
			resolve(import.meta.dirname, 'outside.config.ts'),
		])
		expect(run.code).toBe(64)
		expect(run.stderr).toContain('Config must be a contained repository path')
		expect(run.receipt).toBeUndefined()
	})

	describe.each(RUNNER_COMMANDS)('%s', (command) => {
		it.each(RUNNER_REFUSALS)('refuses $title before spawning', async ({ args, message }) => {
			const run = await RunnerFixture.execute(command, args)
			expect(run.code).toBe(64)
			expect(run.stdout + run.stderr).toContain(message)
			expect(run.receipt).toBeUndefined()
			expect(run.request).toBe(false)
			expect(run.engines.flatMap((engine) => engine.stages)).toEqual([])
		})

		it('lists every declared owner, ancestors included, when no selector is given', async () => {
			const run = await RunnerFixture.execute(command, [])
			expect(run.code).toBe(64)
			expect(run.stderr.split(/\r\n|\n/u)).toEqual(
				expect.arrayContaining(['app', 'app:board', 'app:mail', 'tools', 'tools:search']),
			)
			expect(run.stderr).toContain(command === 'capture' ? 'capture frames' : 'capture journey')
		})

		it('writes the exact request, preserves spaces and quotes, tees output, and removes the request', async () => {
			const run = await RunnerFixture.execute(command, [
				'app:mail',
				'--variant',
				'compact',
				'--case',
				RUNNER_CASE,
			])
			expect(run.code).toBe(0)
			const { request, args, report, parent } = readRunnerReceipt(run)
			expect(request).toMatchObject({
				version: 1,
				stage: 'narrow',
				command,
				selector: 'app:mail',
				case: RUNNER_CASE,
				variants: ['compact'],
				config: 'fixture with spaces.config.ts',
				pid: process.pid,
			})
			expect(parent).toBe(process.pid)
			expect(request.args).toEqual(args)
			expect(report.replaceAll('\\', '/')).toContain(`/runs/${String(request.id)}/`)
			// The anchored pattern is read by a second mechanism, a regular expression engine, so it must
			// match each of the two names exactly and nothing that merely resembles them.
			const pattern = new RegExp(args[args.indexOf('-t') + 1] ?? '', 'u')
			expect(pattern.test(RUNNER_CASE)).toBe(true)
			expect(pattern.test(RUNNER_CLOSING)).toBe(true)
			expect(pattern.test(`${RUNNER_CASE} extra`)).toBe(false)
			expect(pattern.test(`x${RUNNER_CLOSING}`)).toBe(false)
			expect(pattern.test('closes a states + writes aab')).toBe(false)
			expect(run.request).toBe(false)
			expect(run.temporary).toBe(false)
			expect(run.stdout).toContain('fixture stdout')
			expect(run.stderr).toContain('fixture stderr')
			expect(run.log).toContain('fixture stdout')
			expect(run.log).toContain('fixture stderr')
		})

		it('runs the first variant alone, then the others together, in declaration order', async () => {
			const run = await RunnerFixture.execute(command, ['app:mail'])
			expect(run.code).toBe(0)
			const engine = requireValue(run.engines.at(0), 'The runner created no engine')
			expect(
				engine.stages.map((stage) => ({
					stage: stage.request.stage,
					variants: stage.request.variants,
					projects: stage.projects.map((project) => project.name),
				})),
			).toEqual([
				{ stage: 'narrow', variants: ['compact'], projects: ['bench:compact'] },
				{ stage: 'rest', variants: ['wide', 'phone'], projects: ['bench:wide', 'bench:phone'] },
			])
			expect(run.stdout).toContain('bench:compact: 1 owner-bearing passed cases')
			expect(run.stdout).toContain('bench:wide: 1 owner-bearing passed cases')
			expect(run.stdout).toContain('bench:phone: 1 owner-bearing passed cases')
		})

		it('adds no variant the caller did not select, and runs a lone non-first variant in one stage', async () => {
			const run = await RunnerFixture.execute(command, ['app:mail', '--variant', 'phone'])
			expect(run.code).toBe(0)
			const engine = requireValue(run.engines.at(0), 'The runner created no engine')
			expect(engine.stages.map((stage) => [stage.request.stage, stage.request.variants])).toEqual([
				['rest', ['phone']],
			])
		})

		it('derives the engine options and each stage record path from the wrapper declarations', async () => {
			const run = await RunnerFixture.execute(command, ['app:mail'])
			expect(run.code).toBe(0)
			const engine = requireValue(run.engines.at(0), 'The runner created no engine')
			expect(engine.options).toEqual({
				root: engine.options.root,
				directory: RUNNER_DIRECTORY,
				inputs: [...RUNNER_INPUTS],
				registry: `${RUNNER_DIRECTORY}/registry.json`,
				manifest: `${RUNNER_DIRECTORY}/manifest.json`,
				lookups: `${RUNNER_DIRECTORY}/lookups.json`,
				portfolios: [...RUNNER_PORTFOLIOS],
			})
			const narrow = requireValue(engine.stages.at(0), 'The runner ran no stage')
			expect(narrow.projects).toEqual([
				{
					name: 'bench:compact',
					variant: 'compact',
					inputs: [...RUNNER_INPUTS],
					record: `${RUNNER_DIRECTORY}/runs/${narrow.request.id}/narrow/compact.json`,
				},
			])
			expect(narrow.report.startsWith(`${RUNNER_REQUESTS}/runs/${narrow.request.id}/`)).toBe(true)
			expect(run.stdout).toContain(
				`records=${RUNNER_DIRECTORY}/runs/${narrow.request.id}/narrow/<variant>.json`,
			)
		})

		it('selects an owner and its capture tag, and the union of declared scopes for all', async () => {
			const owner = await RunnerFixture.execute(command, ['tools:search', '--variant', 'compact'])
			const all = await RunnerFixture.execute(command, ['all', '--variant', 'compact'])
			const filters = [owner, all].map((run) => {
				const { args } = readRunnerReceipt(run)
				return args[args.indexOf('--tags-filter') + 1]
			})
			expect(filters).toEqual(
				command === 'journey'
					? ['owner:tools:search', '(owner:app || owner:tools)']
					: ['owner:tools:search && tools:search', '(owner:app || owner:tools) && (app || tools)'],
			)
		})

		it('removes the request on child failure, runs no later stage, and exits 1', async () => {
			const run = await RunnerFixture.execute(command, ['app:mail'], { mode: 'fail' })
			expect(run.code).toBe(1)
			expect(readRunnerReceipt(run).request).toMatchObject({ command, selector: 'app:mail' })
			expect(run.engines.flatMap((engine) => engine.stages)).toHaveLength(1)
			expect(run.request).toBe(false)
			expect(run.temporary).toBe(false)
		})

		it('exits 1 for a malformed report and removes the request', async () => {
			const run = await RunnerFixture.execute(command, ['app:mail', '--variant', 'compact'], {
				mode: 'invalid',
			})
			expect(run.code).toBe(1)
			expect(readRunnerReceipt(run).request).toMatchObject({ command })
			expect(run.request).toBe(false)
		})

		it('exits 1 when no requested project held applicable work', async () => {
			const run = await RunnerFixture.execute(command, ['app:mail'], {
				script: { passed: { wide: 0, compact: 0, phone: 0 } },
			})
			expect(run.code).toBe(1)
			expect(run.stderr).toContain('Empty selected workload')
			expect(run.stdout).toContain(
				'compact is inapplicable; the rest stage carries app:mail when requested',
			)
		})

		it('keeps the rest stage when only the first variant held no work', async () => {
			const run = await RunnerFixture.execute(command, ['app:mail'], {
				script: { passed: { compact: 0 } },
			})
			expect(run.code).toBe(0)
			expect(run.stdout).toContain('compact is inapplicable')
			expect(run.engines.flatMap((engine) => engine.stages)).toHaveLength(2)
		})
	})

	it('removes an inherited capture variable under journey', async () => {
		const run = await RunnerFixture.execute('journey', ['app:mail', '--variant', 'compact'], {
			environment: { Capture: '1' },
		})
		expect(run.code).toBe(0)
		expect(readRunnerReceipt(run).capture).toEqual([])
	})

	it('replaces an inherited capture variable with one CAPTURE under capture', async () => {
		const run = await RunnerFixture.execute('capture', ['app:mail', '--variant', 'compact'], {
			environment: { Capture: 'old' },
		})
		expect(run.code).toBe(0)
		expect(readRunnerReceipt(run).capture).toEqual([['CAPTURE', '1']])
	})

	it('refuses journey state projection before spawning', async () => {
		const run = await RunnerFixture.execute('journey', [
			'app:mail',
			'--variant',
			'compact',
			'--state',
			'inbox',
		])
		expect(run.code).toBe(64)
		expect(run.stderr).toContain('State selection is available only to capture and stale')
		expect(run.receipt).toBeUndefined()
		expect(run.request).toBe(false)
	})

	it('resolves a state through the engine and selects its declaring case without widening', async () => {
		const run = await RunnerFixture.execute(
			'capture',
			['app:mail', '--variant', 'compact', '--state', 'inbox'],
			{ script: { lookup: { case: RUNNER_CASE } } },
		)
		expect(run.code).toBe(0)
		const engine = requireValue(run.engines.at(0), 'The runner created no engine')
		expect(engine.lookups).toEqual([
			{ selector: 'app:mail', variants: ['compact'], state: 'inbox' },
		])
		expect(readRunnerReceipt(run).request).toMatchObject({
			state: 'inbox',
			case: RUNNER_CASE,
			variants: ['compact'],
		})
	})

	it.each([
		{ title: 'a missing lookup', fault: 'Refresh explicitly with: capture journey app:mail' },
		{
			title: 'a stale lookup',
			fault: 'The lookup is stale: capture journey app:mail --variant compact',
		},
		{ title: 'a state outside the selector', fault: 'State board is not owned by app:mail' },
	])('refuses $title without an automatic process', async ({ fault }) => {
		const run = await RunnerFixture.execute(
			'capture',
			['app:mail', '--variant', 'compact', '--state', 'inbox'],
			{ script: { lookup: { fault } } },
		)
		expect(run.code).toBe(64)
		expect(run.stderr).toContain(fault)
		expect(run.receipt).toBeUndefined()
		expect(run.request).toBe(false)
	})

	it('passes an explicit case with its state so the engine can refuse a disagreement', async () => {
		const run = await RunnerFixture.execute(
			'capture',
			['app:mail', '--variant', 'compact', '--state', 'inbox', '--case', 'another case'],
			{ script: { lookup: { fault: 'The case disagrees with the state' } } },
		)
		expect(run.code).toBe(64)
		expect(requireValue(run.engines.at(0)).lookups).toEqual([
			{ selector: 'app:mail', variants: ['compact'], state: 'inbox', case: 'another case' },
		])
	})

	it('preserves a live runner request, prunes a dead one and its temporary file, and removes its own', async () => {
		const run = await RunnerFixture.execute('journey', ['app:mail', '--variant', 'compact'], {
			ownership: true,
		})
		expect(run.code).toBe(0)
		expect(run.live).toBe('live request bytes\n')
		expect(run.pending).toBe('live temporary bytes\n')
		const { files } = readRunnerReceipt(run)
		expect(files).toContain(`journey-selection-${String(process.pid)}.json`)
		expect(files).not.toContain(`journey-selection-${String(run.dead)}.json`)
		expect(files).not.toContain(`journey-selection-${String(run.dead)}.json.tmp`)
		expect(run.stale).toBe(false)
		expect(run.abandoned).toBe(false)
		expect(run.request).toBe(false)
		expect(run.temporary).toBe(false)
	})

	it('ends the recorded child and its descendant on an interrupt, removes the request, and restores the handlers', async () => {
		const run = await RunnerFixture.execute('journey', ['app:mail', '--variant', 'compact'], {
			mode: 'interrupt',
			interrupt: 'emit',
		})
		expect(run.code).toBe(1)
		expect(run.request).toBe(false)
		expect(run.temporary).toBe(false)
		expect(run.listeners.after).toBe(run.listeners.before)
		const stage = requireValue(run.engines.at(0)?.stages.at(0), 'The runner ran no stage')
		expect(stage.signal?.aborted).toBe(true)
		expect(isCaptureError(stage.signal?.reason)).toBe(true)
		const tree = run.tree
		if (
			typeof tree !== 'object' ||
			tree === null ||
			!('child' in tree) ||
			!('descendant' in tree) ||
			typeof tree.child !== 'number' ||
			typeof tree.descendant !== 'number'
		)
			throw new Error('Missing descendant receipt')
		expect(isRunning(tree.child)).toBe(false)
		expect(isRunning(tree.descendant)).toBe(false)
		expect(run.engines.flatMap((engine) => engine.stages)).toHaveLength(1)
	})

	// Windows has no signal a process group can receive, so a real signal reaches the installed
	// handler only on a POSIX host. This reading signals the runner's own process, which on POSIX
	// runs the handler instead of ending the process; the process-group reading through the built
	// executable waits for it (U5), and until a POSIX host runs this case it is an unrun limit.
	it.runIf(SUPPORTS_GROUP_SIGNAL)(
		'ends the recorded child and its descendant on a real SIGINT',
		async () => {
			const run = await RunnerFixture.execute('journey', ['app:mail', '--variant', 'compact'], {
				mode: 'interrupt',
				interrupt: 'signal',
			})
			expect(run.code).toBe(1)
			expect(run.request).toBe(false)
			expect(run.listeners.after).toBe(run.listeners.before)
			expect(run.engines.flatMap((engine) => engine.stages)).toHaveLength(1)
		},
	)
})

describe('CaptureRunner stale command', { timeout: FIXTURE_TIMEOUT }, () => {
	it('exits 0 for current frames, 1 for a noncurrent frame, and spawns no child', async () => {
		const current = await RunnerFixture.execute('stale', ['app:mail', '--variant', 'compact'])
		expect(current.code).toBe(0)
		expect(current.stdout).toContain('"status":"current"')
		expect(current.receipt).toBeUndefined()
		const noncurrent = await RunnerFixture.execute('stale', ['app:mail', '--variant', 'compact'], {
			script: { statuses: ['current', 'stale-own'] },
		})
		expect(noncurrent.code).toBe(1)
		expect(noncurrent.stdout).toContain('"status":"stale-own"')
		expect(noncurrent.receipt).toBeUndefined()
	})

	it('refuses an invalid reading with exit 64 and a missing selector with the usage', async () => {
		const invalid = await RunnerFixture.execute('stale', ['app:unknown'], {
			script: { checkFault: 'Unknown selector: app:unknown' },
		})
		expect(invalid.code).toBe(64)
		expect(invalid.stderr).toContain('Unknown selector: app:unknown')
		const bare = await RunnerFixture.execute('stale', [])
		expect(bare.code).toBe(64)
		expect(bare.stderr).toContain('capture stale <selector>')
	})

	it('passes the selection, declared variants, and flags to the engine unchanged', async () => {
		const run = await RunnerFixture.execute('stale', [
			'app:mail',
			'--variant',
			'compact',
			'--state',
			'inbox',
			'--case',
			RUNNER_CASE,
			'--portfolio',
			'extras',
		])
		expect(requireValue(run.engines.at(0)).checks).toEqual([
			{
				selector: 'app:mail',
				declared: ['wide', 'compact', 'phone'],
				variants: ['compact'],
				case: RUNNER_CASE,
				state: 'inbox',
				portfolio: 'extras',
			},
		])
	})

	it.each([
		{ title: 'the selector', args: ['gallery:summer'] },
		{ title: 'the portfolio flag', args: ['app:mail', '--portfolio', 'gallery'] },
	])(
		'reads a standalone portfolio through its own registry when $title names it',
		async ({ args }) => {
			const run = await RunnerFixture.execute('stale', args)
			const engine = requireValue(run.engines.at(0), 'The runner created no engine')
			expect(engine.options).toMatchObject({
				directory: 'out/gallery',
				registry: 'out/gallery/registry.json',
				manifest: 'out/gallery/manifest.json',
				lookups: 'out/gallery/lookups.json',
				portfolios: [...RUNNER_STANDALONE],
			})
		},
	)

	it('reads the primary registry for a selector that names no standalone portfolio', async () => {
		const run = await RunnerFixture.execute('stale', ['app:mail'])
		expect(requireValue(run.engines.at(0)).options).toMatchObject({
			directory: RUNNER_DIRECTORY,
			portfolios: [...RUNNER_PORTFOLIOS],
		})
	})
})
