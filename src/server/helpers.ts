import type { ParseArgsOptionsConfig } from 'node:util'
import type { ProgressInitEvent, ProgressRun } from '@orkestrel/test/server'
import type {
	CaptureCollectionReceipt,
	CaptureDestination,
	CaptureDigest,
	CaptureExpandedManifest,
	CaptureLookup,
	CaptureLookupJournal,
	CaptureManifestDocument,
	CapturePortfolioRoot,
	CaptureProvided,
	CaptureRegistry,
	CaptureRequest,
	CaptureViewport,
} from '@src/core'
import type {
	CaptureArgumentsOptions,
	CaptureChange,
	CaptureChangePlan,
	CaptureCommand,
	CaptureDescriptionExpectation,
	CaptureDiscoveryConfig,
	CaptureDiscoveryOptions,
	CaptureEvidence,
	CaptureFileSnapshot,
	CaptureHashHandler,
	CaptureHolder,
	CaptureHostDescription,
	CaptureHostEntry,
	CaptureImageResult,
	CaptureIntegrityOptions,
	CaptureInputHandler,
	CaptureParsedArguments,
	CapturePicture,
	CapturePreflightResult,
	CaptureProducer,
	CaptureProgress,
	CaptureProject,
	CaptureReaderCommand,
	CaptureReaderDefaults,
	CaptureReaderReport,
	CaptureReceiptInput,
	CaptureRetractionHandler,
	CaptureTerminationHandler,
	CaptureRegistryArguments,
	CaptureRequestOptions,
	CaptureRunnerArguments,
	CaptureStagePlan,
	CaptureWrapperConfig,
	CaptureWrapperOptions,
	CaptureWrapperOverride,
} from './types.js'
import { createHash, randomUUID } from 'node:crypto'
import {
	existsSync,
	closeSync,
	fstatSync,
	openSync,
	readSync,
	globSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import {
	arrayOf,
	attempt,
	isArray,
	isError,
	isFunction,
	isRecord,
	isString,
	parseJSON,
	preview,
} from '@orkestrel/contract'
import { inspectProcess } from '@orkestrel/process/server'
import {
	computeProgress,
	computeProgressRun,
	createProgressPlugin,
	extractProgressEvents,
	readFileSnapshot,
	renderProgress,
} from '@orkestrel/test/server'
import {
	CAPTURE_LOOKUPS_FILE,
	CAPTURE_MANIFEST_FILE,
	CAPTURE_OWNER_PREFIX,
	CAPTURE_PNG_SIGNATURE,
	CAPTURE_REGISTRY_FILE,
	CAPTURE_REQUEST_PREFIX,
	CAPTURE_VERSION,
	CaptureError,
	buildCaptureTags,
	collectCaptureAncestors,
	describeCaptureDeclaration,
	describeCaptureDestination,
	describeCaptureError,
	isCaptureGeometry,
	isCaptureError,
	isCaptureLookupJournal,
	isCaptureManifestDocument,
	isCapturePath,
	isCapturePattern,
	isCaptureReceipt,
	isCaptureRegistry,
	isCaptureSegment,
	isCaptureSelector,
	matchesCaptureMembers,
	matchesCaptureSelector,
	readCaptureReport,
	requireCaptureUnique,
	resolveCaptureKey,
	resolveCaptureOwner,
	resolveLookupKey,
	validateCaptureReceipt,
} from '@src/core'
import {
	CAPTURE_COMMAND_NAMES,
	CAPTURE_COMMAND_OPTIONS,
	CAPTURE_DEFAULTS,
	CAPTURE_DISCOVERY,
	CAPTURE_EXIT,
	CAPTURE_FLAG,
	CAPTURE_FLAG_VALUE,
	CAPTURE_PID_LIMIT,
	CAPTURE_PNG_LIMITS,
	CAPTURE_PROGRESS_SUFFIX,
	CAPTURE_REQUESTS_FLAG,
	CAPTURE_RUNS_DIRECTORY,
	CAPTURE_STAGES,
	CAPTURE_REFUSAL_LIMIT,
	CAPTURE_MESSAGE_LIMIT,
	CAPTURE_TAG_OPERATORS,
	CAPTURE_WRAPPER_PREFIXES,
} from './constants.js'

/**
 * Hashes exact source or image bytes with SHA-256.
 *
 * @param bytes - The bytes, or the explicitly encoded UTF-8 text
 * @returns The lowercase hexadecimal digest
 *
 * @example
 * ```ts
 * computeCaptureHash('') // 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
 * ```
 */
export function computeCaptureHash(bytes: string | Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Classifies changed paths through accepted patterns and reduces owners by ancestry.
 *
 * @param paths - Git paths, including removed paths that no longer exist
 * @param entries - The authenticated accepted registry destinations
 * @returns Sorted path classifications and sorted minimal owners; shared patterns take precedence
 * @example
 * ```ts
 * buildCaptureChangePlan(['README.md'], []).changes
 * // [{ path: 'README.md', classification: 'outside', owners: [] }]
 * ```
 */
export function buildCaptureChangePlan(
	paths: readonly string[],
	entries: readonly CaptureDestination[],
): CaptureChangePlan {
	const population = [...new Set(entries.map(resolveCaptureOwner))].toSorted()
	const changes = [...new Set(paths)].toSorted().map((path): CaptureChange => {
		if (
			entries.some((entry) =>
				[...entry.sources.shared, ...entry.sources.tests].some((pattern) =>
					matchesGlob(path, pattern),
				),
			)
		)
			return { path, classification: 'shared', owners: population }
		const owners = [
			...new Set(
				entries
					.filter((entry) => entry.sources.own.some((pattern) => matchesGlob(path, pattern)))
					.map(resolveCaptureOwner),
			),
		].toSorted()
		return { path, classification: owners.length === 0 ? 'outside' : 'own', owners }
	})
	const owners = [
		...new Set(
			changes
				.filter((change) => change.classification === 'own')
				.flatMap((change) => change.owners),
		),
	].toSorted()
	return {
		changes,
		owners: owners.filter(
			(owner) =>
				!owners.some((ancestor) => ancestor !== owner && matchesCaptureSelector(owner, ancestor)),
		),
	}
}

/**
 * Renders an exact owner command with the selected variants and filters in host shell syntax.
 *
 * @remarks
 * A flag is rendered only when the rendered command's `CAPTURE_COMMAND_OPTIONS` entry declares it,
 * so a journey drops `--state`, a registry refresh drops `--case`, and only `stale` keeps
 * `--portfolio`. `--changed` and `--plan` are never rendered.
 *
 * @param command - The request command, translated to its executable name, or the registry command
 * @param parsed - The parsed flags, a `false` bail rendered as `--no-bail`; changed and plan flags are deliberately replaced by the owner
 * @param selector - The explicit owner or all selector; omitted for a registry refresh
 * @param root - The workspace that makes the wrapper path relative
 * @returns The command ready to copy into the host shell
 * @example
 * ```ts
 * renderCaptureCommand('journey', { config: '/repo/journey.ts', variants: [] }, 'pages:mail', '/repo')
 * // 'capture journey pages:mail --config journey.ts'
 * ```
 */
export function renderCaptureCommand(
	command: CaptureCommand | 'registry',
	parsed: CaptureRunnerArguments,
	selector: string | undefined,
	root: string,
): string {
	const config = resolveCaptureRelative(root, parsed.config)
	const options = CAPTURE_COMMAND_OPTIONS[command]
	return [
		'capture',
		command === 'registry' ? command : CAPTURE_COMMAND_NAMES[command],
		...(selector === undefined ? [] : [selector]),
		...(Object.hasOwn(options, 'variant')
			? parsed.variants.flatMap((variant) => ['--variant', variant])
			: []),
		...(parsed.mode === undefined || !Object.hasOwn(options, 'mode')
			? []
			: ['--mode', parsed.mode]),
		...(parsed.case === undefined || !Object.hasOwn(options, 'case')
			? []
			: parsed.case.startsWith('-')
				? [`--case=${parsed.case}`]
				: ['--case', parsed.case]),
		...(parsed.state === undefined || !Object.hasOwn(options, 'state')
			? []
			: ['--state', parsed.state]),
		...(parsed.portfolio === undefined || !Object.hasOwn(options, 'portfolio')
			? []
			: ['--portfolio', parsed.portfolio]),
		...(parsed.bail === false && Object.hasOwn(options, 'bail') ? ['--no-bail'] : []),
		...(config.startsWith('-') ? [`--config=${config}`] : ['--config', config]),
	]
		.map((argument) =>
			/^[\w./:-]+$/u.test(argument)
				? argument
				: process.platform === 'win32'
					? `'${argument.replaceAll("'", "''")}'`
					: `'${argument.replaceAll("'", "'\\''")}'`,
		)
		.join(' ')
}

/**
 * Normalizes a host path to forward slashes.
 *
 * @param path - A host path
 * @returns The same path with every backslash replaced by a slash
 *
 * @example
 * ```ts
 * normalizeSlashes('tmp\\captures\\a.png') // 'tmp/captures/a.png'
 * ```
 */
export function normalizeSlashes(path: string): string {
	return path.replaceAll('\\', '/')
}

/**
 * Finds the nearest existing path without following a dangling link.
 *
 * @example
 * ```ts
 * readCaptureAncestor('/workspace/missing/file') // '/workspace'
 * ```
 */
export function readCaptureAncestor(path: string): string {
	try {
		lstatSync(path)
		return path
	} catch (error) {
		if (!isError(error) || !('code' in error) || error.code !== 'ENOENT' || dirname(path) === path)
			throw error
		return readCaptureAncestor(dirname(path))
	}
}

/**
 * Resolves an existing path or its nearest existing ancestor to its physical destination.
 *
 * @example
 * ```ts
 * resolveCapturePhysical('/workspace/alias/new') // '/workspace/target/new'
 * ```
 */
export function resolveCapturePhysical(path: string): string {
	const ancestor = readCaptureAncestor(path)
	return resolve(realpathSync(ancestor), relative(ancestor, path))
}

/**
 * Validates a physical destination against a physical root before any read or write.
 *
 * @returns The physical destination, including its missing suffix
 * @throws Thrown when the destination or an existing ancestor escapes the root.
 * @example
 * ```ts
 * requireCaptureContained('/workspace', '/workspace/tmp/new') // '/workspace/tmp/new'
 * ```
 */
export function requireCaptureContained(root: string, path: string): string {
	const physical = resolveCapturePhysical(path)
	const suffix = relative(realpathSync(root), physical)
	if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`))
		throw new CaptureError(`Physical path resolves outside integrity root: ${path}`, {
			code: 'CONTAINMENT',
		})
	return physical
}

/** Validates a supplied path argument before work and classifies an outside value as usage.
 * @param root - The repository root
 * @param path - The supplied path resolved against the root
 * @param flag - The command line flag that supplied the path
 * @returns The contained physical path
 * @example
 * ```ts
 * requireCaptureArgument('/workspace', '/workspace/checks.ts', '--checks')
 * ```
 */
export function requireCaptureArgument(root: string, path: string, flag: string): string {
	try {
		return requireCaptureContained(root, path)
	} catch (error) {
		throw new CaptureError(
			`${flag} ${isCaptureError(error) && error.code === 'CONTAINMENT' ? 'resolves outside the repository' : 'cannot resolve its filesystem path'}: ${preview(path)}; supply a contained repository path`,
			{ code: 'USAGE', cause: error },
		)
	}
}

/** Recognizes filesystem contention codes that ownership arbitration can retry.
 * @param error - The host operation's refusal
 * @param platform - The host contract; Windows permission errors can reflect handles without delete sharing
 * @returns Whether the error names temporary ownership contention
 * @example
 * ```ts
 * matchesCaptureTransient(Object.assign(new Error('busy'), { code: 'EBUSY' })) // true
 * ```
 */
export function matchesCaptureTransient(
	error: unknown,
	platform: NodeJS.Platform = process.platform,
): boolean {
	return (
		error instanceof Error &&
		'code' in error &&
		['EBUSY', 'EMFILE', ...(platform === 'win32' ? ['EPERM', 'EACCES'] : [])].includes(
			String(error.code),
		)
	)
}

/**
 * Names a sheet group by portfolio, owner, and state independently of its output variant.
 *
 * @example
 * ```ts
 * resolveCaptureSheetIdentity(entry) // '["states","pages:mail","mail-screen"]'
 * ```
 */
export function resolveCaptureSheetIdentity(entry: CaptureDestination): string {
	return JSON.stringify([entry.portfolio, resolveCaptureOwner(entry), entry.state])
}

/**
 * Splits a list into consecutive pages with at most the requested size.
 *
 * @example
 * ```ts
 * splitCapturePages([1, 2, 3], 2) // [[1, 2], [3]]
 * ```
 */
export function splitCapturePages<T>(
	entries: readonly T[],
	size: number,
): ReadonlyArray<readonly T[]> {
	return Array.from({ length: Math.ceil(entries.length / size) }, (_, index) =>
		entries.slice(index * size, index * size + size),
	)
}

/**
 * Compares file content, size, modification time, and change time across two snapshots.
 *
 * @example
 * ```ts
 * matchesCaptureFile(previous, undefined) // false
 * ```
 */
export function matchesCaptureFile(
	previous: CaptureFileSnapshot,
	current: CaptureFileSnapshot | undefined,
): boolean {
	return (
		current !== undefined &&
		current.image.digest === previous.image.digest &&
		current.image.size === previous.image.size &&
		current.image.modified === previous.image.modified &&
		current.changed === previous.changed
	)
}

/**
 * Merges unique lookup populations with incoming identities replacing inherited ones.
 *
 * @example
 * ```ts
 * mergeCaptureLookups([lookup], [lookup]) // [lookup]
 * ```
 */
export function mergeCaptureLookups(
	previous: readonly CaptureLookup[],
	lookups: readonly CaptureLookup[],
): readonly CaptureLookup[] {
	requireCaptureUnique(previous.map(resolveLookupKey), 'inherited lookup identities')
	requireCaptureUnique(lookups.map(resolveLookupKey), 'incoming lookup identities')
	const replaced = new Set(lookups.map(resolveLookupKey))
	return [...previous.filter((entry) => !replaced.has(resolveLookupKey(entry))), ...lookups]
}

/**
 * Describes a refusal with its key path, bounded preview, correction, and member differences.
 *
 * @example
 * ```ts
 * describeCaptureFault('--variant[0]', 'bad/name', 'a portable segment')
 * ```
 */
export function describeCaptureFault(
	path: string,
	value: unknown,
	expected: string,
	candidates: readonly string[] = [],
	required: readonly string[] = [],
	allowed: readonly string[] = required,
): string {
	const keys = isRecord(value) ? Object.keys(value) : []
	const missing = required.filter((key) => !isRecord(value) || value[key] === undefined)
	const unexpected = keys.filter((key) => !allowed.includes(key))
	const population = [...new Set([...required, ...keys])]
	const members = isRecord(value)
		? `; members: {${population
				.slice(0, CAPTURE_REFUSAL_LIMIT)
				.map((key) => `${preview(`${path}.${key}`)}: ${preview(value[key])}`)
				.join(
					', ',
				)}${population.length > CAPTURE_REFUSAL_LIMIT ? `, … ${String(population.length - CAPTURE_REFUSAL_LIMIT)} more` : ''}}`
		: ''
	return `${path.length > 80 ? preview(path) : path}: received ${preview(value)}${members}; expected ${expected}; valid candidates: ${describeCaptureMembers(candidates)}; missing: ${describeCaptureMembers(missing)}; unexpected: ${describeCaptureMembers(unexpected)}`
}

/**
 * Describes a bounded member population and the number omitted from its preview.
 * @example
 * ```ts
 * describeCaptureMembers(['wide', 'phone']) // '["wide","phone"]'
 * ```
 */
export function describeCaptureMembers(members: readonly string[]): string {
	return `[${members.slice(0, CAPTURE_REFUSAL_LIMIT).map(preview).join(',')}${members.length > CAPTURE_REFUSAL_LIMIT ? `, … ${String(members.length - CAPTURE_REFUSAL_LIMIT)} more` : ''}]`
}

/**
 * Caps external diagnostic text and names the number of omitted characters.
 * @example
 * ```ts
 * describeCaptureOutput('short diagnostic') // 'short diagnostic'
 * ```
 */
export function describeCaptureOutput(output: string): string {
	return output.length <= CAPTURE_MESSAGE_LIMIT
		? output
		: `${output.slice(0, CAPTURE_MESSAGE_LIMIT)}… ${String(output.length - CAPTURE_MESSAGE_LIMIT)} more characters`
}

/**
 * Maps usage refusals to exit 64 and every other failure to exit 1.
 *
 * @example
 * ```ts
 * resolveCaptureExit(new CaptureError('Invalid flag', { code: 'USAGE' })) // 64
 * ```
 */
export function resolveCaptureExit(error: unknown): number {
	return isCaptureError(error) && error.code === 'USAGE' ? CAPTURE_EXIT.usage : CAPTURE_EXIT.failed
}

/**
 * Settles independent request removal and child termination without hiding either failure.
 *
 * @returns Every removal, termination, or unconfirmed-exit failure
 * @example
 * ```ts
 * await settleCaptureShutdown(() => invocation.retract(), [() => child.stop()]) // []
 * ```
 */
export async function settleCaptureShutdown(
	retract: CaptureRetractionHandler,
	terminations: readonly CaptureTerminationHandler[],
): Promise<readonly unknown[]> {
	const removal = attempt(retract)
	const results = await Promise.allSettled(terminations.map(async (terminate) => await terminate()))
	return [
		...(removal.success ? [] : [removal.error]),
		...results.flatMap((result) =>
			result.status === 'rejected'
				? [result.reason]
				: result.value
					? []
					: [new CaptureError('Capture child termination was not confirmed', { code: 'STAGE' })],
		),
	]
}

/**
 * Computes the digest of both pattern declarations and expanded path and hash membership.
 *
 * @param patterns - The supplied native glob patterns
 * @param files - The expanded file hashes
 * @returns A deterministic digest retaining the original evidence populations
 *
 * @example
 * ```ts
 * buildCaptureDigest(['src/**'], { 'src/a.ts': 'f'.repeat(64) }).patterns // ['src/**']
 * ```
 */
export function buildCaptureDigest(
	patterns: readonly string[],
	files: Readonly<Record<string, string>>,
): CaptureDigest {
	const ordered = Object.entries(files).toSorted(([left], [right]) =>
		left.localeCompare(right, 'en'),
	)
	return {
		patterns: patterns.toSorted(),
		files: Object.fromEntries(ordered),
		digest: computeCaptureHash(JSON.stringify([patterns.toSorted(), ordered])),
	}
}

/**
 * Computes the key under which a pattern list's matched subset of one input population is memoized.
 *
 * @remarks
 * The key joins the population's digest with the sorted patterns, so a list in any order over one
 * population shares a key, and one population never answers for another.
 *
 * @param inputs - The digested input population the patterns match against
 * @param patterns - The native glob patterns, in any order
 * @returns The memo key of the population and the pattern list
 *
 * @example
 * ```ts
 * const inputs = buildCaptureDigest(['src/**'], { 'src/a.ts': 'f'.repeat(64) })
 * computeCaptureMatchKey(inputs, ['src/*.ts', 'src/*.md']) === computeCaptureMatchKey(inputs, ['src/*.md', 'src/*.ts']) // true
 * ```
 */
export function computeCaptureMatchKey(inputs: CaptureDigest, patterns: readonly string[]): string {
	return JSON.stringify([inputs.digest, patterns.toSorted()])
}

/**
 * Filters an input population's paths that match any listed pattern.
 *
 * @remarks
 * Each path is matched with the `matchesGlob` function from `node:path`.
 *
 * @param inputs - The digested input population whose paths are matched
 * @param patterns - The native glob patterns
 * @returns The population's paths that match at least one pattern, in population order
 *
 * @example
 * ```ts
 * const inputs = buildCaptureDigest(['src/**'], { 'src/a.ts': 'f'.repeat(64), 'src/b.md': 'e'.repeat(64) })
 * filterCaptureInputs(inputs, ['src/*.ts']) // Set { 'src/a.ts' }
 * ```
 */
export function filterCaptureInputs(
	inputs: CaptureDigest,
	patterns: readonly string[],
): ReadonlySet<string> {
	return new Set(
		Object.keys(inputs.files).filter((path) =>
			patterns.some((pattern) => matchesGlob(path, pattern)),
		),
	)
}

/**
 * Stores each distinct lookup input population once in a manifest-bound journal.
 *
 * @param lookups - The expanded passing case evidence to publish
 * @param collections - The independently authenticated collection receipts
 * @param manifest - The predecessor manifest digest, absent before the first capture
 * @returns The journal with content-addressed input maps and ordered lookup references
 *
 * @example
 * ```ts
 * buildCaptureLookupJournal([], []).populations // {}
 * ```
 */
export function buildCaptureLookupJournal(
	lookups: readonly CaptureLookup[],
	collections: readonly CaptureCollectionReceipt[],
	manifest?: string,
): CaptureLookupJournal {
	const memo = new Map<Readonly<Record<string, string>>, CaptureDigest>()
	const references = lookups.map((lookup) => ({
		...lookup,
		inputs: computeCaptureTableKey(lookup.inputs, memo),
	}))
	return {
		version: CAPTURE_VERSION,
		...(manifest === undefined ? {} : { manifest }),
		populations: buildCaptureTable(memo),
		lookups: references,
		collections,
	}
}

/**
 * Admits a decoded lookup journal, checking its declared version before its schema.
 *
 * @param value - The decoded journal file
 * @param file - The journal path each refusal names
 * @returns The journal, whose table digests `readCaptureLookups` verifies
 * @throws Thrown with the removal and the refresh commands when the journal declares another
 * protocol version, and thrown naming the file when its schema is invalid.
 *
 * @example
 * ```ts
 * readCaptureLookupJournal(JSON.parse(text), 'tmp/captures/states/lookups.json').lookups.length
 * ```
 */
export function readCaptureLookupJournal(value: unknown, file: string): CaptureLookupJournal {
	requireCaptureVersion(value, 'Lookup journal', file, [file])
	if (!isCaptureLookupJournal(value))
		throw new CaptureError(`Invalid lookup journal schema: ${file}`, {
			code: 'EVIDENCE',
			context: { file },
		})
	return value
}

/**
 * Resolves journal lookup references after verifying each stored input population's digest.
 *
 * @param journal - A structurally validated lookup journal
 * @param file - The journal path each refusal names
 * @returns Every expanded lookup in its stored order, sharing the verified input maps
 * @throws Thrown when a population does not hash to its key or a lookup names an unknown key.
 *
 * @example
 * ```ts
 * readCaptureLookups(buildCaptureLookupJournal([], []), 'tmp/captures/states/lookups.json') // []
 * ```
 */
export function readCaptureLookups(
	journal: CaptureLookupJournal,
	file: string,
): readonly CaptureLookup[] {
	const subject = `Lookup journal at ${file}`
	const populations = readCaptureTable(journal.populations, subject)
	return journal.lookups.map((lookup) => ({
		...lookup,
		inputs: requireCaptureTableEntry(populations, lookup.inputs, subject, 'inputs'),
	}))
}

/**
 * Computes the table key of a file map, the digest from `buildCaptureDigest([], files)`, once per map.
 *
 * @remarks
 * The memo belongs to one document build: it holds each map by identity beside its ordered,
 * digested population, so equal maps from different objects share one key.
 *
 * @param files - The path-to-hash map a document stores once
 * @param memo - The build's memo from each map to its ordered, digested population
 * @returns The digest that names the map in the document's population table
 *
 * @example
 * ```ts
 * const memo = new Map()
 * computeCaptureTableKey({ 'src/a.ts': 'f'.repeat(64) }, memo).length // 64
 * ```
 */
export function computeCaptureTableKey(
	files: Readonly<Record<string, string>>,
	memo: Map<Readonly<Record<string, string>>, CaptureDigest>,
): string {
	const known = memo.get(files)
	if (known !== undefined) return known.digest
	const population = buildCaptureDigest([], files)
	memo.set(files, population)
	return population.digest
}

/**
 * Builds a document's population table from the memo its table keys were computed through.
 *
 * @param memo - The memo `computeCaptureTableKey` filled for one document build
 * @returns Each distinct ordered map under its digest, in the order the build first met it
 *
 * @example
 * ```ts
 * const memo = new Map()
 * const key = computeCaptureTableKey({ 'src/a.ts': 'f'.repeat(64) }, memo)
 * buildCaptureTable(memo)[key] // { 'src/a.ts': 'ffff…' }
 * ```
 */
export function buildCaptureTable(
	memo: ReadonlyMap<Readonly<Record<string, string>>, CaptureDigest>,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
	return Object.fromEntries(
		[...memo.values()].map((population) => [population.digest, population.files]),
	)
}

/**
 * Reads a document's population table after verifying that each map hashes to the key it is stored under.
 *
 * @param table - The stored table from each digest to its path-to-hash map
 * @param subject - The document and its path, which open the refusal message
 * @returns Each verified map by its digest
 * @throws Thrown when a stored map does not hash to its key.
 *
 * @example
 * ```ts
 * readCaptureTable({}, 'Manifest at tmp/captures/states/manifest.json').size // 0
 * ```
 */
export function readCaptureTable(
	table: Readonly<Record<string, Readonly<Record<string, string>>>>,
	subject: string,
): ReadonlyMap<string, Readonly<Record<string, string>>> {
	return new Map(
		Object.entries(table).map(([digest, files]) => {
			if (buildCaptureDigest([], files).digest !== digest)
				throw new CaptureError(
					`${subject} stores a population that does not hash to its key: ${digest}`,
					{ code: 'EVIDENCE' },
				)
			return [digest, files] as const
		}),
	)
}

/**
 * Returns the verified map a table key names, refusing a key the table does not hold.
 *
 * @param table - The verified table `readCaptureTable` returns
 * @param key - The digest a stored member names
 * @param subject - The document and its path, which open the refusal message
 * @param field - The referencing field the refusal message names
 * @returns The file map stored under the key
 * @throws Thrown when the table holds no map under the key.
 *
 * @example
 * ```ts
 * requireCaptureTableEntry(new Map([[key, files]]), key, 'Manifest at manifest.json', 'inputs') === files // true
 * ```
 */
export function requireCaptureTableEntry(
	table: ReadonlyMap<string, Readonly<Record<string, string>>>,
	key: string,
	subject: string,
	field: string,
): Readonly<Record<string, string>> {
	const files = table.get(key)
	if (files === undefined)
		throw new CaptureError(`${subject} names an unknown ${field} digest: ${key}`, {
			code: 'EVIDENCE',
		})
	return files
}

/**
 * Stores each distinct file map of an expanded manifest once, in a table keyed by the map's digest.
 *
 * @param manifest - The expanded manifest the engine publishes
 * @returns The document whose stamps, lookups, and collections name their maps by table key
 *
 * @example
 * ```ts
 * const document = buildCaptureManifestDocument(manifest)
 * Object.keys(document.populations) // one digest per distinct shared or input map
 * ```
 */
export function buildCaptureManifestDocument(
	manifest: CaptureExpandedManifest,
): CaptureManifestDocument {
	const memo = new Map<Readonly<Record<string, string>>, CaptureDigest>()
	const entries = Object.fromEntries(
		Object.entries(manifest.entries).map(([key, stamp]) => [
			key,
			{
				...stamp,
				shared: { ...stamp.shared, files: computeCaptureTableKey(stamp.shared.files, memo) },
			},
		]),
	)
	const lookups = manifest.lookups.map((lookup) => ({
		...lookup,
		inputs: computeCaptureTableKey(lookup.inputs, memo),
	}))
	const collections = manifest.collections?.map((receipt) => ({
		...receipt,
		inputs: { ...receipt.inputs, files: computeCaptureTableKey(receipt.inputs.files, memo) },
	}))
	return {
		version: manifest.version,
		populations: buildCaptureTable(memo),
		registry: manifest.registry,
		entries,
		lookups,
		...(collections === undefined ? {} : { collections }),
	}
}

/**
 * Admits a stored manifest and expands every table reference into the file map it names.
 *
 * @param value - The decoded manifest file
 * @param file - The manifest path each refusal names
 * @returns The expanded manifest, whose references to one key share one verified map
 * @throws Thrown with the removal and the refresh commands when the document declares another
 * protocol version, and thrown when its schema is invalid, a table map does not hash to its key,
 * or a reference names no table key.
 *
 * @example
 * ```ts
 * const manifest = readCaptureManifest(JSON.parse(text), 'tmp/captures/states/manifest.json')
 * manifest.lookups[0]?.inputs // the expanded input map
 * ```
 */
export function readCaptureManifest(value: unknown, file: string): CaptureExpandedManifest {
	requireCaptureVersion(value, 'Manifest', file, [file, 'its lookup journal'])
	if (!isCaptureManifestDocument(value))
		throw new CaptureError(`Invalid inherited manifest schema: ${file}`, { code: 'EVIDENCE' })
	const subject = `Manifest at ${file}`
	const table = readCaptureTable(value.populations, subject)
	return {
		version: value.version,
		registry: value.registry,
		entries: Object.fromEntries(
			Object.entries(value.entries).map(([key, stamp]) => [
				key,
				{
					...stamp,
					shared: {
						...stamp.shared,
						files: requireCaptureTableEntry(table, stamp.shared.files, subject, 'shared.files'),
					},
				},
			]),
		),
		lookups: value.lookups.map((lookup) => ({
			...lookup,
			inputs: requireCaptureTableEntry(table, lookup.inputs, subject, 'inputs'),
		})),
		...(value.collections === undefined
			? {}
			: {
					collections: value.collections.map((receipt) => ({
						...receipt,
						inputs: {
							...receipt.inputs,
							files: requireCaptureTableEntry(table, receipt.inputs.files, subject, 'inputs.files'),
						},
					})),
				}),
	}
}

/**
 * Refuses a document that declares a numeric version other than `CAPTURE_VERSION`, naming what to remove and the refresh commands.
 *
 * @remarks
 * A document with no numeric version passes, so the schema check that follows names that fault.
 * No document of another version is converted.
 *
 * @param value - The decoded document
 * @param subject - The document kind that opens the refusal, such as `Registry`
 * @param file - The document path the refusal names
 * @param removal - The paths, or the phrases naming them, to remove before the refresh
 * @throws Thrown as an `EVIDENCE` capture error whose context carries `file` and `version` when the
 * document declares another numeric version.
 *
 * @example
 * ```ts
 * requireCaptureVersion({ version: 1 }, 'Registry', 'registry.json', ['registry.json'])
 * // throws: Registry version 1 at registry.json is not version 2, … Remove registry.json, then refresh explicitly with: capture registry, then capture frames all
 * ```
 */
export function requireCaptureVersion(
	value: unknown,
	subject: string,
	file: string,
	removal: readonly string[],
): void {
	const version = isRecord(value) ? value.version : undefined
	if (typeof version === 'number' && version !== CAPTURE_VERSION)
		throw new CaptureError(
			`${subject} version ${String(version)} at ${file} is not version ${String(CAPTURE_VERSION)}, and no other version is converted. Remove ${new Intl.ListFormat('en', { type: 'conjunction' }).format(removal)}, then refresh explicitly with: capture registry, then capture frames all`,
			{ code: 'EVIDENCE', context: { file, version } },
		)
}

/**
 * Checks whether an error is the refusal `requireCaptureVersion` throws for another document version.
 *
 * @remarks
 * A caller that adds its own recovery to a refusal passes this one through unchanged, because it
 * already names the removal and the refresh.
 *
 * @param error - The caught value
 * @returns True if it is an `EVIDENCE` capture error whose context carries a file and a numeric version; false otherwise
 *
 * @example
 * ```ts
 * matchesCaptureVersionRefusal(captureError(() => requireCaptureVersion({ version: 1 }, 'Registry', file, [file]))) // true
 * matchesCaptureVersionRefusal(new Error('Invalid')) // false
 * ```
 */
export function matchesCaptureVersionRefusal(error: unknown): boolean {
	return (
		isCaptureError(error) &&
		error.code === 'EVIDENCE' &&
		typeof error.context?.file === 'string' &&
		typeof error.context.version === 'number'
	)
}

/**
 * Classifies a failure raised while reading the accepted registry as the registry condition.
 *
 * @remarks
 * The complete-registry refresh clears every such failure but a document of another version, whose
 * refusal names its own removal and refresh.
 *
 * @param error - The value a registry read threw
 * @returns A `REGISTRY` capture error with the same message and the original as its cause, for a
 * value that is not a capture error or is an `EVIDENCE` capture error other than a version refusal;
 * otherwise the value itself
 *
 * @example
 * ```ts
 * resolveCaptureRegistryFault(new CaptureError('Invalid accepted registry schema or digest', { code: 'EVIDENCE' })) // a REGISTRY capture error
 * resolveCaptureRegistryFault(new CaptureError('Unknown portfolio: x', { code: 'SELECTION' })) // the same error
 * ```
 */
export function resolveCaptureRegistryFault(error: unknown): unknown {
	return isCaptureError(error) && (error.code !== 'EVIDENCE' || matchesCaptureVersionRefusal(error))
		? error
		: new CaptureError(describeCaptureError(error), { code: 'REGISTRY', cause: error })
}

/**
 * Collects the variants that produce each destination across the registry receipts and the lookup runs.
 *
 * @param evidence - The accepted registry and the authenticated lookup runs
 * @returns Each destination description mapped to its distinct producing variants, in first-seen order
 *
 * @example
 * ```ts
 * collectCaptureProducers({ registry, runs: [] }).get(describeCaptureDestination(destination)) // ['light-390']
 * ```
 */
export function collectCaptureProducers(
	evidence: Pick<CaptureEvidence, 'registry' | 'runs'>,
): ReadonlyMap<string, readonly string[]> {
	const sources = [...evidence.registry.receipts, ...evidence.runs.map((entry) => entry.run)]
	const attributions = Map.groupBy(
		sources.flatMap((source) =>
			source.registry.map((entry) => ({
				description: describeCaptureDestination(entry),
				variant: source.variant,
			})),
		),
		(entry) => entry.description,
	)
	return new Map(
		[...attributions].map(([description, entries]) => [
			description,
			[...new Set(entries.map((entry) => entry.variant))],
		]),
	)
}

/**
 * Returns the one variant that produces a destination, refusing a destination with none or several.
 *
 * @param destination - The destination whose producer is read
 * @param producers - The map `collectCaptureProducers` returns
 * @returns The destination's unique producing variant
 * @throws Thrown as an `EVIDENCE` capture error when no variant or more than one produces the destination.
 *
 * @example
 * ```ts
 * requireCaptureProducer(destination, collectCaptureProducers({ registry, runs: [] })) // 'light-390'
 * ```
 */
export function requireCaptureProducer(
	destination: CaptureDestination,
	producers: ReadonlyMap<string, readonly string[]>,
): string {
	const variants = producers.get(describeCaptureDestination(destination)) ?? []
	if (variants.length !== 1 || variants[0] === undefined)
		throw new CaptureError('Destination has no unique producing variant', { code: 'EVIDENCE' })
	return variants[0]
}

/**
 * Computes the registry identity from its authenticated receipts and exact output population.
 *
 * @param registry - The registry fields before its digest is attached
 * @returns The deterministic SHA-256 registry identity
 *
 * @example
 * ```ts
 * computeRegistryDigest({ version: 2, receipts: [], entries: [] }).length // 64
 * ```
 */
export function computeRegistryDigest(
	registry: Pick<CaptureRegistry, 'version' | 'receipts' | 'entries'>,
): string {
	return computeCaptureHash(
		JSON.stringify([
			registry.version,
			registry.receipts
				.map((receipt) =>
					JSON.stringify([
						receipt.version,
						receipt.variant,
						receipt.time,
						receipt.complete,
						receipt.report.file,
						receipt.report.digest,
						Object.entries(receipt.inputs).toSorted(([left], [right]) =>
							left.localeCompare(right, 'en'),
						),
						receipt.declarations.map(describeCaptureDeclaration).toSorted(),
						receipt.registry.map(describeCaptureDestination).toSorted(),
					]),
				)
				.toSorted(),
			registry.entries.map(describeCaptureDestination).toSorted(),
		]),
	)
}

/**
 * Imports complete receipts only after their actual exits and exact report bytes validate.
 *
 * @param inputs - Verifier-owned reporter bytes, receipt declarations, and process outcomes
 * @returns The registry document to publish through the verifier's owned evidence path
 * @throws Thrown for caps, signals, unsuccessful exits, altered reports, or incomplete coverage.
 * @remarks This pure importer starts no process and changes no retained receipt or manifest.
 *
 * @example
 * ```ts
 * const registry = buildCaptureRegistry([{ receipt, report: text, outcome: { code: 0, signal: null }, capped: false }])
 * registry.digest.length // 64
 * ```
 */
export function buildCaptureRegistry(inputs: readonly CaptureReceiptInput[]): CaptureRegistry {
	if (inputs.length === 0)
		throw new CaptureError('A registry requires complete-run receipts', { code: 'EVIDENCE' })
	for (const input of inputs) {
		if (
			input.capped ||
			input.outcome.code !== 0 ||
			input.outcome.signal !== null ||
			!isCaptureReceipt(input.receipt) ||
			!input.receipt.complete ||
			computeCaptureHash(input.report) !== input.receipt.report.digest
		)
			throw new CaptureError(
				'Registry receipt requires an uncapped successful exit and unchanged report',
				{ code: 'EVIDENCE' },
			)
		validateCaptureReceipt(input.receipt, readCaptureReport(parseJSON(input.report)))
	}
	const receipts = inputs.map((input) => input.receipt)
	requireCaptureUnique(
		receipts.map((receipt) => receipt.variant),
		'complete receipt variants',
		true,
	)
	const entries = receipts.flatMap((receipt) => receipt.registry)
	requireCaptureUnique(entries.map(resolveCaptureKey), 'registry identities', true)
	requireCaptureUnique(
		entries.map((entry) => entry.file),
		'registry paths',
		true,
	)
	const registry: Pick<CaptureRegistry, 'version' | 'receipts' | 'entries'> = {
		version: CAPTURE_VERSION,
		receipts,
		entries,
	}
	return { ...registry, digest: computeRegistryDigest(registry) }
}

/**
 * Checks whether bytes open with the eight-byte PNG signature.
 *
 * @param bytes - The leading bytes of a file
 * @returns True if the first eight bytes equal the signature; false otherwise
 *
 * @example
 * ```ts
 * matchesCaptureSignature(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])) // true
 * ```
 */
export function matchesCaptureSignature(bytes: Uint8Array): boolean {
	return Buffer.from(CAPTURE_PNG_SIGNATURE).equals(bytes.subarray(0, CAPTURE_PNG_SIGNATURE.length))
}

/**
 * Computes the PNG Paeth predictor used by both image readers.
 *
 * @param left - The reconstructed left byte
 * @param up - The reconstructed byte above
 * @param corner - The reconstructed upper-left byte
 * @returns The closest neighbor to the linear estimate
 *
 * @example
 * ```ts
 * predictCaptureByte(10, 20, 10) // 20
 * ```
 */
export function predictCaptureByte(left: number, up: number, corner: number): number {
	const estimate = left + up - corner
	const west = Math.abs(estimate - left)
	const north = Math.abs(estimate - up)
	const diagonal = Math.abs(estimate - corner)
	return west <= north && west <= diagonal ? left : north <= diagonal ? up : corner
}

/**
 * Reads PNG compressed-data chunks while refusing truncated or corrupt image bytes.
 *
 * @param bytes - The complete PNG
 * @param offset - The next chunk header. Default: 8.
 * @returns Ordered compressed-data chunks
 * @throws Thrown for bytes over the file budget; a truncated chunk, which a file with no closing
 * chunk also meets; a bad checksum; a closing chunk that is not empty and last; an IHDR chunk
 * anywhere but offset 8; a critical chunk other than IHDR, PLTE, IDAT, and IEND; or IDAT chunks
 * that are not consecutive.
 *
 * @example
 * ```ts
 * readCaptureChunks(encodeCapturePicture(picture)).length // 1
 * ```
 */
export function readCaptureChunks(bytes: Buffer, offset = 8): readonly Buffer[] {
	requireCaptureImageSize(bytes.length)
	const positions = scanCaptureChunks(bytes, offset, Infinity)
	// Each type is read once as a big-endian word; a refusal alone renders it as text.
	const types = positions.map((position) => bytes.readUInt32BE(position + 4))
	const header = Buffer.from('IHDR', 'latin1').readUInt32BE(0)
	const palette = Buffer.from('PLTE', 'latin1').readUInt32BE(0)
	const data = Buffer.from('IDAT', 'latin1').readUInt32BE(0)
	const end = Buffer.from('IEND', 'latin1').readUInt32BE(0)
	const last = positions.at(-1)
	// The walk ends at the closing chunk or refuses, so this guard narrows `last` and never throws.
	if (last === undefined || types.at(-1) !== end)
		throw new CaptureError(
			`Missing capture PNG closing chunk: ${last === undefined ? `no chunk follows offset ${preview(offset)}` : `the last chunk is ${preview(bytes.toString('latin1', last + 4, last + 8))} at offset ${String(last)}`}; expected an empty IEND chunk that ends the file`,
			{ code: 'EVIDENCE' },
		)
	const first = types.indexOf(data)
	const final = types.lastIndexOf(data)
	const placed = positions.find((position, index) => types[index] === header && position !== 8)
	if (placed !== undefined)
		throw new CaptureError(
			`Invalid capture PNG chunk order: ${describeCaptureChunk(bytes, placed)}; expected one IHDR chunk, at offset 8`,
			{ code: 'EVIDENCE' },
		)
	// Bit 5 of a type's first byte is clear for a critical chunk.
	const unknown = positions.find(
		(position, index) =>
			((bytes[position + 4] ?? 0) & 32) === 0 &&
			![header, palette, data, end].includes(types[index] ?? 0),
	)
	if (unknown !== undefined)
		throw new CaptureError(
			`Unsupported capture PNG chunk: critical ${describeCaptureChunk(bytes, unknown)}; expected a critical chunk to be IHDR, PLTE, IDAT, or IEND`,
			{ code: 'EVIDENCE' },
		)
	const gap = types.findIndex((type, index) => index > first && index < final && type !== data)
	const resume = gap === -1 ? -1 : types.indexOf(data, gap)
	const resumed = positions[resume]
	const before = positions[resume - 1]
	if (resumed !== undefined && before !== undefined)
		throw new CaptureError(
			`Invalid capture PNG chunk order: ${describeCaptureChunk(bytes, resumed)} follows ${preview(bytes.toString('latin1', before + 4, before + 8))} at offset ${String(before)}; expected every IDAT chunk in one consecutive run`,
			{ code: 'EVIDENCE' },
		)
	return positions.flatMap((position, index) => {
		const length = bytes.readUInt32BE(position)
		return types[index] === data && length > 0
			? [bytes.subarray(position + 8, position + 8 + length)]
			: []
	})
}

/**
 * Walks a PNG's checked chunks from one header and returns each header's offset, up to the closing chunk.
 *
 * @remarks
 * The walk reads at most `count` chunks, and never more than the bytes can hold, so an infinite or
 * very large count ends at the closing chunk or at a refusal. Each level halves the count, so the
 * call depth grows with the logarithm of the chunks the bytes can hold.
 *
 * @param bytes - The complete PNG
 * @param position - The offset of the first chunk header to read
 * @param count - The most chunks to read
 * @returns The offset of each chunk header read, in order
 * @throws Thrown for a truncated chunk, a bad checksum, or a closing chunk that is not empty and last.
 *
 * @example
 * ```ts
 * scanCaptureChunks(encodeCapturePicture({ width: 1, height: 1, pixels: Uint8Array.from([1, 2, 3]) }), 8, Infinity) // [8, 33, 57]
 * ```
 */
export function scanCaptureChunks(
	bytes: Buffer,
	position: number,
	count: number,
): readonly number[] {
	// A chunk spans at least 12 bytes, so the bytes hold fewer chunks than this.
	const limit = Math.min(count, Math.floor(bytes.length / 12) + 1)
	if (limit >= 2) {
		const half = Math.ceil(limit / 2)
		const head = scanCaptureChunks(bytes, position, half)
		const last = head.at(-1)
		if (last === undefined || bytes.toString('latin1', last + 4, last + 8) === 'IEND') return head
		return [
			...head,
			...scanCaptureChunks(bytes, last + 12 + bytes.readUInt32BE(last), limit - half),
		]
	}
	if (!(limit >= 1)) return []
	if (!Number.isSafeInteger(position) || position < 8 || position + 12 > bytes.length)
		throw new CaptureError(
			`Truncated capture PNG: no 12-byte chunk frame fits at offset ${preview(position)} in ${String(bytes.length)} bytes; expected a whole offset from 8 with 12 bytes after it`,
			{ code: 'EVIDENCE' },
		)
	const end = position + 12 + bytes.readUInt32BE(position)
	if (end > bytes.length)
		throw new CaptureError(
			`Truncated capture PNG chunk: ${describeCaptureChunk(bytes, position)} ends at byte ${String(end)}; expected it to end within the file's ${String(bytes.length)} bytes`,
			{ code: 'EVIDENCE' },
		)
	const stored = bytes.readUInt32BE(end - 4)
	const computed = crc32(bytes.subarray(position + 4, end - 4)) >>> 0
	if (computed !== stored)
		throw new CaptureError(
			`Capture PNG checksum differs: ${describeCaptureChunk(bytes, position)} stores ${stored.toString(16).padStart(8, '0')}; expected ${computed.toString(16).padStart(8, '0')}`,
			{ code: 'EVIDENCE' },
		)
	if (
		bytes.toString('latin1', position + 4, position + 8) === 'IEND' &&
		(end !== position + 12 || end !== bytes.length)
	)
		throw new CaptureError(
			`Invalid capture PNG closing chunk: ${describeCaptureChunk(bytes, position)} ends at byte ${String(end)} of ${String(bytes.length)}; expected an empty IEND chunk that ends the file`,
			{ code: 'EVIDENCE' },
		)
	return [position]
}

