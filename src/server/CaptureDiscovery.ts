import type {
	CaptureDiscoveryInterface,
	CaptureExecutionResult,
	CaptureDiscoveryRequest,
	CaptureDiscoveryRunOptions,
	CaptureHostDescription,
} from './types.js'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { attempt, parseJSON } from '@orkestrel/contract'
import { CAPTURE_VERSION, CaptureError, describeCaptureError, isCapturePath } from '@src/core'
import { CAPTURE_DISCOVERY, CAPTURE_VITEST_ENTRY } from './constants.js'
import { readCaptureDescription, resolveCaptureRelative } from './helpers.js'

/**
 * Reads a consumer's wrapper by running the consumer's installed Vitest in discovery mode.
 *
 * @remarks
 * The runner never loads the wrapper itself, so it imports neither Vite nor Vitest. It publishes an
 * atomic request with the `discover` phase, spawns the consumer's own Vitest entry through Node as
 * `list --filesOnly --config <wrapper> --configLoader runner`, and reads back the description the
 * wrapper writes when it calls `answerCaptureDiscovery`. The child is bounded by a deadline and
 * recorded by the invocation, so an interrupt ends it with the rest of its tree. The description is
 * accepted only after the child exited zero and every echo in it matches this exchange: the
 * invocation, the challenge, the wrapper, this process as the wrapper's parent, and the spawned
 * child as its writer. A wrapper that never answers, answers another exchange, or answers twice
 * from different processes is refused.
 *
 * @example
 * ```ts
 * const discovery = new CaptureDiscovery({ root: process.cwd(), config, invocation })
 * const { projects } = await discovery.describe()
 * ```
 */
export class CaptureDiscovery implements CaptureDiscoveryInterface {
	readonly #options: CaptureDiscoveryRunOptions

	/**
	 * Binds the workspace, the wrapper, and the invocation that owns the child.
	 *
	 * @param options - The workspace, the absolute wrapper path, the invocation, and the optional mode and deadline
	 */
	constructor(options: CaptureDiscoveryRunOptions) {
		this.#options = options
	}

	async describe(): Promise<CaptureHostDescription> {
		const { root, config, invocation, mode, deadline } = this.#options
		const relative = resolveCaptureRelative(root, config)
		if (!isCapturePath(relative))
			throw new CaptureError('Config must be a contained repository path', { code: 'USAGE' })
		if (!existsSync(resolve(root, config)))
			throw new CaptureError(`Cannot find the journey wrapper: ${relative}`, {
				code: 'USAGE',
				context: { config: relative },
			})
		const entry = resolve(root, CAPTURE_VITEST_ENTRY)
		if (!existsSync(entry))
			throw new CaptureError(
				`Cannot find the consumer's installed Vitest: ${CAPTURE_VITEST_ENTRY}; install vitest in the workspace`,
				{ code: 'HOST' },
			)
		const nonce = randomUUID()
		const args = [
			entry,
			...CAPTURE_DISCOVERY.arguments,
			'--config',
			resolve(root, config),
			...(mode === undefined ? [] : ['--mode', mode]),
			'--configLoader',
			'runner',
		]
		const request: CaptureDiscoveryRequest = {
			version: CAPTURE_VERSION,
			phase: CAPTURE_DISCOVERY.phase,
			id: invocation.id,
			nonce,
			config: relative,
			pid: process.pid,
			args,
		}
		const answer = resolve(invocation.directory, CAPTURE_DISCOVERY.description)
		const log = resolve(invocation.directory, 'discovery.log')
		const limit = deadline ?? CAPTURE_DISCOVERY.deadline
		invocation.prepare()
		rmSync(answer, { force: true })
		const result = await this.#run(request, args, log, limit)
		if (invocation.interrupted)
			throw new CaptureError('Runner interrupted', {
				code: 'STAGE',
				context: { phase: 'discover' },
			})
		if (result.expired === true)
			throw new CaptureError(
				`Discovery of ${relative} did not finish within ${String(limit)} ms; the child was ended`,
				{ code: 'HOST', context: { config: relative } },
			)
		if (result.code !== 0 || result.signal !== null)
			throw new CaptureError(
				`Discovery of ${relative} did not exit successfully (${String(result.code ?? result.signal)}); see ${log}`,
				{ code: 'HOST', context: { config: relative } },
			)
		if (!existsSync(answer))
			throw new CaptureError(
				`The wrapper ${relative} answered no discovery request; call answerCaptureDiscovery before any other work`,
				{ code: 'HOST', context: { config: relative } },
			)
		const read = attempt(() => parseJSON(readFileSync(answer, 'utf8')))
		if (!read.success)
			throw new CaptureError(
				`The host description cannot be read: ${describeCaptureError(read.error)}`,
				{
					code: 'HOST',
					cause: read.error,
				},
			)
		return readCaptureDescription(read.value, {
			id: invocation.id,
			nonce,
			config: relative,
			parent: process.pid,
			pid: result.pid,
		})
	}

	// Publishes the request for the length of the child, and withdraws it whatever the child does.
	async #run(
		request: CaptureDiscoveryRequest,
		args: readonly string[],
		log: string,
		deadline: number,
	): Promise<CaptureExecutionResult> {
		const { invocation } = this.#options
		try {
			invocation.publish(request)
			return await invocation.spawn(args, log, true, deadline)
		} finally {
			invocation.retract()
		}
	}
}
