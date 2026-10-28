import type { ChildProcess } from 'node:child_process'
import type { CaptureRequest } from '@src/core'
import type {
	CaptureDiscoveryRequest,
	CaptureExecutionResult,
	CaptureInvocationInterface,
	CaptureInvocationOptions,
} from './types.js'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PROCESS_CONFIRMATION } from '@orkestrel/process'
import { killProcess, killTree } from '@orkestrel/process/server'
import { CAPTURE_REQUEST_PREFIX, CaptureError } from '@src/core'
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
 * The runner creates one per call, so the abort controller, the child registry, the spawn log, and
 * the interrupt flag belong to that call and never to the runner. An interrupt ends each child's
 * process tree through `killTree` on win32, where the platform has no signal a process group can
 * receive, and through `killProcess` on every other host, which signals the detached group.
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
	readonly #children = new Set<ChildProcess>()
	readonly #expired = new Set<ChildProcess>()
	readonly #launches: string[] = []
	readonly #interrupt = this.#abort.bind(this)
	readonly #request: string
	readonly #directory: string
	#interrupted = false
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
		return this.#interrupted
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

	spawn(
		args: readonly string[],
		log: string,
		capture: boolean,
		deadline?: number,
	): Promise<CaptureExecutionResult> {
		this.#launches.push(log)
		writeFileSync(log, '')
		const environment = Object.fromEntries(
			Object.entries(process.env).filter(
				([name]) =>
					name.toLowerCase() !== CAPTURE_FLAG.toLowerCase() &&
					name.toLowerCase() !== CAPTURE_REQUESTS_FLAG.toLowerCase(),
			),
		)
		// The child reads the directory the runner publishes to, so a wrapper never repeats it.
		const inherited = {
			...environment,
			[CAPTURE_REQUESTS_FLAG]: resolve(this.#options.root, this.#options.requests),
		}
		const child = spawn(process.execPath, args, {
			cwd: this.#options.root,
			env: capture ? { ...inherited, [CAPTURE_FLAG]: CAPTURE_FLAG_VALUE } : inherited,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
			detached: process.platform !== 'win32',
		})
		this.#children.add(child)
		const timer =
			deadline === undefined
				? undefined
				: setTimeout(() => {
						this.#expired.add(child)
						void this.#terminate(child)
					}, deadline)
		this.#options.stdout(`pid=${String(child.pid)}\n`)
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			this.#options.stdout(chunk)
			appendFileSync(log, chunk)
		})
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			this.#options.stderr(chunk)
			appendFileSync(log, chunk)
		})
		return new Promise((done) => {
			child.once('error', (error) => {
				this.#options.stderr(`${error.message}\n`)
			})
			child.once('close', (code, signal) => {
				clearTimeout(timer)
				this.#children.delete(child)
				done({
					code,
					signal,
					...(child.pid === undefined ? {} : { pid: child.pid }),
					...(this.#expired.has(child) ? { expired: true } : {}),
				})
			})
		})
	}

	#abort(): void {
		if (this.#interrupted) return
		this.#interrupted = true
		this.#controller.abort(new CaptureError('Runner interrupted', { code: 'STAGE' }))
		this.retract()
		this.#termination = Promise.all(
			[...this.#children].map((child) => this.#terminate(child)),
		).then(() => undefined)
	}

	async #terminate(child: ChildProcess): Promise<void> {
		if (child.pid === undefined) return
		if (process.platform === 'win32') await killTree(child.pid, PROCESS_CONFIRMATION)
		else killProcess(child, 'SIGKILL')
	}
}
