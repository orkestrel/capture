import type { CaptureRequest } from '@src/core'
import type {
	CaptureChangePlan,
	CaptureIntegrityInterface,
	CaptureIntegrityOptions,
	CaptureInvocationInterface,
	CaptureOutcome,
	CaptureOwnerOutcome,
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
import { attempt } from '@orkestrel/contract'
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
	renderCaptureCommand,
	requireCaptureProjects,
	resolveCaptureRelative,
	resolveCaptureStages,
	resolveCaptureVariants,
} from './helpers.js'

/**
 * Drives selected owners through one journey stage or staged frame captures.
 *
 * @remarks
 * The wrapper and the installed Vitest supply the registry and the execution protocol, and the
 * wrapper's provided values supply every name the runner uses: the variants, the first-stage
 * variant, the final case, and the portfolio roots. The runner never loads the wrapper itself: a
 * `CaptureDiscovery` runs the consumer's installed Vitest in discovery mode and reads back the host
 * description the wrapper writes, so the runner imports neither Vite nor Vitest. It creates one
 * discovery invocation per `execute` call and a separate invocation per changed owner, and holds
 * none of that call's state itself.
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
		const argumentsResult = attempt(() => readCaptureArguments(argv, command, root, config))
		try {
			if (!argumentsResult.success) throw argumentsResult.error
			const parsed = argumentsResult.value
			const description = await new CaptureDiscovery({
				root,
				config: parsed.config,
				invocation,
				...(this.#options.deadline === undefined ? {} : { deadline: this.#options.deadline }),
			}).describe()
			const projects = description.projects.map((entry) => entry.project)
			return command === 'stale'
				? await this.#check(parsed, projects)
				: parsed.changed === undefined
					? await this.#run(invocation, command, parsed, projects)
					: await this.#changed(invocation, command, parsed, projects)
		} catch (error) {
			const ran = Object.values(CAPTURE_STAGES).filter((stage) =>
				invocation.launched(resolve(invocation.directory, `${command}-${stage}.log`)),
			)
			const next = renderCaptureCommand(
				command,
				{
					config: argumentsResult.success ? argumentsResult.value.config : resolve(root, config),
					variants: [],
				},
				'all',
				root,
			)
			this.#stderr(
				`${describeCaptureError(error)}\n${ran.length === 0 ? 'No execution child ran; the command was refused before execution.' : `Execution stopped after stages: ${ran.join(', ')}; no later stage ran.`}\nNEXT ${next}\n`,
			)
			return isCaptureError(error) && error.code === 'USAGE'
				? CAPTURE_EXIT.usage
				: CAPTURE_EXIT.failed
		} finally {
			await invocation.release()
		}
	}

	async #changed(
		discovery: CaptureInvocationInterface,
		command: CaptureRequest['command'],
		parsed: CaptureRunnerArguments,
		projects: readonly CaptureProject[],
	): Promise<number> {
		const { root, requests } = this.#options
		const primary = requireCaptureProjects(projects)
		const plan = this.#changes(parsed, primary)
		for (const change of plan.changes) this.#stdout(`CHANGE ${JSON.stringify(change)}\n`)
		const commands = plan.owners.map((owner) => renderCaptureCommand(command, parsed, owner, root))
		const shared = plan.changes.filter((change) => change.classification === 'shared')
		const complete = renderCaptureCommand(
			'journey',
			{ config: parsed.config, variants: parsed.variants },
			'all',
			root,
		)
		for (const next of commands) this.#stdout(`COMMAND ${next}\n`)
		const variants = resolveCaptureVariants(parsed.variants, projects)
		if (shared.length > 0) {
			this.#stderr(
				`Shared journey inputs cannot be narrowed because every destination reads them: ${JSON.stringify(shared.map((change) => change.path))}\n`,
			)
			this.#stdout(
				`SUMMARY ${JSON.stringify({ run: [], passed: [], failed: [], notrun: plan.owners, reason: 'shared inputs require an explicit journey selection' })}\n`,
			)
			for (const next of [...commands, complete]) this.#stdout(`NEXT ${next}\n`)
			return CAPTURE_EXIT.usage
		}
		if (plan.owners.length === 0) {
			this.#stdout(
				`No journey input changed\nSUMMARY ${JSON.stringify({ run: [], passed: [], failed: [], notrun: [], reason: 'only outside paths or no changed paths' })}\nNEXT ${complete}\n`,
			)
			return parsed.plan ? CAPTURE_EXIT.passed : CAPTURE_EXIT.failed
		}
		const selectors = [...new Set(projects.flatMap((project) => project.tags))]
			.filter((tag) => tag.startsWith(CAPTURE_OWNER_PREFIX))
			.map((tag) => tag.slice(CAPTURE_OWNER_PREFIX.length))
		for (const owner of plan.owners) {
			const fault = describeCaptureSelectorFault(owner, selectors)
			if (fault !== undefined) throw new CaptureError(fault, { code: 'USAGE' })
			if (parsed.plan) await this.#resolve(this.#integrity(primary), parsed, owner, variants)
		}
		if (parsed.plan) {
			this.#stdout(
				`SUMMARY ${JSON.stringify({ run: [], passed: [], failed: [], notrun: plan.owners, reason: '--plan starts no execution child' })}\n`,
			)
			for (const next of commands) this.#stdout(`NEXT ${next}\n`)
			return CAPTURE_EXIT.passed
		}
		const outcomes: CaptureOwnerOutcome[] = []
		for (const owner of plan.owners) {
			if (discovery.interrupted) break
			const invocation = new CaptureInvocation({
				command,
				root,
				requests,
				stdout: this.#stdout,
				stderr: this.#stderr,
			})
			invocation.attach()
			try {
				invocation.prepare()
				const code = await this.#run(
					invocation,
					command,
					{ ...parsed, selector: owner },
					projects,
				).catch((error: unknown) => {
					this.#stderr(`${describeCaptureError(error)}\n`)
					return isCaptureError(error) && error.code === 'USAGE'
						? CAPTURE_EXIT.usage
						: CAPTURE_EXIT.failed
				})
				outcomes.push({
					owner,
					code,
					ran: Object.values(CAPTURE_STAGES).some((stage) =>
						invocation.launched(resolve(invocation.directory, `${command}-${stage}.log`)),
					),
				})
			} finally {
				await invocation.release()
			}
			if (outcomes.some((outcome) => outcome.code !== CAPTURE_EXIT.passed)) break
		}
		const failed = outcomes.filter((outcome) => outcome.code !== CAPTURE_EXIT.passed)
		const notrun = plan.owners.filter(
			(owner) => !outcomes.some((outcome) => outcome.owner === owner && outcome.ran),
		)
		this.#stdout(
			`SUMMARY ${JSON.stringify({
				run: outcomes.filter((outcome) => outcome.ran).map((outcome) => outcome.owner),
				passed: outcomes
					.filter((outcome) => outcome.code === CAPTURE_EXIT.passed)
					.map((outcome) => outcome.owner),
				failed: failed.map((outcome) => outcome.owner),
				notrun,
				reason: discovery.interrupted
					? 'interrupted'
					: failed.length > 0
						? 'stopped at the first red owner'
						: 'every selected owner passed',
			})}\n`,
		)
		for (const owner of [...new Set([...failed.map((outcome) => outcome.owner), ...notrun])])
			this.#stdout(`NEXT ${renderCaptureCommand(command, parsed, owner, root)}\n`)
		if (failed.length === 0 && notrun.length === 0) this.#stdout(`NEXT ${complete}\n`)
		return failed.at(0)?.code ?? (discovery.interrupted ? CAPTURE_EXIT.failed : CAPTURE_EXIT.passed)
	}

	#changes(parsed: CaptureRunnerArguments, primary: CaptureProject): CaptureChangePlan {
		try {
			if (parsed.changed === undefined)
				throw new CaptureError('Missing value: --changed', { code: 'USAGE' })
			return this.#integrity(primary).changed(parsed.changed)
		} catch (error) {
			const command = renderCaptureCommand(
				'journey',
				{ config: parsed.config, variants: [] },
				'all',
				this.#options.root,
			)
			const registry = renderCaptureCommand(
				'registry',
				{ config: parsed.config, variants: [] },
				undefined,
				this.#options.root,
			)
			throw new CaptureError(
				`${describeCaptureError(error)}\nNo owner ran; changed selection was refused.\n${isCaptureError(error) && error.code === 'EVIDENCE' ? `NEXT ${registry}\n` : ''}NEXT ${command}`,
				{ code: 'USAGE', cause: error },
			)
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
		const variants = resolveCaptureVariants(parsed.variants, projects)
		const integrity = this.#integrity(primary)
		const selected = await this.#resolve(integrity, parsed, selector, variants)
		const plan: CaptureRunPlan = {
			command,
			projects,
			selector,
			filter: buildCaptureFilter(command, selector, selectors),
			...(selected === undefined ? {} : { case: selected }),
			...(parsed.state === undefined ? {} : { state: parsed.state }),
			final: primary.final,
			directory: resolveCaptureRelative(root, primary.directory),
			config: resolveCaptureRelative(root, parsed.config),
		}
		const outcomes: CaptureOutcome[] = []
		const stages = resolveCaptureStages(variants, primary.first, command)
		const completed: CaptureStagePlan[] = []
		try {
			for (const stage of stages) {
				if (invocation.interrupted) return CAPTURE_EXIT.failed
				outcomes.push(...(await this.#stage(invocation, integrity, plan, stage)))
				completed.push(stage)
			}
			for (const outcome of outcomes) {
				this.#stdout(`${outcome.project}: ${String(outcome.count)} owner-bearing passed cases\n`)
			}
			if (outcomes.every((outcome) => outcome.count === 0))
				throw new CaptureError(
					'Empty selected workload: no requested project held applicable work',
					{ code: 'STAGE' },
				)
			return CAPTURE_EXIT.passed
		} finally {
			const ran = stages.filter((stage) =>
				invocation.launched(resolve(invocation.directory, `${command}-${stage.name}.log`)),
			)
			const notrun = stages.filter((stage) => !ran.includes(stage))
			const failed = ran.filter((stage) => !completed.includes(stage))
			const passed =
				completed.length === stages.length && outcomes.some((outcome) => outcome.count > 0)
			this.#stdout(
				`STAGES ${JSON.stringify({
					selector,
					run: ran.map((stage) => stage.name),
					passed: completed.map((stage) => stage.name),
					failed: failed.map((stage) => stage.name),
					notrun: notrun.map((stage) => stage.name),
					reason: invocation.interrupted
						? 'interrupted; no later stage ran'
						: passed
							? 'selected workload passed'
							: failed.length > 0
								? 'stage failed; no later stage ran'
								: notrun.length > 0
									? 'refused before execution'
									: 'empty selected workload',
				})}\n`,
			)
			this.#stdout(
				`NEXT ${renderCaptureCommand(passed ? 'journey' : command, passed ? { config: parsed.config, variants: [] } : parsed, passed ? 'all' : selector, root)}\n`,
			)
		}
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
			final: plan.final,
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
		return `Usage: capture ${CAPTURE_COMMAND_NAMES[command]} <selector> [--variant <name>] [--case <full name>]${state} [--config <file>]\nOr: capture ${CAPTURE_COMMAND_NAMES[command]} --changed <ref> [--plan] [--variant <name>] [--case <full name>]${state} [--config <file>]\nSelectors:\n${selectors.toSorted().join('\n')}\nall (every declared scope; name it explicitly)`
	}
}
