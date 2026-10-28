import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { waitForEvent } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'

/**
 * Starts and ends the real Node processes the runner proofs need as a live or dead process id.
 *
 * @remarks
 * Every process runs a TypeScript fixture in this directory through the host's own Node, so a
 * proof names a process that exists or provably does not, never a made-up number.
 */
export class ProcessFixture {
	/**
	 * Runs a short-lived process to its end and returns the process id it held.
	 *
	 * @returns The id of a process that has exited
	 * @throws Thrown when the host spawns no process or still reads the id as running.
	 */
	static async exited(): Promise<number> {
		const child = spawn(process.execPath, [resolve(import.meta.dirname, 'Reporter.ts')], {
			windowsHide: true,
			stdio: 'ignore',
		})
		await waitForEvent<readonly [number | null, NodeJS.Signals | null]>(
			(receive) => {
				child.once('close', receive)
				return () => child.off('close', receive)
			},
			'the reporter closes',
			{ budget: 20_000 },
		)
		if (child.pid === undefined) throw new Error('The reporter fixture spawned no process')
		if (isRunning(child.pid)) throw new Error('The exited fixture still reads as running')
		return child.pid
	}

	/**
	 * Starts a process that stays alive until stopped and waits until it reports ready.
	 *
	 * @returns The running process
	 */
	static async sleeper(): Promise<ChildProcess> {
		const child = spawn(process.execPath, [resolve(import.meta.dirname, 'Sleeper.ts')], {
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		await waitForEvent<readonly [unknown]>(
			(receive) => {
				child.stdout.once('data', receive)
				return () => child.stdout.off('data', receive)
			},
			'the sleeper is ready',
			{ budget: 20_000 },
		)
		return child
	}

	/**
	 * Ends a process this fixture started and waits for its streams to close.
	 *
	 * @param child - The process to end
	 */
	static async stop(child: ChildProcess): Promise<void> {
		const closed = waitForEvent<readonly [number | null, NodeJS.Signals | null]>(
			(receive) => {
				child.once('close', receive)
				return () => child.off('close', receive)
			},
			'the fixture process closes',
			{ budget: 20_000 },
		)
		child.kill()
		await closed
	}
}