/**
 * Describes the PNG chunk whose header sits at an offset by its type, offset, and length.
 *
 * @remarks The type is untrusted file bytes, so it is JSON-encoded and length-capped.
 *
 * @param bytes - The complete PNG
 * @param position - The offset of the chunk header, with its 8 header bytes inside `bytes`
 * @returns The chunk's description for a refusal
 *
 * @example
 * ```ts
 * describeCaptureChunk(encodeCapturePicture(picture), 8) // '"IHDR" at offset 8 with length 13'
 * ```
 */
export function describeCaptureChunk(bytes: Buffer, position: number): string {
	return `${preview(bytes.toString('latin1', position + 4, position + 8))} at offset ${String(position)} with length ${String(bytes.readUInt32BE(position))}`
}

/**
 * Reads an image only after its opened file's size is inside the compressed-byte budget.
 * @throws Thrown when the file is oversized, unreadable, or changes size during the read.
 * @example
 * ```ts
 * const bytes = readCaptureImage('/workspace/tmp/captures/mail.png')
 * ```
 */
export function readCaptureImage(file: string): Buffer {
	const descriptor = openSync(file, 'r')
	try {
		const size = fstatSync(descriptor).size
		requireCaptureImageSize(size)
		const bytes = Buffer.alloc(size)
		if (
			readSync(descriptor, bytes, 0, size, 0) !== size ||
			readSync(descriptor, Buffer.alloc(1), 0, 1, size) !== 0
		)
			throw new CaptureError('Capture PNG read is incomplete or its size changed', {
				code: 'EVIDENCE',
			})
		return bytes
	} finally {
		closeSync(descriptor)
	}
}

