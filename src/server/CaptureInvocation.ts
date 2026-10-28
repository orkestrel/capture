import type { SessionInterface } from '@orkestrel/process'
import type { CaptureRequest } from '@src/core'
import type {
	CaptureDiscoveryRequest,
	CaptureExecutionResult,
	CaptureInvocationInterface,
	CaptureInvocationOptions,
} from './types.js'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { createSession } from '@orkestrel/process/server'
import { createTimeout } from '@orkestrel/timeout'
import {
	CAPTURE_REQUEST_PREFIX,
	CaptureError,
	describeCaptureError,
	isCaptureError,
} from '@src/core'
import {
	CAPTURE_FLAG,
	CAPTURE_FLAG_VALUE,
	CAPTURE_REQUESTS_FLAG,
	CAPTURE_RUNS_DIRECTORY,
} from './constants.js'
import { readCaptureRequestOwner, readCaptureRunning } from './helpers.js'

/**
 * Owns one runner invocation's identity, request file, children, and interruption.
 *
 * @remarks
 * The runner creates one for discovery and each changed owner, so the abort controller, session
 * registry, and spawn log belong to an invocation. Interruption derives from the controller's
 * signal. Sessions end the Windows process tree, or signal the POSIX group with SIGTERM and then
 * SIGKILL after a 250 ms grace. A linked timeout ends discovery without interrupting the invocation.
 * Raw stdout is decoded across chunk boundaries and flushed at termination. A writer failure or
 * an observation cutoff refuses the stage rather than accepting incomplete evidence.
 *
 * @example
 * ```ts
 * const invocation = new CaptureInvocation({
 * 	command: 'journey',
 * 	root: process.cwd(),
 * 	requests: 'tmp/units',
 * 	stdout: (text) => process.stdout.write(text),
 * 	stderr: (text) => process.stderr.write(text),
 * })
 * invocation.attach()
 * ```
 */
export class CaptureInvocation implements CaptureInvocationInterface {
	readonly #options: CaptureInvocationOptions
	readonly #id = randomUUID()
	readonly #controller = new AbortController()
	readonly #children = new Set<SessionInterface>()
	readonly #launches: string[] = []
	readonly #interrupt = this.#abort.bind(this)
	readonly #request: string
	readonly #directory: string
	#termination: Promise<void> | undefined

