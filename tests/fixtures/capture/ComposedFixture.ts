import type { CaptureCommand } from '@src/server'
import type { ComposedExecution, ComposedRun } from '../../setupServer.js'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { waitForCondition } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { createCaptureRegistrar, createCaptureRunner } from '@src/server'
import {
	COMPOSED_REQUESTS,
	READER_CONFIG,
	createComposedWrapper,
	createStandIn,
	withEnvironment,
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
	 * an executable's built-in defaults need
	 */
	constructor(options: { readonly config?: string; readonly requests?: string } = {}) {
		super()
		this.config = options.config ?? READER_CONFIG
		this.requests = options.requests ?? COMPOSED_REQUESTS
		try {
			this.write(this.config, createComposedWrapper(this.root))
			this.write('node_modules/vitest/vitest.mjs', createStandIn(this.requests))
		} catch (error) {
			// A throwing constructor returns no instance, so no caller's finally block can destroy it.
			this.destroy()
			throw error
		}
	}

	/**
	 * Runs one runner command over the workspace with the real engine.
	 *
	 * @param command - The runner command
	 * @param argv - The command line after the subcommand
	 * @param options - The environment and whether to interrupt once the child is up
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
				}).execute(),
			options,
		)
		return { code, stdout: stdout.join(''), stderr: stderr.join('') }
	}

	/**
	 * Runs the registry refresh over the workspace.
	 *
	 * @param argv - The command line after the subcommand
	 * @param options - The environment and whether to interrupt once the child is up
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
				}).execute(),
			options,
		)
		return { code, stdout: stdout.join(''), stderr: stderr.join('') }
	}

	async #watch(start: () => Promise<number>, options: ComposedExecution): Promise<number> {
		const ready = resolve(this.root, 'ready.json')
		rmSync(ready, { force: true })
		const running = withEnvironment(options.environment ?? {}, start)
		if (options.interrupt === true) {
			await waitForCondition('the producer reports ready', () => existsSync(ready), {
				budget: 20_000,
			})
			process.emit('SIGINT')
		}
		const code = await running
		if (existsSync(ready)) {
			const reading: unknown = parseJSON(readFileSync(ready, 'utf8'))
			if (isRecord(reading) && typeof reading.pid === 'number') {
				const { pid } = reading
				await waitForCondition('the producer has exited', () => !isRunning(pid), {
					budget: 20_000,
				})
			}
		}
		return code
	}
}