/**
 * Refuses compressed image bytes before file reads or chunk-buffer allocation.
 * @example
 * ```ts
 * requireCaptureImageSize(4096) // undefined
 * ```
 */
export function requireCaptureImageSize(size: number): void {
	if (!Number.isSafeInteger(size) || size < 0 || size > CAPTURE_PNG_LIMITS.bytes)
		throw new CaptureError(
			`Capture PNG size is outside the file budget: ${preview(size)} bytes; expected a whole number of bytes from 0 to ${String(CAPTURE_PNG_LIMITS.bytes)}`,
			{ code: 'EVIDENCE' },
		)
}

/**
 * Reconstructs one filtered PNG scanline from its filter byte and the row above.
 *
 * @param filter - The scanline's filter type, from 0 through 4
 * @param line - The filtered bytes of the row, without the filter byte
 * @param above - The reconstructed row above, or `undefined` for the first row
 * @param channels - The number of bytes in one pixel
 * @returns The reconstructed row
 *
 * @example
 * ```ts
 * unfilterCaptureRow(1, Uint8Array.from([1, 1, 1, 1]), undefined, 1) // Uint8Array [1, 2, 3, 4]
 * ```
 */
export function unfilterCaptureRow(
	filter: number,
	line: Uint8Array,
	above: Uint8Array | undefined,
	channels: number,
): Uint8Array {
	// Each byte reads reconstructed bytes before it, so the row is written once per index, in order.
	// The filter is chosen once per row; any other filter value predicts 0 and copies the line.
	const bytes = new Uint8Array(line.length)
	if (filter === 1)
		for (const index of line.keys())
			bytes[index] =
				((line[index] ?? 0) + (index >= channels ? (bytes[index - channels] ?? 0) : 0)) & 255
	else if (filter === 2)
		for (const index of line.keys())
			bytes[index] = ((line[index] ?? 0) + (above?.[index] ?? 0)) & 255
	else if (filter === 3)
		for (const index of line.keys())
			bytes[index] =
				((line[index] ?? 0) +
					(((index >= channels ? (bytes[index - channels] ?? 0) : 0) + (above?.[index] ?? 0)) >>
						1)) &
				255
	else if (filter === 4)
		for (const index of line.keys())
			bytes[index] =
				((line[index] ?? 0) +
					predictCaptureByte(
						index >= channels ? (bytes[index - channels] ?? 0) : 0,
						above?.[index] ?? 0,
						index >= channels ? (above?.[index - channels] ?? 0) : 0,
					)) &
				255
	else bytes.set(line)
	return bytes
}

/**
 * Inflates a PNG's compressed stream, refusing one that is corrupt or longer than declared.
 *
 * @param data - The concatenated data-chunk payloads
 * @param length - The inflated length the header's dimensions declare, a whole number from 1 to
 * `Number.MAX_SAFE_INTEGER`; any other value gives an unspecified result that might throw
 * @returns The inflated scanlines
 * @throws Thrown when the stream is not valid deflate data or inflates past `length`.
 *
 * @example
 * ```ts
 * inflateCaptureStream(deflateSync(Buffer.from([1, 2, 3])), 3) // Buffer <01 02 03>
 * ```
 */
export function inflateCaptureStream(data: Buffer, length: number): Buffer {
	try {
		return inflateSync(data, { maxOutputLength: length })
	} catch (error) {
		throw new CaptureError(
			`Capture PNG stream is corrupt or longer than declared: ${preview(isError(error) ? error.message : error)} in ${String(data.length)} compressed bytes; expected a zlib stream that inflates to at most ${preview(length)} bytes`,
			{ code: 'EVIDENCE', cause: error },
		)
	}
}

/**
 * Decodes the eight-bit, non-interlaced PNGs the capture readers consume.
 *
 * @remarks
 * It reads grayscale, grayscale with alpha, RGB, and RGBA, the colour types an encoder writes for a
 * browser capture. A grayscale sample fills all three channels, and an alpha channel is dropped.
 * Indexed colour, other bit depths, and interlacing are refused.
 *
 * @param bytes - The exact physical image bytes
 * @returns Image dimensions and RGB pixels
 * @throws Thrown for unsupported, malformed, or truncated images.
 *
 * @example
 * ```ts
 * decodeCapturePicture(encodeCapturePicture({ width: 1, height: 1, pixels: Uint8Array.from([1, 2, 3]) })).pixels // Uint8Array [1, 2, 3]
 * ```
 */
export function decodeCapturePicture(bytes: Buffer): CapturePicture {
	requireCaptureImageSize(bytes.length)
	if (
		bytes.length < 33 ||
		!matchesCaptureSignature(bytes) ||
		bytes.toString('latin1', 12, 16) !== 'IHDR' ||
		bytes.readUInt32BE(8) !== 13
	)
		throw new CaptureError(
			`Invalid capture PNG header: ${
				bytes.length < 33
					? `the file is ${String(bytes.length)} bytes`
					: !matchesCaptureSignature(bytes)
						? `the signature is ${bytes.toString('hex', 0, 8)}`
						: `the first chunk is ${preview(bytes.toString('latin1', 12, 16))} with length ${String(bytes.readUInt32BE(8))}`
			}; expected at least 33 bytes that open with the signature ${Buffer.from(CAPTURE_PNG_SIGNATURE).toString('hex')} and an IHDR chunk with length 13`,
			{ code: 'EVIDENCE' },
		)
	// The header's checksum is checked before any of its fields is judged.
	scanCaptureChunks(bytes, 8, 1)
	const width = bytes.readUInt32BE(16)
	const height = bytes.readUInt32BE(20)
	const channels =
		bytes[25] === 6 ? 4 : bytes[25] === 2 ? 3 : bytes[25] === 4 ? 2 : bytes[25] === 0 ? 1 : 0
	const gray = bytes[25] === 0 || bytes[25] === 4
	if (channels === 0 || bytes[24] !== 8 || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0)
		throw new CaptureError(
			`Unsupported capture PNG encoding: bit depth ${String(bytes[24])}, colour type ${String(bytes[25])}, compression ${String(bytes[26])}, filter ${String(bytes[27])}, interlace ${String(bytes[28])}; expected bit depth 8, colour type 0, 2, 4, or 6, compression 0, filter 0, and interlace 0`,
			{ code: 'EVIDENCE' },
		)
	const size = `${String(width)} × ${String(height)}`
	if (width === 0 || height === 0)
		throw new CaptureError(
			`Invalid capture PNG dimensions: ${size}; expected a width and a height of at least 1`,
			{ code: 'EVIDENCE' },
		)
	const stride = width * channels
	const length = (stride + 1) * height
	if (!Number.isSafeInteger(length))
		throw new CaptureError(
			`Invalid capture PNG dimensions: ${size} at ${String(channels)} bytes per pixel; expected scanlines of at most ${String(Number.MAX_SAFE_INTEGER)} bytes in all`,
			{ code: 'EVIDENCE' },
		)
	if (width * height > CAPTURE_PNG_LIMITS.pixels)
		throw new CaptureError(
			`Capture PNG exceeds the pixel budget: ${size} is ${String(width * height)} pixels; expected at most ${String(CAPTURE_PNG_LIMITS.pixels)} pixels`,
			{ code: 'EVIDENCE' },
		)
	if (width > CAPTURE_PNG_LIMITS.side || height > CAPTURE_PNG_LIMITS.side)
		throw new CaptureError(
			`Capture PNG exceeds the dimension budget: ${size}; expected at most ${String(CAPTURE_PNG_LIMITS.side)} pixels per side`,
			{ code: 'EVIDENCE' },
		)
	const chunks = readCaptureChunks(bytes)
	const raw = inflateCaptureStream(
		chunks.length === 1 && chunks[0] !== undefined ? chunks[0] : Buffer.concat(chunks),
		length,
	)
	if (raw.length !== length)
		throw new CaptureError(
			`Capture PNG scanline length differs: the stream inflates to ${String(raw.length)} bytes; expected ${String(length)} bytes for ${size} at ${String(channels)} bytes per pixel and one filter byte per row`,
			{ code: 'EVIDENCE' },
		)
	// Each row is written once, in order, and an unfiltered row reads the reconstructed slice above it.
	const rows = new Uint8Array(stride * height)
	for (const row of new Array(height).keys()) {
		const filter = raw[row * (stride + 1)]
		if (filter === undefined || filter > 4)
			throw new CaptureError(
				`Unsupported capture PNG filter: type ${String(filter)} on row ${String(row)}; expected a type from 0 to 4`,
				{ code: 'EVIDENCE' },
			)
		const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1))
		rows.set(
			filter === 0
				? line
				: unfilterCaptureRow(
						filter,
						line,
						row === 0 ? undefined : rows.subarray((row - 1) * stride, row * stride),
						channels,
					),
			row * stride,
		)
	}
	if (channels === 3) return { width, height, pixels: rows }
	const pixels = new Uint8Array(width * height * 3)
	const columns = Array.from({ length: width }, (_, column) => column)
	for (const row of new Array(height).keys()) {
		for (const column of columns) {
			const source = (row * width + column) * channels
			const target = (row * width + column) * 3
			pixels[target] = rows[source] ?? 0
			pixels[target + 1] = rows[source + (gray ? 0 : 1)] ?? 0
			pixels[target + 2] = rows[source + (gray ? 0 : 2)] ?? 0
		}
	}
	return { width, height, pixels }
}

/**
 * Encodes an unsigned 32-bit integer as four big-endian bytes.
 *
 * @param value - An integer from 0 through 4294967295
 * @returns The four bytes, most significant first
 *
 * @example
 * ```ts
 * encodeCaptureWord(258) // Buffer <00 00 01 02>
 * ```
 */
export function encodeCaptureWord(value: number): Buffer {
	return Buffer.from([24, 16, 8, 0].map((shift) => (value >>> shift) & 255))
}

/**
 * Encodes one checked PNG chunk for contact-sheet output.
 *
 * @param name - The four-byte chunk name
 * @param data - The chunk payload
 * @returns Header, payload, and checksum bytes
 *
 * @example
 * ```ts
 * encodeCaptureChunk('IEND', Buffer.alloc(0)).length // 12
 * ```
 */
export function encodeCaptureChunk(name: string, data: Buffer): Buffer {
	const header = Buffer.concat([encodeCaptureWord(data.length), Buffer.from(name, 'latin1')])
	const tail = encodeCaptureWord(crc32(Buffer.concat([header.subarray(4), data])) >>> 0)
	return Buffer.concat([header, data, tail])
}

