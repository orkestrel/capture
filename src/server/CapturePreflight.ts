import type { CaptureDestination, CaptureStoredManifest } from '@src/core'
import type {
	CaptureArtifactReading,
	CaptureCheckFrame,
	CaptureImageReading,
	CaptureJudgedFrame,
	CaptureJudgedRecord,
	CaptureProducer,
	CaptureProject,
	CapturePreflightInterface,
	CapturePreflightResult,
	CaptureReaderOptions,
	CaptureReaderSelection,
	CaptureWriteHandler,
} from './types.js'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
	arrayOf,
	attempt,
	isArray,
	isFunction,
	isRecord,
	isString,
	parseJSON,
} from '@orkestrel/contract'
import {
	CAPTURE_MANIFEST_FILE,
	CaptureError,
	describeCaptureError,
	isCapturePath,
	isCaptureRun,
	isCaptureStoredManifest,
	resolveCaptureKey,
} from '@src/core'
import {
	CAPTURE_DEFAULTS,
	CAPTURE_EXIT,
	CAPTURE_MINIMUM_IMAGE,
	CAPTURE_REPORT_LINES,
	CAPTURE_RUNS_DIRECTORY,
} from './constants.js'
import { CaptureDiscovery } from './CaptureDiscovery.js'
import { CaptureIntegrity } from './CaptureIntegrity.js'
import { CaptureInvocation } from './CaptureInvocation.js'
import {
	buildCaptureIntegrityOptions,
	collectCaptureErrors,
	collectCaptureFraming,
	collectCaptureIdentical,
	computeCaptureHash,
	decodeCapturePicture,
	requireCaptureProjects,
	resolveCaptureRelative,
} from './helpers.js'

/**
 * Reads the selected population's frames and reports their freshness, framing, and coverage.
 *
 * @remarks
 * A successful preflight is iteration evidence and never assembled-portfolio acceptance. The reader
 * reads the host's wrapper through a `CaptureDiscovery`, the consumer's own Vitest in discovery
 * mode, and reads its projects the way the runner does: it names no portfolio, owner, variant, or
 * path the wrapper does not declare, and it imports neither Vite nor Vitest. It
 * judges each frame by the artifact the frame's own stamp names, never by a variant's latest file.
 * Rules that belong to one product, such as a page-title check or a pixel comparison, live in a
 * host module named by the `checks` option. The reader loads that module through the runtime's own
 * module loader by its file URL, reads its `CAPTURE_CHECKS` export, a list of readers from a frame to
 * its findings, and appends every finding to the report.
 *
 * @example
 * ```ts
 * const preflight = new CapturePreflight({
 * 	root: process.cwd(),
 * 	config: `${process.cwd()}/configs/app/vite.journey.config.ts`,
 * 	selection: { selector: 'pages:mail' },
 * 	journeys: `${process.cwd()}/tmp/journey`,
 * })
 * const exit = await preflight.execute()
 * ```
 */
export class CapturePreflight implements CapturePreflightInterface {
	readonly #options: CaptureReaderOptions
	readonly #stdout: CaptureWriteHandler
	readonly #stderr: CaptureWriteHandler

	/**
	 * Binds one explicit workspace, wrapper, and selection.
	 *
	 * @param options - The host configuration and the exact requested bounds
	 */
	constructor(options: CaptureReaderOptions) {
		this.#options = options
		this.#stdout = options.stdout ?? process.stdout.write.bind(process.stdout)
		this.#stderr = options.stderr ?? process.stderr.write.bind(process.stderr)
	}

