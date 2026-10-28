import type {
	CaptureCLIInterface,
	CaptureCLIOptions,
	CaptureDiscoveryInterface,
	CaptureDiscoveryRunOptions,
	CaptureIntegrityInterface,
	CaptureIntegrityOptions,
	CapturePreflightInterface,
	CaptureReaderOptions,
	CaptureRegistrarInterface,
	CaptureRegistrarOptions,
	CaptureRunnerInterface,
	CaptureRunnerOptions,
	CaptureSheetOptions,
	CaptureSheetsInterface,
} from './types.js'
import { CaptureCLI } from './CaptureCLI.js'
import { CaptureDiscovery } from './CaptureDiscovery.js'
import { CaptureIntegrity } from './CaptureIntegrity.js'
import { CapturePreflight } from './CapturePreflight.js'
import { CaptureRegistrar } from './CaptureRegistrar.js'
import { CaptureRunner } from './CaptureRunner.js'
import { CaptureSheets } from './CaptureSheets.js'

/**
 * Creates the integrity engine bound to an explicit workspace and host portfolio mapping.
 *
 * @param options - The workspace, evidence paths, authorized physical roots, and optional file hash
 * @returns A new engine that stamps stages, reads declarations, checks freshness, and resolves states
 * @throws Thrown when the root is not absolute, a path escapes the root, or a portfolio is invalid.
 *
 * @example
 * ```ts
 * const integrity = createCaptureIntegrity({
 * 	root: process.cwd(),
 * 	directory: 'tmp/captures/states',
 * 	inputs: ['src/**'],
 * 	registry: 'tmp/captures/states/registry.json',
 * 	manifest: 'tmp/captures/states/manifest.json',
 * 	lookups: 'tmp/captures/states/lookups.json',
 * 	portfolios: [{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }],
 * })
 * ```
 */
export function createCaptureIntegrity(
	options: CaptureIntegrityOptions,
): CaptureIntegrityInterface {
	return new CaptureIntegrity(options)
}

/**
 * Creates the runner that drives owner-selected journeys for one command line.
 *
 * @param options - The command, the workspace, the wrapper default, the request directory, the command line, and optional output and engine seams
 * @returns A new runner whose `execute` runs the command and returns its exit status
 *
 * @example
 * ```ts
 * const runner = createCaptureRunner({
 * 	command: 'journey',
 * 	root: process.cwd(),
 * 	config: 'configs/app/vite.journey.config.ts',
 * 	requests: 'tmp/units',
 * 	argv: ['pages:mail', '--variant', 'light-390'],
 * })
 * const exit = await runner.execute() // 0 when every stage passed
 * ```
 */
export function createCaptureRunner(options: CaptureRunnerOptions): CaptureRunnerInterface {
	return new CaptureRunner(options)
}

/**
 * Creates the preflight that judges the selected frames' freshness, framing, and coverage.
 *
 * @param options - The workspace, the wrapper, the selection, the journey artifact directory, and optional checks module and output seams
 * @returns A new preflight whose `execute` prints its report and returns the exit status
 *
 * @example
 * ```ts
 * const preflight = createCapturePreflight({
 * 	root: process.cwd(),
 * 	config: `${process.cwd()}/configs/app/vite.journey.config.ts`,
 * 	selection: { selector: 'pages:mail' },
 * 	journeys: `${process.cwd()}/tmp/journey`,
 * })
 * const exit = await preflight.execute() // 0 when every selected frame is current and sound
 * ```
 */
export function createCapturePreflight(options: CaptureReaderOptions): CapturePreflightInterface {
	return new CapturePreflight(options)
}

/**
 * Creates the contact-sheet writer for the selected frames.
 *
 * @param options - The reader options that select the frames and the new directory that receives the sheets
 * @returns A new writer whose `execute` writes the sheets and returns the exit status
 *
 * @example
 * ```ts
 * const sheets = createCaptureSheets({ reader, output: `${process.cwd()}/tmp/sheets` })
 * const exit = await sheets.execute() // 0 when every selected frame is current and sound
 * ```
 */
export function createCaptureSheets(options: CaptureSheetOptions): CaptureSheetsInterface {
	return new CaptureSheets(options)
}

/**
 * Creates the discovery that reads a consumer's wrapper through the consumer's own Vitest.
 *
 * @param options - The workspace, the absolute wrapper path, the invocation that owns the child, and the optional mode and deadline
 * @returns A new discovery whose `describe` publishes the request and returns the wrapper's host description
 *
 * @example
 * ```ts
 * const discovery = createCaptureDiscovery({ root: process.cwd(), config, invocation })
 * const { projects } = await discovery.describe()
 * ```
 */
export function createCaptureDiscovery(
	options: CaptureDiscoveryRunOptions,
): CaptureDiscoveryInterface {
	return new CaptureDiscovery(options)
}

/**
 * Creates the registry refresh that runs each producing variant's complete journey and publishes the registry.
 *
 * @param options - The workspace, the wrapper default, the request directory, the command line, and optional output seams
 * @returns A new refresh whose `execute` publishes `registry.json` and returns the exit status
 *
 * @example
 * ```ts
 * const registrar = createCaptureRegistrar({
 * 	root: process.cwd(),
 * 	config: 'configs/app/vite.journey.config.ts',
 * 	requests: 'tmp/capture',
 * 	argv: ['--variant', 'light-390'],
 * })
 * const exit = await registrar.execute() // 0 when the registry was published
 * ```
 */
export function createCaptureRegistrar(
	options: CaptureRegistrarOptions,
): CaptureRegistrarInterface {
	return new CaptureRegistrar(options)
}

/**
 * Creates the executable's command dispatcher over a workspace and injected writers.
 *
 * @param options - The workspace and the report and diagnostic writers; default: the working directory and the process streams
 * @returns A new dispatcher whose `execute` runs one command line and returns its exit code
 *
 * @example
 * ```ts
 * const exit = await createCaptureCLI().execute(['journey', 'pages:mail']) // 0 when the journey passed
 * ```
 */
export function createCaptureCLI(options: CaptureCLIOptions = {}): CaptureCLIInterface {
	return new CaptureCLI(options)
}