/**
 * Encodes an RGB picture using the contact-sheet writer's native PNG format.
 *
 * @param picture - The complete RGB pixel buffer
 * @param compressed - If `true`, compresses scanlines; if `false`, stores them in the deflate stream. Default: `true`.
 * @returns A PNG file
 * @throws Thrown when a dimension is not a whole number of at least 1, or when the pixel length is
 * not `width * height * 3`.
 *
 * @example
 * ```ts
 * encodeCapturePicture({ width: 1, height: 1, pixels: Uint8Array.from([1, 2, 3]) }).subarray(1, 4).toString() // 'PNG'
 * ```
 */
export function encodeCapturePicture(picture: CapturePicture, compressed = true): Buffer {
	if (
		!Number.isSafeInteger(picture.width) ||
		!Number.isSafeInteger(picture.height) ||
		picture.width <= 0 ||
		picture.height <= 0 ||
		picture.pixels.length !== picture.width * picture.height * 3
	)
		throw new CaptureError('Invalid capture picture dimensions', { code: 'EVIDENCE' })
	const stride = picture.width * 3
	const raw = Buffer.concat(
		Array.from({ length: picture.height }, (_, row) =>
			Buffer.concat([Buffer.from([0]), picture.pixels.subarray(row * stride, (row + 1) * stride)]),
		),
	)
	return Buffer.concat([
		Buffer.from(CAPTURE_PNG_SIGNATURE),
		encodeCaptureChunk(
			'IHDR',
			Buffer.concat([
				encodeCaptureWord(picture.width),
				encodeCaptureWord(picture.height),
				Buffer.from([8, 2, 0, 0, 0]),
			]),
		),
		encodeCaptureChunk('IDAT', deflateSync(raw, { level: compressed ? 6 : 0 })),
		encodeCaptureChunk('IEND', Buffer.alloc(0)),
	])
}

/**
 * Sums a run of samples three bytes apart, one channel of consecutive RGB pixels.
 *
 * @remarks
 * The caller bounds the run: the call reads one sample per column, inside the bytes or not, so a
 * count that is not above 0 sums nothing and a fractional count reads its ceiling. Each sample reads
 * `pixels[index] ?? 0` at the index the call computes, so an index outside the bytes, a fractional
 * index, or a `NaN` index reads 0. For whole-number arguments, the sum equals the direct sum of
 * those samples where every number the call computes from its arguments is a safe integer, each
 * sample index among them.
 *
 * @param pixels - The source RGB bytes
 * @param start - The index of the first sample
 * @param columns - The number of samples to sum
 * @returns The sum, reading an index outside the bytes or a fractional index as 0
 * @throws Thrown as an `EVIDENCE` capture error when `columns` is `Infinity`.
 *
 * @example
 * ```ts
 * sumCaptureRow(Uint8Array.from([1, 0, 0, 2, 0, 0, 3]), 0, 3) // 6
 * ```
 */
export function sumCaptureRow(pixels: Uint8Array, start: number, columns: number): number {
	// Halving keeps the recursion depth logarithmic in the run; a leaf reads up to eight samples.
	if (columns > 8) {
		if (columns === Infinity)
			throw new CaptureError('Capture sum columns must be a finite sample count, not Infinity', {
				code: 'EVIDENCE',
			})
		const half = Math.ceil(columns / 2)
		return (
			sumCaptureRow(pixels, start, half) + sumCaptureRow(pixels, start + half * 3, columns - half)
		)
	}
	return (
		(columns > 0 ? (pixels[start] ?? 0) : 0) +
		(columns > 1 ? (pixels[start + 3] ?? 0) : 0) +
		(columns > 2 ? (pixels[start + 6] ?? 0) : 0) +
		(columns > 3 ? (pixels[start + 9] ?? 0) : 0) +
		(columns > 4 ? (pixels[start + 12] ?? 0) : 0) +
		(columns > 5 ? (pixels[start + 15] ?? 0) : 0) +
		(columns > 6 ? (pixels[start + 18] ?? 0) : 0) +
		(columns > 7 ? (pixels[start + 21] ?? 0) : 0)
	)
}

/**
 * Sums one channel of a picture over a block of source rows.
 *
 * @remarks
 * Source row `top + row` starts its block at `(top + row) * picture.width * 3 + left`, and each row
 * contributes `columns` samples through `sumCaptureRow`. The caller bounds the block: the call reads
 * `rows × columns` samples, inside the bytes or not, so a row count that is not above 0 sums nothing
 * and a fractional row count reads its ceiling. For whole-number arguments, the sum equals the
 * direct sum of those samples where every number the call computes from its arguments is a safe
 * integer, each row number, each intermediate sum and product of a row start, and each sample index
 * among them.
 *
 * @param picture - The source RGB picture
 * @param top - The block's first source row
 * @param left - The byte offset of the block's first sample inside a row, its channel included
 * @param row - The first row to sum, counted from `top`
 * @param rows - The number of rows to sum
 * @param columns - The number of samples to sum in each row
 * @returns The block's sum
 * @throws Thrown as an `EVIDENCE` capture error when `rows` is `Infinity`, or when `columns` is
 * `Infinity` and the block reads a row.
 *
 * @example
 * ```ts
 * sumCaptureBlock({ width: 2, height: 2, pixels: Uint8Array.from([1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]) }, 0, 0, 0, 2, 2) // 10
 * ```
 */
export function sumCaptureBlock(
	picture: CapturePicture,
	top: number,
	left: number,
	row: number,
	rows: number,
	columns: number,
): number {
	if (rows > 2) {
		if (rows === Infinity)
			throw new CaptureError('Capture sum rows must be a finite row count, not Infinity', {
				code: 'EVIDENCE',
			})
		const half = Math.ceil(rows / 2)
		return (
			sumCaptureBlock(picture, top, left, row, half, columns) +
			sumCaptureBlock(picture, top, left, row + half, rows - half, columns)
		)
	}
	return (
		(rows > 0
			? sumCaptureRow(picture.pixels, (top + row) * picture.width * 3 + left, columns)
			: 0) +
		(rows > 1
			? sumCaptureRow(picture.pixels, (top + (row + 1)) * picture.width * 3 + left, columns)
			: 0)
	)
}

/**
 * Scales a picture with an exact area average and clips its displayed height.
 *
 * @param picture - The source RGB picture
 * @param factor - The reduction factor, a whole number of at least 1; any other value gives an
 * unspecified result that might throw
 * @param limit - The maximum displayed height, a whole number of at least 1; any other value gives
 * an unspecified result that might throw
 * @returns A separately owned scaled picture
 *
 * @example
 * ```ts
 * shrinkCapturePicture({ width: 2, height: 2, pixels: new Uint8Array(12) }, 2, 8).width // 1
 * ```
 */
export function shrinkCapturePicture(
	picture: CapturePicture,
	factor: number,
	limit: number,
): CapturePicture {
	const width = Math.max(1, Math.ceil(picture.width / factor))
	const height = Math.min(Math.max(1, Math.ceil(picture.height / factor)), limit)
	// A block reaches at most this many rows and columns; `Array.from` applies the array-length rule.
	const reach = Array.from({
		length: Math.ceil(Math.min(factor, Math.max(picture.width, picture.height))),
	}).length
	// A clipped height can be fractional or negative, so the length follows the array-length rule.
	const pixels = new Uint8Array(
		Math.min(Math.max(Math.trunc(width * height * 3) || 0, 0), Number.MAX_SAFE_INTEGER),
	)
	const offsets = Array.from({ length: Math.min(width * 3, pixels.length) }, (_, offset) => offset)
	// Each output row is written once per byte, in order; a partial last row stops at the length.
	const lines = pixels.length === 0 ? 0 : Math.ceil(pixels.length / (width * 3))
	for (const y of new Array(lines).keys()) {
		const rows = Math.min(factor, picture.height - y * factor)
		for (const offset of offsets) {
			const index = y * width * 3 + offset
			if (index >= pixels.length) break
			const x = Math.floor(offset / 3)
			const columns = Math.min(factor, picture.width - x * factor)
			pixels[index] = Math.round(
				sumCaptureBlock(
					picture,
					y * factor,
					x * Math.ceil(factor) * 3 + (offset % 3),
					0,
					rows > 0 ? Math.min(reach, Math.ceil(rows)) : 0,
					columns > 0 ? Math.min(reach, Math.ceil(columns)) : 0,
				) /
					(rows * columns),
			)
		}
	}
	return { width, height, pixels }
}

/**
 * Composes pictures on the contact-sheet gray background.
 *
 * @param pictures - The ordered source cells or rows
 * @param vertical - If `true`, stacks rows; if `false`, places cells side by side
 * @param gap - The space between source pictures. Default: 6.
 * @returns A separately owned composite
 * @throws Thrown for an empty picture selection, with the `USAGE` condition.
 * @throws Thrown with the `EVIDENCE` condition when a width, a height, or the gap is not a whole
 * number from 0 to `CAPTURE_PNG_LIMITS.side`, or when the composite exceeds that side or the
 * `CAPTURE_PNG_LIMITS.pixels` budget.
 *
 * @example
 * ```ts
 * composeCapturePictures([picture, picture], false).width // picture.width * 2 + 6
 * ```
 */
export function composeCapturePictures(
	pictures: readonly CapturePicture[],
	vertical: boolean,
	gap = 6,
): CapturePicture {
	if (pictures.length === 0)
		throw new CaptureError('Empty contact-sheet picture selection', { code: 'USAGE' })
	const { side, pixels: budget } = CAPTURE_PNG_LIMITS
	const faults = [
		...pictures.flatMap((picture, position) =>
			(['width', 'height'] as const).flatMap((axis) =>
				Number.isSafeInteger(picture[axis]) && picture[axis] >= 0 && picture[axis] <= side
					? []
					: [`pictures[${String(position)}].${axis} is ${preview(picture[axis])}`],
			),
		),
		...(Number.isSafeInteger(gap) && gap >= 0 && gap <= side ? [] : [`gap is ${preview(gap)}`]),
	]
	const { width, height } = computeCaptureComposite(pictures, vertical, gap)
	if (faults.length > 0 || !matchesCaptureLimits({ width, height }))
		throw new CaptureError(
			`Contact-sheet geometry is out of range: ${
				faults.length === 0
					? `composite is ${String(width)} × ${String(height)}`
					: [
							...faults.slice(0, CAPTURE_REFUSAL_LIMIT),
							...(faults.length > CAPTURE_REFUSAL_LIMIT
								? [`… ${String(faults.length - CAPTURE_REFUSAL_LIMIT)} more`]
								: []),
						].join('; ')
			}; expected whole numbers from 0 to ${String(side)} for every width, height, and gap, and a composite of at most ${String(side)} per side and ${String(budget)} pixels`,
			{ code: 'EVIDENCE' },
		)
	// Each picture's span runs from the end before it to its own: the picture's row, then gray gap.
	const ends: number[] = []
	for (const picture of pictures)
		ends.push((ends.at(-1) ?? 0) + (vertical ? picture.height : picture.width) + gap)
	// An empty span writes nothing, so dropping it bounds the row loop by the composite's width.
	const spans = pictures
		.map((picture, position) => ({
			picture,
			start: ends[position - 1] ?? 0,
			end: Math.min(ends[position] ?? 0, vertical ? height : width),
		}))
		.filter((span) => span.end > span.start)
	// Spans are written once each, in index order.
	const pixels = new Uint8Array(width * height * 3)
	if (vertical) {
		for (const { picture, start, end } of spans) {
			for (const row of new Array(Math.max(0, end - start)).keys()) {
				const copied = row < picture.height ? picture.width : 0
				const target = (start + row) * width * 3
				pixels.set(
					picture.pixels.subarray(row * picture.width * 3, (row * picture.width + copied) * 3),
					target,
				)
				pixels.fill(128, target + copied * 3, target + width * 3)
			}
		}
		return { width, height, pixels }
	}
	for (const row of new Array(height).keys()) {
		for (const { picture, start, end } of spans) {
			const copied = row < picture.height ? Math.min(picture.width, end - start) : 0
			const target = (row * width + start) * 3
			pixels.set(
				picture.pixels.subarray(row * picture.width * 3, (row * picture.width + copied) * 3),
				target,
			)
			pixels.fill(128, target + copied * 3, (row * width + end) * 3)
		}
	}
	return { width, height, pixels }
}

/**
 * Computes the width and height of the composite that `composeCapturePictures` builds from
 * pictures of these sizes.
 *
 * @param pictures - The ordered source sizes
 * @param vertical - If `true`, stacks them; if `false`, places them side by side
 * @param gap - The space between source pictures. Default: 6.
 * @returns The composite's width and height, each 0 for no pictures
 *
 * @example
 * ```ts
 * computeCaptureComposite([{ width: 4, height: 2 }, { width: 3, height: 5 }], false) // { width: 13, height: 5 }
 * ```
 */
export function computeCaptureComposite(
	pictures: ReadonlyArray<Pick<CapturePicture, 'width' | 'height'>>,
	vertical: boolean,
	gap = 6,
): Pick<CapturePicture, 'width' | 'height'> {
	const span = gap * Math.max(0, pictures.length - 1)
	return vertical
		? {
				width: pictures.reduce((widest, entry) => Math.max(widest, entry.width), 0),
				height: pictures.reduce((sum, entry) => sum + entry.height, 0) + span,
			}
		: {
				width: pictures.reduce((sum, entry) => sum + entry.width, 0) + span,
				height: pictures.reduce((tallest, entry) => Math.max(tallest, entry.height), 0),
			}
}

/**
 * Checks whether a picture size fits `CAPTURE_PNG_LIMITS`, per side and in pixels.
 *
 * @param picture - The size to check
 * @returns True if neither side passes `CAPTURE_PNG_LIMITS.side` and the area does not pass
 * `CAPTURE_PNG_LIMITS.pixels`; false otherwise
 *
 * @example
 * ```ts
 * matchesCaptureLimits({ width: 13040, height: 1636 }) // false
 * ```
 */
export function matchesCaptureLimits(picture: Pick<CapturePicture, 'width' | 'height'>): boolean {
	const { side, pixels } = CAPTURE_PNG_LIMITS
	return picture.width <= side && picture.height <= side && picture.width * picture.height <= pixels
}

/**
 * Splits contact-sheet rows into consecutive pages of at most `size` rows whose stacked composite
 * fits `CAPTURE_PNG_LIMITS`.
 *
 * @remarks
 * A page takes each next row while it holds fewer than `size` rows and the stacked composite,
 * with `gap` between rows, still fits; otherwise the row opens the next page.
 *
 * @param rows - The ordered rows, each with its composite width and height
 * @param size - The most rows a page holds, a whole number of at least 1; any other value gives an
 * unspecified result that might throw
 * @param gap - The space between stacked rows
 * @returns The pages, in order
 * @throws Thrown with the `USAGE` condition when one row alone does not fit `CAPTURE_PNG_LIMITS`,
 * naming its composite, the limits, and the narrower `--variant` selection that recovers.
 *
 * @example
 * ```ts
 * splitCaptureSheets([{ width: 13040, height: 400 }, { width: 13040, height: 400 }], 4, 12).length // 1
 * ```
 */
export function splitCaptureSheets<T extends Pick<CapturePicture, 'width' | 'height'>>(
	rows: readonly T[],
	size: number,
	gap: number,
): ReadonlyArray<readonly T[]> {
	const wide = rows.find((row) => !matchesCaptureLimits(row))
	if (wide !== undefined)
		throw new CaptureError(
			`Contact-sheet row is out of range: composite is ${String(wide.width)} × ${String(wide.height)}; expected at most ${String(CAPTURE_PNG_LIMITS.side)} per side and ${String(CAPTURE_PNG_LIMITS.pixels)} pixels; select fewer variants with --variant`,
			{ code: 'USAGE' },
		)
	// Each record holds its page's first row and the page's stacked size through this row.
	const marks: Array<{ readonly first: number; readonly width: number; readonly height: number }> =
		[]
	for (const [index, row] of rows.entries()) {
		const last = marks.at(-1)
		const joined =
			last === undefined
				? undefined
				: {
						first: last.first,
						width: Math.max(last.width, row.width),
						height: last.height + gap + row.height,
					}
		marks.push(
			joined !== undefined && index - joined.first < size && matchesCaptureLimits(joined)
				? joined
				: { first: index, width: row.width, height: row.height },
		)
	}
	const starts = marks.flatMap((mark, index) => (mark.first === index ? [index] : []))
	return starts.map((first, page) => rows.slice(first, starts[page + 1] ?? rows.length))
}

/**
 * Reads the process id that a request file, or its temporary sibling, names.
 *
 * @param name - A file name from the request directory
 * @returns The process id the name carries, from 1 to `CAPTURE_PID_LIMIT`, or `undefined` for any
 * other name
 *
 * @example
 * ```ts
 * readCaptureRequestOwner('journey-selection-4242.json') // 4242
 * readCaptureRequestOwner('journey-selection-4242.json.tmp') // 4242
 * readCaptureRequestOwner('journey-selection.json') // undefined
 * readCaptureRequestOwner('journey-selection-4294967296.json') // undefined
 * ```
 */
export function readCaptureRequestOwner(name: string): number | undefined {
	const match = new RegExp(`^${CAPTURE_REQUEST_PREFIX}-(\\d+)\\.json(?:\\.tmp)?$`, 'u').exec(name)
	const pid = Number(match?.[1])
	return Number.isSafeInteger(pid) && pid > 0 && pid <= CAPTURE_PID_LIMIT ? pid : undefined
}

/**
 * Describes the request holders that keep a workspace busy, naming apart those the host could not inspect.
 *
 * @param holders - The holders `CaptureInvocationInterface.holders` lists
 * @param directory - The workspace-relative request directory that holds their request files
 * @returns The running holders' sentence, then the uninspected holders' sentence with its correction
 *
 * @example
 * ```ts
 * describeCaptureHolders([{ pid: 4242, inspected: true }], 'tmp/capture')
 * // 'Another runner holds this workspace (process 4242)'
 * ```
 */
export function describeCaptureHolders(
	holders: readonly CaptureHolder[],
	directory: string,
): string {
	const running = holders.filter((holder) => holder.inspected).map((holder) => holder.pid)
	const unknown = holders.filter((holder) => !holder.inspected).map((holder) => holder.pid)
	return [
		...(running.length === 0
			? []
			: [`Another runner holds this workspace (process ${running.join(', ')})`]),
		...(unknown.length === 0
			? []
			: [
					`Request holder process ${unknown.join(', ')} could not be inspected; confirm no capture process or surviving child is running before deleting its request file in ${directory}`,
				]),
	].join('. ')
}

/**
 * Resolves a path to the slash-separated form the evidence documents store, relative to a root.
 *
 * @param root - The absolute workspace path
 * @param target - The absolute or workspace-relative path
 * @returns The path relative to the root, with every backslash replaced by a slash
 *
 * @example
 * ```ts
 * resolveCaptureRelative(process.cwd(), resolve('tmp', 'units')) // 'tmp/units'
 * ```
 */
export function resolveCaptureRelative(root: string, target: string): string {
	return normalizeSlashes(relative(root, resolve(root, target)))
}

/**
 * Escapes every regular-expression metacharacter so a case name matches only itself.
 *
 * @param text - The literal text
 * @returns The text with each metacharacter backslash-quoted
 *
 * @example
 * ```ts
 * escapeCapturePattern('renders (a.b) + c') // 'renders \\(a\\.b\\) \\+ c'
 * ```
 */
