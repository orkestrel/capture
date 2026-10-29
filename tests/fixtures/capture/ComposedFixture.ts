import type { CaptureRequest } from '@src/core'
import type { CaptureCommand } from '@src/server'
import type { ComposedExecution, ComposedRun } from '../../setupServer.js'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { waitForCondition } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { isCaptureRequest } from '@src/core'
import { createCaptureRegistrar, createCaptureRunner } from '@src/server'
import {
	COMPOSED_REQUESTS,
	READER_CONFIG,
	createComposedWrapper,
	createStandIn,
	withEnvironment,
	waitForCaptureStatus,
} from '../../setupServer.js'
import { IntegrityFixture } from './IntegrityFixture.js'

/**
 * Owns an integrity workspace that also holds a wrapper and a Vitest stand-in, and runs the real
 * runner, the real engine, and the registry refresh over it in this process.
 *
 * @remarks
 * The runner and the engine are the subjects, so both run here for real with their output captured
 * through the writers. The producer is a real Node child that writes real files and the wrapper is a
 * real module that Vite loads from the workspace. Nothing stands in for the engine.
 */
export class ComposedFixture extends IntegrityFixture {
	/** Holds the workspace-relative wrapper path the workspace carries and its runs load. */
	readonly config: string
	/** Holds the workspace-relative request directory the stand-in reads and the runs write. */
	readonly requests: string

	/**
	 * Creates the committed workspace and writes the wrapper and the Vitest stand-in it spawns.
	 *
	 * @param options - The wrapper path and request directory to use in place of the fixture's own, as
	 * an executable's built-in defaults need, the variant the wrapper stages alone first, and whether
	 * to commit the wrapper as the Git baseline for changed-selection proofs
	 */
	constructor(
		options: {
			readonly config?: string
			readonly requests?: string
			readonly first?: string
			readonly committed?: boolean
		} = {},
	) {
		super()
		this.config = options.config ?? READER_CONFIG
		this.requests = options.requests ?? COMPOSED_REQUESTS
		try {
			this.write(this.config, createComposedWrapper(this.root, options.first))
			this.write('node_modules/vitest/vitest.mjs', createStandIn())
			this.write('node_modules/vitest/package.json', JSON.stringify({ version: '4.1.12' }))
			if (options.committed) {
				execFileSync('git', ['add', '--', this.config], { cwd: this.root, windowsHide: true })
				execFileSync(
					'git',
					[
						'-c',
						'user.name=Fixture',
						'-c',
						'user.email=fixture@example.invalid',
						'commit',
						'--quiet',
						'--no-gpg-sign',
						'-m',
						'wrapper baseline',
					],
					{ cwd: this.root, windowsHide: true },
				)
			}
		} catch (error) {
			// A throwing constructor returns no instance, so no caller's finally block can destroy it.
			this.destroy()
			throw error
		}
	}

	/** Lists the requests observed by actual execution children, excluding discovery. */
	get stages(): readonly CaptureRequest[] {
		const file = resolve(this.root, 'tmp/stage-children.jsonl')
		if (!existsSync(file)) return []
		return readFileSync(file, 'utf8')
			.split(/\r\n|\n/u)
			.filter((line) => line !== '')
			.map((line) => {
				const request: unknown = parseJSON(line)
				if (!isCaptureRequest(request)) throw new Error('Invalid recorded stage request')
				return request
			})
	}

	/**
	 * Runs one runner command over the workspace with the real engine.
	 *
	 * @param command - The runner command
	 * @param argv - The command line after the subcommand
	 * @param options - The environment, how to interrupt once the child is up, and the discovery deadline
	 * @returns The exit and what the runner printed
	 */
	async run(
		command: CaptureCommand,
		argv: readonly string[],
		options: ComposedExecution = {},
	): Promise<ComposedRun> {
		const stdout: string[] = []
		const stderr: string[] = []
		const code = await this.#watch(
			async () =>
				await createCaptureRunner({
					command,
					root: this.root,
					config: this.config,
					requests: this.requests,
					argv,
					stdout: (text) => stdout.push(text),
					stderr: (text) => stderr.push(text),
					...(options.deadline === undefined ? {} : { deadline: options.deadline }),
				}).execute(),
			options,
		)
		return { code, stdout: stdout.join(''), stderr: stderr.join('') }
	}

	/**
	 * Runs the registry refresh over the workspace.
	 *
	 * @param argv - The command line after the subcommand
	 * @param options - The environment, how to interrupt once the child is up, and the discovery deadline
	 * @returns The exit and what the refresh printed
	 */
	async refresh(
		argv: readonly string[] = [],
		options: ComposedExecution = {},
	): Promise<ComposedRun> {
		const stdout: string[] = []
		const stderr: string[] = []
		const code = await this.#watch(
			async () =>
				await createCaptureRegistrar({
					root: this.root,
					config: this.config,
					requests: this.requests,
					argv,
					stdout: (text) => stdout.push(text),
					stderr: (text) => stderr.push(text),
					...(options.deadline === undefined ? {} : { deadline: options.deadline }),
				}).execute(),
			options,
		)
		return { code, stdout: stdout.join(''), stderr: stderr.join('') }
	}

	/**
	 * Reads the process ids the producer reported once its stage child and descendant were up.
	 *
	 * @returns The child and, when it had one, its descendant; empty before the producer reported ready
	 */
	readReady(): readonly number[] {
		const ready = resolve(this.root, 'ready.json')
		if (!existsSync(ready)) return []
		const result: unknown = parseJSON(readFileSync(ready, 'utf8'))
		if (!isRecord(result)) return []
		return [result.pid, result.descendant].filter((pid): pid is number => typeof pid === 'number')
	}

	async #watch(start: () => Promise<number>, options: ComposedExecution): Promise<number> {
		const ready = resolve(this.root, 'ready.json')
		rmSync(ready, { force: true })
		const running = withEnvironment(options.environment ?? {}, start)
		if (options.interrupt !== undefined) {
			await waitForCaptureStatus(ready, ['pid'])
			// A real signal reaches the installed handler only on a POSIX host, so a proof that asks for
			// one runs only there; the emitted signal runs the same handler on every host.
			if (options.interrupt === 'emit') process.emit('SIGINT')
			else process.kill(process.pid, 'SIGINT')
		}
		const code = await running
		const pids = this.readReady()
		if (pids.length > 0)
			await waitForCondition(
				'the producer and its descendant have exited',
				() => pids.every((pid) => !isRunning(pid)),
				{ budget: 20_000 },
			)
		return code
	}
}
