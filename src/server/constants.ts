/**
 * Names the executable subcommand each runner command answers to.
 *
 * @remarks
 * The frame-placing command is `capture` in the request protocol and `frames` on the command line,
 * because `capture capture` would stutter. The usage text prints the command-line name.
 *
 * @example
 * ```ts
 * CAPTURE_COMMAND_NAMES.capture // 'frames'
 * ```
 */
export const CAPTURE_COMMAND_NAMES = Object.freeze({
	journey: 'journey',
	capture: 'frames',
	stale: 'stale',
} as const)

/**
 * Holds the exit status each runner outcome maps to.
 *
 * @remarks `passed` is every stage green with work run, `failed` is a failed stage or an empty
 * workload, and `usage` is a refused command line or selection.
 *
 * @example
 * ```ts
 * CAPTURE_EXIT.usage // 64
 * ```
 */
export const CAPTURE_EXIT = Object.freeze({ passed: 0, failed: 1, usage: 64 } as const)

/**
 * Names the two stages a runner invocation plans: the first variant alone, then the rest together.
 *
 * @example
 * ```ts
 * CAPTURE_STAGES.first // 'narrow'
 * ```
 */
export const CAPTURE_STAGES = Object.freeze({ first: 'narrow', rest: 'rest' } as const)

/**
 * Lists the command-line flags the runner reads, each followed by exactly one value.
 *
 * @example
 * ```ts
 * CAPTURE_OPTION_FLAGS.includes('--variant') // true
 * ```
 */
export const CAPTURE_OPTION_FLAGS: readonly string[] = Object.freeze([
	'--config',
	'--variant',
	'--case',
	'--state',
	'--portfolio',
])

/**
 * Lists the words a tag name can never be, because a tag filter reads them as operators.
 *
 * @example
 * ```ts
 * CAPTURE_TAG_OPERATORS.includes('and') // true
 * ```
 */
export const CAPTURE_TAG_OPERATORS: readonly string[] = Object.freeze(['and', 'or', 'not'])

/**
 * Names the tag prefix that marks a case's owner path and each ancestor of it.
 *
 * @example
 * ```ts
 * `${CAPTURE_OWNER_PREFIX}pages:mail` // 'owner:pages:mail'
 * ```
 */
export const CAPTURE_OWNER_PREFIX = 'owner:'

/**
 * Names the environment variable that turns frame capture on for a Vitest child.
 *
 * @example
 * ```ts
 * process.env[CAPTURE_FLAG] = CAPTURE_FLAG_VALUE
 * ```
 */
export const CAPTURE_FLAG = 'CAPTURE'

/**
 * Holds the one value of the capture variable that turns frame capture on.
 *
 * @example
 * ```ts
 * CAPTURE_FLAG_VALUE // '1'
 * ```
 */
export const CAPTURE_FLAG_VALUE = '1'

/**
 * Names the repository-relative path of the Vitest entry the runner spawns through Node.
 *
 * @example
 * ```ts
 * resolve(root, CAPTURE_VITEST_ENTRY)
 * ```
 */
export const CAPTURE_VITEST_ENTRY = 'node_modules/vitest/vitest.mjs'

/**
 * Names the directory beneath a portfolio or request directory that holds one invocation's records.
 *
 * @example
 * ```ts
 * `tmp/captures/states/${CAPTURE_RUNS_DIRECTORY}/a/narrow/light-390.json`
 * ```
 */
export const CAPTURE_RUNS_DIRECTORY = 'runs'

/**
 * Lists the command-line flags a reader reads, each followed by exactly one value.
 *
 * @remarks `--variant` is the only flag that repeats. `--output` belongs to the contact sheets.
 *
 * @example
 * ```ts
 * CAPTURE_READER_FLAGS.includes('--checks') // true
 * ```
 */
export const CAPTURE_READER_FLAGS: readonly string[] = Object.freeze([
	'--variant',
	'--state',
	'--case',
	'--portfolio',
	'--config',
	'--journeys',
	'--checks',
	'--output',
])

/**
 * Holds the byte count under which an image is too small to be a real frame.
 *
 * @example
 * ```ts
 * bytes.length < CAPTURE_MINIMUM_IMAGE // true for a blank placeholder
 * ```
 */
export const CAPTURE_MINIMUM_IMAGE = 4000

/**
 * Names the first word of the line a reader prints, followed by its JSON report.
 *
 * @example
 * ```ts
 * `${CAPTURE_REPORT_LINES.preflight} ${JSON.stringify(report)}\n`
 * ```
 */
export const CAPTURE_REPORT_LINES = Object.freeze({
	preflight: 'READER',
	sheets: 'SHEETS',
} as const)

/**
 * Holds the contact-sheet geometry: how wide a cell shrinks toward, how tall it may grow, the mark
 * that stands in for an unreadable image, the gap between neighbors, and how many cells, rows, and
 * pairs a row and a sheet hold.
 *
 * @example
 * ```ts
 * CAPTURE_SHEET.cell // 320
 * ```
 */
export const CAPTURE_SHEET = Object.freeze({
	cell: 320,
	limit: 400,
	mark: Object.freeze({ width: 160, height: 20, present: 220, absent: 20 }),
	gap: 12,
	pairs: 2,
	rows: 4,
} as const)