	/**
	 * Reads the authenticated selection and the host's declared viewports.
	 *
	 * @returns The engine, the selected destinations, the viewports, and the primary run directory
	 * @throws Thrown when the wrapper, the registry, or the selection is invalid.
	 *
	 * @example
	 * ```ts
	 * const { population } = await preflight.read()
	 * ```
	 */
	async read(): Promise<CaptureReaderSelection> {
		const { root, config, selection } = this.#options
		if (!isCapturePath(resolveCaptureRelative(root, config)))
			throw new CaptureError('Reader config must be a contained repository path', { code: 'USAGE' })
		const loaded = await this.#load(config)
		const primary = requireCaptureProjects(loaded.map((entry) => entry.project))
		// A standalone root has no stamping route and is read only when a selection names it.
		const standalone = primary.standalone.find(
			(entry) =>
				selection.portfolio === entry.portfolio ||
				selection.selector === entry.portfolio ||
				selection.selector.startsWith(`${entry.portfolio}:`),
		)
		const options = buildCaptureIntegrityOptions(root, primary, standalone)
		const integrity = new CaptureIntegrity(options)
		const population = await integrity.read(selection)
		// A standalone root's producers belong to another wrapper, so only the primary population is mapped.
		if (
			standalone === undefined &&
			population.entries.some(
				(entry) => !loaded.some((candidate) => candidate.producer.project === entry.project),
			)
		)
			throw new CaptureError('Authenticated destination has no actual wrapper project', {
				code: 'HOST',
			})
		return {
			integrity,
			population,
			variants: loaded.map((entry) => entry.producer),
			directory: options.directory,
		}
	}

