import type { CaptureRequest } from '@src/core'
import type {
	CaptureIntegrityInterface,
	CaptureIntegrityOptions,
	CaptureInvocationInterface,
	CaptureOutcome,
	CapturePortfolioRoot,
	CaptureProject,
	CaptureRunnerArguments,
	CaptureRunnerInterface,
	CaptureRunnerOptions,
	CaptureRunPlan,
	CaptureStagePlan,
	CaptureWriteHandler,
} from './types.js'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	CAPTURE_LOOKUPS_FILE,
	CAPTURE_MANIFEST_FILE,
	CAPTURE_REGISTRY_FILE,
	CaptureError,
	describeCaptureError,
	isCaptureError,
	isCapturePath,
} from '@src/core'
import { CaptureDiscovery } from './CaptureDiscovery.js'
import { CaptureIntegrity } from './CaptureIntegrity.js'
import { CaptureInvocation } from './CaptureInvocation.js'
import {
	CAPTURE_COMMAND_NAMES,
	CAPTURE_EXIT,
	CAPTURE_OWNER_PREFIX,
	CAPTURE_RUNS_DIRECTORY,
	CAPTURE_STAGES,
	CAPTURE_VITEST_ENTRY,
} from './constants.js'
import {
	buildCaptureArguments,
	buildCaptureFilter,
	describeCaptureSelectorFault,
	readCaptureArguments,
	requireCaptureProjects,
	resolveCaptureRelative,
	resolveCaptureStages,
} from './helpers.js'

/**
 * Drives owner-selected journeys through narrow and remaining variant stages.
 *
 * @remarks
 * The wrapper and the installed Vitest supply the registry and the execution protocol, and the
 * wrapper's provided values supply every name the runner uses: the variants, the first-stage
 * variant, the closing case, and the portfolio roots. The runner never loads the wrapper itself: a
 * `CaptureDiscovery` runs the consumer's installed Vitest in discovery mode and reads back the host
 * description the wrapper writes, so the runner imports neither Vite nor Vitest. It creates one
 * `CaptureInvocation` per `execute` call and holds none of that call's state itself.
 *
 * @example
 * ```ts
 * const runner = new CaptureRunner({
 * 	command: 'journey',
 * 	root: process.cwd(),
 * 	config: 'configs/app/vite.journey.config.ts',
 * 	requests: 'tmp/units',
 * 	argv: ['pages:mail', '--variant', 'light-390'],
 * })
 * const exit = await runner.execute()
 * ```
 */
export class CaptureRunner implements CaptureRunnerInterface {
	readonly #options: CaptureRunnerOptions
	readonly #stdout: CaptureWriteHandler
	readonly #stderr: CaptureWriteHandler

	/**
	 * Binds the command, the workspace, and the command line.
	 *
	 * @param options - The command, the workspace, the wrapper default, the request directory, and the command line
	 */
	constructor(options: CaptureRunnerOptions) {
		this.#options = options
		this.#stdout = options.stdout ?? process.stdout.write.bind(process.stdout)
		this.#stderr = options.stderr ?? process.stderr.write.bind(process.stderr)
	}

