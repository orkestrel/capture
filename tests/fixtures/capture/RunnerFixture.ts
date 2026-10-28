import type { ScratchInterface } from '@orkestrel/test/server'
import type { CaptureCommand } from '@src/server'
import type { RunnerExecution, RunnerRun } from '../../setupServer.js'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { resolve } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { waitForCondition } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { createCaptureRunner } from '@src/server'
import { RUNNER_REQUESTS, withEnvironment } from '../../setupServer.js'
import { ProcessFixture } from './ProcessFixture.js'
import { RecordingIntegrity } from './RecordingIntegrity.js'

/**
 * Owns a scratch workspace that holds a non-Veneer wrapper and a Vitest stand-in, and runs the real
 * runner over them in this process.
 *
 * @remarks
 * The runner is the subject, so it runs here with its own output captured through its writers and
 * its engine replaced by the recording boundary stub. Every child it spawns is a real Node
 * process: the stand-in at `node_modules/vitest/vitest.mjs` records what the runner established.
 */
export class RunnerFixture {
	readonly #scratch: ScratchInterface

	/**
	 * Runs one command over a private fixture and removes it afterwards.
	 *
	 * @param command - The runner command
	 * @param argv - The command line after the entry name
	 * @param options - The environment, scripted outcomes, stand-in fault, and interrupt
	 * @returns What the execution left behind
	 */
	static async execute(
		command: CaptureCommand,
		argv: readonly string[],
		options: RunnerExecution = {},
	): Promise<RunnerRun> {
		const fixture = new RunnerFixture()
		try {
			return await fixture.run(command, argv, options)
		} finally {
			fixture.destroy()
		}
	}

	/** Creates the scratch workspace with the wrapper and the stripped Vitest stand-in. */
	constructor() {
		this.#scratch = createScratch({ prefix: 'runner-' })
		try {
			this.#scratch.write(
				'fixture with spaces.config.ts',
				readFileSync(resolve(import.meta.dirname, 'fixture.config.ts'), 'utf8'),
			)
			this.#scratch.write(
				'node_modules/vitest/vitest.mjs',
				stripTypeScriptTypes(readFileSync(resolve(import.meta.dirname, 'Recorder.ts'), 'utf8')),
			)
		} catch (error) {
			// A throwing constructor returns no instance, so no caller's finally block can destroy it.
			this.#scratch.destroy()
			throw error
		}
	}

	/** Holds the absolute workspace path. */
	get path(): string {
		return this.#scratch.path
	}

	/**
	 * Runs the real runner and gathers its boundary.
	 *
	 * @param command - The runner command
	 * @param argv - The command line after the entry name
	 * @param options - The environment, scripted outcomes, stand-in fault, and interrupt
	 * @returns The exit, output, receipt, request files, recorded engine calls, and listener counts
	 */
	async run(
		command: CaptureCommand,
		argv: readonly string[],
		options: RunnerExecution = {},
	): Promise<RunnerRun> {
		const dead = await ProcessFixture.exited()
		const bystander = options.ownership === true ? await ProcessFixture.sleeper() : undefined
		const own = `${RUNNER_REQUESTS}/journey-selection-${String(process.pid)}.json`
		const live = `${RUNNER_REQUESTS}/journey-selection-${String(bystander?.pid)}.json`
		const stale = `${RUNNER_REQUESTS}/journey-selection-${String(dead)}.json`
		if (bystander !== undefined) {
			this.#scratch.write(live, 'live request bytes\n')
			this.#scratch.write(`${live}.tmp`, 'live temporary bytes\n')
			this.#scratch.write(stale, 'dead request bytes\n')
			this.#scratch.write(`${stale}.tmp`, 'dead temporary bytes\n')
		}
		const engines: RecordingIntegrity[] = []
		const stdout: string[] = []
		const stderr: string[] = []
		const before = process.listenerCount('SIGINT')
		try {
			const running = withEnvironment(
				{
					...options.environment,
					CAPTURE_FIXTURE_ROOT: this.path,
					CAPTURE_FIXTURE_REQUESTS: RUNNER_REQUESTS,
					CAPTURE_FIXTURE_DESCENDANT: resolve(import.meta.dirname, 'Sleeper.ts'),
					...(options.mode === undefined ? {} : { CAPTURE_FIXTURE_MODE: options.mode }),
				},
				async () =>
					await createCaptureRunner({
						command,
						root: this.path,
						config: 'fixture with spaces.config.ts',
						requests: RUNNER_REQUESTS,
						argv,
						stdout: (text) => stdout.push(text),
						stderr: (text) => stderr.push(text),
						integrity: (integrityOptions) => {
							const engine = new RecordingIntegrity(integrityOptions, options.script ?? {})
							engines.push(engine)
							return engine
						},
					}).execute(),
			)
			if (options.interrupt !== undefined) {
				await waitForCondition(
					'the descendant reports ready',
					() => this.#scratch.has('tree.json'),
					{
						budget: 20_000,
					},
				)
				if (options.interrupt === 'emit') process.emit('SIGINT')
				else process.kill(process.pid, 'SIGINT')
			}
			const code = await running
			const receipt: unknown = parseJSON(this.#scratch.read('receipt.json') ?? '')
			const tree: unknown = parseJSON(this.#scratch.read('tree.json') ?? '')
			if (isRecord(tree) && typeof tree.child === 'number' && typeof tree.descendant === 'number') {
				const { child, descendant } = tree
				await waitForCondition(
					'the recorded child and descendant have exited',
					() => !isRunning(child) && !isRunning(descendant),
					{ budget: 20_000 },
				)
			}
			const invocation =
				isRecord(receipt) && isRecord(receipt.request) && typeof receipt.request.id === 'string'
					? receipt.request.id
					: undefined
			return {
				code,
				stdout: stdout.join(''),
				stderr: stderr.join(''),
				receipt,
				tree,
				engines,
				request: this.#scratch.has(own),
				temporary: this.#scratch.has(`${own}.tmp`),
				live: this.#scratch.read(live),
				pending: this.#scratch.read(`${live}.tmp`),
				stale: this.#scratch.has(stale),
				abandoned: this.#scratch.has(`${stale}.tmp`),
				dead,
				log:
					invocation === undefined
						? undefined
						: this.#scratch.read(`${RUNNER_REQUESTS}/runs/${invocation}/${command}-narrow.log`),
				listeners: { before, after: process.listenerCount('SIGINT') },
			}
		} finally {
			if (bystander !== undefined) await ProcessFixture.stop(bystander)
		}
	}

	/** Removes the scratch workspace. */
	destroy(): void {
		this.#scratch.destroy()
	}
}
