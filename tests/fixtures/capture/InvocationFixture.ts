import type { ScratchInterface } from '@orkestrel/test/server'
import { createScratch } from '@orkestrel/test/server'
import { CaptureInvocation } from '@src/server'
import { RUNNER_REQUESTS } from '../../setupServer.js'

/**
 * Owns a scratch workspace and the invocations created over it, with their output captured.
 *
 * @remarks
 * Each invocation writes through the fixture's two logs, so a proof reads exactly what the
 * invocation reported without replacing any stream.
 */
export class InvocationFixture {
	readonly scratch: ScratchInterface
	readonly invocation: CaptureInvocation
	readonly stdout: string[] = []
	readonly stderr: string[] = []

	/** Creates the scratch workspace and the first invocation over it. */
	constructor() {
		this.scratch = createScratch({ prefix: 'invocation-' })
		this.invocation = this.next()
	}

	/**
	 * Creates another invocation over the same workspace and output logs.
	 *
	 * @returns A new invocation with its own identity
	 */
	next(): CaptureInvocation {
		return new CaptureInvocation({
			command: 'journey',
			root: this.scratch.path,
			requests: RUNNER_REQUESTS,
			stdout: (text) => this.stdout.push(text),
			stderr: (text) => this.stderr.push(text),
		})
	}

	/** Removes the scratch workspace. */
	destroy(): void {
		this.scratch.destroy()
	}
}