	async execute(): Promise<number> {
		const { command, root, requests, argv, config } = this.#options
		const invocation = new CaptureInvocation({
			command,
			root,
			requests,
			stdout: this.#stdout,
			stderr: this.#stderr,
		})
		invocation.attach()
		try {
			const parsed = readCaptureArguments(argv, command, root, config)
			const description = await new CaptureDiscovery({
				root,
				config: parsed.config,
				invocation,
				...(this.#options.deadline === undefined ? {} : { deadline: this.#options.deadline }),
			}).describe()
			const projects = description.projects.map((entry) => entry.project)
			return command === 'stale'
				? await this.#check(parsed, projects)
				: await this.#run(invocation, command, parsed, projects)
		} catch (error) {
			this.#stderr(`${describeCaptureError(error)}\n`)
			return isCaptureError(error) && error.code === 'USAGE'
				? CAPTURE_EXIT.usage
				: CAPTURE_EXIT.failed
		} finally {
			await invocation.release()
		}
	}

	async #run(
		invocation: CaptureInvocationInterface,
		command: CaptureRequest['command'],
		parsed: CaptureRunnerArguments,
		projects: readonly CaptureProject[],
	): Promise<number> {
		const { root } = this.#options
		const primary = requireCaptureProjects(projects)
		const selectors = [...new Set(projects.flatMap((project) => project.tags))]
			.filter((tag) => tag.startsWith(CAPTURE_OWNER_PREFIX))
			.map((tag) => tag.slice(CAPTURE_OWNER_PREFIX.length))
		const selector = parsed.selector
		if (selector === undefined) throw new CaptureError(this.#usage(selectors), { code: 'USAGE' })
		const fault = describeCaptureSelectorFault(selector, selectors)
		if (fault !== undefined) throw new CaptureError(fault, { code: 'USAGE', context: { selector } })
		const declared = [...new Set(projects.flatMap((project) => project.variants))]
		for (const variant of parsed.variants) {
			if (!declared.includes(variant))
				throw new CaptureError(`Unknown variant: ${variant}`, {
					code: 'USAGE',
					context: { variant },
				})
		}
		const variants = declared.filter(
			(variant) => parsed.variants.length === 0 || parsed.variants.includes(variant),
		)
		if (variants.length === 0)
			throw new CaptureError('The wrapper declares no journey variants', { code: 'HOST' })
		for (const variant of variants) {
			if (!projects.some((project) => project.variant === variant))
				throw new CaptureError(`The wrapper declares no journey project for ${variant}`, {
					code: 'HOST',
					context: { variant },
				})
		}
		const integrity = this.#integrity(primary)
		const selected = await this.#resolve(integrity, parsed, selector, variants)
		const plan: CaptureRunPlan = {
			command,
			projects,
			selector,
			filter: buildCaptureFilter(command, selector, selectors),
			...(selected === undefined ? {} : { case: selected }),
			...(parsed.state === undefined ? {} : { state: parsed.state }),
			closing: primary.closing,
			directory: resolveCaptureRelative(root, primary.directory),
			config: resolveCaptureRelative(root, parsed.config),
		}
		const outcomes: CaptureOutcome[] = []
		for (const stage of resolveCaptureStages(variants, primary.first)) {
			if (invocation.interrupted) return CAPTURE_EXIT.failed
			outcomes.push(...(await this.#stage(invocation, integrity, plan, stage)))
		}
		for (const outcome of outcomes) {
			this.#stdout(`${outcome.project}: ${String(outcome.count)} owner-bearing passed cases\n`)
		}
		if (outcomes.every((outcome) => outcome.count === 0))
			throw new CaptureError('Empty selected workload: no requested project held applicable work', {
				code: 'STAGE',
			})
		return CAPTURE_EXIT.passed
	}

	async #stage(
		invocation: CaptureInvocationInterface,
		integrity: CaptureIntegrityInterface,
		plan: CaptureRunPlan,
		stage: CaptureStagePlan,
	): Promise<readonly CaptureOutcome[]> {
		const { root } = this.#options
		const report = resolve(invocation.directory, `${plan.command}-${stage.name}.json`)
		const log = resolve(invocation.directory, `${plan.command}-${stage.name}.log`)
		const selected = stage.variants.flatMap((variant) =>
			plan.projects.filter((project) => project.variant === variant),
		)
		const args = buildCaptureArguments({
			entry: resolve(root, CAPTURE_VITEST_ENTRY),
			config: resolve(root, plan.config),
			report,
			projects: selected.map((project) => project.name),
			filter: plan.filter,
			...(plan.case === undefined ? {} : { case: plan.case }),
			closing: plan.closing,
		})
		const request: CaptureRequest = {
			version: 1,
			id: invocation.id,
			stage: stage.name,
			config: plan.config,
			pid: process.pid,
			command: plan.command,
			selector: plan.selector,
			...(plan.case === undefined ? {} : { case: plan.case }),
			...(plan.state === undefined ? {} : { state: plan.state }),
			variants: stage.variants,
			args,
		}
		rmSync(report, { force: true })
		try {
			invocation.publish(request)
			this.#stdout(
				`${plan.command} ${stage.name}: ${stage.variants.join(', ')}; ${plan.selector}${plan.case === undefined ? '' : ' (case-scoped)'}; report=${report}; records=${plan.directory}/${CAPTURE_RUNS_DIRECTORY}/${invocation.id}/${stage.name}/<variant>.json\n`,
			)
			const result = await integrity
				.stamp({
					request,
					report: resolveCaptureRelative(root, report),
					signal: invocation.signal,
					projects: selected.map((project) => ({
						name: project.name,
						variant: project.variant,
						inputs: project.inputs,
						record: `${resolveCaptureRelative(root, project.directory)}/${CAPTURE_RUNS_DIRECTORY}/${request.id}/${request.stage}/${project.variant}.json`,
					})),
					execute: () => invocation.spawn(args, log, plan.command === 'capture'),
				})
				.catch((error: unknown) => {
					if (invocation.launched(log)) throw error
					throw new CaptureError(describeCaptureError(error), { code: 'USAGE', cause: error })
				})
			this.#stdout(
				`INTEGRITY ${JSON.stringify({
					command: plan.command,
					stage: stage.name,
					variants: stage.variants,
					stamps: result.entries.length,
					lookups: result.lookups.length,
					duration: result.duration,
				})}\n`,
			)
			const outcomes = result.projects.map((project) => ({
				project: project.project,
				variant: project.variant,
				count: project.passed.length,
			}))
			if (stage.name === CAPTURE_STAGES.first && outcomes.every((outcome) => outcome.count === 0)) {
				this.#stdout(
					`${stage.variants.join(', ')} is inapplicable; the rest stage carries ${plan.selector} when requested\n`,
				)
			}
			return outcomes
		} finally {
			invocation.retract()
		}
	}

	async #resolve(
		integrity: CaptureIntegrityInterface,
		parsed: CaptureRunnerArguments,
		selector: string,
		variants: readonly string[],
	): Promise<string | undefined> {
		if (parsed.state === undefined) return parsed.case
		return await integrity
			.lookup({
				selector,
				variants,
				state: parsed.state,
				...(parsed.case === undefined ? {} : { case: parsed.case }),
			})
			.then(
				(result) => result.case,
				(error: unknown) => {
					throw new CaptureError(describeCaptureError(error), { code: 'USAGE', cause: error })
				},
			)
	}

	#integrity(
		primary: CaptureProject,
		standalone?: CapturePortfolioRoot,
	): CaptureIntegrityInterface {
		const { root } = this.#options
		const directory =
			standalone === undefined
				? resolveCaptureRelative(root, primary.directory)
				: standalone.directory
		if (!isCapturePath(directory))
			throw new CaptureError('The wrapper provides a directory outside the repository', {
				code: 'HOST',
				context: { directory },
			})
		const options: CaptureIntegrityOptions = {
			root,
			directory,
			inputs: primary.inputs,
			registry: `${directory}/${CAPTURE_REGISTRY_FILE}`,
			manifest: `${directory}/${CAPTURE_MANIFEST_FILE}`,
			lookups: `${directory}/${CAPTURE_LOOKUPS_FILE}`,
			portfolios: standalone === undefined ? primary.portfolios : [standalone],
		}
		const create = this.#options.integrity
		return create === undefined ? new CaptureIntegrity(options) : create(options)
	}

	async #check(
		parsed: CaptureRunnerArguments,
		projects: readonly CaptureProject[],
	): Promise<number> {
		try {
			const selector = parsed.selector
			if (selector === undefined)
				throw new CaptureError(
					`Usage: capture ${CAPTURE_COMMAND_NAMES.stale} <selector> [--variant <output>] [--state <state>] [--case <full name>] [--portfolio <name>]`,
					{ code: 'USAGE' },
				)
			const primary = requireCaptureProjects(projects)
			// A standalone root has no stamping route and is read only when a selection names it.
			const standalone = primary.standalone.find(
				(root) =>
					parsed.portfolio === root.portfolio ||
					selector === root.portfolio ||
					selector.startsWith(`${root.portfolio}:`),
			)
			// An omitted variant list reads every output variant of the selected registry destinations,
			// and refuses a declared producing variant the registry never attested.
			const result = await this.#integrity(primary, standalone).check({
				selector,
				declared: [...new Set(projects.flatMap((project) => project.variants))],
				...(parsed.variants.length === 0 ? {} : { variants: parsed.variants }),
				...(parsed.case === undefined ? {} : { case: parsed.case }),
				...(parsed.state === undefined ? {} : { state: parsed.state }),
				...(parsed.portfolio === undefined ? {} : { portfolio: parsed.portfolio }),
			})
			this.#stdout(`INTEGRITY ${JSON.stringify({ command: 'stale', ...result })}\n`)
			return result.entries.every((entry) => entry.status === 'current')
				? CAPTURE_EXIT.passed
				: CAPTURE_EXIT.failed
		} catch (error) {
			throw new CaptureError(describeCaptureError(error), { code: 'USAGE', cause: error })
		}
	}

	#usage(selectors: readonly string[]): string {
		const { command } = this.#options
		const state = command === 'capture' ? ' [--state <name>]' : ''
		return `Usage: capture ${CAPTURE_COMMAND_NAMES[command]} <selector> [--variant <name>] [--case <full name>]${state} [--config <file>]\nSelectors:\n${selectors.toSorted().join('\n')}\nall (every declared scope; name it explicitly)`
	}
}
