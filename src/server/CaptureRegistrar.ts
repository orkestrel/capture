import type { CaptureRequest } from '@src/core'
import type {
	CaptureExecutionResult,
	CaptureInvocationInterface,
	CaptureProject,
	CaptureReceiptInput,
	CaptureRegistrarInterface,
	CaptureRegistrarOptions,
	CaptureRegistryArguments,
	CaptureWriteHandler,
} from './types.js'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseJSON } from '@orkestrel/contract'
import {
	CAPTURE_REGISTRY_FILE,
	CAPTURE_VERSION,
	CaptureError,
	describeCaptureError,
	describeCaptureRequest,
	isCaptureError,
	isCapturePath,
	isCaptureRegistry,
	isCaptureRun,
	readCaptureReport,
	validateCaptureRun,
} from '@src/core'
import { CaptureDiscovery } from './CaptureDiscovery.js'
import { CaptureIntegrity } from './CaptureIntegrity.js'
import { CaptureInvocation } from './CaptureInvocation.js'
import {
	CAPTURE_EXIT,
	CAPTURE_OWNER_PREFIX,
	CAPTURE_REGISTRY_LINE,
	CAPTURE_REGISTRY_STAGE,
	CAPTURE_RUNS_DIRECTORY,
	CAPTURE_VITEST_ENTRY,
} from './constants.js'
import {
	buildCaptureArguments,
	buildCaptureFilter,
	buildCaptureIntegrityOptions,
	buildCaptureRegistry,
	computeCaptureHash,
	readCaptureInputs,
	readCaptureRegistryArguments,
	requireCaptureProjects,
	resolveCaptureRelative,
	writeCaptureDocument,
} from './helpers.js'

/**
 * Refreshes the accepted registry from one complete capture-free journey per producing variant.
 *
 * @remarks
 * The refresh is the one route that bootstraps or replaces the registry the stage transaction
 * requires, so it cannot stamp through the integrity engine. It reads the wrapper through the same
 * discovery the runner uses, takes the same invocation entity, request file, and Vitest child, and runs
 * each producing variant as a stage of its own with the `all` selector and no capture variable. It
 * reads each stage's reporter and closing record, takes the project's input population before and
 * after, and builds the receipts through `buildCaptureRegistry`. The registry is written to a
 * candidate beside its target, read back through the integrity engine, and only then renamed into
 * place, so a registry the engine would refuse never replaces a good one. With `--variant`, the
 * existing registry's receipts for the other declared variants are kept. It never widens a scoped
 * run into a refresh and refuses while another runner holds a request file in the request directory.
 *
 * @example
 * ```ts
 * const registrar = new CaptureRegistrar({
 * 	root: process.cwd(),
 * 	config: 'configs/app/vite.journey.config.ts',
 * 	requests: 'tmp/capture',
 * 	argv: [],
 * })
 * const exit = await registrar.execute()
 * ```
 */
export class CaptureRegistrar implements CaptureRegistrarInterface {
	readonly #options: CaptureRegistrarOptions
	readonly #stdout: CaptureWriteHandler
	readonly #stderr: CaptureWriteHandler

	/**
	 * Binds the workspace, the wrapper default, the request directory, and the command line.
	 *
	 * @param options - The workspace, the wrapper default, the request directory, the command line, and optional output writers
	 */
	constructor(options: CaptureRegistrarOptions) {
		this.#options = options
		this.#stdout = options.stdout ?? process.stdout.write.bind(process.stdout)
		this.#stderr = options.stderr ?? process.stderr.write.bind(process.stderr)
	}

	async execute(): Promise<number> {
		const { root, requests, argv, config } = this.#options
		const invocation = new CaptureInvocation({
			command: 'journey',
			root,
			requests,
			stdout: this.#stdout,
			stderr: this.#stderr,
		})
		invocation.attach()
		try {
			const parsed = readCaptureRegistryArguments(argv, root, config)
			const description = await new CaptureDiscovery({
				root,
				config: parsed.config,
				invocation,
				...(parsed.mode === undefined ? {} : { mode: parsed.mode }),
				...(this.#options.deadline === undefined ? {} : { deadline: this.#options.deadline }),
			}).describe()
			return await this.#refresh(
				invocation,
				parsed,
				description.projects.map((entry) => entry.project),
			)
		} catch (error) {
			this.#stderr(`${describeCaptureError(error)}\n`)
			return isCaptureError(error) && error.code === 'USAGE'
				? CAPTURE_EXIT.usage
				: CAPTURE_EXIT.failed
		} finally {
			await invocation.release()
		}
	}