	/**
	 * Judges every selected frame and returns the framing, freshness, images, and issues.
	 *
	 * @returns The preflight reading without upgrading any freshness classification
	 * @throws Thrown when the selection or an artifact cannot be read.
	 *
	 * @example
	 * ```ts
	 * const result = await preflight.check()
	 * ```
	 */
	async check(): Promise<CapturePreflightResult> {
		const source = await this.read()
		const freshness = await source.integrity.check({
			...this.#options.selection,
			variants: [...new Set(source.population.entries.map((entry) => entry.variant))],
		})
		const readings = source.population.entries.map((entry) => this.#image(entry))
		const images = readings.flatMap((reading) =>
			reading.image === undefined ? [] : [reading.image],
		)
		return {
			selection: source.population,
			variants: source.variants,
			directory: source.directory,
			freshness,
			images,
			framing: collectCaptureFraming(images, source.variants),
			issues: readings.flatMap((reading) => reading.issues),
		}
	}

	/**
	 * Executes the check and prints its report.
	 *
	 * @returns Exit 0 for current frames without defects, 1 for any defect, or 64 for refused usage
	 *
	 * @example
	 * ```ts
	 * const exit = await preflight.execute() // 0
	 * ```
	 */
	async execute(): Promise<number> {
		try {
			const result = await this.check()
			const issues = [...result.issues, ...(await this.#artifacts(result))]
			this.#stdout(
				`${CAPTURE_REPORT_LINES.preflight} ${JSON.stringify({
					selection: result.selection,
					freshness: result.freshness,
					framing: result.framing,
					issues,
					identical: collectCaptureIdentical(result.images),
					sizes: result.images.map(({ entry, picture, size }) => ({
						file: entry.file,
						width: picture.width,
						height: picture.height,
						bytes: size,
					})),
					acceptance: false,
				})}\n`,
			)
			return issues.length > 0 ||
				result.freshness.entries.some((entry) => entry.status !== 'current')
				? CAPTURE_EXIT.failed
				: CAPTURE_EXIT.passed
		} catch (error) {
			this.#stderr(`${describeCaptureError(error)}\n`)
			return CAPTURE_EXIT.usage
		}
	}

	// Discovers the wrapper through the consumer's own Vitest and keeps each project beside its producing viewport.
	async #load(
		config: string,
	): Promise<
		ReadonlyArray<{ readonly project: CaptureProject; readonly producer: CaptureProducer }>
	> {
		const { root, requests, deadline } = this.#options
		// A discovery child's output is the runner's log, never the reader's report.
		const invocation = new CaptureInvocation({
			command: 'stale',
			root,
			requests: requests ?? CAPTURE_DEFAULTS.requests,
			stdout: () => undefined,
			stderr: () => undefined,
		})
		invocation.attach()
		try {
			const description = await new CaptureDiscovery({
				root,
				config,
				invocation,
				...(deadline === undefined ? {} : { deadline }),
			}).describe()
			return description.projects.map(({ project, viewport }) => {
				if (viewport === undefined)
					throw new CaptureError('A reader project declares no viewport geometry', {
						code: 'HOST',
					})
				return { project, producer: { ...viewport, project: project.name } }
			})
		} finally {
			await invocation.release()
		}
	}

	// Loads the host's check readers; a reader without a checks module has none.
	async #checks(): Promise<ReadonlyArray<(frame: CaptureCheckFrame) => unknown>> {
		const { checks, root } = this.#options
		if (checks === undefined) return []
		const loaded: unknown = await this.#import(resolve(root, checks)).catch((error: unknown) => {
			throw new CaptureError(`Cannot load the checks module: ${checks}`, {
				code: 'HOST',
				cause: error,
			})
		})
		const list: unknown = isRecord(loaded) ? loaded.CAPTURE_CHECKS : undefined
		if (!isArray(list) || !list.every(isFunction))
			throw new CaptureError(
				`The checks module exports no CAPTURE_CHECKS list of readers: ${checks}`,
				{ code: 'HOST' },
			)
		return list
	}

	// Imports a host module by its file URL; the specifier is computed, so a bundler leaves it alone.
	async #import(file: string): Promise<unknown> {
		return await import(/* @vite-ignore */ pathToFileURL(file).href)
	}

	// Decodes one selected image, reporting the reason an unreadable or tiny one cannot be judged.
	#image(entry: CaptureDestination): {
		readonly image: CaptureImageReading | undefined
		readonly issues: readonly string[]
	} {
		const read = attempt(() => {
			const bytes = readFileSync(resolve(this.#options.root, entry.file))
			if (bytes.length < CAPTURE_MINIMUM_IMAGE)
				throw new CaptureError(`Image under 4 KB: ${entry.file}`, { code: 'EVIDENCE' })
			const image: CaptureImageReading = {
				entry,
				picture: decodeCapturePicture(bytes),
				digest: computeCaptureHash(bytes),
				size: bytes.length,
			}
			return image
		})
		return read.success
			? { image: read.value, issues: [] }
			: {
					image: undefined,
					issues: [`Cannot read image ${entry.file}: ${describeCaptureError(read.error)}`],
				}
	}

	// Judges each frame by the artifact its own stamp's run record names, then runs the host's checks.
	async #artifacts(result: CapturePreflightResult): Promise<readonly string[]> {
		const stored = this.#manifest(result.directory)
		const located = result.selection.entries.map((entry) => ({
			entry,
			location: attempt(() => this.#locate(entry, stored, result.variants, result.directory)),
		}))
		const paths = new Set(
			located.flatMap(({ location }) => (location.success ? [location.value.record] : [])),
		)
		const records = new Map(
			[...paths].map((record) => [record, attempt(() => this.#artifact(record))] as const),
		)
		const judged = located.map(({ entry, location }): CaptureJudgedFrame => {
			if (!location.success)
				return { entry, artifact: undefined, issues: [describeCaptureError(location.error)] }
			const reading = records.get(location.value.record)
			if (reading === undefined)
				throw new CaptureError(`Judged run record was not read: ${location.value.record}`, {
					code: 'EVIDENCE',
				})
			if (!reading.success)
				return { entry, artifact: undefined, issues: [describeCaptureError(reading.error)] }
			const artifact = reading.value
			const lines = artifact.text.split('\n')
			const covered =
				artifact.run.passed.includes(location.value.case) &&
				artifact.run.entries.some(
					(emitted) => resolveCaptureKey(emitted) === resolveCaptureKey(entry),
				)
			return {
				entry,
				artifact,
				issues: [
					...(covered ? [] : [`Judged record does not cover ${entry.file}: ${artifact.record}`]),
					...(lines.includes(`record=${artifact.record}`)
						? []
						: [`Judged journey artifact does not cover its record: ${artifact.file}`]),
					...(lines.includes(`case-ran=${location.value.case}`)
						? []
						: [`Judged journey artifact does not cover ${location.value.case}: ${artifact.file}`]),
				],
			}
		})
		const artifacts = [
			...new Map(
				judged.flatMap(({ artifact }) =>
					artifact === undefined ? [] : [[artifact.file, artifact] as const],
				),
			).values(),
		]
		const errors = artifacts.flatMap((artifact) =>
			collectCaptureErrors(artifact.file, artifact.text),
		)
		const checks = await this.#checks()
		const findings = judged.flatMap(({ entry, artifact }) => {
			const picture = result.images.find((image) => image.entry.file === entry.file)?.picture
			return checks.flatMap((check) => {
				const found: unknown = check({ entry, picture, artifact })
				if (!arrayOf(isString)(found))
					throw new CaptureError('A host check returned something other than a list of findings', {
						code: 'HOST',
					})
				return found
			})
		})
		return [...new Set([...judged.flatMap(({ issues }) => issues), ...errors, ...findings])]
	}

	// Reads the stamps the engine's check validated; an absent manifest holds no stamps.
	#manifest(directory: string): CaptureStoredManifest | undefined {
		const file = resolve(this.#options.root, directory, CAPTURE_MANIFEST_FILE)
		if (!existsSync(file)) return undefined
		const manifest = parseJSON(readFileSync(file, 'utf8'))
		if (!isCaptureStoredManifest(manifest))
			throw new CaptureError('Invalid stamped manifest schema', { code: 'EVIDENCE' })
		return manifest
	}

	// Resolves the run record a judged frame's stamp names through its wrapper's producing variant.
	#locate(
		entry: CaptureDestination,
		stored: CaptureStoredManifest | undefined,
		producers: readonly CaptureProducer[],
		directory: string,
	): CaptureJudgedRecord {
		const stamp = stored?.entries[resolveCaptureKey(entry)]
		if (stamp === undefined)
			throw new CaptureError(`Judged frame has no stamped run record: ${entry.file}`, {
				code: 'EVIDENCE',
			})
		const producing = producers.find((producer) => producer.project === entry.project)?.name
		if (producing === undefined)
			throw new CaptureError(`No journey artifact mapping for project: ${entry.project}`, {
				code: 'HOST',
			})
		const record = `${directory}/${CAPTURE_RUNS_DIRECTORY}/${stamp.identity.id}/${stamp.identity.stage}/${producing}.json`
		if (!isCapturePath(record))
			throw new CaptureError(`Invalid judged run record path: ${record}`, { code: 'EVIDENCE' })
		return { record, case: stamp.case }
	}

	// Reads a judged record and the artifact it names, refusing changed or unbound artifact bytes.
	#artifact(record: string): CaptureArtifactReading {
		const { root, journeys } = this.#options
		const run = parseJSON(readFileSync(resolve(root, record), 'utf8'))
		if (!isCaptureRun(run))
			throw new CaptureError(`Invalid judged run record: ${record}`, { code: 'EVIDENCE' })
		if (run.artifact === undefined)
			throw new CaptureError(`Judged record names no journey artifact: ${record}`, {
				code: 'EVIDENCE',
			})
		const file = run.artifact.file
		const path = resolve(root, file)
		const contained = relative(journeys, path)
		if (contained === '' || contained.startsWith('..') || isAbsolute(contained))
			throw new CaptureError(`Judged journey artifact is outside the journeys directory: ${file}`, {
				code: 'CONTAINMENT',
			})
		const bytes = attempt(() => readFileSync(path))
		if (!bytes.success)
			throw new CaptureError(
				`Cannot read judged journey artifact: ${file}: ${describeCaptureError(bytes.error)}`,
				{ code: 'EVIDENCE', cause: bytes.error },
			)
		if (computeCaptureHash(bytes.value) !== run.artifact.digest)
			throw new CaptureError(`Judged journey artifact differs from its record: ${file}`, {
				code: 'EVIDENCE',
			})
		return { record, run, file, text: bytes.value.toString('utf8') }
	}
}