/**
 * Names the contact-sheet files: the sheet prefix and digits, and the two index documents.
 *
 * @example
 * ```ts
 * `${CAPTURE_SHEET_FILES.prefix}001.png` // 'sheet-001.png'
 * ```
 */
export const CAPTURE_SHEET_FILES = Object.freeze({
	prefix: 'sheet-',
	digits: 3,
	data: 'index.json',
	notes: 'index.md',
} as const)

/**
 * Lists the command-line flags the registry refresh reads, each followed by exactly one value.
 *
 * @remarks `--variant` is the only flag that repeats. `--mode` is forwarded to the wrapper's Vitest.
 *
 * @example
 * ```ts
 * CAPTURE_REGISTRY_FLAGS.includes('--mode') // true
 * ```
 */
export const CAPTURE_REGISTRY_FLAGS: readonly string[] = Object.freeze([
	'--variant',
	'--config',
	'--mode',
])

/**
 * Names the stage each producing variant's complete journey runs in, ahead of the variant's name.
 *
 * @example
 * ```ts
 * `${CAPTURE_REGISTRY_STAGE}-light-390` // 'registry-light-390'
 * ```
 */
export const CAPTURE_REGISTRY_STAGE = 'registry'

/**
 * Names the first word of the line the registry refresh prints, followed by its JSON summary.
 *
 * @example
 * ```ts
 * `${CAPTURE_REGISTRY_LINE} ${JSON.stringify(summary)}\n`
 * ```
 */
export const CAPTURE_REGISTRY_LINE = 'REGISTRY'

/**
 * Names the executable's subcommands in the order its usage text lists them.
 *
 * @remarks
 * `frames` runs the `capture` request command, so `capture capture` never stutters. The other
 * names are their own commands.
 *
 * @example
 * ```ts
 * CAPTURE_SUBCOMMANDS.includes('registry') // true
 * ```
 */
export const CAPTURE_SUBCOMMANDS: readonly string[] = Object.freeze([
	'journey',
	'frames',
	'stale',
	'preflight',
	'sheets',
	'registry',
])

/**
 * Holds the repository-relative paths the executable falls back to when the command line names none.
 *
 * @remarks
 * `config` is the journey wrapper a scaffold-born browser application carries, `requests` is the
 * one default directory the runner publishes its request file to, and `journeys` is the directory
 * of journey artifacts the readers read. The runner hands the directory it uses to every child in
 * `CAPTURE_REQUESTS`, and `readCaptureRequest` and `answerCaptureDiscovery` read it from there when
 * the wrapper names none, so a wrapper never repeats this value. `--config` replaces the wrapper
 * and `--journeys` the artifacts.
 *
 * @example
 * ```ts
 * CAPTURE_DEFAULTS.config // 'configs/app/vite.journey.config.ts'
 * ```
 */
export const CAPTURE_DEFAULTS = Object.freeze({
	config: 'configs/app/vite.journey.config.ts',
	requests: 'tmp/capture',
	journeys: 'tmp/journey',
} as const)

/**
 * Names the environment variable that carries the absolute request directory to a Vitest child.
 *
 * @remarks
 * The runner sets it on every child it spawns, the discovery child included. A wrapper that names no
 * request directory reads it, so the runner and the wrapper agree without a repeated constant.
 *
 * @example
 * ```ts
 * process.env[CAPTURE_REQUESTS_FLAG] // '/repo/tmp/capture' inside a runner's child
 * ```
 */
export const CAPTURE_REQUESTS_FLAG = 'CAPTURE_REQUESTS'

/**
 * Holds the discovery exchange's fixed names and bound.
 *
 * @remarks
 * `phase` is the value that marks a request as a discovery request, `description` is the file the
 * wrapper writes inside the invocation directory, `arguments` are the Vitest arguments that list the
 * configuration's test files without collecting a test, `deadline` is the longest, in milliseconds,
 * the discovery child may run.
 *
 * @example
 * ```ts
 * CAPTURE_DISCOVERY.phase // 'discover'
 * ```
 */
export const CAPTURE_DISCOVERY = Object.freeze({
	phase: 'discover',
	description: 'description.json',
	arguments: Object.freeze(['list', '--filesOnly']),
	deadline: 60_000,
} as const)

/**
 * Holds the usage text the executable prints when it is given no subcommand or an unknown one.
 *
 * @example
 * ```ts
 * CAPTURE_USAGE.split('\n')[0] // 'Usage: capture <command> [arguments]'
 * ```
 */
export const CAPTURE_USAGE = [
	'Usage: capture <command> [arguments]',
	'Commands:',
	'  journey <selector> [--variant <name>]... [--case <full name>] [--config <file>]',
	'  frames <selector> [--variant <name>]... [--case <full name>] [--state <name>] [--config <file>]',
	'  stale <selector> [--variant <name>]... [--case <full name>] [--state <name>] [--portfolio <name>] [--config <file>]',
	'  preflight <selector> [--variant <name>]... [--state <name>] [--case <full name>] [--portfolio <name>] [--config <file>] [--journeys <directory>] [--checks <module>]',
	'  sheets <selector> --output <new directory> [--variant <name>]... [--state <name>] [--case <full name>] [--portfolio <name>] [--config <file>] [--journeys <directory>] [--checks <module>]',
	'  registry [--variant <name>]... [--mode <name>] [--config <file>]',
	'Exit: 0 passed, 1 failed or refused by the evidence, 64 refused usage.',
].join('\n')
