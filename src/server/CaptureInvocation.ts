import type { SessionInterface } from '@orkestrel/process'
import type { CaptureRequest } from '@src/core'
import type {
	CaptureDiscoveryRequest,
	CaptureExecutionResult,
	CaptureInvocationInterface,
	CaptureInvocationOptions,
	CaptureOwnership,
} from './types.js'
import { randomUUID } from 'node:crypto'
import {
	appendFileSync,
	linkSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { attempt, isRecord, parseJSON, preview } from '@orkestrel/contract'
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
	CAPTURE_OWNER_FILE,
} from './constants.js'
import {
	computeCaptureHash,
	readCaptureRequestOwner,
	readCaptureRunning,
	settleCaptureShutdown,
} from './helpers.js'

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
	readonly #lock: string
	#lease: string | undefined
	#termination: Promise<readonly unknown[]> | undefined

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
		this.#lock = resolve(options.root, options.requests, CAPTURE_OWNER_FILE)
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
		const failures: unknown[] = []
		try {
			failures.push(
				...(await (this.#termination ??
					settleCaptureShutdown(
						() => this.retract(),
						[...this.#children].map((child) => () => child.stop()),
					))),
			)
		} catch (error) {
			failures.push(error)
		} finally {
			process.off('SIGINT', this.#interrupt)
			process.off('SIGTERM', this.#interrupt)
			if (this.#lease !== undefined) {
				const removal = attempt(() => {
					const marker = attempt(() => readFileSync(this.#lock, 'utf8'))
					if (!marker.success) {
						if (
							marker.error instanceof Error &&
							'code' in marker.error &&
							marker.error.code === 'ENOENT'
						)
							return
						throw marker.error
					}
					if (this.#owner(marker.value).id === this.id) rmSync(this.#lock, { force: true })
				})
				if (removal.success) this.#lease = undefined
				else failures.push(removal.error)
			}
		}
		if (failures.length > 0)
			throw new CaptureError('Capture shutdown failed', {
				code: 'STAGE',
				cause: new AggregateError(failures),
			})
	}

	prepare(): void {
		const requests = resolve(this.#options.root, this.#options.requests)
		mkdirSync(requests, { recursive: true })
		this.#claim()
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
					return pid === undefined ||
						(pid === process.pid && this.#lease !== undefined) ||
						!readCaptureRunning(pid)
						? []
						: [pid]
				}),
			),
		]
	}

	publish(request: CaptureRequest | CaptureDiscoveryRequest): void {
		this.#claim()
		writeFileSync(`${this.#request}.tmp`, `${JSON.stringify(request)}\n`)
		renameSync(`${this.#request}.tmp`, this.#request)
	}

	retract(): void {
		if (this.#lease === undefined) return
		const results = [
			attempt(() => rmSync(this.#request, { force: true })),
			attempt(() => rmSync(`${this.#request}.tmp`, { force: true })),
		]
		const failures = results.flatMap((result) => (result.success ? [] : [result.error]))
		if (failures.length > 0)
			throw new CaptureError('Capture request removal failed', {
				code: 'STAGE',
				cause: new AggregateError(failures),
			})
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
				// The tail is written outside the session's listener isolation, so its failure joins the same refusal.
				try {
					if (tail !== '') {
						this.#options.stdout(tail)
						appendFileSync(log, tail)
					}
				} catch (error) {
					failure.abort(
						new CaptureError('Capture child output could not be recorded', {
							code: 'STAGE',
							cause: error,
						}),
					)
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
		this.#termination = settleCaptureShutdown(
			() => this.retract(),
			[...this.#children].map((child) => () => child.stop()),
		)
	}

	#claim(): void {
		if (this.#lease !== undefined) return
		const directory = attempt(() => statSync(resolve(this.#options.root, this.#options.requests)))
		if (!directory.success || !directory.value.isDirectory())
			throw new CaptureError(
				`Capture request directory is unavailable: ${resolve(this.#options.root, this.#options.requests)}`,
				{ code: 'STAGE', ...(!directory.success ? { cause: directory.error } : {}) },
			)
		const temporary = `${this.#lock}.${this.id}.tmp`
		try {
			writeFileSync(temporary, JSON.stringify({ pid: process.pid, id: this.id }), { flag: 'wx' })
			for (let iteration = 0; iteration < 64; iteration += 1) {
				const opened = attempt(() => linkSync(temporary, this.#lock))
				if (opened.success) {
					this.#lease = this.id
					return
				}
				if (
					!(opened.error instanceof Error) ||
					!('code' in opened.error) ||
					opened.error.code !== 'EEXIST'
				)
					throw opened.error
				const marker = attempt(() => readFileSync(this.#lock, 'utf8'))
				if (!marker.success) {
					if (
						marker.error instanceof Error &&
						'code' in marker.error &&
						marker.error.code === 'ENOENT'
					)
						continue
					throw new CaptureError(`Capture ownership marker is unreadable: ${this.#lock}`, {
						code: 'STAGE',
						cause: marker.error,
					})
				}
				const owner = this.#owner(marker.value)
				if (readCaptureRunning(owner.pid)) this.#refuse(owner)
				this.#reserve(marker.value, temporary)
				const moved = `${this.#lock}.${randomUUID()}.stale`
				const renamed = attempt(() => renameSync(this.#lock, moved))
				if (!renamed.success) {
					if (
						renamed.error instanceof Error &&
						'code' in renamed.error &&
						renamed.error.code === 'ENOENT'
					)
						continue
					throw renamed.error
				}
				try {
					const actual = readFileSync(moved, 'utf8')
					if (actual !== marker.value) {
						const restored = attempt(() => linkSync(moved, this.#lock))
						if (
							!restored.success &&
							(!(restored.error instanceof Error) ||
								!('code' in restored.error) ||
								restored.error.code !== 'EEXIST')
						)
							throw restored.error
						continue
					}
					this.#options.stderr(
						`Reclaimed stale capture ownership from process ${String(owner.pid)}; invocation ${preview(owner.id)}\n`,
					)
				} finally {
					rmSync(moved, { force: true })
				}
			}
			throw new CaptureError(
				'Capture ownership changed repeatedly; retry after serializing capture commands',
				{ code: 'STAGE' },
			)
		} catch (error) {
			if (isCaptureError(error)) throw error
			throw new CaptureError(`Cannot claim capture ownership: ${this.#lock}`, {
				code: 'STAGE',
				cause: error,
			})
		} finally {
			rmSync(temporary, { force: true })
		}
	}

	#owner(marker: string): CaptureOwnership {
		if (marker === '')
			throw new CaptureError(
				`Capture ownership marker is empty: ${this.#lock}; its holder cannot be established`,
				{ code: 'STAGE' },
			)
		const owner = attempt(() => parseJSON(marker))
		if (
			!owner.success ||
			!isRecord(owner.value) ||
			typeof owner.value.pid !== 'number' ||
			!Number.isSafeInteger(owner.value.pid) ||
			owner.value.pid <= 0 ||
			typeof owner.value.id !== 'string' ||
			owner.value.id === ''
		)
			throw new CaptureError(
				`Capture ownership marker is malformed: ${this.#lock}; expected { pid: positive integer, id: nonempty string }, received ${preview(marker)}`,
				{ code: 'STAGE' },
			)
		return { pid: owner.value.pid, id: owner.value.id }
	}

	#reserve(marker: string, temporary: string): void {
		// Retain fences so a delayed reader of a stale identity cannot rename its replacement.
		let predecessor = marker
		for (let iteration = 0; iteration < 64; iteration += 1) {
			const fence = `${this.#lock}.reclaim-${computeCaptureHash(predecessor)}`
			const reserved = attempt(() => linkSync(temporary, fence))
			if (reserved.success) return
			if (
				!(reserved.error instanceof Error) ||
				!('code' in reserved.error) ||
				reserved.error.code !== 'EEXIST'
			)
				throw reserved.error
			predecessor = readFileSync(fence, 'utf8')
			const owner = this.#owner(predecessor)
			if (owner.id === this.id) return
			if (readCaptureRunning(owner.pid)) this.#refuse(owner)
		}
		throw new CaptureError(
			'Capture reclaim history exceeds its retry budget; inspect the request directory before retrying',
			{ code: 'STAGE' },
		)
	}

	#refuse(holder: CaptureOwnership): never {
		throw new CaptureError(
			`Another runner holds this workspace (process ${preview(holder.pid)}); invocation ${preview(holder.id)}; serialize capture commands. If this pid is not a capture run, inspect ${this.#lock} and remove the stale marker only after confirming no capture run owns this request directory`,
			{ code: 'STAGE' },
		)
	}
}
