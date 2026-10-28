import type {
	CaptureCheckResult,
	CaptureIntegrityInterface,
	CaptureIntegrityOptions,
	CaptureLookupOptions,
	CaptureLookupResult,
	CaptureReadResult,
	CaptureStageOptions,
	CaptureStageResult,
	CaptureStaleOptions,
} from '@src/server'
import type { RecordingScript } from '../../setupServer.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseJSON } from '@orkestrel/contract'
import { CaptureError } from '@src/core'
import { FIXTURE_HASH } from '../../setup.js'

/**
 * Implements the integrity contract minimally and records every call the runner makes to it.
 *
 * @remarks
 * The runner's claims are process orchestration: which stages run, what each request and argument
 * list carries, and how outcomes map to exits. This boundary stub supplies only what that needs,
 * and the engine's own claims stay with the engine's proofs. A stage runs the runner's real child
 * and passes only when it exits zero and left a report that parses.
 */
export class RecordingIntegrity implements CaptureIntegrityInterface {
	readonly options: CaptureIntegrityOptions
	readonly stages: CaptureStageOptions[] = []
	readonly lookups: CaptureLookupOptions[] = []
	readonly checks: CaptureStaleOptions[] = []
	readonly #script: RecordingScript

	/**
	 * Binds the options the runner derived and the scripted outcomes.
	 *
	 * @param options - The options the runner passed to its engine handler
	 * @param script - The scripted counts, lookup outcome, and freshness statuses
	 */
	constructor(options: CaptureIntegrityOptions, script: RecordingScript) {
		this.options = options
		this.#script = script
	}

	async read(): Promise<CaptureReadResult> {
		return { registry: FIXTURE_HASH, entries: [] }
	}

	async stamp(options: CaptureStageOptions): Promise<CaptureStageResult> {
		this.stages.push(options)
		const outcome = await options.execute()
		if (outcome.code !== 0 || outcome.signal !== null)
			throw new CaptureError(`The child ended with ${String(outcome.code ?? outcome.signal)}`, {
				code: 'STAGE',
			})
		const report = readFileSync(resolve(this.options.root, options.report), 'utf8')
		if (parseJSON(report) === undefined)
			throw new CaptureError('The report is not JSON', { code: 'EVIDENCE' })
		return {
			request: options.request,
			projects: options.projects.map((project) => ({
				project: project.name,
				variant: project.variant,
				record: { file: project.record, digest: FIXTURE_HASH },
				declarations: [],
				passed: Array.from(
					{ length: this.#script.passed?.[project.variant] ?? 1 },
					(_value, index) => `case ${String(index)}`,
				),
			})),
			entries: [],
			lookups: [],
			duration: 0,
		}
	}

	async check(selection: CaptureStaleOptions): Promise<CaptureCheckResult> {
		this.checks.push(selection)
		if (this.#script.checkFault !== undefined)
			throw new CaptureError(this.#script.checkFault, { code: 'EVIDENCE' })
		return {
			required: [],
			entries: (this.#script.statuses ?? ['current']).map((status, index) => ({
				file: `out/frames/${String(index)}.png`,
				state: 'inbox',
				variant: 'compact',
				status,
				reasons: [],
			})),
			warnings: [],
			duration: 0,
		}
	}

	async lookup(options: CaptureLookupOptions): Promise<CaptureLookupResult> {
		this.lookups.push(options)
		const scripted = this.#script.lookup
		if (scripted === undefined || 'fault' in scripted)
			throw new CaptureError(scripted?.fault ?? 'No lookup is scripted', { code: 'EVIDENCE' })
		return { case: scripted.case, entries: [], lookups: [] }
	}
}
