import type { ReaderCommand } from '../../setupServer.js'
import {
	createCapturePreflight,
	createCaptureSheets,
	readCaptureReaderArguments,
} from '@src/server'
import {
	READER_CONFIG,
	READER_JOURNEYS,
	createReaderWrapper,
	createStandIn,
} from '../../setupServer.js'
import { IntegrityFixture } from './IntegrityFixture.js'

/** Carries what one reader execution printed and the exit it returned. */
export interface ReaderRun {
	readonly status: number
	readonly stdout: string
	readonly stderr: string
}

/**
 * Owns an integrity workspace that also holds a wrapper, and runs the real readers over it in this process.
 *
 * @remarks
 * The readers are the subject, so they run here with their output captured through their writers. The
 * producer is still a real Node child writing real files, and the wrapper is a real module that the
 * Vitest stand-in imports when a reader discovers it, so the readers import no Vite.
 */
export class ReaderFixture extends IntegrityFixture {
	/** Creates the committed workspace and writes the wrapper the readers discover and the stand-in that answers. */
	constructor() {
		super()
		try {
			this.write(READER_CONFIG, createReaderWrapper(this.root))
			this.write('node_modules/vitest/vitest.mjs', createStandIn())
		} catch (error) {
			// A throwing constructor returns no instance, so no caller's finally block can destroy it.
			this.destroy()
			throw error
		}
	}

	/**
	 * Runs one reader over the workspace and gathers its output.
	 *
	 * @param command - The reader to run
	 * @param args - The selector and flags after the entry name; the wrapper and artifact directory are added
	 * @returns The exit, the output, and the refusals
	 * @throws Thrown when the contact sheets are requested without an output directory.
	 */
	async run(command: ReaderCommand, args: readonly string[]): Promise<ReaderRun> {
		const stdout: string[] = []
		const stderr: string[] = []
		const parsed = readCaptureReaderArguments(args, this.root, {
			config: READER_CONFIG,
			journeys: READER_JOURNEYS,
		})
		const reader = {
			...parsed.reader,
			stdout: (text: string) => stdout.push(text),
			stderr: (text: string) => stderr.push(text),
		}
		if (command === 'preflight') {
			const status = await createCapturePreflight(reader).execute()
			return { status, stdout: stdout.join(''), stderr: stderr.join('') }
		}
		if (parsed.output === undefined) throw new Error('Contact sheets require --output')
		const status = await createCaptureSheets({ reader, output: parsed.output }).execute()
		return { status, stdout: stdout.join(''), stderr: stderr.join('') }
	}
}