export function escapeCapturePattern(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Builds the tag expression that selects an owner population, and its capture tags for frames.
 *
 * @remarks
 * A journey selects `owner:<selector>`. A capture intersects that with the capture tag the
 * selector names, which is its scope and part: the first two segments. The `all` selector unions
 * every declared scope. Colons stay part of a tag name.
 *
 * @param command - The runner command
 * @param selector - The requested owner path or `all`
 * @param selectors - Every owner path the wrapper declares, without the `owner:` prefix
 * @returns The expression for `--tags-filter`
 *
 * @example
 * ```ts
 * buildCaptureFilter('journey', 'pages:mail', ['pages', 'pages:mail']) // 'owner:pages:mail'
 * buildCaptureFilter('capture', 'pages:mail', ['pages', 'pages:mail']) // 'owner:pages:mail && pages:mail'
 * ```
 */
export function buildCaptureFilter(
	command: CaptureCommand,
	selector: string,
	selectors: readonly string[],
): string {
	const scopes = selectors.filter((entry) => !entry.includes(':'))
	const owner =
		selector === 'all'
			? `(${scopes.map((scope) => `${CAPTURE_OWNER_PREFIX}${scope}`).join(' || ')})`
			: `${CAPTURE_OWNER_PREFIX}${selector}`
	const capture =
		selector === 'all' ? `(${scopes.join(' || ')})` : selector.split(':').slice(0, 2).join(':')
	return command === 'journey' ? owner : `${owner} && ${capture}`
}

/**
 * Plans one selected journey stage or narrow and remaining frame stages.
 *
 * @remarks
 * Journeys run every selected variant together. Frame captures stage the first variant alone and
 * the remaining variants together. Empty stages are dropped and no unselected variant is added.
 *
 * @param variants - The selected variants in declaration order
 * @param first - The variant the wrapper stages alone first
 * @param command - The journey or capture command whose stage contract applies
 * @returns The non-empty stages in run order
 *
 * @example
 * ```ts
 * resolveCaptureStages(['wide', 'compact'], 'compact', 'capture')
 * // [{ name: 'narrow', variants: ['compact'] }, { name: 'rest', variants: ['wide'] }]
 * ```
 */
export function resolveCaptureStages(
	variants: readonly string[],
	first: string,
	command: CaptureRequest['command'],
): readonly CaptureStagePlan[] {
	if (command === 'journey')
		return variants.length === 0 ? [] : [{ name: CAPTURE_STAGES.selected, variants: [...variants] }]
	const stages: readonly CaptureStagePlan[] = [
		{ name: CAPTURE_STAGES.first, variants: variants.filter((variant) => variant === first) },
		{ name: CAPTURE_STAGES.rest, variants: variants.filter((variant) => variant !== first) },
	]
	return stages.filter((stage) => stage.variants.length > 0)
}

/**
 * Resolves selected producing variants in declaration order and requires their projects.
 *
 * @param selected - Explicit variants, or an empty list for every declared variant
 * @param projects - The discovered host projects
 * @returns The declared variants the selection includes
 * @throws Thrown as USAGE for an unknown variant or HOST for missing variant projects.
 * @example
 * ```ts
 * const variants = resolveCaptureVariants(['light-390'], projects)
 * // ['light-390'] when the wrapper declares its project
 * ```
 */
export function resolveCaptureVariants(
	selected: readonly string[],
	projects: readonly CaptureProject[],
): readonly string[] {
	const declared = [...new Set(projects.flatMap((project) => project.variants))]
	for (const variant of selected) {
		if (!declared.includes(variant))
			throw new CaptureError(
				`Unknown variant; ${describeCaptureFault('--variant', variant, 'a variant declared by the wrapper', declared)}`,
				{ code: 'USAGE', context: { variant } },
			)
	}
	const variants = declared.filter((variant) => selected.length === 0 || selected.includes(variant))
	if (variants.length === 0)
		throw new CaptureError('The wrapper declares no journey variants', { code: 'HOST' })
	for (const variant of variants) {
		if (!projects.some((project) => project.variant === variant))
			throw new CaptureError(`The wrapper declares no journey project for ${variant}`, {
				code: 'HOST',
				context: { variant },
			})
	}
	return variants
}

/**
 * Collects the owner selectors the projects' owner tags declare, once each, in tag order.
 *
 * @param projects - The discovered host projects
 * @returns Each tagged owner selector, ancestors included where the wrapper tags them
 * @example
 * ```ts
 * collectCaptureOwners(projects) // ['pages', 'pages:mail'] for owner:pages and owner:pages:mail tags
 * ```
 */
export function collectCaptureOwners(projects: readonly CaptureProject[]): readonly string[] {
	return [...new Set(projects.flatMap((project) => project.tags))]
		.filter((tag) => tag.startsWith(CAPTURE_OWNER_PREFIX))
		.map((tag) => tag.slice(CAPTURE_OWNER_PREFIX.length))
}

/**
 * Refuses unknown command selections from the wrapper before authenticating disk evidence.
 * @example
 * ```ts
 * requireCaptureSelection('all', [], projects) // undefined for declared wrapper projects
 * ```
 */
export function requireCaptureSelection(
	selector: string,
	variants: readonly string[],
	projects: readonly CaptureProject[],
	outputs: readonly string[] = [],
	portfolio?: string,
): void {
	const selectors = [
		...new Set(
			projects.flatMap((project) => [
				...collectCaptureOwners([project]),
				...project.standalone.map((entry) => entry.portfolio),
			]),
		),
	]
	const fault = describeCaptureSelectorFault(selector, selectors)
	if (fault !== undefined) throw new CaptureError(fault, { code: 'USAGE' })
	const portfolios = [
		...new Set(
			projects.flatMap((project) =>
				[...project.portfolios, ...project.standalone].map((entry) => entry.portfolio),
			),
		),
	]
	if (portfolio !== undefined && !portfolios.includes(portfolio))
		throw new CaptureError(
			describeCaptureFault(
				'--portfolio',
				portfolio,
				'a portfolio declared by the wrapper',
				portfolios,
			),
			{ code: 'USAGE' },
		)
	const declared = [...new Set([...projects.flatMap((project) => project.variants), ...outputs])]
	for (const variant of variants)
		if (!declared.includes(variant))
			throw new CaptureError(
				describeCaptureFault(
					'--variant',
					variant,
					'a variant declared by the wrapper or registry output population',
					declared,
				),
				{ code: 'USAGE' },
			)
}

/**
 * Picks the standalone portfolio root a selection names by its selector or its portfolio.
 *
 * @remarks
 * A standalone root has no stamping route and no registry refresh, so a selection reads it only
 * when it names the root's portfolio. Every other selection reads the primary directory.
 *
 * @param roots - The wrapper's standalone roots
 * @param selector - The selected owner selector
 * @param portfolio - The selected portfolio, when the selection names one
 * @returns The named standalone root, or `undefined` for a primary selection
 * @example
 * ```ts
 * const vue = { portfolio: 'vue', directory: 'tmp/captures/vue', scoped: false }
 * resolveCaptureStandalone([vue], 'vue:home') // vue
 * resolveCaptureStandalone([vue], 'pages:mail') // undefined
 * ```
 */
export function resolveCaptureStandalone(
	roots: readonly CapturePortfolioRoot[],
	selector: string,
	portfolio?: string,
): CapturePortfolioRoot | undefined {
	return roots.find(
		(root) =>
			portfolio === root.portfolio ||
			selector === root.portfolio ||
			selector.startsWith(`${root.portfolio}:`),
	)
}

/**
 * Reads output variant candidates without authenticating or accepting registry evidence.
 * @remarks Missing, unreadable, or malformed registries supply no candidate hints; the integrity engine still authenticates every accepted read.
 * @example
 * ```ts
 * readCaptureVariants('/workspace', '/workspace/tmp/captures/states/registry.json') // [] when absent
 * ```
 */
export function readCaptureVariants(root: string, file: string): readonly string[] {
	const read = attempt(() => parseJSON(readFileSync(requireCaptureContained(root, file), 'utf8')))
	return read.success && isCaptureRegistry(read.value)
		? [...new Set(read.value.entries.map((entry) => entry.variant))]
		: []
}

/**
 * Builds the exact Node argument array that spawns one Vitest stage.
 *
 * @remarks
 * Each value is its own array element, so no shell quoting applies and a case name keeps its
 * spaces and quotes. An exact case adds `-t` with the anchored pattern for that case and the
 * final case, so the final case still writes the run record.
 *
 * @param options - The entry, wrapper, report and progress files, projects, tag filter, bail switch, and optional exact case and mode
 * @returns The arguments after the Node executable
 *
 * @example
 * ```ts
 * const args = buildCaptureArguments({
 * 	entry: '/repo/node_modules/vitest/vitest.mjs',
 * 	config: '/repo/vite.journey.config.ts',
 * 	report: '/repo/tmp/units/runs/a/journey-selected.json',
 * 	progress: '/repo/tmp/units/runs/a/selected.progress.jsonl',
 * 	projects: ['journey:light-390'],
 * 	filter: 'owner:pages:mail',
 * 	final: 'closes the run',
 * })
 * args.includes('--bail=1') // true
 * ```
 */
export function buildCaptureArguments(options: CaptureArgumentsOptions): readonly string[] {
	const separator = options.case === undefined ? ' ' : readCaptureSeparator(options.entry)
	return [
		options.entry,
		'run',
		'--config',
		options.config,
		...(options.mode === undefined
			? []
			: options.mode.startsWith('-')
				? [`--mode=${options.mode}`]
				: ['--mode', options.mode]),
		'--configLoader',
		'runner',
		'--no-cache',
		...(options.bail === false ? [] : ['--bail=1']),
		'--reporter=dot',
		'--reporter=json',
		`--outputFile.json=${options.report}`,
		`--outputFile.progress=${options.progress}`,
		...options.projects.flatMap((project) => ['--project', project]),
		...(options.filter === undefined ? [] : ['--tags-filter', options.filter]),
		...(options.case === undefined
			? []
			: [
					'-t',
					`^(?:${[options.case, options.final].map((name) => escapeCapturePattern((options.titles?.[name] ?? [name]).join(separator))).join('|')})$`,
				]),
	]
}

/**
 * Reads the installed workspace Vitest's exact title separator, refusing unsupported majors.
 * @example
 * ```ts
 * readCaptureSeparator('/workspace/node_modules/vitest/vitest.mjs') // ' > ' on Vitest 5
 * ```
 */
export function readCaptureSeparator(entry: string): string {
	const file = resolve(dirname(entry), 'package.json')
	const loaded = attempt(() => parseJSON(readFileSync(file, 'utf8')))
	if (!loaded.success)
		throw new CaptureError(`Cannot read installed Vitest manifest: ${file}`, {
			code: 'HOST',
			cause: loaded.error,
		})
	const manifest: unknown = loaded.value
	const version = isRecord(manifest) ? manifest.version : undefined
	if (typeof version === 'string' && version.split('.')[0] === '5') return ' > '
	throw new CaptureError(
		describeCaptureFault('vitest.version', version, 'a supported installed Vitest major', ['5']),
		{ code: 'HOST' },
	)
}

/**
 * Reads original title segments from the accepted registry's authenticated JSON reporter files.
 * @param root - The repository root that contains the registry and its reporters
 * @param file - The accepted registry path
 * @param selector - The optional owner selector that bounds the case candidates
 * @returns Exact case names mapped to their original title segments within the selected owners
 * @throws Thrown with the removal of the registry and the manifest and lookup journal beside it,
 * and the refresh commands, when the registry declares another protocol version; thrown as a
 * `REGISTRY` capture error when the registry or a reporter it names is absent, unreadable, or fails
 * authentication.
 * @example
 * ```ts
 * const titles = readCaptureTitles('/workspace', '/workspace/tmp/captures/states/registry.json')
 * ```
 */
export function readCaptureTitles(
	root: string,
	file: string,
	selector?: string,
): Readonly<Record<string, readonly string[]>> {
	try {
		const path = requireCaptureContained(root, file)
		const loaded = attempt(() => readFileSync(path, 'utf8'))
		if (!loaded.success)
			throw new CaptureError(
				`Missing accepted registry; run the explicit complete-registry refresh: capture registry. Registry path: ${file}`,
				{ code: 'EVIDENCE', cause: loaded.error },
			)
		const registry: unknown = parseJSON(loaded.value)
		requireCaptureVersion(registry, 'Registry', file, [
			file,
			resolve(dirname(file), CAPTURE_MANIFEST_FILE),
			resolve(dirname(file), CAPTURE_LOOKUPS_FILE),
		])
		if (!isCaptureRegistry(registry))
			throw new CaptureError('Invalid accepted registry for case titles', { code: 'EVIDENCE' })
		return Object.fromEntries(
			registry.receipts.flatMap((receipt) => {
				const text = readFileSync(
					requireCaptureContained(root, resolve(root, receipt.report.file)),
					'utf8',
				)
				if (computeCaptureHash(text) !== receipt.report.digest)
					throw new CaptureError('Registry reporter digest differs for case titles', {
						code: 'EVIDENCE',
					})
				const report: unknown = parseJSON(text)
				if (!isRecord(report) || !arrayOf(isRecord)(report.testResults))
					throw new CaptureError('Invalid registry reporter for case titles', { code: 'EVIDENCE' })
				const selected =
					selector === undefined
						? undefined
						: new Set(
								readCaptureReport(report)
									.assertions.filter((entry) => matchesCaptureSelector(entry.owner, selector))
									.map((entry) => entry.case),
							)
				return report.testResults.flatMap((result) =>
					!arrayOf(isRecord)(result.assertionResults)
						? []
						: result.assertionResults.flatMap((assertion) => {
								if (
									!isString(assertion.fullName) ||
									!isString(assertion.title) ||
									!arrayOf(isString)(assertion.ancestorTitles)
								)
									return []
								const titles = [...assertion.ancestorTitles, assertion.title]
								if (titles.join(' ') !== assertion.fullName)
									throw new CaptureError('Registry reporter title segments differ from its case', {
										code: 'EVIDENCE',
									})
								return selected === undefined || selected.has(assertion.fullName)
									? [[assertion.fullName, titles] as const]
									: []
							}),
				)
			}),
		)
	} catch (error) {
		throw resolveCaptureRegistryFault(error)
	}
}

/**
 * Parses standard option tokens and refuses empty values, terminators, and repeated single options.
 *
 * @remarks A boolean option whose default is `true` reads its `--no-` form as `false` and refuses
 * its positive form, so `--no-bail` is the one spelling of `bail`; the `--no-` form of any other
 * option is refused as unknown. An option and its `--no-` form repeat each other.
 *
 * @param argv - The arguments after the subcommand
 * @param options - The command's frozen Node option definitions
 * @param usage - The command syntax appended to every parser refusal
 * @returns Typed values, positionals, and the tokens that supplied them
 * @example
 * ```ts
 * readCaptureOptions(['--case=-draft'], CAPTURE_COMMAND_OPTIONS.journey, 'Usage: capture journey <selector>').values.case // '-draft'
 * readCaptureOptions(['--no-bail'], CAPTURE_COMMAND_OPTIONS.journey, 'Usage: capture journey <selector>').values.bail // false
 * ```
 */
export function readCaptureOptions<Options extends ParseArgsOptionsConfig>(
	argv: readonly string[],
	options: Options,
	usage: string,
): CaptureParsedArguments<Options> {
	try {
		const parsed = parseArgs({
			args: [...argv],
			options,
			tokens: true,
			strict: true,
			allowPositionals: true,
			allowNegative: true,
		})
		for (const token of parsed.tokens) {
			if (token.kind === 'option-terminator')
				throw new CaptureError('The -- option terminator is refused', { code: 'USAGE' })
			if (token.kind !== 'option') continue
			if (token.rawName === `--no-${token.name}` && options[token.name]?.default !== true)
				throw new CaptureError(`Unknown option '${token.rawName}'`, { code: 'USAGE' })
			if (token.rawName === `--${token.name}` && options[token.name]?.default === true)
				throw new CaptureError(
					`Unknown option '${token.rawName}'; ${token.name} is on by default, and --no-${token.name} turns it off`,
					{ code: 'USAGE' },
				)
			if (token.value === '')
				throw new CaptureError(`Missing value: --${token.name}`, { code: 'USAGE' })
			if (
				options[token.name]?.multiple !== true &&
				parsed.tokens.some(
					(earlier) =>
						earlier.kind === 'option' && earlier.name === token.name && earlier.index < token.index,
				)
			)
				throw new CaptureError(`Repeated option: --${token.name}`, { code: 'USAGE' })
		}
		return parsed
	} catch (error) {
		throw new CaptureError(`${describeCaptureError(error)}\n${usage}`, {
			code: 'USAGE',
			cause: error,
		})
	}
}

/**
 * Reads the runner's command line into one selector, its flags, and the resolved wrapper path.
 *
 * @remarks
 * `--state` belongs to `capture` and `stale`, and `--portfolio` to `stale`. Journey and capture
 * accept `--changed <ref>` instead of a selector, with optional valueless `--plan`, and valueless
 * `--no-bail`, which sets `bail` to `false`. Every other
 * flag takes one nonempty value, either separated or in equals form, and only `--variant` repeats.
 * A value beginning with a dash requires equals form. A bare invocation leaves its selector absent
 * so the caller can print usage with the declared selectors.
 *
 * @param argv - The arguments after the entry name
 * @param command - The runner command the flags belong to
 * @param root - The absolute workspace path the wrapper path resolves against
 * @param fallback - The repository-relative wrapper path used when `--config` is absent
 * @returns The parsed arguments with an absolute wrapper path
 * @throws Thrown as a `USAGE` capture error for an unknown, repeated, misplaced, or valueless flag, a
 * second selector, a repeated or invalid variant, an invalid state, or an empty case.
 *
 * @example
 * ```ts
 * readCaptureArguments(['pages:mail', '--variant', 'light-390'], 'journey', '/repo', 'vite.journey.config.ts')
 * // { selector: 'pages:mail', config: '/repo/vite.journey.config.ts', variants: ['light-390'] }
 * ```
 */
export function readCaptureArguments(
	argv: readonly string[],
	command: CaptureCommand,
	root: string,
	fallback: string,
): CaptureRunnerArguments {
	const usage = `Usage: capture ${CAPTURE_COMMAND_NAMES[command]} <selector> [options]${command === 'stale' ? '' : `; capture ${CAPTURE_COMMAND_NAMES[command]} --changed <ref> [--plan] [options]`}`
	const { values, positionals: positional } = readCaptureOptions(
		argv,
		CAPTURE_COMMAND_OPTIONS[command],
		usage,
	)
	if (positional.length > 1)
		throw new CaptureError('Expected exactly one selector', { code: 'USAGE' })
	const variants = values.variant ?? []
	if (new Set(variants).size !== variants.length)
		throw new CaptureError('Repeated variant', { code: 'USAGE' })
	const invalid = variants.findIndex((variant) => !isCaptureSegment(variant))
	if (invalid !== -1)
		throw new CaptureError(
			`Invalid variant identity; ${describeCaptureFault(`--variant[${String(invalid)}]`, variants[invalid], "a portable nonempty identity segment; valid values come from the wrapper's variant declarations")}`,
			{ code: 'USAGE' },
		)
	const state = 'state' in values && typeof values.state === 'string' ? values.state : undefined
	if (state !== undefined && !isCaptureSegment(state))
		throw new CaptureError(
			`Invalid state identity; ${describeCaptureFault('--state', state, "a portable nonempty state identity; valid values come from the selected case's state declarations")}`,
			{ code: 'USAGE' },
		)
	const name = values.case
	const mode = values.mode
	if (name !== undefined && name.trim() === '')
		throw new CaptureError('Empty case name', { code: 'USAGE' })
	const portfolio =
		'portfolio' in values && typeof values.portfolio === 'string' ? values.portfolio : undefined
	const selector = positional.at(0)
	const changed =
		'changed' in values && typeof values.changed === 'string' ? values.changed : undefined
	const plan = 'plan' in values && values.plan === true
	const bail = !('bail' in values) || values.bail !== false
	if (changed !== undefined && selector !== undefined)
		throw new CaptureError(
			'A selector cannot be combined with --changed; use --changed <ref> alone',
			{ code: 'USAGE' },
		)
	if (plan && changed === undefined)
		throw new CaptureError('--plan requires --changed <ref>', { code: 'USAGE' })
	return {
		...(selector === undefined ? {} : { selector }),
		...(changed === undefined ? {} : { changed }),
		...(plan ? { plan: true } : {}),
		...(bail ? {} : { bail: false }),
		config: resolve(root, values.config ?? fallback),
		...(mode === undefined ? {} : { mode }),
		variants,
		...(name === undefined ? {} : { case: name }),
		...(state === undefined ? {} : { state }),
		...(portfolio === undefined ? {} : { portfolio }),
	}
}

/**
 * Reads the physical portfolio roots a wrapper declares and refuses a malformed or repeated root.
 *
 * @param value - The wrapper's declaration, expected to be a list of roots
 * @param subject - The name of the declaration in a refusal
 * @returns The validated roots in declaration order
 * @throws Thrown as a `HOST` capture error when the declaration is not a list or a root is malformed, and
 * as an `EVIDENCE` capture error when a portfolio name repeats, case-folded.
 *
 * @example
 * ```ts
 * readCapturePortfolios([{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }], 'portfolios')
 * ```
 */
export function readCapturePortfolios(
	value: unknown,
	subject: string,
): readonly CapturePortfolioRoot[] {
	if (!isArray(value))
		throw new CaptureError(
			`The wrapper provides no ${subject}; ${describeCaptureFault(subject, value, 'a list of portfolio roots', ['portfolio', 'directory', 'scoped'])}`,
			{ code: 'HOST' },
		)
	const roots = value.map((root, index): CapturePortfolioRoot => {
		const keys = ['portfolio', 'directory', 'scoped']
		if (
			!isRecord(root) ||
			!isCaptureSegment(root.portfolio) ||
			!isCapturePath(root.directory) ||
			typeof root.scoped !== 'boolean' ||
			Object.keys(root).some((key) => !keys.includes(key))
		)
			throw new CaptureError(
				`The wrapper provides an invalid ${subject} root; ${describeCaptureFault(`${subject}[${String(index)}]`, root, '{ portfolio: portable segment, directory: contained portable path, scoped: boolean }', keys, keys)}`,
				{ code: 'HOST' },
			)
		return { portfolio: root.portfolio, directory: root.directory, scoped: root.scoped }
	})
	requireCaptureUnique(
		roots.map((root) => root.portfolio),
		subject,
		true,
	)
	return roots
}

/**
 * Reads one wrapper project's host declarations from its Vitest test configuration.
 *
 * @remarks
 * The label is the project's `name` or its `label` member. Tags must not contain whitespace or a
 * tag-filter operator, and a variant must be a portable identity. The project's own `variant` must
 * be one of the declared `variants`, and so must the `first` stage variant. Portfolio roots and
 * the final case are required, and standalone roots default to none. `uniform` is an optional
 * list of unique valid owner selectors for the preflight's frame scan. Default: every scope.
 * An empty list judges none; the declaration never narrows the other readings.
 *
 * @param test - The project's `test` configuration, or any value the wrapper supplied in its place
 * @returns The validated project declaration
 * @throws Thrown as a `HOST` capture error when a declaration is missing or malformed.
 *
 * @example
 * ```ts
 * const project = readCaptureProject({
 * 	name: 'journey:light-390',
 * 	tags: [{ name: 'owner:pages:mail' }],
 * 	provide: {
 * 		variant: 'light-390',
 * 		variants: [{ name: 'light-390' }],
 * 		directory: '/repo/tmp/captures/states',
 * 		record: 'tmp/captures/states/runs/a/light-390.json',
 * 		inputs: ['src/**'],
 * 		final: 'closes the run',
 * 		first: 'light-390',
 * 		portfolios: [{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }],
 * 	},
 * })
 * project.variant // 'light-390'
 * ```
 */
export function readCaptureProject(test: unknown): CaptureProject {
	const name: unknown = isRecord(test) ? test.name : undefined
	const label =
		typeof name === 'string'
			? name
			: isRecord(name) && typeof name.label === 'string'
				? name.label
				: undefined
	if (label === undefined)
		throw new CaptureError(
			'Unsupported journey project name: expected a string or an object with a string label',
			{ code: 'HOST' },
		)
	const entries: unknown = isRecord(test) ? test.tags : undefined
	const tags: unknown = (isArray(entries) ? entries : []).map((tag): unknown =>
		isRecord(tag) ? tag.name : undefined,
	)
	if (
		!arrayOf(isString)(tags) ||
		tags.some((tag) => /[\s!*&|()]/u.test(tag) || CAPTURE_TAG_OPERATORS.includes(tag))
	)
		throw new CaptureError('The wrapper declares an invalid tag name', { code: 'HOST' })
	const provided: unknown = isRecord(test) ? test.provide : undefined
	const declared: unknown = isRecord(provided) ? provided.variants : undefined
	if (!isArray(declared))
		throw new CaptureError('A journey project provides no variants', { code: 'HOST' })
	const variants = declared.map((entry): unknown => (isRecord(entry) ? entry.name : undefined))
	if (!arrayOf(isString)(variants))
		throw new CaptureError('A journey variant has no name', { code: 'HOST' })
	if (
		!isRecord(provided) ||
		!isString(provided.directory) ||
		!isString(provided.record) ||
		!arrayOf(isCapturePattern)(provided.inputs)
	)
		throw new CaptureError(
			`The wrapper provides no bounded integrity host declaration; ${describeCaptureFault('test.provide', provided, '{ directory: string workspace path, record: string run path, inputs: portable glob[] }', ['directory', 'record', 'inputs'], ['directory', 'record', 'inputs'], isRecord(provided) ? Object.keys(provided) : [])}`,
			{
				code: 'HOST',
			},
		)
	const invalid = variants.findIndex((variant) => !isCaptureSegment(variant))
	if (invalid !== -1)
		throw new CaptureError(
			`A journey variant has an invalid identity; ${describeCaptureFault(`test.provide.variants[${String(invalid)}].name`, variants[invalid], 'a portable nonempty variant identity segment', variants.some(isCaptureSegment) ? variants.filter(isCaptureSegment) : ['<portable variant name>'])}`,
			{ code: 'HOST' },
		)
	requireCaptureUnique(variants, 'journey variants', true)
	const variant = provided.variant
	if (!isString(variant) || !variants.includes(variant))
		throw new CaptureError(`The project ${label} provides no declared variant`, { code: 'HOST' })
	const first = provided.first
	if (!isString(first) || !variants.includes(first))
		throw new CaptureError('The wrapper provides no first-stage variant among its variants', {
			code: 'HOST',
		})
	const final = provided.final
	if (!isString(final) || final.trim() === '')
		throw new CaptureError('The wrapper provides no final case', { code: 'HOST' })
	const uniform = provided.uniform
	if (uniform !== undefined && !arrayOf(isCaptureSelector)(uniform))
		throw new CaptureError('The wrapper uniform scopes must be a list of valid owner selectors', {
			code: 'HOST',
		})
	if (uniform !== undefined) requireCaptureUnique(uniform, 'uniform scopes')
	const portfolios = readCapturePortfolios(provided.portfolios, 'portfolios')
	if (portfolios.length === 0)
		throw new CaptureError('The wrapper provides no portfolio roots', { code: 'HOST' })
	const standalone =
		provided.standalone === undefined
			? []
			: readCapturePortfolios(provided.standalone, 'standalone portfolios')
	requireCaptureUnique(
		[...portfolios, ...standalone].map((root) => root.portfolio),
		'portfolio names',
		true,
	)
	return {
		name: label,
		variant,
		tags,
		variants,
		directory: provided.directory,
		record: provided.record,
		inputs: provided.inputs,
		final,
		first,
		...(uniform === undefined ? {} : { uniform }),
		portfolios,
		standalone,
	}
}

/**
 * Describes a project's portfolio roots as comparable lines, primary roots apart from standalone ones.
 *
 * @param project - The project whose roots to describe
 * @returns One line per root, naming its kind, portfolio, directory, and scoping
 *
 * @example
 * ```ts
 * describeCapturePortfolios({
 * 	portfolios: [{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true }],
 * 	standalone: [],
 * }) // ['primary states tmp/captures/states true']
 * ```
 */
export function describeCapturePortfolios(
	project: Pick<CaptureProject, 'portfolios' | 'standalone'>,
): readonly string[] {
	return [
		...project.portfolios.map(
			(root) => `primary ${root.portfolio} ${root.directory} ${String(root.scoped)}`,
		),
		...project.standalone.map(
			(root) => `standalone ${root.portfolio} ${root.directory} ${String(root.scoped)}`,
		),
	]
}

/**
 * Refuses a wrapper project set whose members repeat or disagree on a host declaration.
 *
 * @remarks
 * Project labels are unique and so is each project's own variant, case-folded. Every project must
 * declare the same primary directory, inputs, variants, first-stage variant, final case, and
 * portfolio roots, because the runner builds one engine for the whole set. Uniform declarations
 * must also agree as populations, with absence distinct from an empty list.
 *
 * @param projects - The wrapper's projects
 * @returns The first project, whose declarations every other project matches
 * @throws Thrown as a `HOST` capture error when the set is empty or its members disagree, and as an
 * `EVIDENCE` capture error when a label or variant repeats.
 *
 * @example
 * ```ts
 * requireCaptureProjects([project]) // project
 * ```
 */
export function requireCaptureProjects(projects: readonly CaptureProject[]): CaptureProject {
	const first = projects.at(0)
	if (first === undefined)
		throw new CaptureError('No host project declares integrity inputs', { code: 'HOST' })
	requireCaptureUnique(
		projects.map((project) => project.name),
		'journey projects',
	)
	requireCaptureUnique(
		projects.map((project) => project.variant),
		'journey project variants',
		true,
	)
	if (
		projects.some(
			(project) =>
				project.directory !== first.directory ||
				project.final !== first.final ||
				project.first !== first.first ||
				(project.uniform === undefined || first.uniform === undefined
					? project.uniform !== first.uniform
					: !matchesCaptureMembers(project.uniform, first.uniform)) ||
				!matchesCaptureMembers(project.inputs, first.inputs) ||
				!matchesCaptureMembers(project.variants, first.variants) ||
				!matchesCaptureMembers(
					describeCapturePortfolios(project),
					describeCapturePortfolios(first),
				),
		)
	)
		throw new CaptureError('Host project integrity declarations disagree', { code: 'HOST' })
	return first
}

/**
 * Describes why a selector names nothing the wrapper declares, naming the first unknown segment.
 *
 * @remarks
 * The depth of a segment decides its label: the first segment is a scope and every deeper one an
 * owner. `all` and every declared owner path, ancestors included, name something.
 *
 * @param selector - The requested owner path or `all`
 * @param selectors - Every owner path the wrapper declares, ancestors included
 * @returns The refusal text, or `undefined` when the selector names a declared population
 *
 * @example
 * ```ts
 * describeCaptureSelectorFault('pages:mail', ['pages', 'pages:mail']) // undefined
 * describeCaptureSelectorFault('pages:none', ['pages', 'pages:mail'])?.includes('selector: received "pages:none"') // true
 * ```
 */
export function describeCaptureSelectorFault(
	selector: string,
	selectors: readonly string[],
): string | undefined {
	if (selector === 'all' || selectors.includes(selector)) return undefined
	const parts = selector.split(':')
	const missing = parts.findIndex(
		(_part, index) => !selectors.includes(parts.slice(0, index + 1).join(':')),
	)
	return `Unknown ${missing === 0 ? 'scope' : 'owner'}: ${preview(parts[missing] ?? selector)}; ${describeCaptureFault('selector', selector, 'all or a declared colon-separated owner selector; obsolete owner paths are not aliases', ['all', ...selectors])}`
}

/**
 * Builds the refusal a wrapper raises for a request file it cannot accept as its parent's.
 *
 * @param file - The absolute request path, named in the message
 * @param cause - The underlying failure, when there is one
 * @returns A `HOST` capture error naming the file
 *
 * @example
 * ```ts
 * buildCaptureRequestRefusal('/repo/tmp/units/journey-selection-4242.json').message
 * // 'Invalid journey selection request: /repo/tmp/units/journey-selection-4242.json'
 * ```
 */
export function buildCaptureRequestRefusal(file: string, cause?: unknown): CaptureError {
	return new CaptureError(`Invalid journey selection request: ${file}`, {
		code: 'HOST',
		context: { file },
		...(cause === undefined ? {} : { cause }),
	})
}

/**
 * Reads and validates the request the runner wrote for the wrapper process that is its child.
 *
 * @remarks
 * Only the file named by `ppid` is read, so a request a stopped runner left never reaches a run
 * that has no runner parent. Every refusal names its cause: a file that does not parse, a record
 * whose `pid` differs from the parent's, arguments that differ from the process's own, an
 * unsupported version, an identity that is not a portable segment, a wrapper path that is not
 * `config`, a state on a command that cannot carry one, and a command, selector, variant list, or
 * case the wrapper does not declare.
 *
 * @param options - The parent id, the process arguments, the request directory, and the wrapper's declarations
 * @returns The validated request, or `undefined` when the parent wrote none
 * @throws Thrown as a `HOST` capture error when a request exists and fails any check.
 *
 * @example
 * ```ts
 * const request = readCaptureRequest({
 * 	ppid: process.ppid,
 * 	argv: process.argv.slice(1),
 * 	directory: '/repo/tmp/units',
 * 	config: 'configs/vite.journey.config.ts',
 * 	owners: ['pages:mail'],
 * 	variants: ['light-390'],
 * })
 * request?.selector // 'pages:mail', or undefined when no runner is the parent
 * ```
 */
export function readCaptureRequest(options: CaptureRequestOptions): CaptureRequest | undefined {
	const file = resolve(
		resolveCaptureRequests(options.directory),
		`${CAPTURE_REQUEST_PREFIX}-${String(options.ppid)}.json`,
	)
	if (!existsSync(file)) return undefined
	const read = attempt(() => readFileSync(file, 'utf8'))
	if (!read.success) throw buildCaptureRequestRefusal(file, read.error)
	const parsed = parseJSON(read.value)
	if (!isRecord(parsed)) throw buildCaptureRequestRefusal(file)
	if (parsed.phase !== undefined)
		throw buildCaptureRequestRefusal(
			file,
			new CaptureError('Journey selection request belongs to the discovery phase', {
				code: 'HOST',
			}),
		)
	if (parsed.pid !== options.ppid)
		throw buildCaptureRequestRefusal(
			file,
			new CaptureError('Journey selection request does not belong to the parent process', {
				code: 'HOST',
			}),
		)
	const args = arrayOf(isString)(parsed.args) ? parsed.args : undefined
	if (
		args === undefined ||
		args.length !== options.argv.length ||
		!args.every((argument, index) => argument === options.argv[index])
	)
		throw new CaptureError(
			`Journey selection request arguments differ from the process arguments: ${file}`,
			{ code: 'HOST', context: { file } },
		)
	if (parsed.version !== CAPTURE_VERSION)
		throw new CaptureError('Journey selection request has invalid version', { code: 'HOST' })
	if (!isCaptureSegment(parsed.id) || !isCaptureSegment(parsed.stage))
		throw new CaptureError('Journey selection request has invalid identity', { code: 'HOST' })
	if (parsed.config !== options.config)
		throw new CaptureError('Journey selection request has invalid config', { code: 'HOST' })
	if (parsed.mode !== undefined && (typeof parsed.mode !== 'string' || parsed.mode.trim() === ''))
		throw new CaptureError('Journey selection request has invalid mode', { code: 'HOST' })
	const command =
		parsed.command === 'journey' || parsed.command === 'capture' ? parsed.command : undefined
	if (
		parsed.state !== undefined &&
		(typeof parsed.state !== 'string' || parsed.state.trim() === '' || command !== 'capture')
	)
		throw new CaptureError('Journey selection request has invalid state', { code: 'HOST' })
	const selector = typeof parsed.selector === 'string' ? parsed.selector : undefined
	const variants = arrayOf(isString)(parsed.variants) ? parsed.variants : undefined
	if (
		command === undefined ||
		selector === undefined ||
		selector.trim() === '' ||
		(selector !== 'all' &&
			!options.owners.some((owner) => matchesCaptureSelector(owner, selector))) ||
		variants === undefined ||
		variants.length === 0 ||
		new Set(variants).size !== variants.length ||
		variants.some((variant) => !options.variants.includes(variant)) ||
		(parsed.case !== undefined && (typeof parsed.case !== 'string' || parsed.case.trim() === ''))
	)
		throw new CaptureError(
			'Journey selection request has invalid command, selector, variants, or case',
			{ code: 'HOST' },
		)
	return {
		version: CAPTURE_VERSION,
		id: parsed.id,
		stage: parsed.stage,
		config: options.config,
		pid: options.ppid,
		command,
		...(typeof parsed.mode === 'string' ? { mode: parsed.mode } : {}),
		selector,
		...(typeof parsed.case === 'string' ? { case: parsed.case } : {}),
		variants,
		args,
		...(typeof parsed.state === 'string' ? { state: parsed.state } : {}),
	}
}

/**
 * Reads a reader's command line into its selection, its flags, and the resolved paths.
 *
 * @remarks
 * The first argument is the selector and every flag after it takes one nonempty value, separated
 * or in equals form. Only `--variant` repeats. `--output` belongs to sheets; the preflight option
 * table refuses it before discovery. `--mode` selects the wrapper's Vitest mode. The wrapper, the journey artifact directory, and the checks module
 * resolve against `root`; `defaults` supplies the first two when the command line names neither.
 *
 * @param argv - The arguments after the entry name
 * @param root - The absolute workspace path the paths resolve against
 * @param defaults - The repository-relative wrapper and journey artifact directory to fall back to
 * @param command - The reader command whose option table applies. Default: `sheets`
 * @returns The reader options and the optional contact-sheet directory
 * @throws Thrown as a `USAGE` capture error for an absent selector, an unknown, repeated, or
 * valueless flag.
 *
 * @example
 * ```ts
 * readCaptureReaderArguments(['pages:mail', '--variant', 'light-390'], '/repo', {
 * 	config: 'configs/vite.journey.config.ts',
 * 	journeys: 'tmp/journey',
 * }).reader.selection // { selector: 'pages:mail', variants: ['light-390'] }
 * ```
 */
export function readCaptureReaderArguments(
	argv: readonly string[],
	root: string,
	defaults: CaptureReaderDefaults,
	command: 'preflight' | 'sheets' = 'sheets',
): CaptureReaderCommand {
	const usage = `Usage: capture ${command} <selector> ${command === 'sheets' ? '--output <directory> ' : ''}[options]`
	const { values, positionals, tokens } = readCaptureOptions(
		argv,
		CAPTURE_COMMAND_OPTIONS[command],
		usage,
	)
	const selector = positionals.at(0)
	if (selector === undefined || positionals.length !== 1 || tokens.at(0)?.kind !== 'positional')
		throw new CaptureError(usage, { code: 'USAGE' })
	const variants = values.variant ?? []
	const state = values.state
	const name = values.case
	const portfolio = values.portfolio
	const checks = values.checks
	const output = 'output' in values && typeof values.output === 'string' ? values.output : undefined
	const mode = values.mode
	return {
		reader: {
			root: resolve(root),
			config: resolve(root, values.config ?? defaults.config),
			...(mode === undefined ? {} : { mode }),
			journeys: resolve(root, values.journeys ?? defaults.journeys),
			selection: {
				selector,
				...(variants.length === 0 ? {} : { variants }),
				...(state === undefined ? {} : { state }),
				...(name === undefined ? {} : { case: name }),
				...(portfolio === undefined ? {} : { portfolio }),
			},
			...(checks === undefined ? {} : { checks: resolve(root, checks) }),
			...(defaults.requests === undefined ? {} : { requests: defaults.requests }),
		},
		...(output === undefined ? {} : { output: resolve(root, output) }),
	}
}

/**
 * Reads the viewport a wrapper project's producing variant declares.
 *
 * @param test - The project's `test` configuration, or any value the wrapper supplied in its place
 * @returns The producing variant's name and pixel geometry
 * @throws Thrown as a `HOST` capture error when the project declares no variant geometry or its
 * producing variant has none.
 *
 * @example
 * ```ts
 * readCaptureViewport({
 * 	provide: { variant: 'light-390', variants: [{ name: 'light-390', width: 390, height: 844 }] },
 * }) // { name: 'light-390', width: 390, height: 844 }
 * ```
 */
export function readCaptureViewport(test: unknown): CaptureViewport {
	const provided: unknown = isRecord(test) ? test.provide : undefined
	const declared: unknown = isRecord(provided) ? provided.variants : undefined
	const variant: unknown = isRecord(provided) ? provided.variant : undefined
	if (!arrayOf(isCaptureGeometry)(declared))
		throw new CaptureError('A reader project declares no viewport geometry', { code: 'HOST' })
	const viewport = declared.find((entry) => entry.name === variant)
	if (viewport === undefined)
		throw new CaptureError('A reader project has no declared producing viewport', { code: 'HOST' })
	return { name: viewport.name, width: viewport.width, height: viewport.height }
}

/**
 * Derives the integrity engine's options from a wrapper project's host declarations.
 *
 * @remarks
 * Without `standalone` the engine reads the project's primary directory and every portfolio root the
 * project authorizes. With one, the engine reads that root alone, keeping its registry, manifest, and
 * lookups beside its own directory.
 *
 * @param root - The absolute workspace path
 * @param project - The wrapper project whose declarations the engine adopts
 * @param standalone - The standalone root to read through, when a selection names one
 * @returns The options the engine is constructed with
 * @throws Thrown as a `HOST` capture error when the directory leaves the repository.
 *
 * @example
 * ```ts
 * buildCaptureIntegrityOptions(root, project).manifest // 'tmp/captures/states/manifest.json'
 * ```
 */
export function buildCaptureIntegrityOptions(
	root: string,
	project: CaptureProject,
	standalone?: CapturePortfolioRoot,
): CaptureIntegrityOptions {
	const directory =
		standalone === undefined
			? resolveCaptureRelative(root, project.directory)
			: standalone.directory
	if (!isCapturePath(directory))
		throw new CaptureError('The wrapper provides a directory outside the repository', {
			code: 'HOST',
			context: { directory },
		})
	return {
		root,
		directory,
		inputs: project.inputs,
		registry: `${directory}/${CAPTURE_REGISTRY_FILE}`,
		manifest: `${directory}/${CAPTURE_MANIFEST_FILE}`,
		lookups: `${directory}/${CAPTURE_LOOKUPS_FILE}`,
		portfolios: standalone === undefined ? project.portfolios : [standalone],
	}
}

/**
 * Reports a portfolio, owner, and viewport whose frames mix cropped, viewport-sized, and page-sized images.
 *
 * @remarks
 * Only a frame at its own producing variant counts, so an auxiliary output variant never joins its
 * producer's group. A frame narrower than its viewport reads `crop`, one as tall as the viewport
 * reads `viewport`, and any other reads `page`. The observation names the mixture without inferring
 * which framing was intended.
 *
 * @param images - The selected images, decoded
 * @param producers - The wrapper's producing viewports
 * @returns One observation per group that holds more than one kind
 *
 * @example
 * ```ts
 * scanCaptureFrames(images, producers) // ['Mixed framing: states/pages:mail@390: page, viewport']
 * ```
 */
export function scanCaptureFrames(
	images: readonly CaptureImageResult[],
	producers: readonly CaptureProducer[],
): readonly string[] {
	const families = [
		...new Set(images.map(({ entry }) => `${entry.portfolio}/${resolveCaptureOwner(entry)}`)),
	]
	return families.flatMap((family) =>
		[...new Set(producers.map((producer) => producer.width))].flatMap((width) => {
			const kinds = [
				...new Set(
					images.flatMap(({ entry, picture }) => {
						const viewport = producers.find((producer) => producer.project === entry.project)
						if (
							`${entry.portfolio}/${resolveCaptureOwner(entry)}` !== family ||
							viewport?.width !== width ||
							entry.variant !== viewport.name
						)
							return []
						return [
							picture.width < viewport.width
								? 'crop'
								: picture.height === viewport.height
									? 'viewport'
									: 'page',
						]
					}),
				),
			]
			return kinds.length > 1
				? [`Mixed framing: ${family}@${String(width)}: ${kinds.join(', ')}`]
				: []
		}),
	)
}

/**
 * Groups the selected images whose bytes are identical.
 *
 * @param images - The selected images, decoded
 * @returns One list of files per digest shared by more than one image
 *
 * @example
 * ```ts
 * collectCaptureIdentical(images) // [['tmp/captures/a.png', 'tmp/captures/b.png']]
 * ```
 */
export function collectCaptureIdentical(
	images: readonly CaptureImageResult[],
): ReadonlyArray<readonly string[]> {
	// A group keeps the order in which its digest first appears and lists its images in input order.
	return [...Map.groupBy(images, (image) => image.digest).values()]
		.filter((group) => group.length > 1)
		.map((group) => group.map((image) => image.entry.file))
}

/**
 * Builds the report a preflight prints and a contact-sheet index carries from one preflight result.
 *
 * @param result - The judged selection
 * @returns The selection, freshness, mixed observations, issues, identical groups, image sizes, and `acceptance: false`
 *
 * @example
 * ```ts
 * buildCaptureReaderReport(await preflight.check()).acceptance // false
 * ```
 */
export function buildCaptureReaderReport(result: CapturePreflightResult): CaptureReaderReport {
	return {
		selection: result.selection,
		freshness: result.freshness,
		mixed: result.mixed,
		issues: result.issues,
		identical: collectCaptureIdentical(result.images),
		sizes: result.images.map(({ entry, picture, size }) => ({
			file: entry.file,
			width: picture.width,
			height: picture.height,
			bytes: size,
		})),
		acceptance: false,
	}
}

/**
 * Finds the journey artifact lines that report an uncaught, unhandled, or logged error.
 *
 * @param file - The artifact's repository-relative path, which prefixes each finding
 * @param text - The artifact's text
 * @returns One finding per matching line
 *
 * @example
 * ```ts
 * collectCaptureErrors('tmp/journey/light-390.txt', 'ok\nUncaught TypeError') // ['tmp/journey/light-390.txt: Uncaught TypeError']
 * ```
 */
export function collectCaptureErrors(file: string, text: string): readonly string[] {
	return text
		.split(/\r\n|\n/u)
		.filter((line) => /\b(uncaught|unhandled|error:)/iu.test(line))
		.map((line) => `${file}: ${line}`)
}

/**
 * Resolves one entry of a wrapper's project list to the project it declares.
 *
 * @remarks
 * A factory entry is called with the serve command and the requested mode, or the default test
 * mode, as Vitest calls it, and a promise is awaited. The result is the project as plain data: the runner reads
 * and validates it, so one reader owns every refusal.
 *
 * @param input - The entry as the wrapper declared it: an inline project, a promise of one, or a factory
 * @returns The resolved project, whatever it holds
 *
 * @example
 * ```ts
 * const project = await resolveCaptureWrapperProject(wrapper.test.projects[0])
 * ```
 */
export async function resolveCaptureWrapperProject(
	input: unknown,
	mode = 'test',
): Promise<unknown> {
	return isFunction(input) ? await input({ command: 'serve', mode }) : await input
}

/**
 * Reads one wrapper project, as the description file holds it, into its host declarations and viewport.
 *
 * @remarks
 * The viewport is read when the project declares geometry for its producing variant and is absent
 * otherwise, because a runner command needs none and only a reader refuses its absence.
 *
 * @param value - The resolved project as plain data
 * @returns The validated project and, when it declares one, its producing viewport
 * @throws Thrown as a `HOST` capture error when the project is a path or a non-record, or when its
 * declarations are malformed.
 *
 * @example
 * ```ts
 * const { project } = readCaptureEntry({ test: { name: 'journey:light-390', provide } })
 * project.variant // 'light-390'
 * ```
 */
export function readCaptureEntry(value: unknown): CaptureHostEntry {
	if (!isRecord(value))
		throw new CaptureError('The journey wrapper must declare inline projects', { code: 'HOST' })
	const project = readCaptureProject(value.test)
	const viewport = attempt(() => readCaptureViewport(value.test))
	return { project, ...(viewport.success ? { viewport: viewport.value } : {}) }
}

/**
 * Resolves the directory that holds the runner's request files for the process that reads them.
 *
 * @remarks
 * A directory the wrapper names wins. Otherwise the directory the runner handed this child in
 * `CAPTURE_REQUESTS` applies, and a process the runner did not start reads `CAPTURE_DEFAULTS.requests`
 * beneath its working directory. The one default therefore lives here and in the executable, and a
 * consumer never has to repeat it.
 *
 * @param directory - The directory the wrapper declares, when it declares one
 * @returns The absolute directory
 *
 * @example
 * ```ts
 * resolveCaptureRequests('/repo/tmp/units') // '/repo/tmp/units'
 * ```
 */
export function resolveCaptureRequests(directory?: string): string {
	return resolve(directory ?? process.env[CAPTURE_REQUESTS_FLAG] ?? CAPTURE_DEFAULTS.requests)
}

/**
 * Builds the empty Node configuration a wrapper returns once it has answered a discovery request.
 *
 * @remarks
 * It carries no project, no setup file, and no include pattern, so Vitest collects no test, starts
 * no browser, and initializes no output for a discovery child.
 *
 * @returns A fresh configuration object
 *
 * @example
 * ```ts
 * export default (await answerCaptureDiscovery(options)) ? buildCaptureDiscoveryConfig() : config
 * ```
 */
export function buildCaptureDiscoveryConfig(): CaptureDiscoveryConfig {
	return { test: { include: [], passWithNoTests: true, watch: false } }
}

/**
 * Accepts the description a wrapper wrote only when it answers this exchange and no other.
 *
 * @remarks
 * Every echo must match: the invocation, the challenge, the wrapper path, the runner as the
 * wrapper's parent, and the child the runner spawned as the writer. Each project then passes the same
 * reader the wrapper's own declarations pass through, and the list may not be empty.
 *
 * @param value - The parsed description file
 * @param expected - What the request and the spawn establish
 * @returns The validated description
 * @throws Thrown as a `HOST` capture error naming the first echo that differs, a malformed
 * document, an empty project list, or a malformed project.
 *
 * @example
 * ```ts
 * const description = readCaptureDescription(parseJSON(text), expected)
 * ```
 */
export function readCaptureDescription(
	value: unknown,
	expected: CaptureDescriptionExpectation,
): CaptureHostDescription {
	const keys = ['version', 'id', 'nonce', 'config', 'parent', 'pid', 'projects']
	if (
		!isRecord(value) ||
		value.version !== CAPTURE_VERSION ||
		!isArray(value.projects) ||
		keys.some((key) => value[key] === undefined) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new CaptureError(
			`The host description is malformed; ${describeCaptureFault('description', value, `{ version: ${String(CAPTURE_VERSION)}, id: invocation id, nonce: challenge, config: wrapper path, parent: parent pid, pid: discovery child pid, projects: project[] }`, keys, keys)}`,
			{ code: 'HOST' },
		)
	if (value.id !== expected.id)
		throw new CaptureError(
			`The host description answers another invocation; ${describeCaptureFault('description.id', value.id, 'the active invocation id', [expected.id])}`,
			{ code: 'HOST' },
		)
	if (value.nonce !== expected.nonce)
		throw new CaptureError(
			`The host description answers another challenge (a replay); ${describeCaptureFault('description.nonce', value.nonce, 'the active discovery challenge', [expected.nonce])}`,
			{
				code: 'HOST',
			},
		)
	if (value.config !== expected.config)
		throw new CaptureError(
			`The host description names another wrapper; ${describeCaptureFault('description.config', value.config, 'the requested wrapper path', [expected.config])}`,
			{ code: 'HOST' },
		)
	if (value.parent !== expected.parent)
		throw new CaptureError(
			`The host description was written for another parent process; ${describeCaptureFault('description.parent', value.parent, 'the parent process id', [String(expected.parent)])}`,
			{
				code: 'HOST',
			},
		)
	if (expected.pid === undefined || value.pid !== expected.pid)
		throw new CaptureError(
			`The host description was not written by the discovery child; ${describeCaptureFault('description.pid', value.pid, 'the spawned discovery child process id', expected.pid === undefined ? [] : [String(expected.pid)])}`,
			{
				code: 'HOST',
			},
		)
	if (value.projects.length === 0)
		throw new CaptureError(
			`The wrapper declares no projects; ${describeCaptureFault('description.projects', value.projects, 'a nonempty list of wrapper projects', ['{ test: project configuration }'])}`,
			{ code: 'HOST' },
		)
	return {
		version: CAPTURE_VERSION,
		id: expected.id,
		nonce: expected.nonce,
		config: expected.config,
		parent: expected.parent,
		pid: expected.pid,
		projects: value.projects.map(readCaptureEntry),
	}
}

/**
 * Answers the runner's discovery request from the wrapper, before the wrapper does any other work.
 *
 * @remarks
 * The wrapper calls it once, ahead of anything that sets up a browser, initializes an output
 * directory, or collects a test, and returns `buildCaptureDiscoveryConfig()` when it answered. It
 * reads only the request file its parent process wrote and answers `false` when there is none, or
 * when the file is no discovery request, so an execution child falls through to `readCaptureRequest`.
 * A discovery request is accepted only from its own parent with the exact arguments it recorded, the
 * wrapper path it names, and an identity and challenge that are portable segments. The wrapper
 * describes every project from its own declarations and writes one description, atomically, to the
 * invocation directory; a second answer from another process is refused as a replay, while the same
 * process may answer again if Vitest loads its configuration twice.
 *
 * @param options - The parent id, the process arguments, the request directory, the wrapper path, and the wrapper's `test.projects`
 * @returns True once the description is written; false when the request is no discovery request
 * @throws Thrown as a `HOST` capture error for a discovery request that fails any check or a
 * replayed answer. It does not judge the projects: the runner reads and refuses a malformed one.
 *
 * @example
 * ```ts
 * const answered = await answerCaptureDiscovery({
 * 	ppid: process.ppid,
 * 	argv: process.argv.slice(1),
 * 	config: 'configs/vite.journey.config.ts',
 * 	projects,
 * })
 * ```
 */
export async function answerCaptureDiscovery(options: CaptureDiscoveryOptions): Promise<boolean> {
	const directory = resolveCaptureRequests(options.directory)
	const file = resolve(directory, `${CAPTURE_REQUEST_PREFIX}-${String(options.ppid)}.json`)
	if (!existsSync(file)) return false
	const read = attempt(() => readFileSync(file, 'utf8'))
	if (!read.success) return false
	const parsed = parseJSON(read.value)
	if (!isRecord(parsed) || parsed.phase !== CAPTURE_DISCOVERY.phase) return false
	if (parsed.pid !== options.ppid)
		throw buildCaptureRequestRefusal(
			file,
			new CaptureError('Discovery request does not belong to the parent process', {
				code: 'HOST',
			}),
		)
	const args = arrayOf(isString)(parsed.args) ? parsed.args : undefined
	if (
		args === undefined ||
		args.length !== options.argv.length ||
		!args.every((argument, index) => argument === options.argv[index])
	)
		throw new CaptureError(
			`Discovery request arguments differ from the process arguments: ${file}`,
			{ code: 'HOST', context: { file } },
		)
	if (parsed.version !== CAPTURE_VERSION)
		throw new CaptureError('Discovery request has invalid version', { code: 'HOST' })
	if (!isCaptureSegment(parsed.id) || !isCaptureSegment(parsed.nonce))
		throw new CaptureError('Discovery request has invalid identity', { code: 'HOST' })
	if (parsed.config !== options.config)
		throw new CaptureError('Discovery request has invalid config', { code: 'HOST' })
	if (parsed.mode !== undefined && (typeof parsed.mode !== 'string' || parsed.mode.trim() === ''))
		throw new CaptureError('Discovery request has invalid mode', { code: 'HOST' })
	const answer = resolve(
		directory,
		CAPTURE_RUNS_DIRECTORY,
		parsed.id,
		CAPTURE_DISCOVERY.description,
	)
	const prior = existsSync(answer) ? parseJSON(readFileSync(answer, 'utf8')) : undefined
	if (prior !== undefined && !(isRecord(prior) && prior.pid === process.pid))
		throw new CaptureError(`Discovery was already answered for this request: ${file}`, {
			code: 'HOST',
			context: { file },
		})
	// The projects travel as plain data; the runner reads and judges them, so one reader owns every refusal.
	const mode = typeof parsed.mode === 'string' ? parsed.mode : undefined
	const projects = await Promise.all(
		options.projects.map((input) => resolveCaptureWrapperProject(input, mode)),
	)
	writeCaptureDocument(answer, {
		version: CAPTURE_VERSION,
		id: parsed.id,
		nonce: parsed.nonce,
		config: options.config,
		parent: options.ppid,
		pid: process.pid,
		projects,
	})
	return true
}

/**
 * Lists a directory through a reader, answering an empty list for a missing directory.
 *
 * @param directory - The absolute directory to list
 * @param list - Reads the directory's entries, such as `readdirSync` with its options
 * @returns The entries the reader returned, or none when the directory is missing
 * @throws Thrown as an `EVIDENCE` capture error naming the directory for any other failure to read it.
 *
 * @example
 * ```ts
 * readCaptureListing('/repo/tmp/captures/states/pages', (path) => readdirSync(path)) // ['inbox--light-390.png']
 * ```
 */
export function readCaptureListing<TEntry>(
	directory: string,
	list: (path: string) => readonly TEntry[],
): readonly TEntry[] {
	const listed = attempt(() => list(directory))
	if (listed.success) return listed.value
	if (isError(listed.error) && 'code' in listed.error && listed.error.code === 'ENOENT') return []
	throw new CaptureError(`Cannot list capture frames under ${directory}`, {
		code: 'EVIDENCE',
		cause: listed.error,
		context: { directory },
	})
}

/**
 * Lists the frames a portfolio directory holds, as paths relative to it, in sorted order.
 *
 * @remarks
 * A frame is a `.png` file at the directory's top level or directly inside one of the scope
 * directories. The run records directory holds no frame, and every other directory is unknown. A
 * missing directory, or one removed between the listing and its read, holds no frame.
 *
 * @param directory - The absolute portfolio directory
 * @param scopes - The scope directories the owners declare, each an owner path's first segment
 * @returns Each frame's slash-separated path relative to the directory
 * @throws Thrown as an `EVIDENCE` capture error for a frame beneath the run records, an unknown
 * directory, a directory inside a scope, or a directory the host refuses to read.
 *
 * @example
 * ```ts
 * readCaptureFrames('/repo/tmp/captures/states', ['pages']) // ['pages/inbox--light-390.png']
 * ```
 */
export function readCaptureFrames(directory: string, scopes: readonly string[]): readonly string[] {
	return readCaptureListing(directory, (path) => readdirSync(path, { withFileTypes: true }))
		.flatMap((entry): readonly string[] => {
			if (!entry.isDirectory()) return entry.name.endsWith('.png') ? [entry.name] : []
			if (entry.name === CAPTURE_RUNS_DIRECTORY) {
				const frames = readCaptureListing(resolve(directory, entry.name), (path) =>
					readdirSync(path, { recursive: true, encoding: 'utf8' }),
				).filter((name) => name.endsWith('.png'))
				if (frames.length > 0)
					throw new CaptureError(
						`Frames sit beneath the run records: ${describeCaptureMembers(frames.map(normalizeSlashes))}`,
						{ code: 'EVIDENCE', context: { directory } },
					)
				return []
			}
			if (!scopes.includes(entry.name))
				throw new CaptureError(
					`Unknown capture directory: ${describeCaptureFault('directory', entry.name, 'a scope the owners declare, or the run records', [...scopes, CAPTURE_RUNS_DIRECTORY])}`,
					{ code: 'EVIDENCE', context: { directory } },
				)
			return readCaptureListing(resolve(directory, entry.name), (path) =>
				readdirSync(path, { withFileTypes: true }),
			).flatMap((file): readonly string[] => {
				if (file.isDirectory())
					throw new CaptureError(
						`Unknown capture directory: ${preview(`${entry.name}/${file.name}`)}; a scope holds frames only`,
						{ code: 'EVIDENCE', context: { directory } },
					)
				return file.name.endsWith('.png') ? [`${entry.name}/${file.name}`] : []
			})
		})
		.toSorted()
}

/**
 * Reads the progress file of the stage that is running, or that ran last, in a workspace.
 *
 * @remarks
 * The file is the most recently modified `<stage>.progress.jsonl` beneath the request directory's
 * run directories. The progress file is an observation of the run and never evidence. A partial
 * last line, which the reporter can still be appending, is not read, so a file with no complete
 * line holds no run. For each run with no `end` line, `alive` reads the process id its `init` line
 * records: a writer that has ended turns the run `interrupted`, measured to the time of its last
 * line, and a writer the host cannot inspect, or an id that is not a positive safe integer, lists
 * the run's id in `uninspected`.
 *
 * @param root - The absolute workspace path
 * @param requests - The workspace-relative request directory
 * @param now - The wall-clock time of the reading, in milliseconds since the Unix epoch. Default: `Date.now()`
 * @param alive - Reads whether a writer process exists, or `undefined` when the host cannot tell. Default: `inspectProcess` from `@orkestrel/process/server`
 * @returns The workspace-relative file, one reading per process that wrote it, and the writers the host could not inspect
 * @throws Thrown as a `STAGE` capture error when no stage has written a progress file, or when the
 * file cannot be read or holds a complete line that is not a progress event.
 *
 * @example
 * ```ts
 * readCaptureProgress('/repo', 'tmp/capture').runs[0]?.state // 'live' while the stage runs
 * ```
 */
export function readCaptureProgress(
	root: string,
	requests: string,
	now: number = Date.now(),
	alive: (pid: number) => boolean | undefined = inspectProcess,
): CaptureProgress {
	const runs = resolve(root, requests, CAPTURE_RUNS_DIRECTORY)
	const [newest] = globSync(`*/*${CAPTURE_PROGRESS_SUFFIX}`, { cwd: runs })
		.flatMap((name) => {
			const stat = attempt(() => statSync(resolve(runs, name)))
			return stat.success && stat.value.isFile()
				? [{ file: resolveCaptureRelative(root, resolve(runs, name)), time: stat.value.mtimeMs }]
				: []
		})
		.toSorted((left, right) => right.time - left.time || right.file.localeCompare(left.file))
	if (newest === undefined)
		throw new CaptureError(
			`No stage has written a progress file under ${resolveCaptureRelative(root, runs)}; run a journey, frames, or registry command first`,
			{ code: 'STAGE', context: { directory: resolveCaptureRelative(root, runs) } },
		)
	const read = attempt(() =>
		extractProgressEvents(readFileSnapshot(resolve(root, newest.file)).toString('utf8')),
	)
	if (!read.success)
		throw new CaptureError(
			`Cannot read the progress file ${newest.file}: ${describeCaptureOutput(describeCaptureError(read.error))}`,
			{ code: 'STAGE', cause: read.error, context: { file: newest.file } },
		)
	const events = read.value
	const computed = computeProgress(events, now)
	const writers = new Map(
		computed
			.filter((run) => run.state === 'live')
			.map((run) => [
				run.pid,
				Number.isSafeInteger(run.pid) && run.pid > 0 ? alive(run.pid) : undefined,
			]),
	)
	return {
		file: newest.file,
		runs: computed.map((run): ProgressRun => {
			if (writers.get(run.pid) !== false) return run
			// An interrupted run wrote no end line, so its clock stops at the time of its last line.
			const own = events.filter((event) => event.pid === run.pid)
			const init = own.findLast((event): event is ProgressInitEvent => event.event === 'init')
			const last = own.at(-1)
			const ended =
				init === undefined || last === undefined
					? run
					: (computeProgressRun(own, init.wall + last.time - init.time) ?? run)
			return { ...ended, state: 'interrupted', running: [], remaining: undefined }
		}),
		uninspected: [...writers].flatMap(([pid, answer]) => (answer === undefined ? [pid] : [])),
	}
}

/**
 * Renders a progress reading as the text `capture progress` prints.
 *
 * @param progress - The reading `readCaptureProgress` returns
 * @returns The file line, then each run as `renderProgress` from `@orkestrel/test/server` renders it,
 * followed by an unknown-state line for each run whose writer the host could not inspect
 *
 * @example
 * ```ts
 * renderCaptureProgress({ file: 'tmp/capture/runs/a/selected.progress.jsonl', runs: [], uninspected: [] })
 * // 'progress tmp/capture/runs/a/selected.progress.jsonl\nNo run has written a complete progress line yet'
 * ```
 */
export function renderCaptureProgress(progress: CaptureProgress): string {
	return [
		`progress ${progress.file}`,
		...(progress.runs.length === 0
			? ['No run has written a complete progress line yet']
			: progress.runs.flatMap((run) => [
					renderProgress([run]),
					...(progress.uninspected.includes(run.pid)
						? [
								`  state unknown: the host could not inspect writer ${String(run.pid)}, so the run might have ended without its end line`,
							]
						: []),
				])),
	].join('\n')
}

/**
 * Builds the values capture merges into one variant's Vitest project.
 *
 * @param options - The wrapper's declarations
 * @param variant - The variant the project produces
 * @param provided - The variant's frame directory, run record path, capture switch, and runner request
 * @returns The owner tags, the provided values, and the `readCaptureFrames` browser command over the directory
 *
 * @example
 * ```ts
 * buildCaptureOverride(options, variant, { directory, record, capture: true }).test.provide.record
 * // 'tmp/captures/states/runs/run-1/selected/light-390.json'
 * ```
 */
export function buildCaptureOverride(
	options: Omit<CaptureWrapperOptions<unknown>, 'url' | 'project'>,
	variant: CaptureViewport,
	provided: Pick<CaptureProvided, 'directory' | 'record' | 'capture' | 'request'>,
): CaptureWrapperOverride {
	const scopes = [
		...new Set(options.owners.flatMap((owner) => collectCaptureAncestors(owner).slice(0, 1))),
	]
	return {
		test: {
			tags: buildCaptureTags(options.owners).map((name) => ({ name })),
			provide: {
				variant: variant.name,
				variants: options.variants,
				directory: provided.directory,
				record: provided.record,
				inputs: options.inputs,
				sources: options.sources,
				final: options.final,
				first: options.first,
				...(options.uniform === undefined ? {} : { uniform: options.uniform }),
				portfolios: options.portfolios,
				capture: provided.capture,
				...(provided.request === undefined ? {} : { request: provided.request }),
			},
			browser: {
				commands: { readCaptureFrames: () => readCaptureFrames(provided.directory, scopes) },
			},
		},
	}
}

/**
 * Builds a journey wrapper's Vitest configuration as plain data, answering discovery first.
 *
 * @remarks
 * Call it inside the wrapper's own `defineConfig` callback, before any other work: capture imports
 * neither Vite nor Vitest, so the result is data the wrapper returns. The wrapper path is `url`
 * relative to the working directory, which is the workspace root for every child the runner
 * spawns. During a discovery request it describes each variant's project as `{ name, tags,
 * provide }`, with the name the host's `project` chose, and returns `buildCaptureDiscoveryConfig()`.
 * Otherwise it reads the runner's request, provides each project the values `CaptureProvided`
 * declares except `standalone`, and registers the browser command `readCaptureFrames`, which lists the frames under
 * the provided directory. With the capture variable unset, each variant writes to its own scratch
 * sibling of the evidence root, emptied first. The result's root `plugins` holds one
 * `createProgressPlugin()`, so a stage the runner passes `--outputFile.progress` writes its
 * progress file.
 *
 * @param options - The wrapper path, variants, owners, stage and final names, evidence root, inputs, sources, portfolios, and project builder
 * @returns The discovery configuration while discovery runs, and otherwise the progress plugin and one project per variant
 * @throws Thrown as a `HOST` capture error, before any directory work, for a `url` that is no
 * `file:` URL, an evidence root that is not a portable relative path, or a variant name that is no
 * capture segment, and later for an invalid owner or a runner request that fails its checks; and as
 * a `CONTAINMENT` capture error for a wrapper or scratch path outside the workspace.
 *
 * @example
 * ```ts
 * export default defineConfig(({ mode }) =>
 * 	buildCaptureWrapper({ ...declarations, url: import.meta.url, project: (variant, override) => appJourney(variant, mode, override) }),
 * )
 * ```
 */
export async function buildCaptureWrapper<TProject>(
	options: CaptureWrapperOptions<TProject>,
): Promise<CaptureWrapperConfig<TProject> | CaptureDiscoveryConfig> {
	const root = process.cwd()
	const path = attempt(() => fileURLToPath(options.url))
	if (!path.success)
		throw new CaptureError(
			`Invalid wrapper url; ${describeCaptureFault('url', options.url, "the wrapper module's import.meta.url, a file: URL")}`,
			{ code: 'HOST', cause: path.error },
		)
	requireCaptureContained(root, path.value)
	if (!isCapturePath(options.directory))
		throw new CaptureError(
			`Invalid evidence root; ${describeCaptureFault('directory', options.directory, 'a portable workspace-relative path')}`,
			{ code: 'HOST' },
		)
	// A variant name becomes a scratch directory segment that is emptied, so it must name one segment.
	const invalid = options.variants.findIndex((variant) => !isCaptureSegment(variant.name))
	if (invalid !== -1)
		throw new CaptureError(
			`Invalid variant name; ${describeCaptureFault(`variants[${String(invalid)}].name`, options.variants[invalid]?.name, 'a portable nonempty identity segment')}`,
			{ code: 'HOST' },
		)
	// A scratch directory is emptied when capture is off, so it must not overlap a root it would empty.
	const roots = [options.directory, ...options.portfolios.map((entry) => entry.directory)]
	for (const variant of options.variants) {
		const scratch = resolve(
			root,
			dirname(options.directory),
			`${CAPTURE_WRAPPER_PREFIXES.scratch}${variant.name}`,
		)
		const overlap = roots.find((entry) =>
			[relative(resolve(root, entry), scratch), relative(scratch, resolve(root, entry))].some(
				(step) => step === '' || (!step.startsWith('..') && !isAbsolute(step)),
			),
		)
		if (overlap !== undefined)
			throw new CaptureError(
				`Invalid evidence root; the no-capture scratch directory ${resolveCaptureRelative(root, scratch)} of variant ${variant.name} overlaps ${overlap}, which it would empty`,
				{ code: 'HOST' },
			)
	}
	const config = resolveCaptureRelative(root, path.value)
	const argv = process.argv.slice(1)
	const capture = process.env[CAPTURE_FLAG] === CAPTURE_FLAG_VALUE
	const evidence = resolve(root, options.directory)
	const answered = await answerCaptureDiscovery({
		ppid: process.ppid,
		argv,
		config,
		projects: options.variants.map((variant) => () => {
			const override = buildCaptureOverride(options, variant, {
				directory: evidence,
				record: `${options.directory}/${CAPTURE_RUNS_DIRECTORY}/${CAPTURE_DISCOVERY.phase}/${variant.name}.json`,
				capture,
			})
			const project: unknown = options.project(variant, override)
			return {
				test: {
					name: isRecord(project) && isRecord(project.test) ? project.test.name : undefined,
					tags: override.test.tags,
					provide: override.test.provide,
				},
			}
		}),
	})
	if (answered) return buildCaptureDiscoveryConfig()
	const request = readCaptureRequest({
		ppid: process.ppid,
		argv,
		config,
		owners: options.owners,
		variants: options.variants.map((variant) => variant.name),
	})
	const invocation =
		request === undefined
			? `${CAPTURE_WRAPPER_PREFIXES.direct}${randomUUID()}`
			: `${request.id}/${request.stage}`
	return {
		plugins: [createProgressPlugin()],
		test: {
			projects: options.variants.map((variant) => {
				const directory = capture
					? evidence
					: requireCaptureContained(
							root,
							resolve(
								root,
								dirname(options.directory),
								`${CAPTURE_WRAPPER_PREFIXES.scratch}${variant.name}`,
							),
						)
				if (!capture) {
					rmSync(directory, { recursive: true, force: true })
					mkdirSync(directory, { recursive: true })
				}
				return options.project(
					variant,
					buildCaptureOverride(options, variant, {
						directory,
						record: `${options.directory}/${CAPTURE_RUNS_DIRECTORY}/${invocation}/${variant.name}.json`,
						capture,
						...(request === undefined ? {} : { request }),
					}),
				)
			}),
		},
	}
}

/**
 * Reads the registry command line into the wrapper path, the variants to refresh, and the mode.
 *
 * @remarks
 * The command takes no selector: it refreshes every producing variant the wrapper declares, or the
 * variants named by repeated `--variant` flags. Every flag but valueless `--no-bail` takes one
 * value, and only `--variant` repeats. `--mode` is forwarded to the wrapper's Vitest process
 * unread, and `--no-bail` sets `bail` to `false`.
 *
 * @param argv - The arguments after the subcommand
 * @param root - The absolute workspace path the wrapper path resolves against
 * @param fallback - The repository-relative wrapper path used when `--config` is absent
 * @returns The parsed arguments with an absolute wrapper path
 * @throws Thrown as a `USAGE` capture error for a positional argument, an unknown, repeated, or
 * valueless flag, or a repeated or invalid variant.
 *
 * @example
 * ```ts
 * readCaptureRegistryArguments(['--variant', 'light-390'], '/repo', 'vite.journey.config.ts')
 * // { config: '/repo/vite.journey.config.ts', variants: ['light-390'] }
 * ```
 */
export function readCaptureRegistryArguments(
	argv: readonly string[],
	root: string,
	fallback: string,
): CaptureRegistryArguments {
	const usage =
		'Usage: capture registry [--variant <name>]... [--no-bail] [--mode <name>] [--config <file>]'
	const { values, positionals } = readCaptureOptions(argv, CAPTURE_COMMAND_OPTIONS.registry, usage)
	if (positionals.length > 0)
		throw new CaptureError(
			`Unexpected argument ${JSON.stringify(positionals[0]?.slice(0, 80))}: the registry command takes no selector and refreshes every producing variant, or those named by --variant. ${usage}`,
			{ code: 'USAGE' },
		)
	const variants = values.variant ?? []
	if (new Set(variants).size !== variants.length)
		throw new CaptureError('Repeated variant', { code: 'USAGE' })
	const invalid = variants.findIndex((variant) => !isCaptureSegment(variant))
	if (invalid !== -1)
		throw new CaptureError(
			`Invalid variant identity; ${describeCaptureFault(`--variant[${String(invalid)}]`, variants[invalid], "a portable nonempty identity segment; valid values come from the wrapper's variant declarations")}`,
			{ code: 'USAGE' },
		)
	const mode = values.mode
	return {
		config: resolve(root, values.config ?? fallback),
		variants,
		...(mode === undefined ? {} : { mode }),
		...(values.bail === false ? { bail: false } : {}),
	}
}

/**
 * Reads the bounded input population a project declares, as file paths and content hashes.
 *
 * @remarks
 * The expansion is the one the integrity engine takes: the native glob over the patterns, regular
 * files only, sorted, each path contained in the workspace. A pattern that matches nothing
 * contributes no file.
 *
 * @param root - The absolute workspace path
 * @param patterns - The project's native input patterns
 * @param hash - Digests each file's exact bytes. Default: `computeCaptureHash`
 * @param read - Reads a contained input through the owning operation's snapshot memo, when supplied
 * @returns The workspace-relative path of every matched file and its digest
 * @throws Thrown as a `CONTAINMENT` capture error for a matched path the evidence cannot hold, and as
 * an `EVIDENCE` capture error for a path that matches under two spellings.
 *
 * @example
 * ```ts
 * readCaptureInputs(process.cwd(), ['src/**']) // { 'src/a.ts': '3f2a…' }
 * ```
 */
export function readCaptureInputs(
	root: string,
	patterns: readonly string[],
	hash: CaptureHashHandler = computeCaptureHash,
	read?: CaptureInputHandler,
): Readonly<Record<string, string>> {
	const files = [...new Set(globSync([...patterns], { cwd: root }).map(normalizeSlashes))]
		.filter((file) => {
			if (!isCapturePath(file))
				throw new CaptureError(`Input path cannot be held as evidence: ${JSON.stringify(file)}`, {
					code: 'CONTAINMENT',
				})
			return statSync(requireCaptureContained(root, resolve(root, file))).isFile()
		})
		.toSorted()
	requireCaptureUnique(files, 'input paths', true)
	return Object.fromEntries(
		files.flatMap((file) => {
			const digest =
				read === undefined
					? hash(readFileSync(requireCaptureContained(root, resolve(root, file))))
					: read(file)
			return digest === undefined ? [] : [[file, digest]]
		}),
	)
}

/**
 * Writes one JSON document atomically, so a reader sees the old bytes or the new and never a part.
 *
 * @remarks
 * The document is written to a unique temporary sibling, flushed, and renamed over the target. The
 * signal is checked after the flush and before the rename, and the temporary file never outlives the
 * call.
 *
 * @param path - The absolute target path, whose directory is created when missing
 * @param value - The value to serialize
 * @param signal - Aborts the write before the rename when it fires
 *
 * @example
 * ```ts
 * writeCaptureDocument('/repo/tmp/captures/states/registry.json', registry)
 * ```
 */
export function writeCaptureDocument(path: string, value: unknown, signal?: AbortSignal): void {
	mkdirSync(dirname(path), { recursive: true })
	const temporary = `${path}.${randomUUID()}.tmp`
	try {
		writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', flush: true })
		signal?.throwIfAborted()
		renameSync(temporary, path)
	} finally {
		rmSync(temporary, { force: true })
	}
}
