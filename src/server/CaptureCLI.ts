import type { CaptureCLIInterface, CaptureCLIOptions, CaptureWriteHandler } from './types.js'
import { CaptureError, describeCaptureError, isCaptureError } from '@src/core'
import { CapturePreflight } from './CapturePreflight.js'
import { CaptureRegistrar } from './CaptureRegistrar.js'
import { CaptureRunner } from './CaptureRunner.js'
import { CaptureSheets } from './CaptureSheets.js'
import { CAPTURE_DEFAULTS, CAPTURE_SUBCOMMANDS, CAPTURE_USAGE } from './constants.js'
import { readCaptureReaderArguments, resolveCaptureExit } from './helpers.js'

/**
 * Dispatches capture commands and maps usage and evidence refusals to their exit codes.
 *
 * @remarks
 * The executable's whole behaviour: it reads the subcommand, hands the rest of the command line to
 * the runner, the registry refresh, the preflight, or the contact sheets, and turns a refused
 * usage into exit 64 and any other capture refusal into exit 1, writing the refusal to its error
 * writer. An error that is not a capture refusal propagates.
 *
 * @example
 * ```ts
 * const exit = await new CaptureCLI().execute(['journey', 'pages:mail'])
 * ```
 */
export class CaptureCLI implements CaptureCLIInterface {
	readonly #root: string
	readonly #stdout: CaptureWriteHandler
	readonly #stderr: CaptureWriteHandler

	/** Creates the executable with the working directory and process writers as defaults. */
	constructor(options: CaptureCLIOptions = {}) {
		this.#root = options.root ?? process.cwd()
		this.#stdout = options.stdout ?? process.stdout.write.bind(process.stdout)
		this.#stderr = options.stderr ?? process.stderr.write.bind(process.stderr)
	}

	/**
	 * Executes one command line and returns its exit code after every child has settled.
	 *
	 * @param args - The arguments following the executable name
	 * @returns 0 for passed work, 1 for failed evidence, or 64 for refused usage
	 * @example
	 * ```ts
	 * await new CaptureCLI().execute([]) // 64, with usage written to stderr
	 * ```
	 */
	async execute(args: readonly string[]): Promise<number> {
		try {
			const [name, ...argv] = args
			const root = this.#root
			if (name === undefined || !CAPTURE_SUBCOMMANDS.includes(name))
				throw new CaptureError(
					`${name === undefined ? 'No command given' : `Unknown command ${JSON.stringify(name.slice(0, 80))}`}.\n${CAPTURE_USAGE}`,
					{ code: 'USAGE' },
				)
			switch (name) {
				case 'journey':
				case 'frames':
				case 'stale': {
					const command = name === 'frames' ? 'capture' : name === 'stale' ? 'stale' : 'journey'
					return await new CaptureRunner({
						command,
						root,
						config: CAPTURE_DEFAULTS.config,
						requests: CAPTURE_DEFAULTS.requests,
						argv,
						stdout: this.#stdout,
						stderr: this.#stderr,
					}).execute()
				}
				case 'registry': {
					return await new CaptureRegistrar({
						root,
						config: CAPTURE_DEFAULTS.config,
						requests: CAPTURE_DEFAULTS.requests,
						argv,
						stdout: this.#stdout,
						stderr: this.#stderr,
					}).execute()
				}
				case 'preflight': {
					const { reader } = readCaptureReaderArguments(argv, root, CAPTURE_DEFAULTS, 'preflight')
					return await new CapturePreflight({
						...reader,
						stdout: this.#stdout,
						stderr: this.#stderr,
					}).execute()
				}
				default: {
					const { reader, output } = readCaptureReaderArguments(argv, root, CAPTURE_DEFAULTS)
					if (output === undefined)
						throw new CaptureError(
							'The sheets command requires --output <new directory>, which must not exist and must sit outside the selected capture directories',
							{ code: 'USAGE' },
						)
					return await new CaptureSheets({
						reader: { ...reader, stdout: this.#stdout, stderr: this.#stderr },
						output,
					}).execute()
				}
			}
		} catch (error) {
			if (!isCaptureError(error)) throw error
			this.#stderr(`${describeCaptureError(error)}\n`)
			return resolveCaptureExit(error)
		}
	}
}