	/**
	 * Creates the invocation entity for one runner call.
	 *
	 * @param options - The command, the workspace, the request directory, and the output writers
	 */
	constructor(options: CaptureInvocationOptions) {
		this.#options = options
		this.#request = resolve(
			options.root,
			options.requests,
			`${CAPTURE_REQUEST_PREFIX}-${String(process.pid)}.json`,
		)
		this.#directory = resolve(options.root, options.requests, CAPTURE_RUNS_DIRECTORY, this.#id)
	}

	get id(): string {
		return this.#id
	}

	get request(): string {
		return this.#request
	}

	get directory(): string {
		return this.#directory
	}

	get signal(): AbortSignal {
		return this.#controller.signal
	}

	get interrupted(): boolean {
		return this.#controller.signal.aborted
	}

	attach(): void {
		process.on('SIGINT', this.#interrupt)
		process.on('SIGTERM', this.#interrupt)
	}

	async release(): Promise<void> {
		await this.#termination
		process.off('SIGINT', this.#interrupt)
		process.off('SIGTERM', this.#interrupt)
	}

	prepare(): void {
		const requests = resolve(this.#options.root, this.#options.requests)
		mkdirSync(this.#directory, { recursive: true })
		for (const name of readdirSync(requests)) {
			const pid = readCaptureRequestOwner(name)
			if (pid === undefined || pid === process.pid) continue
			if (!readCaptureRunning(pid)) rmSync(resolve(requests, name), { force: true })
		}
	}

	holders(): readonly number[] {
		const requests = resolve(this.#options.root, this.#options.requests)
		return [
			...new Set(
				readdirSync(requests).flatMap((name) => {
					const pid = readCaptureRequestOwner(name)
					return pid === undefined || pid === process.pid || !readCaptureRunning(pid) ? [] : [pid]
				}),
			),
		]
	}

	publish(request: CaptureRequest | CaptureDiscoveryRequest): void {
		writeFileSync(`${this.#request}.tmp`, `${JSON.stringify(request)}\n`)
		renameSync(`${this.#request}.tmp`, this.#request)
	}

	retract(): void {
		rmSync(this.#request, { force: true })
		rmSync(`${this.#request}.tmp`, { force: true })
	}

	launched(log: string): boolean {
		return this.#launches.includes(log)
	}

	async spawn(
		args: readonly string[],
		log: string,
		capture: boolean,
		deadline?: number,
	): Promise<CaptureExecutionResult> {
		this.signal.throwIfAborted()
		const timeout =
			deadline === undefined ? undefined : createTimeout({ ms: deadline, signal: this.signal })
		// Keep the armed signal: a later parent abort clears the handle's expiry reading.
		const expiry = timeout?.signal
		const failure = new AbortController()
		const decoder = new StringDecoder('utf8')
		const signal = AbortSignal.any([
			this.signal,
			failure.signal,
			...(expiry === undefined ? [] : [expiry]),
		])
		try {
			writeFileSync(log, '')
			const environment = Object.fromEntries(
				Object.entries(process.env).filter(
					([name]) =>
						name.toLowerCase() !== CAPTURE_FLAG.toLowerCase() &&
						name.toLowerCase() !== CAPTURE_REQUESTS_FLAG.toLowerCase(),
				),
			)
			const session = createSession({
				command: {
					file: process.execPath,
					arguments: args,
					isolated: true,
					environment: {
						...environment,
						[CAPTURE_REQUESTS_FLAG]: resolve(this.#options.root, this.#options.requests),
						...(capture ? { [CAPTURE_FLAG]: CAPTURE_FLAG_VALUE } : {}),
					},
				},
				workspace: this.#options.root,
				grace: 250,
				signal,
				on: {
					stdout: (bytes) => {
						const text = decoder.write(Buffer.from(bytes))
						this.#options.stdout(text)
						appendFileSync(log, text)
					},
					stderr: (text) => {
						this.#options.stderr(text)
						appendFileSync(log, text)
					},
					error: (error) =>
						failure.abort(
							new CaptureError(`Capture child failed: ${describeCaptureError(error)}`, {
								code: 'STAGE',
								cause: error,
							}),
						),
				},
				// Session listeners isolate throws; a lost tee must still refuse all evidence.
				error: (error) =>
					failure.abort(
						new CaptureError('Capture child output could not be recorded', {
							code: 'STAGE',
							cause: error,
						}),
					),
			})
			this.#children.add(session)
			this.#launches.push(log)
			try {
				timeout?.start()
				this.#options.stdout(`pid=${String(session.pid)}\n`)
				await session.end()
				const outcome = await session.exit
				const tail = decoder.end()
				if (tail !== '') {
					this.#options.stdout(tail)
					appendFileSync(log, tail)
				}
				failure.signal.throwIfAborted()
				if (!outcome.drained)
					throw new CaptureError(
						'Capture child observation was cut off before its output drained',
						{
							code: 'STAGE',
						},
					)
				return {
					code: outcome.code,
					signal: outcome.signal,
					...(session.pid === undefined ? {} : { pid: session.pid }),
					...(expiry?.aborted === true ? { expired: true } : {}),
				}
			} finally {
				await session.destroy()
				this.#children.delete(session)
			}
		} catch (error) {
			if (isCaptureError(error)) throw error
			throw new CaptureError('Capture child execution failed', { code: 'STAGE', cause: error })
		} finally {
			timeout?.clear()
		}
	}

	#abort(): void {
		if (this.signal.aborted) return
		this.#controller.abort(new CaptureError('Runner interrupted', { code: 'STAGE' }))
		this.retract()
		this.#termination = Promise.all([...this.#children].map((child) => child.stop())).then(
			() => undefined,
		)
	}
}
