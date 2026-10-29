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
	CAPTURE_SURVIVORS_FILE,
	CAPTURE_OWNER_FILE,
	CAPTURE_OWNER_TIMEOUT,
	CAPTURE_OWNER_BACKOFF,
} from './constants.js'
import {
	readCaptureRequestOwner,
	readCaptureRunning,
	settleCaptureShutdown,
	matchesCaptureTransient,
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
	readonly #unconfirmed = new Set<number>()
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
			if (this.#termination !== undefined) await this.#termination
			failures.push(
				...(await settleCaptureShutdown(
					() => this.retract(),
					[...this.#children].map((child) => () => this.#stop(child)),
				)),
			)
		} catch (error) {
			failures.push(error)
		} finally {
			process.off('SIGINT', this.#interrupt)
			process.off('SIGTERM', this.#interrupt)
			if (this.#lease !== undefined) {
				const removal = attempt(() => {
					const deadline = performance.now() + CAPTURE_OWNER_TIMEOUT
					const marker = attempt(() => this.#read(deadline))
					if (!marker.success) {
						if (
							marker.error instanceof Error &&
							'code' in marker.error &&
							marker.error.code === 'ENOENT'
						)
							return
						throw marker.error
					}
					if (this.#owner(marker.value).id !== this.id) return
					if (this.#unconfirmed.size > 0) {
						this.#record()
						return
					}
					this.#remove(deadline)
				})
				if (removal.success && this.#unconfirmed.size === 0) this.#lease = undefined
				else if (!removal.success) failures.push(removal.error)
			}
		}
		if (failures.length > 0 || this.#unconfirmed.size > 0)
			throw new CaptureError(
				`Capture shutdown failed${this.#unconfirmed.size === 0 ? '' : `; child termination was not confirmed for process ${[...this.#unconfirmed].join(', ')}; ownership marker retained: ${this.#lock}; child record: ${resolve(this.#directory, CAPTURE_SURVIVORS_FILE)}`}`,
				{
					code: 'STAGE',
					cause: new AggregateError(failures),
				},
			)
	}

	prepare(): void {
		const requests = resolve(this.#options.root, this.#options.requests)
		attempt(() => mkdirSync(requests, { recursive: true }))
		this.#claim()
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
			mkdirSync(this.#directory, { recursive: true })
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
				await this.#stop(session)
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
			[...this.#children].map((child) => () => this.#stop(child)),
		)
	}

	async #stop(child: SessionInterface): Promise<boolean> {
		if (child.pid !== undefined) this.#unconfirmed.add(child.pid)
		const confirmed = await (this.#options.terminate === undefined
			? child.stop()
			: this.#options.terminate(child))
		if (confirmed && child.pid !== undefined) this.#unconfirmed.delete(child.pid)
		if (confirmed) {
			await child.destroy()
			this.#children.delete(child)
		}
		return confirmed
	}

	#read(deadline: number): string {
		const result = attempt(() =>
			this.#options.ownership?.read === undefined
				? readFileSync(this.#lock, 'utf8')
				: this.#options.ownership.read(this.#lock),
		)
		if (result.success) return result.value
		if (!matchesCaptureTransient(result.error, this.#options.ownership?.platform))
			throw result.error
		this.#backoff(deadline, result.error)
		return this.#read(deadline)
	}

	#remove(deadline: number): void {
		const result = attempt(() => {
			// Re-read on every retry, including after a failed unlink.
			if (this.#owner(this.#read(deadline)).id !== this.id) return
			if (this.#options.ownership?.remove === undefined) rmSync(this.#lock, { force: true })
			else this.#options.ownership.remove(this.#lock)
		})
		if (result.success) return
		if (result.error instanceof Error && 'code' in result.error && result.error.code === 'ENOENT')
			return
		if (!matchesCaptureTransient(result.error, this.#options.ownership?.platform))
			throw result.error
		this.#backoff(deadline, result.error)
		this.#remove(deadline)
	}

	#record(retry = true): void {
		const file = resolve(this.#directory, CAPTURE_SURVIVORS_FILE)
		const text = JSON.stringify({
			pid: process.pid,
			id: this.id,
			command: this.#options.command,
			children: [...this.#unconfirmed],
			at: new Date().toISOString(),
		})
		try {
			if (this.#options.ownership?.write === undefined) writeFileSync(file, text, { flag: 'wx' })
			else this.#options.ownership.write(file, text)
		} catch (error) {
			const code =
				error instanceof Error && 'code' in error ? String(error.code) : describeCaptureError(error)
			if (code === 'EEXIST') return
			if (code === 'ENOENT' && retry) {
				mkdirSync(this.#directory, { recursive: true })
				return this.#record(false)
			}
			throw new CaptureError(`Cannot write capture child record (${code}): ${file}`, {
				code: 'STAGE',
				cause: error,
			})
		}
	}

	#write(file: string, text: string): void {
		try {
			if (this.#options.ownership?.write === undefined) writeFileSync(file, text, { flag: 'wx' })
			else this.#options.ownership.write(file, text)
		} catch (error) {
			throw new CaptureError(
				`Cannot write capture ownership temporary (${error instanceof Error && 'code' in error ? String(error.code) : describeCaptureError(error)}): ${file}`,
				{ code: 'STAGE', cause: error },
			)
		}
	}

	#backoff(deadline: number, error?: unknown): void {
		const left = deadline - performance.now()
		if (left <= 0)
			throw new CaptureError(
				`Capture ownership marker is temporarily unavailable (${error instanceof Error && 'code' in error ? String(error.code) : 'contention'}): ${this.#lock}; rerun after serializing capture commands`,
				{ code: 'STAGE', cause: error },
			)
		Atomics.wait(
			new Int32Array(new SharedArrayBuffer(4)),
			0,
			0,
			Math.min(CAPTURE_OWNER_BACKOFF, left),
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
		const requests = resolve(this.#options.root, this.#options.requests)
		for (const name of readdirSync(requests)) {
			if (!name.startsWith(`${CAPTURE_OWNER_FILE}.`) || !name.endsWith('.tmp')) continue
			const [pid] = name.slice(CAPTURE_OWNER_FILE.length + 1).split('.')
			if (
				pid !== undefined &&
				/^\d+$/u.test(pid) &&
				Number.isSafeInteger(Number(pid)) &&
				Number(pid) > 0 &&
				!readCaptureRunning(Number(pid))
			)
				attempt(() => rmSync(resolve(requests, name), { force: true }))
		}
		const temporary = `${this.#lock}.${String(process.pid)}.${this.id}.tmp`
		try {
			this.#write(temporary, JSON.stringify({ pid: process.pid, id: this.id }))
			const deadline = performance.now() + CAPTURE_OWNER_TIMEOUT
			this.#acquire(temporary, deadline)
		} catch (error) {
			if (isCaptureError(error)) throw error
			const code =
				error instanceof Error && 'code' in error ? String(error.code) : describeCaptureError(error)
			const unsupported = [
				'ENOTSUP',
				'EOPNOTSUPP',
				'ENOSYS',
				'EXDEV',
				...((this.#options.ownership?.platform ?? process.platform) === 'win32' ? [] : ['EPERM']),
			].includes(code)
			throw new CaptureError(
				`Cannot link capture ownership (${code}): ${this.#lock}${unsupported ? '; the store directory must support hard links' : '; inspect the filesystem error and rerun'}`,
				{ code: 'STAGE', cause: error },
			)
		} finally {
			rmSync(temporary, { force: true })
		}
	}

	#acquire(temporary: string, deadline: number): void {
		const opened = attempt(() =>
			this.#options.ownership?.link === undefined
				? linkSync(temporary, this.#lock)
				: this.#options.ownership.link(temporary, this.#lock),
		)
		if (opened.success) {
			this.#lease = this.id
			return
		}
		if (matchesCaptureTransient(opened.error, this.#options.ownership?.platform)) {
			this.#backoff(deadline, opened.error)
			return this.#acquire(temporary, deadline)
		}
		if (
			!(opened.error instanceof Error) ||
			!('code' in opened.error) ||
			opened.error.code !== 'EEXIST'
		)
			throw opened.error
		const marker = attempt(() => this.#read(deadline))
		if (!marker.success) {
			if (
				marker.error instanceof Error &&
				'code' in marker.error &&
				marker.error.code === 'ENOENT'
			) {
				this.#backoff(deadline)
				return this.#acquire(temporary, deadline)
			}
			if (isCaptureError(marker.error)) throw marker.error
			throw new CaptureError(
				`Capture ownership marker is unreadable: ${this.#lock}; rerun after inspecting the filesystem error`,
				{
					code: 'STAGE',
					cause: marker.error,
				},
			)
		}
		const owner = attempt(() => this.#owner(marker.value))
		const alive = owner.success
			? (this.#options.ownership?.alive ?? readCaptureRunning)(owner.value.pid)
			: undefined
		// Confirm the content after the liveness probe, or after a yield for malformed content.
		if (!owner.success) this.#backoff(deadline)
		const confirmed = attempt(() => this.#read(deadline))
		if (!confirmed.success) {
			if (
				confirmed.error instanceof Error &&
				'code' in confirmed.error &&
				confirmed.error.code === 'ENOENT'
			) {
				this.#backoff(deadline)
				return this.#acquire(temporary, deadline)
			}
			if (isCaptureError(confirmed.error)) throw confirmed.error
			throw new CaptureError(
				`Capture ownership marker is unreadable: ${this.#lock}; rerun after inspecting the filesystem error`,
				{ code: 'STAGE', cause: confirmed.error },
			)
		}
		if (confirmed.value !== marker.value) {
			this.#backoff(deadline)
			return this.#acquire(temporary, deadline)
		}
		if (!owner.success) throw owner.error
		this.#refuse(owner.value, alive === true)
	}

	#owner(marker: string): CaptureOwnership {
		if (marker === '')
			throw new CaptureError(
				`Capture ownership marker is empty; confirm no capture process or surviving child is running and inspect this file: ${this.#lock}; its holder cannot be established`,
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
				`Capture ownership marker is malformed; expected { pid: positive integer, id: nonempty string }, received ${preview(marker)}; confirm no capture process or surviving child is running and inspect this file: ${this.#lock}`,
				{ code: 'STAGE' },
			)
		return {
			pid: owner.value.pid,
			id: owner.value.id,
		}
	}

	#refuse(holder: CaptureOwnership, alive: boolean): never {
		if (!alive)
			throw new CaptureError(
				`Capture ownership process ${String(holder.pid)} is not running; invocation ${preview(holder.id)}. ${this.#survivors(holder)} Confirm no capture process or surviving child is running and re-read ${this.#lock} to confirm it still names pid ${String(holder.pid)} before you delete this file and rerun`,
				{ code: 'STAGE' },
			)
		throw new CaptureError(
			`Another runner holds this workspace (process ${preview(holder.pid)}); invocation ${preview(holder.id)}; serialize capture commands. If this pid is not a capture run, confirm no capture process or surviving child is running and re-read ${this.#lock} to confirm it still names pid ${String(holder.pid)} before deleting`,
			{ code: 'STAGE' },
		)
	}

	#survivors(holder: CaptureOwnership): string {
		const file = resolve(
			this.#options.root,
			this.#options.requests,
			CAPTURE_RUNS_DIRECTORY,
			holder.id,
			CAPTURE_SURVIVORS_FILE,
		)
		try {
			const record: unknown = parseJSON(
				this.#options.ownership?.read === undefined
					? readFileSync(file, 'utf8')
					: this.#options.ownership.read(file),
			)
			if (
				!isRecord(record) ||
				record.pid !== holder.pid ||
				record.id !== holder.id ||
				typeof record.command !== 'string' ||
				record.command === '' ||
				typeof record.at !== 'string' ||
				!Number.isFinite(Date.parse(record.at)) ||
				!Array.isArray(record.children) ||
				!record.children.every(
					(pid: unknown) => typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0,
				)
			)
				return `Child record could not be read (EINVAL): ${file}.`
			return `Unconfirmed child processes: ${record.children.join(', ')}; stop them before deleting. Child record: ${file}.`
		} catch (error) {
			const code =
				error instanceof SyntaxError
					? 'EINVAL'
					: error instanceof Error && 'code' in error
						? String(error.code)
						: describeCaptureError(error)
			return code === 'ENOENT'
				? `No child record exists at ${file}.`
				: `Child record could not be read (${code}): ${file}.`
		}
	}
}