	async #refresh(
		invocation: CaptureInvocationInterface,
		parsed: CaptureRegistryArguments,
		projects: readonly CaptureProject[],
	): Promise<number> {
		const { root } = this.#options
		const primary = requireCaptureProjects(projects)
		const declared = [...new Set(projects.flatMap((project) => project.variants))]
		for (const variant of parsed.variants) {
			if (!declared.includes(variant))
				throw new CaptureError(
					`Unknown variant: ${JSON.stringify(variant)}; the wrapper declares ${declared.join(', ')}`,
					{ code: 'USAGE', context: { variant } },
				)
		}
		const variants = declared.filter(
			(variant) => parsed.variants.length === 0 || parsed.variants.includes(variant),
		)
		for (const variant of variants) {
			if (!projects.some((project) => project.variant === variant))
				throw new CaptureError(`The wrapper declares no journey project for ${variant}`, {
					code: 'HOST',
					context: { variant },
				})
		}
		const directory = resolveCaptureRelative(root, primary.directory)
		const target = `${directory}/${CAPTURE_REGISTRY_FILE}`
		const holders = invocation.holders()
		if (holders.length > 0)
			throw new CaptureError(
				`Another runner holds this workspace (process ${holders.join(', ')}); the registry refresh starts only while no runner is mid-stage`,
				{ code: 'STAGE', context: { holders } },
			)
		// A receipt this run keeps must still match its reporter bytes, so an altered one refuses before any journey runs.
		const retained = parsed.variants.length === 0 ? [] : this.#retain(target, variants, declared)
		if (retained.length > 0) buildCaptureRegistry(retained)
		const imports: CaptureReceiptInput[] = []
		for (const variant of variants) {
			if (invocation.interrupted) return CAPTURE_EXIT.failed
			imports.push(await this.#stage(invocation, parsed, projects, primary, variant))
		}
		if (invocation.interrupted) return CAPTURE_EXIT.failed
		const registry = buildCaptureRegistry([...retained, ...imports])
		const candidate = `${target}.${invocation.id}.candidate`
		const path = resolve(root, candidate)
		try {
			writeCaptureDocument(path, registry, invocation.signal)
			// The engine reads the candidate exactly as it will read the registry, before anything is replaced.
			await new CaptureIntegrity({
				...buildCaptureIntegrityOptions(root, primary),
				registry: candidate,
			}).read({ selector: 'all' })
			invocation.signal.throwIfAborted()
			renameSync(path, resolve(root, target))
		} finally {
			rmSync(path, { force: true })
		}
		this.#stdout(
			`${CAPTURE_REGISTRY_LINE} ${JSON.stringify({
				file: target,
				digest: registry.digest,
				variants: registry.receipts.map((receipt) => receipt.variant),
				refreshed: variants,
				entries: registry.entries.length,
			})}\n`,
		)
		return CAPTURE_EXIT.passed
	}

	async #stage(
		invocation: CaptureInvocationInterface,
		parsed: CaptureRegistryArguments,
		projects: readonly CaptureProject[],
		primary: CaptureProject,
		variant: string,
	): Promise<CaptureReceiptInput> {
		const { root } = this.#options
		const project = projects.find((candidate) => candidate.variant === variant)
		if (project === undefined)
			throw new CaptureError(`The wrapper declares no journey project for ${variant}`, {
				code: 'HOST',
				context: { variant },
			})
		const selectors = [...new Set(projects.flatMap((candidate) => candidate.tags))]
			.filter((tag) => tag.startsWith(CAPTURE_OWNER_PREFIX))
			.map((tag) => tag.slice(CAPTURE_OWNER_PREFIX.length))
		const stage = `${CAPTURE_REGISTRY_STAGE}-${variant}`
		const report = resolve(invocation.directory, `${stage}.json`)
		const log = resolve(invocation.directory, `${stage}.log`)
		const record = `${resolveCaptureRelative(root, primary.directory)}/${CAPTURE_RUNS_DIRECTORY}/${invocation.id}/${stage}/${variant}.json`
		const args = buildCaptureArguments({
			entry: resolve(root, CAPTURE_VITEST_ENTRY),
			config: parsed.config,
			report,
			projects: [project.name],
			filter: buildCaptureFilter('journey', 'all', selectors),
			closing: primary.closing,
			...(parsed.mode === undefined ? {} : { mode: parsed.mode }),
		})
		const request: CaptureRequest = {
			version: 1,
			id: invocation.id,
			stage,
			config: resolveCaptureRelative(root, parsed.config),
			pid: process.pid,
			command: 'journey',
			selector: 'all',
			variants: [variant],
			args,
		}
		const before = readCaptureInputs(root, project.inputs)
		const started = Date.now()
		rmSync(report, { force: true })
		this.#stdout(`registry ${stage}: ${variant}; all; report=${report}; record=${record}\n`)
		const outcome = await this.#run(invocation, request, log)
		if (invocation.interrupted)
			throw new CaptureError('Runner interrupted', { code: 'STAGE', context: { variant } })
		if (outcome.code !== 0 || outcome.signal !== null)
			throw new CaptureError(
				`The registry journey for ${variant} did not exit successfully (${String(outcome.code ?? outcome.signal)})`,
				{ code: 'STAGE', context: { variant, code: outcome.code, signal: outcome.signal } },
			)
		if (!existsSync(report))
			throw new CaptureError(`The registry journey for ${variant} wrote no reporter at ${report}`, {
				code: 'EVIDENCE',
				context: { variant },
			})
		const text = readFileSync(report, 'utf8')
		const reading = readCaptureReport(parseJSON(text))
		if (reading.start < started || reading.end > Date.now())
			throw new CaptureError('Reporter does not belong to this refresh', { code: 'EVIDENCE' })
		if (!existsSync(resolve(root, record)))
			throw new CaptureError(
				`The registry journey for ${variant} wrote no closing record at ${record}`,
				{
					code: 'EVIDENCE',
					context: { variant },
				},
			)
		const run: unknown = parseJSON(readFileSync(resolve(root, record), 'utf8'))
		if (
			!isCaptureRun(run) ||
			run.request === undefined ||
			run.variant !== variant ||
			describeCaptureRequest(run.request) !== describeCaptureRequest(request)
		)
			throw new CaptureError(`Invalid or mismatched closing record: ${record}`, {
				code: 'EVIDENCE',
			})
		if (Date.parse(run.time) < started || Date.parse(run.time) > reading.end)
			throw new CaptureError('Closing record time does not belong to this refresh', {
				code: 'EVIDENCE',
			})
		validateCaptureRun(run, reading, project.name)
		if (!run.complete)
			throw new CaptureError(
				`The registry journey for ${variant} was not a complete run; a refresh imports complete runs only`,
				{ code: 'EVIDENCE', context: { variant } },
			)
		if (JSON.stringify(readCaptureInputs(root, project.inputs)) !== JSON.stringify(before))
			throw new CaptureError('Bounded host inputs or membership changed during the refresh', {
				code: 'STAGE',
				context: { variant },
			})
		return {
			receipt: {
				version: CAPTURE_VERSION,
				variant,
				time: run.time,
				report: {
					file: resolveCaptureRelative(root, report),
					digest: computeCaptureHash(text),
				},
				inputs: before,
				declarations: run.declarations,
				registry: run.registry,
				complete: run.complete,
			},
			report: text,
			outcome,
			capped: false,
		}
	}

	async #run(
		invocation: CaptureInvocationInterface,
		request: CaptureRequest,
		log: string,
	): Promise<CaptureExecutionResult> {
		try {
			invocation.publish(request)
			return await invocation.spawn(request.args, log, false)
		} finally {
			invocation.retract()
		}
	}

	#retain(
		target: string,
		refreshed: readonly string[],
		declared: readonly string[],
	): readonly CaptureReceiptInput[] {
		const { root } = this.#options
		const path = resolve(root, target)
		if (!existsSync(path)) return []
		const registry: unknown = parseJSON(readFileSync(path, 'utf8'))
		if (!isCaptureRegistry(registry))
			throw new CaptureError(
				`The existing registry is invalid and cannot keep the variants this run leaves out; refresh every producing variant to replace it: ${target}`,
				{ code: 'EVIDENCE' },
			)
		return registry.receipts
			.filter(
				(receipt) => declared.includes(receipt.variant) && !refreshed.includes(receipt.variant),
			)
			.map((receipt) => {
				if (!isCapturePath(receipt.report.file) || !existsSync(resolve(root, receipt.report.file)))
					throw new CaptureError(
						`The retained receipt for ${receipt.variant} has no reporter at ${JSON.stringify(receipt.report.file)}; refresh every producing variant`,
						{ code: 'EVIDENCE', context: { variant: receipt.variant } },
					)
				return {
					receipt,
					report: readFileSync(resolve(root, receipt.report.file), 'utf8'),
					outcome: { code: 0, signal: null },
					capped: false,
				}
			})
	}
}
