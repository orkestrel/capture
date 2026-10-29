import type {
	CaptureCollectionReceipt,
	CaptureDestination,
	CaptureDigest,
	CaptureFreshness,
	CaptureLookup,
	CaptureRegistry,
	CaptureRun,
	CaptureStamp,
	CaptureStatus,
	CaptureStoredManifest,
} from '@src/core'
import type {
	CaptureChangePlan,
	CaptureCheckOptions,
	CaptureCheckResult,
	CaptureCollectionEvidence,
	CaptureDirectoryResult,
	CaptureEvidence,
	CaptureFileSnapshot,
	CaptureHashHandler,
	CaptureIntegrityInterface,
	CaptureIntegrityOptions,
	CaptureLookupOptions,
	CaptureLookupResult,
	CaptureReadOptions,
	CaptureReadResult,
	CaptureSnapshot,
	CaptureStageOptions,
	CaptureStageResult,
	CaptureStaleOptions,
} from './types.js'
import { randomUUID } from 'node:crypto'
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { executeSync } from '@orkestrel/process/server'
import {
	CAPTURE_VERSION,
	CaptureError,
	collectCaptureChanges,
	collectCaptureDuplicates,
	describeCaptureDeclaration,
	describeCaptureDestination,
	describeCaptureError,
	describeCaptureIdentity,
	describeCaptureRequest,
	isCaptureError,
	isCaptureLookupJournal,
	isCapturePath,
	isCapturePattern,
	isCaptureRegistry,
	isCaptureRequest,
	isCaptureRun,
	isCaptureSegment,
	isCaptureSelector,
	isCaptureStoredManifest,
	matchesCaptureMembers,
	matchesCaptureSelector,
	readCaptureDirty,
	readCaptureReport,
	requireCaptureUnique,
	resolveCaptureKey,
	resolveCaptureOwner,
	resolveCaptureStatus,
	validateCaptureReceipt,
	validateCaptureRun,
} from '@src/core'
import {
	buildCaptureChangePlan,
	buildCaptureDigest,
	buildCaptureLookupJournal,
	computeCaptureHash,
	computeRegistryDigest,
	matchesCaptureSignature,
	normalizeSlashes,
	readCaptureLookups,
	readCaptureInputs,
	matchesCaptureFile,
	mergeCaptureLookups,
	readCaptureAncestor,
	resolveCapturePhysical,
	describeCaptureSelectorFault,
	describeCaptureFault,
	readCaptureImage,
	describeCaptureOutput,
} from './helpers.js'

/**
 * Validates capture transactions, freshness, and state lookup against real filesystem evidence.
 *
 * @remarks
 * The host supplies every product path, portfolio mapping, and source population; the engine
 * infers none of them from a name. Construct it through `createCaptureIntegrity`, or directly
 * with the same options.
 *
 * @example
 * ```ts
 * const integrity = new CaptureIntegrity({
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
export class CaptureIntegrity implements CaptureIntegrityInterface {
	readonly #options: CaptureIntegrityOptions
	readonly #root: string
	readonly #roots: ReadonlyMap<string, string>
	readonly #hash: CaptureHashHandler

	/**
	 * Binds the engine to an explicit workspace and host portfolio mapping.
	 *
	 * @param options - The workspace, evidence paths, authorized physical roots, and optional file hash
	 * @throws Thrown when the root is not absolute, a path escapes the root, or a portfolio is invalid.
	 */
	constructor(options: CaptureIntegrityOptions) {
		if (!isAbsolute(options.root))
			throw new CaptureError('Integrity root must be absolute', { code: 'HOST' })
		this.#root = realpathSync(options.root)
		this.#hash = options.hash ?? computeCaptureHash
		this.#options = {
			...options,
			inputs: [...options.inputs],
			portfolios: options.portfolios.map((entry) => ({ ...entry })),
		}
		if (options.inputs.length === 0 || !options.inputs.every(isCapturePattern))
			throw new CaptureError('Invalid bounded host inputs', { code: 'HOST' })
		for (const path of [options.directory, options.manifest, options.registry, options.lookups])
			this.#resolve(path)
		if (options.portfolios.length === 0)
			throw new CaptureError('Missing host portfolio roots', { code: 'HOST' })
		requireCaptureUnique(
			options.portfolios.map((entry) => entry.portfolio),
			'portfolio identities',
			true,
		)
		requireCaptureUnique(
			options.portfolios.map((entry) => entry.directory),
			'portfolio roots',
			true,
		)
		if (!options.portfolios.every((entry) => isCaptureSegment(entry.portfolio)))
			throw new CaptureError('Invalid portfolio identity', { code: 'HOST' })
		this.#roots = new Map(
			options.portfolios.map((entry) => [entry.directory, this.#resolve(entry.directory)] as const),
		)
		if (!this.#roots.has(options.directory))
			throw new CaptureError('Primary run directory has no authorized portfolio root', {
				code: 'HOST',
			})
		for (const entry of options.portfolios) this.#path(entry.directory)
	}

	/**
	 * Classifies changes since a Git merge-base through the accepted registry.
	 *
	 * @param ref - The Git ref whose merge-base with HEAD bounds tracked changes; HEAD selects uncommitted work
	 * @returns Every tracked or untracked changed path and the reduced owner selection
	 * @throws Thrown when Git refuses the ref or the accepted registry cannot be authenticated.
	 * @example
	 * ```ts
	 * const plan = integrity.changed('HEAD')
	 * ```
	 */
	changed(ref: string): CaptureChangePlan {
		const registry = this.#registry(new Map(), new Map())
		try {
			const commit = this.#git([
				'rev-parse',
				'--verify',
				'--end-of-options',
				`${ref}^{commit}`,
			]).trim()
			const base = this.#git(['merge-base', commit, 'HEAD']).trim()
			const tracked = this.#git(['diff', '--name-only', '--no-renames', '-z', base, '--'])
			const untracked = this.#git(['ls-files', '--others', '--exclude-standard', '-z'])
			return buildCaptureChangePlan(
				[tracked, untracked].flatMap((text) => text.split('\0').filter((path) => path !== '')),
				registry.entries,
			)
		} catch (error) {
			throw new CaptureError(describeCaptureError(error), { code: 'HOST', cause: error })
		}
	}

	/**
	 * Validates an executed stage before atomically publishing its authorized evidence.
	 *
	 * @param options - The exact stage and the runner-owned child execution callback
	 * @returns The committed stage evidence after every selected sibling validates
	 * @throws Thrown when execution, identity, records, reporter results, paths, inputs, registry
	 * evidence, projection, or atomic publication fails. Precommit failures preserve prior
	 * manifest bytes, and journey requests publish no image stamps.
	 *
	 * @example
	 * ```ts
	 * const result = await integrity.stamp(stage)
	 * ```
	 */
	async stamp(options: CaptureStageOptions): Promise<CaptureStageResult> {
		const request = options.request
		if (!isCaptureRequest(request))
			throw new CaptureError('Invalid capture stage request', { code: 'HOST' })
		requireCaptureUnique(request.variants, 'requested variants', true)
		requireCaptureUnique(
			options.projects.map((project) => project.name),
			'selected projects',
			true,
		)
		if (
			!matchesCaptureMembers(
				request.variants,
				options.projects.map((project) => project.variant),
			)
		)
			throw new CaptureError('Selected projects differ from requested variants', { code: 'HOST' })
		this.#path(request.config)
		this.#path(options.report)
		if (options.report !== this.#reportPath(request.args))
			throw new CaptureError('Reporter path differs from requested argv', { code: 'HOST' })
		for (const project of options.projects) {
			if (!matchesCaptureMembers(project.inputs, this.#options.inputs))
				throw new CaptureError('Project input population differs from host inputs', {
					code: 'HOST',
				})
			if (
				project.record !==
				`${this.#options.directory}/runs/${request.id}/${request.stage}/${project.variant}.json`
			)
				throw new CaptureError('Selected record path differs from stage identity', {
					code: 'HOST',
				})
			this.#path(project.record)
		}
		options.signal?.throwIfAborted()
		if (request.state !== undefined && request.case === undefined)
			throw new CaptureError('State request must name its resolved declaring case', {
				code: 'SELECTION',
			})
		const evidence = this.#evidence(new Map())
		this.#uniqueRegistry(evidence.registry.entries)
		const before = this.#snapshot(options)
		const outcome = await options.execute()
		const started = performance.now()
		options.signal?.throwIfAborted()
		if (outcome.code !== 0 || outcome.signal !== null)
			throw new CaptureError('Capture stage child did not exit successfully', {
				code: 'STAGE',
				context: { code: outcome.code, signal: outcome.signal },
			})
		// The record pass reads each file once; the final check below rereads disk with its own memo.
		const snapshots = new Map<string, CaptureFileSnapshot | undefined>()
		const digests = new Map<string, CaptureDigest>()
		const stable = new Map<string, true>()
		const reporter = this.#fresh(options.report, before, snapshots)
		const report = readCaptureReport(this.#json(options.report))
		if (report.start < before.time || report.end > Date.now())
			throw new CaptureError('Reporter does not belong to this execution', { code: 'EVIDENCE' })
		if (report.assertions.some((entry) => !request.variants.includes(entry.variant)))
			throw new CaptureError('Reporter contains an unrequested producing variant', {
				code: 'EVIDENCE',
			})
		const records = options.projects.map((project) => {
			const file = this.#fresh(project.record, before, snapshots)
			const run = this.#json(project.record)
			if (
				!isCaptureRun(run) ||
				run.request === undefined ||
				run.variant !== project.variant ||
				describeCaptureRequest(run.request) !== describeCaptureRequest(request)
			)
				throw new CaptureError(`Invalid or mismatched final record: ${project.record}`, {
					code: 'EVIDENCE',
				})
			if (Date.parse(run.time) < before.time || Date.parse(run.time) > report.end)
				throw new CaptureError('Final record time does not belong to this execution', {
					code: 'EVIDENCE',
				})
			validateCaptureRun(run, report, project.name)
			if (run.artifact === undefined)
				throw new CaptureError(`Final record names no journey artifact: ${project.record}`, {
					code: 'EVIDENCE',
				})
			const artifact = this.#fresh(run.artifact.file, before, snapshots)
			if (artifact.image.digest !== run.artifact.digest)
				throw new CaptureError(`Journey artifact differs from its record: ${run.artifact.file}`, {
					code: 'EVIDENCE',
				})
			for (const destination of run.registry) this.#destination(destination)
			const snapshot = before.projects.find((entry) => entry.project === project.name)
			if (snapshot === undefined)
				throw new CaptureError('Missing pre-execution project snapshot', { code: 'EVIDENCE' })
			this.#attest(run, evidence, snapshot.inputs.files, snapshots)
			for (const destination of run.registry)
				this.#stable(destination, snapshot.inputs, snapshots, digests, stable)
			return { file, run, artifact }
		})
		const entries = records.flatMap(({ run }) => run.entries)
		this.#uniqueRegistry(entries)
		const images = entries.map((entry) => this.#fresh(entry.file, before, snapshots, true))
		const identities = new Map<string, string>()
		const physical = Map.groupBy(this.#images(), (file) => this.#physicalIdentity(file, identities))
		if (
			entries.some(
				(entry) => (physical.get(this.#physicalIdentity(entry.file, identities))?.length ?? 0) > 1,
			)
		)
			throw new CaptureError('Duplicate physical capture output', { code: 'EVIDENCE' })
		const provenance = request.command === 'capture' ? this.#provenance() : undefined
		const stamps: readonly CaptureStamp[] = entries.map((entry) => {
			const image = images.find((snapshot) => snapshot.file === entry.file)
			if (image === undefined || provenance === undefined)
				throw new CaptureError('Missing capture provenance', { code: 'EVIDENCE' })
			return {
				...entry,
				identity: {
					id: request.id,
					stage: request.stage,
					pid: request.pid,
					config: request.config,
				},
				time: new Date().toISOString(),
				...provenance,
				own: this.#digest(entry.sources.own, snapshots, digests).files,
				shared: this.#digest(entry.sources.shared, snapshots, digests),
				tests: this.#digest(entry.sources.tests, snapshots, digests).files,
				image: image.image,
				registry: evidence.registry.digest,
			}
		})
		const lookups: readonly CaptureLookup[] = records.flatMap(({ run, file }) => {
			const project = options.projects.find((entry) => entry.variant === run.variant)
			if (project === undefined)
				throw new CaptureError('Missing selected project', { code: 'EVIDENCE' })
			const inputs = this.#digest(project.inputs, snapshots, digests).files
			return run.declarations
				.filter((entry) => run.passed.includes(entry.case))
				.map((entry) => ({
					registry: evidence.registry.digest,
					variant: run.variant,
					case: entry.case,
					owner: entry.owner,
					states: entry.states,
					inputs,
					run: { file: file.file, digest: file.image.digest },
				}))
		})
		const collected: readonly CaptureCollectionReceipt[] = records.map(({ run, file }) => {
			const project = options.projects.find((entry) => entry.variant === run.variant)
			const snapshot = before.projects.find((entry) => entry.project === project?.name)
			if (project === undefined || snapshot === undefined)
				throw new CaptureError('Missing full-collection input snapshot', { code: 'EVIDENCE' })
			return {
				registry: evidence.registry.digest,
				variant: run.variant,
				project: project.name,
				inputs: snapshot.inputs,
				run: { file: file.file, digest: file.image.digest },
				report: { file: reporter.file, digest: reporter.image.digest },
			}
		})
		const collections = this.#mergeCollections(evidence.collections, collected)
		const merged = mergeCaptureLookups(evidence.lookups, lookups)
		const finalSnapshots = new Map<string, CaptureFileSnapshot | undefined>()
		const redigests = new Map<string, CaptureDigest>()
		const restable = new Map<string, true>()
		for (const record of records) {
			const project = before.projects.find((entry) =>
				options.projects.some(
					(selected) => selected.name === entry.project && selected.variant === record.run.variant,
				),
			)
			if (project === undefined)
				throw new CaptureError('Missing final input snapshot', { code: 'EVIDENCE' })
			for (const destination of record.run.registry)
				this.#stable(destination, project.inputs, finalSnapshots, redigests, restable)
			if (
				this.#digest(project.inputs.patterns, finalSnapshots, redigests).digest !==
				project.inputs.digest
			)
				throw new CaptureError('Bounded host inputs or membership changed during execution', {
					code: 'STAGE',
				})
		}
		for (const path of [this.#options.manifest, this.#options.registry, this.#options.lookups]) {
			if (
				this.#file(path, finalSnapshots)?.image.digest !==
				before.files.find((file) => file.file === path)?.image.digest
			)
				throw new CaptureError(`Evidence changed during the stage: ${path}`, { code: 'STAGE' })
		}
		if (
			this.#file(options.report, finalSnapshots)?.image.digest !== reporter.image.digest ||
			records.some(
				(record) =>
					this.#file(record.file.file, finalSnapshots)?.image.digest !== record.file.image.digest ||
					this.#file(record.artifact.file, finalSnapshots)?.image.digest !==
						record.artifact.image.digest,
			) ||
			images.some((image) => !matchesCaptureFile(image, this.#file(image.file, finalSnapshots)))
		)
			throw new CaptureError('Stage output changed before commit', { code: 'STAGE' })
		options.signal?.throwIfAborted()
		if (request.command === 'capture' && stamps.length > 0) {
			const inherited = Object.entries(evidence.manifest?.entries ?? {})
			const replaced = new Set(stamps.map(resolveCaptureKey))
			const next: CaptureStoredManifest = {
				collections,
				version: CAPTURE_VERSION,
				registry: evidence.registry,
				entries: Object.fromEntries([
					...inherited.filter(([key]) => !replaced.has(key)),
					...stamps.map((stamp) => [resolveCaptureKey(stamp), stamp] as const),
				]),
				lookups: merged,
			}
			if (!isCaptureStoredManifest(next))
				throw new CaptureError('Invalid next manifest', { code: 'EVIDENCE' })
			this.#commit(this.#options.manifest, next, options.signal)
		} else if (request.command === 'journey' && collected.length > 0) {
			const manifest = before.files.find((file) => file.file === this.#options.manifest)?.image
				.digest
			this.#commit(
				this.#options.lookups,
				buildCaptureLookupJournal(merged, collections, manifest),
				options.signal,
			)
		}
		return {
			request,
			entries: stamps,
			lookups,
			duration: performance.now() - started,
			projects: records.map(({ run, file }) => ({
				project: options.projects.find((project) => project.variant === run.variant)?.name ?? '',
				variant: run.variant,
				record: { file: file.file, digest: file.image.digest },
				declarations: run.declarations,
				passed: run.passed,
			})),
		}
	}

	/**
	 * Reads current full-collection evidence and selects exact declaration destinations.
	 *
	 * @param options - The explicit selection; omitted variants derive from authenticated mappings
	 * @returns The accepted registry identity and exactly selected destinations
	 * @throws Thrown with explicit preparation when declarations lack current authenticated evidence.
	 *
	 * @example
	 * ```ts
	 * const { entries } = await integrity.read({ selector: 'pages:mail' })
	 * ```
	 */
	async read(options: CaptureReadOptions): Promise<CaptureReadResult> {
		try {
			const snapshots = new Map<string, CaptureFileSnapshot | undefined>()
			const digests = new Map<string, CaptureDigest>()
			const evidence = this.#evidence(snapshots)
			const collections = this.#collections(evidence, snapshots)
			const populated = this.#population(evidence, collections)
			const destinations = this.#destinations(populated)
			this.#uniqueRegistry(destinations)
			const variants = this.#variants(destinations, options)
			const entries = this.#select(populated, destinations, { ...options, variants }, false)
			const inputs = this.#digest(this.#options.inputs, snapshots, digests)
			for (const variant of new Set(entries.map((entry) => this.#producer(entry, populated)))) {
				const anchor = evidence.registry.receipts.find((receipt) => receipt.variant === variant)
				if (anchor !== undefined && collectCaptureChanges(anchor.inputs, inputs.files).length === 0)
					continue
				if (
					!collections.some(
						(entry) =>
							entry.run.variant === variant && entry.receipt.inputs.digest === inputs.digest,
					)
				)
					throw new CaptureError(
						`No current full-collection evidence for producing variant: ${variant}`,
						{ code: 'EVIDENCE', context: { variant } },
					)
			}
			// The final check rereads disk; the read's memo would hide a change made since it measured.
			if (this.#digest(this.#options.inputs, new Map(), new Map()).digest !== inputs.digest)
				throw new CaptureError('Declaration inputs changed during the read', { code: 'EVIDENCE' })
			return { registry: evidence.registry.digest, entries }
		} catch (error) {
			throw new CaptureError(
				`${describeCaptureError(error)}. Prepare the explicit complete-registry refresh, or an explicit capture-free owner/case run whose full collection equals that anchor for each affected producing variant; this read starts no process.`,
				{ code: isCaptureError(error) ? error.code : 'EVIDENCE', cause: error },
			)
		}
	}

	/**
	 * Checks the explicitly selected output population without changing evidence or images.
	 *
	 * @param selection - The selected owners, optional output variants, state, and portfolio, and
	 * the wrapper's declared producing variants. Default variants: every output variant of the
	 * selected registry destinations.
	 * @returns Freshness classifications and warnings for the selected population
	 * @throws Thrown when required evidence, schema, containment, or selection is invalid, or when
	 * variants are omitted and a declared producing variant has no registry evidence.
	 *
	 * @example
	 * ```ts
	 * const result = await integrity.check({ selector: 'pages:mail' })
	 * ```
	 */
	async check(selection: CaptureStaleOptions): Promise<CaptureCheckResult> {
		const started = performance.now()
		const snapshots = new Map<string, CaptureFileSnapshot | undefined>()
		const digests = new Map<string, CaptureDigest>()
		const previous = this.#evidence(snapshots)
		const evidence = this.#population(previous, this.#collections(previous, snapshots))
		// Destinations alone cannot show a producing variant whose full collection never arrived.
		const attested = new Set([
			...evidence.registry.receipts.map((receipt) => receipt.variant),
			...evidence.runs.map(({ run }) => run.variant),
		])
		const unattested =
			selection.variants === undefined
				? (selection.declared ?? []).filter((variant) => !attested.has(variant))
				: []
		if (unattested.length > 0)
			throw new CaptureError(`Unattested declared variant: ${unattested.join(', ')}`, {
				code: 'EVIDENCE',
				context: { variants: unattested },
			})
		const registry = this.#destinations(evidence)
		const options: CaptureCheckOptions = {
			...selection,
			variants: this.#variants(registry, selection),
		}
		const required = this.#select(evidence, registry, options, false)
		const disk = this.#images()
		const identities = new Map<string, string>()
		const physical = Map.groupBy(disk, (file) => this.#physicalIdentity(file, identities))
		const duplicates = collectCaptureDuplicates(registry.map(resolveCaptureKey), true)
		const entries: CaptureFreshness[] = required.map((entry) => {
			const key = resolveCaptureKey(entry)
			const stamp = evidence.manifest?.entries[key]
			const image = this.#file(entry.file, snapshots)
			const own = this.#digest(entry.sources.own, snapshots, digests)
			const shared = this.#digest(entry.sources.shared, snapshots, digests)
			const findings: Array<{ readonly status: CaptureStatus; readonly reason: string }> = []
			if (duplicates.includes(key))
				findings.push({ status: 'duplicate', reason: 'Repeated registry identity' })
			if ((physical.get(this.#physicalIdentity(entry.file, identities))?.length ?? 0) > 1)
				findings.push({ status: 'duplicate', reason: 'Several paths name the same physical image' })
			if (image === undefined)
				findings.push({ status: 'missing', reason: 'Required image is absent' })
			if (stamp === undefined)
				findings.push({ status: 'unstamped', reason: 'Required image has no authorized stamp' })
			else {
				if (stamp.file !== entry.file || resolveCaptureOwner(stamp) !== resolveCaptureOwner(entry))
					findings.push({
						status: 'orphan',
						reason: 'Stamp names an obsolete physical location or owner',
					})
				if (
					image !== undefined &&
					(image.image.digest !== stamp.image.digest ||
						image.image.size !== stamp.image.size ||
						image.image.modified !== stamp.image.modified)
				)
					findings.push({
						status: 'unstamped',
						reason: 'Image digest, size, or modification time differs',
					})
				if (
					!matchesCaptureMembers(stamp.sources.shared, entry.sources.shared) ||
					shared.digest !== stamp.shared.digest
				)
					findings.push({
						status: 'stale-shared',
						reason: 'Shared source patterns, membership, or hashes changed',
					})
				if (
					!matchesCaptureMembers(stamp.sources.own, entry.sources.own) ||
					collectCaptureChanges(stamp.own, own.files).length > 0 ||
					entry.sources.own.some(
						(pattern) => !Object.keys(own.files).some((file) => matchesGlob(file, pattern)),
					)
				)
					findings.push({
						status: 'stale-own',
						reason: 'Own source patterns, membership, or hashes changed',
					})
				if (
					stamp.case !== entry.case ||
					stamp.project !== entry.project ||
					stamp.portfolio !== entry.portfolio
				)
					findings.push({
						status: 'orphan',
						reason: 'Stamp declaring case, project, or portfolio is obsolete',
					})
			}
			return {
				file: entry.file,
				state: entry.state,
				variant: entry.variant,
				status: resolveCaptureStatus(findings.map((finding) => finding.status)),
				reasons: findings.map((finding) => finding.reason),
			}
		})
		const extras = disk
			.filter(
				(file) =>
					!required.some((entry) => entry.file === file) &&
					this.#attributable(file, required, registry, options),
			)
			.map((file) => {
				const name = file.slice(file.lastIndexOf('/') + 1, -4)
				const separator = name.lastIndexOf('--')
				return {
					file,
					state: separator < 0 ? name : name.slice(0, separator),
					variant: separator < 0 ? '' : name.slice(separator + 2),
					status: 'orphan' as const,
					reasons: ['Physical PNG has no selected canonical registry destination'],
				}
			})
		const warnings = required.flatMap((entry) => {
			const stamp = evidence.manifest?.entries[resolveCaptureKey(entry)]
			if (stamp === undefined) return []
			const files = collectCaptureChanges(
				stamp.tests,
				this.#digest(entry.sources.tests, snapshots, digests).files,
			)
			return files.length === 0 ? [] : [{ files, cases: [entry.case] }]
		})
		return {
			required,
			entries: [...entries, ...extras],
			warnings,
			duration: performance.now() - started,
		}
	}

	/**
	 * Resolves an explicitly requested state through fresh registry and passing case evidence.
	 *
	 * @param options - The original selector, producing variants, state, and optional exact case
	 * @returns The agreed declaring case, output mappings, and validated lookup receipts
	 * @throws Thrown when evidence is missing, stale, ambiguous, or disagrees with the selection;
	 * the message names the explicit refresh command.
	 *
	 * @example
	 * ```ts
	 * const { case: name } = await integrity.lookup({ selector: 'pages:mail', state: 'inbox', variants: ['light-390'] })
	 * ```
	 */
	async lookup(options: CaptureLookupOptions): Promise<CaptureLookupResult> {
		try {
			const snapshots = new Map<string, CaptureFileSnapshot | undefined>()
			const digests = new Map<string, CaptureDigest>()
			const evidence = this.#evidence(snapshots)
			const entries = this.#select(evidence, this.#destinations(evidence), options, true)
			this.#uniqueRegistry(entries)
			const cases = [...new Set(entries.map((entry) => entry.case))]
			const [name] = cases
			if (
				name === undefined ||
				cases.length !== 1 ||
				(options.case !== undefined && options.case !== name)
			)
				throw new CaptureError(
					'State declaring case disagrees with the exact case or producing variants',
					{ code: 'SELECTION' },
				)
			const lookups = entries.map((entry) => {
				const run = evidence.runs.find((record) =>
					record.run.registry.some(
						(destination) =>
							describeCaptureDestination(destination) === describeCaptureDestination(entry),
					),
				)
				const lookup = evidence.lookups.find(
					(candidate) =>
						candidate.case === entry.case &&
						candidate.variant === run?.run.variant &&
						candidate.states.includes(options.state),
				)
				if (
					lookup === undefined ||
					lookup.registry !== evidence.registry.digest ||
					!matchesCaptureSelector(lookup.owner, options.selector) ||
					collectCaptureChanges(
						lookup.inputs,
						this.#digest(this.#options.inputs, snapshots, digests).files,
					).length > 0
				)
					throw new CaptureError(
						`Missing or stale state lookup: ${entry.state} in ${entry.project}`,
						{
							code: 'EVIDENCE',
						},
					)
				const stamp = evidence.manifest?.entries[resolveCaptureKey(entry)]
				if (
					stamp !== undefined &&
					describeCaptureIdentity(stamp) !== describeCaptureIdentity(entry)
				)
					throw new CaptureError('State lookup disagrees with the manifest identity', {
						code: 'EVIDENCE',
					})
				return lookup
			})
			return { case: name, entries, lookups }
		} catch (error) {
			throw new CaptureError(
				`${describeCaptureError(error)}. Refresh explicitly with: capture journey ${options.selector}${options.variants.map((variant) => ` --variant ${variant}`).join('')}${options.case === undefined ? '' : ` --case ${JSON.stringify(options.case)}`}. Registry declaration changes require the complete-registry refresh: capture registry.`,
				{ code: isCaptureError(error) ? error.code : 'EVIDENCE', cause: error },
			)
		}
	}

	// Omitted output variants mean every variant the selected registry destinations declare.
	#variants(
		destinations: readonly CaptureDestination[],
		options: CaptureReadOptions,
	): readonly string[] {
		return (
			options.variants ?? [
				...new Set(
					destinations
						.filter(
							(entry) =>
								matchesCaptureSelector(resolveCaptureOwner(entry), options.selector) &&
								(options.portfolio === undefined || entry.portfolio === options.portfolio),
						)
						.map((entry) => entry.variant),
				),
			]
		)
	}

	#mergeCollections(
		previous: readonly CaptureCollectionReceipt[],
		receipts: readonly CaptureCollectionReceipt[],
	): readonly CaptureCollectionReceipt[] {
		requireCaptureUnique(
			previous.map((entry) => entry.run.file),
			'inherited collection records',
			true,
		)
		requireCaptureUnique(
			receipts.map((entry) => entry.run.file),
			'incoming collection records',
			true,
		)
		const replaced = new Set(receipts.map((entry) => entry.run.file))
		const merged = [...previous.filter((entry) => !replaced.has(entry.run.file)), ...receipts]
		// Keep one lineage origin and the latest collection per producing variant.
		return merged.filter(
			(entry, index) =>
				merged.findIndex((candidate) => candidate.variant === entry.variant) === index ||
				merged.findLastIndex((candidate) => candidate.variant === entry.variant) === index,
		)
	}

	#collections(
		evidence: CaptureEvidence,
		snapshots: Map<string, CaptureFileSnapshot | undefined>,
	): readonly CaptureCollectionEvidence[] {
		const collections = evidence.collections.map((receipt) => {
			const file = this.#file(receipt.run.file, snapshots)
			const report = this.#file(receipt.report.file, snapshots)
			if (
				file === undefined ||
				report === undefined ||
				file.image.digest !== receipt.run.digest ||
				report.image.digest !== receipt.report.digest
			)
				throw new CaptureError(`Collection record or report bytes changed: ${receipt.variant}`, {
					code: 'EVIDENCE',
				})
			if (
				receipt.inputs.digest !==
				buildCaptureDigest(receipt.inputs.patterns, receipt.inputs.files).digest
			)
				throw new CaptureError('Invalid collection input digest', { code: 'EVIDENCE' })
			for (const path of Object.keys(receipt.inputs.files)) this.#path(path)
			const run = this.#json(receipt.run.file)
			if (
				!isCaptureRun(run) ||
				run.request === undefined ||
				run.variant !== receipt.variant ||
				receipt.run.file !==
					`${this.#options.directory}/runs/${run.request.id}/${run.request.stage}/${run.variant}.json` ||
				receipt.report.file !== this.#reportPath(run.request.args)
			)
				throw new CaptureError('Collection has no matching authorized runner record', {
					code: 'EVIDENCE',
				})
			validateCaptureRun(run, readCaptureReport(this.#json(receipt.report.file)), receipt.project)
			this.#uniqueRegistry(run.registry)
			for (const destination of run.registry) this.#destination(destination)
			return { receipt, file, run }
		})
		for (const collection of collections) {
			const anchor = evidence.registry.receipts.find(
				(receipt) => receipt.variant === collection.run.variant,
			)
			const baseline =
				anchor ??
				collections.find(
					(candidate) =>
						candidate.run.variant === collection.run.variant &&
						evidence.registry.receipts.some(
							(receipt) =>
								collectCaptureChanges(receipt.inputs, candidate.receipt.inputs.files).length === 0,
						),
				)?.run
			if (baseline === undefined)
				throw new CaptureError(
					`Collection has no complete-anchor provenance: ${collection.run.variant}`,
					{ code: 'EVIDENCE' },
				)
			if (
				!matchesCaptureMembers(
					baseline.declarations.map(describeCaptureDeclaration),
					collection.run.declarations.map(describeCaptureDeclaration),
				) ||
				!matchesCaptureMembers(
					baseline.registry.map(describeCaptureDestination),
					collection.run.registry.map(describeCaptureDestination),
				)
			)
				throw new CaptureError('Collection declarations differ from the complete anchor', {
					code: 'EVIDENCE',
				})
		}
		return collections
	}

	#population(
		evidence: CaptureEvidence,
		collections: readonly CaptureCollectionEvidence[],
	): CaptureEvidence {
		return { ...evidence, runs: collections.map(({ file, run }) => ({ file, run })) }
	}

	// A physical path resolves inside the integrity root, whatever its portfolio.
	#resolve(file: string): string {
		if (!isCapturePath(file))
			throw new CaptureError(`Invalid serialized path: ${file}`, { code: 'CONTAINMENT' })
		const path = resolve(this.#root, ...file.split('/'))
		this.#contained(path)
		const ancestor = readCaptureAncestor(path)
		this.#contained(realpathSync(ancestor))
		return path
	}

	// A path under a portfolio root also resolves inside that root's physical directory.
	#path(file: string, paths?: Map<string, string>): string {
		const known = paths?.get(file)
		if (known !== undefined) return known
		const path = this.#resolve(file)
		for (const [directory, authorized] of this.#roots) {
			if (file !== directory && !file.startsWith(`${directory}/`)) continue
			const suffix = relative(authorized, resolveCapturePhysical(path))
			if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`))
				throw new CaptureError(`Physical path resolves outside authorized capture root: ${file}`, {
					code: 'CONTAINMENT',
				})
		}
		paths?.set(file, path)
		return path
	}

	#contained(path: string): void {
		const suffix = relative(this.#root, path)
		if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`))
			throw new CaptureError(`Physical path resolves outside integrity root: ${path}`, {
				code: 'CONTAINMENT',
			})
	}

	// Reads each path once per pass; the pass owns the memo and discards it when it ends.
	#file(
		file: string,
		snapshots: Map<string, CaptureFileSnapshot | undefined>,
		paths?: Map<string, string>,
	): CaptureFileSnapshot | undefined {
		if (snapshots.has(file)) return snapshots.get(file)
		const snapshot = this.#readFile(file, paths)
		snapshots.set(file, snapshot)
		return snapshot
	}

	#readFile(file: string, paths?: Map<string, string>): CaptureFileSnapshot | undefined {
		const path = this.#path(file, paths)
		if (!existsSync(path)) return undefined
		const stat = statSync(path)
		if (!stat.isFile())
			throw new CaptureError(`Expected a physical file: ${file}`, { code: 'CONTAINMENT' })
		return {
			file,
			image: {
				digest: this.#hash(
					file.toLowerCase().endsWith('.png') ? readCaptureImage(path) : readFileSync(path),
				),
				size: stat.size,
				modified: stat.mtimeMs,
			},
			changed: stat.ctimeMs,
		}
	}

	#json(file: string, paths?: Map<string, string>): unknown {
		const document: unknown = parseJSON(readFileSync(this.#path(file, paths), 'utf8'))
		if (!isRecord(document))
			throw new CaptureError(`Invalid JSON document: ${file}`, { code: 'EVIDENCE' })
		return document
	}

	// Expands each pattern list once per pass; the digest sorts its patterns, so sorted lists share a key.
	#digest(
		patterns: readonly string[],
		snapshots: Map<string, CaptureFileSnapshot | undefined>,
		digests: Map<string, CaptureDigest>,
	): CaptureDigest {
		if (!patterns.every(isCapturePattern))
			throw new CaptureError('Invalid source attribution pattern', { code: 'HOST' })
		requireCaptureUnique(patterns, 'source patterns', true)
		const key = JSON.stringify(patterns.toSorted())
		const known = digests.get(key)
		if (known !== undefined) return known
		const digest = buildCaptureDigest(
			patterns,
			readCaptureInputs(
				this.#root,
				patterns,
				this.#hash,
				(file) => this.#file(file, snapshots)?.image.digest,
			),
		)
		digests.set(key, digest)
		return digest
	}

	#images(): readonly string[] {
		const pending: CaptureDirectoryResult[] = this.#options.portfolios.map((entry) => ({
			directory: entry.directory,
			ancestors: [],
		}))
		const files: string[] = []
		for (const result of pending) {
			const directory = result.directory
			const path = this.#path(directory)
			if (!existsSync(path)) continue
			const physical = realpathSync(path)
			if (result.ancestors.includes(physical))
				throw new CaptureError('Cyclic portfolio directory alias', { code: 'CONTAINMENT' })
			const entries = readdirSync(path)
			requireCaptureUnique(entries, 'physical path spellings', true)
			for (const name of entries) {
				const file = `${directory}/${name}`
				const target = this.#path(file)
				if (statSync(target).isDirectory())
					pending.push({ directory: file, ancestors: [...result.ancestors, physical] })
				else if (name.toLowerCase().endsWith('.png')) files.push(file)
			}
		}
		return files.toSorted()
	}

	#snapshot(options: CaptureStageOptions): CaptureSnapshot {
		const files = [
			...new Set([
				...this.#images(),
				options.report,
				...options.projects.map((project) => project.record),
				this.#options.manifest,
				this.#options.registry,
				this.#options.lookups,
			]),
		]
		const snapshots = new Map<string, CaptureFileSnapshot | undefined>()
		const digests = new Map<string, CaptureDigest>()
		return {
			time: Date.now(),
			projects: options.projects.map((project) => {
				if (project.inputs.length === 0)
					throw new CaptureError('Missing bounded host input population', { code: 'HOST' })
				return { project: project.name, inputs: this.#digest(project.inputs, snapshots, digests) }
			}),
			files: files.flatMap((file) => {
				const snapshot = this.#file(file, snapshots)
				return snapshot === undefined ? [] : [snapshot]
			}),
		}
	}

	#fresh(
		file: string,
		before: CaptureSnapshot,
		snapshots: Map<string, CaptureFileSnapshot | undefined>,
		image = false,
	): CaptureFileSnapshot {
		const current = this.#file(file, snapshots)
		const previous = before.files.find((entry) => entry.file === file)
		if (
			current === undefined ||
			current.image.modified < before.time ||
			current.changed < before.time ||
			(previous !== undefined && matchesCaptureFile(previous, current))
		)
			throw new CaptureError(`Missing or stale execution output: ${file}`, { code: 'STAGE' })
		if (image && !matchesCaptureSignature(readCaptureImage(this.#path(file))))
			throw new CaptureError(`Capture output is not a PNG: ${file}`, { code: 'EVIDENCE' })
		return current
	}

	#stable(
		entry: CaptureDestination,
		before: CaptureDigest,
		snapshots: Map<string, CaptureFileSnapshot | undefined>,
		digests: Map<string, CaptureDigest>,
		stable: Map<string, true>,
	): void {
		const key = JSON.stringify([
			before.digest,
			entry.sources.own.toSorted(),
			entry.sources.shared.toSorted(),
			entry.sources.tests.toSorted(),
		])
		if (stable.has(key)) return
		for (const patterns of [entry.sources.own, entry.sources.shared, entry.sources.tests]) {
			const current = this.#digest(patterns, snapshots, digests)
			if (Object.keys(current.files).some((file) => before.files[file] === undefined))
				throw new CaptureError(
					`Attribution outside the predeclared host population: ${entry.file}`,
					{ code: 'STAGE' },
				)
			const previous = Object.fromEntries(
				Object.entries(before.files).filter(([file]) =>
					patterns.some((pattern) => matchesGlob(file, pattern)),
				),
			)
			if (collectCaptureChanges(previous, current.files).length > 0)
				throw new CaptureError(
					`Attributed inputs or membership changed during execution: ${entry.file}`,
					{ code: 'STAGE' },
				)
			if (
				patterns.some(
					(pattern) => !Object.keys(current.files).some((file) => matchesGlob(file, pattern)),
				)
			)
				throw new CaptureError(`Declared source pattern has no files: ${entry.file}`, {
					code: 'HOST',
				})
		}
		stable.set(key, true)
	}

	#destination(entry: CaptureDestination, paths?: Map<string, string>): void {
		const portfolio = this.#options.portfolios.find(
			(candidate) => candidate.portfolio === entry.portfolio,
		)
		if (portfolio === undefined)
			throw new CaptureError(`Unknown portfolio: ${entry.portfolio}`, { code: 'SELECTION' })
		const expected = `${portfolio.directory}/${portfolio.scoped ? `${entry.scope}/` : ''}${entry.state}--${entry.variant}.png`
		if (entry.file !== expected)
			throw new CaptureError(`Noncanonical physical destination: ${entry.file}`, {
				code: 'EVIDENCE',
			})
		this.#path(entry.file, paths)
	}

	#uniqueRegistry(entries: readonly CaptureDestination[]): void {
		requireCaptureUnique(entries.map(resolveCaptureKey), 'registry identities', true)
		requireCaptureUnique(
			entries.map((entry) => entry.file),
			'registry paths',
			true,
		)
	}

	#registry(
		snapshots: Map<string, CaptureFileSnapshot | undefined>,
		paths: Map<string, string>,
	): CaptureRegistry {
		if (!existsSync(this.#path(this.#options.registry, paths)))
			throw new CaptureError(
				'Missing accepted registry; run the explicit complete-registry refresh',
				{
					code: 'EVIDENCE',
				},
			)
		const registry = this.#json(this.#options.registry, paths)
		if (
			!isCaptureRegistry(registry) ||
			registry.digest !== computeRegistryDigest(registry) ||
			registry.receipts.length === 0
		)
			throw new CaptureError('Invalid accepted registry schema or digest', { code: 'EVIDENCE' })
		requireCaptureUnique(
			registry.receipts.map((receipt) => receipt.variant),
			'complete receipt variants',
			true,
		)
		for (const receipt of registry.receipts) {
			const report = this.#file(receipt.report.file, snapshots, paths)
			if (!receipt.complete || report?.image.digest !== receipt.report.digest)
				throw new CaptureError('Registry receipt is incomplete or its report changed', {
					code: 'EVIDENCE',
				})
			validateCaptureReceipt(receipt, readCaptureReport(this.#json(receipt.report.file, paths)))
			for (const path of Object.keys(receipt.inputs)) this.#path(path, paths)
			requireCaptureUnique(Object.keys(receipt.inputs), 'receipt input paths', true)
		}
		if (
			!matchesCaptureMembers(
				registry.entries.map(describeCaptureDestination),
				registry.receipts.flatMap((receipt) => receipt.registry.map(describeCaptureDestination)),
			)
		)
			throw new CaptureError('Registry entries differ from complete receipts', { code: 'EVIDENCE' })
		for (const entry of registry.entries) this.#destination(entry, paths)
		return registry
	}

	#evidence(snapshots: Map<string, CaptureFileSnapshot | undefined>): CaptureEvidence {
		const paths = new Map<string, string>()
		const registry = this.#registry(snapshots, paths)
		const manifest = existsSync(this.#path(this.#options.manifest, paths))
			? this.#json(this.#options.manifest, paths)
			: undefined
		if (manifest !== undefined && !isCaptureStoredManifest(manifest))
			throw new CaptureError('Invalid inherited manifest schema', { code: 'EVIDENCE' })
		if (manifest !== undefined) {
			requireCaptureUnique(Object.keys(manifest.entries), 'manifest keys', true)
			if (manifest.registry.digest !== computeRegistryDigest(manifest.registry))
				throw new CaptureError('Invalid inherited registry digest', { code: 'EVIDENCE' })
			for (const [key, stamp] of Object.entries(manifest.entries)) {
				if (key !== resolveCaptureKey(stamp))
					throw new CaptureError('Manifest key differs from stamp identity', { code: 'EVIDENCE' })
				if (
					stamp.shared.digest !==
						buildCaptureDigest(stamp.shared.patterns, stamp.shared.files).digest ||
					!matchesCaptureMembers(stamp.shared.patterns, stamp.sources.shared)
				)
					throw new CaptureError('Invalid inherited shared digest', { code: 'EVIDENCE' })
				this.#path(stamp.file, paths)
				for (const path of [
					...Object.keys(stamp.own),
					...Object.keys(stamp.shared.files),
					...Object.keys(stamp.tests),
				])
					this.#path(path, paths)
			}
		}
		const separate: unknown = existsSync(this.#path(this.#options.lookups, paths))
			? this.#json(this.#options.lookups, paths)
			: undefined
		if (separate !== undefined && !isCaptureLookupJournal(separate))
			throw new CaptureError('Invalid separate lookup schema', { code: 'EVIDENCE' })
		const manifestDigest = this.#file(this.#options.manifest, snapshots, paths)?.image.digest
		const current =
			separate !== undefined && separate.manifest === manifestDigest
				? readCaptureLookups(separate)
				: []
		const lookups = mergeCaptureLookups(manifest?.lookups ?? [], current).filter(
			(entry) => entry.registry === registry.digest,
		)
		const populations = new Map<Readonly<Record<string, string>>, true>()
		const references = Map.groupBy(lookups, (entry) => entry.run.file)
		const runs = [...references].map(([file, referenced]) => {
			const snapshot = this.#file(file, snapshots, paths)
			if (
				snapshot === undefined ||
				referenced.some((entry) => entry.run.digest !== snapshot.image.digest)
			)
				throw new CaptureError(`Lookup run record is missing or changed: ${file}`, {
					code: 'EVIDENCE',
				})
			const run = this.#json(file, paths)
			if (
				!isCaptureRun(run) ||
				run.request === undefined ||
				file !==
					`${this.#options.directory}/runs/${run.request.id}/${run.request.stage}/${run.variant}.json`
			)
				throw new CaptureError('Lookup has no authorized runner record', { code: 'EVIDENCE' })
			const projects = [...new Set(run.registry.map((entry) => entry.project))]
			if (projects.length > 1)
				throw new CaptureError('Lookup record mixes producing projects', { code: 'EVIDENCE' })
			validateCaptureRun(
				run,
				readCaptureReport(this.#json(this.#reportPath(run.request.args, paths), paths)),
				projects[0] ?? '',
			)
			const anchor = registry.receipts.find((entry) => entry.variant === run.variant)
			if (
				anchor !== undefined &&
				(!matchesCaptureMembers(
					anchor.declarations.map(describeCaptureDeclaration),
					run.declarations.map(describeCaptureDeclaration),
				) ||
					!matchesCaptureMembers(
						anchor.registry.map(describeCaptureDestination),
						run.registry.map(describeCaptureDestination),
					))
			)
				throw new CaptureError('Lookup declarations disagree with the accepted registry', {
					code: 'EVIDENCE',
				})
			const declarations = new Map(run.declarations.map((entry) => [entry.case, entry]))
			const passed = new Set(run.passed)
			for (const entry of referenced) {
				const declaration = declarations.get(entry.case)
				if (
					declaration === undefined ||
					declaration.owner !== entry.owner ||
					run.variant !== entry.variant ||
					!passed.has(entry.case) ||
					!matchesCaptureMembers(declaration.states, entry.states)
				)
					throw new CaptureError('Lookup differs from its passing declaration', {
						code: 'EVIDENCE',
					})
				if (!populations.has(entry.inputs)) {
					for (const path of Object.keys(entry.inputs)) this.#path(path, paths)
					populations.set(entry.inputs, true)
				}
			}
			for (const destination of run.registry) this.#destination(destination, paths)
			return { file: snapshot, run }
		})
		const collections = this.#mergeCollections(
			(manifest?.collections ?? []).filter((entry) => entry.registry === registry.digest),
			(separate?.manifest === manifestDigest ? (separate?.collections ?? []) : []).filter(
				(entry) => entry.registry === registry.digest,
			),
		)
		return { registry, ...(manifest === undefined ? {} : { manifest }), lookups, runs, collections }
	}

	#attest(
		run: CaptureRun,
		evidence: CaptureEvidence,
		inputs: Readonly<Record<string, string>>,
		snapshots: Map<string, CaptureFileSnapshot | undefined>,
	): void {
		const receipt = evidence.registry.receipts.find((entry) => entry.variant === run.variant)
		const previous =
			evidence.runs.find((entry) => entry.run.variant === run.variant)?.run ??
			this.#collections(evidence, snapshots).find((entry) => entry.run.variant === run.variant)?.run
		const declarations = receipt?.declarations ?? previous?.declarations
		const registry = receipt?.registry ?? previous?.registry
		if (declarations !== undefined && registry !== undefined) {
			if (
				!matchesCaptureMembers(
					declarations.map(describeCaptureDeclaration),
					run.declarations.map(describeCaptureDeclaration),
				) ||
				!matchesCaptureMembers(
					registry.map(describeCaptureDestination),
					run.registry.map(describeCaptureDestination),
				)
			)
				throw new CaptureError(
					'Collected registry declarations changed; run the explicit complete-registry refresh',
					{ code: 'EVIDENCE' },
				)
		} else if (
			!evidence.registry.receipts.some(
				(entry) => collectCaptureChanges(entry.inputs, inputs).length === 0,
			)
		) {
			throw new CaptureError(
				'Unattested producing variant; run the explicit complete-registry refresh before its owner lookup refresh',
				{ code: 'EVIDENCE', context: { variant: run.variant } },
			)
		}
	}

	#destinations(evidence: CaptureEvidence): readonly CaptureDestination[] {
		const anchored = new Set(evidence.registry.receipts.map((entry) => entry.variant))
		const variants = [...new Set(evidence.runs.map((entry) => entry.run.variant))].filter(
			(variant) => !anchored.has(variant),
		)
		return [
			...evidence.registry.entries,
			...variants.flatMap((variant) => {
				const runs = evidence.runs.filter((entry) => entry.run.variant === variant)
				const [first] = runs
				if (first === undefined) return []
				for (const entry of runs) {
					if (
						!matchesCaptureMembers(
							first.run.registry.map(describeCaptureDestination),
							entry.run.registry.map(describeCaptureDestination),
						)
					)
						throw new CaptureError('Scoped registry attestations disagree', { code: 'EVIDENCE' })
				}
				return first.run.registry
			}),
		]
	}

	#select(
		evidence: CaptureEvidence,
		entries: readonly CaptureDestination[],
		options: CaptureCheckOptions | CaptureLookupOptions,
		attributed: boolean,
	): readonly CaptureDestination[] {
		const selectors = [
			...new Set(
				entries.flatMap((entry) => {
					const parts = resolveCaptureOwner(entry).split(':')
					return parts.map((_part, index) => parts.slice(0, index + 1).join(':'))
				}),
			),
		]
		const fault = describeCaptureSelectorFault(options.selector, selectors)
		if (fault !== undefined) throw new CaptureError(fault, { code: 'USAGE' })
		if (
			options.portfolio !== undefined &&
			!this.#options.portfolios.some((entry) => entry.portfolio === options.portfolio)
		)
			throw new CaptureError(
				`Unknown portfolio; ${describeCaptureFault(
					'selection.portfolio',
					options.portfolio,
					'an authorized portfolio',
					this.#options.portfolios.map((entry) => entry.portfolio),
				)}`,
				{ code: 'USAGE' },
			)
		if (
			!isCaptureSelector(options.selector) ||
			!options.variants.every(isCaptureSegment) ||
			(options.state !== undefined && !isCaptureSegment(options.state)) ||
			(options.case !== undefined && options.case.trim() === '')
		)
			throw new CaptureError(
				`Invalid capture selection; ${describeCaptureFault('selection', options, 'portable variants and state, a nonempty case, and an authorized portfolio; valid values come from the selected registry destinations', ['selector', 'variants', 'state', 'case', 'portfolio'], ['selector', 'variants'], ['selector', 'variants', 'state', 'case', 'portfolio'])}; ${describeCaptureFault(
					'selection.portfolio',
					options.portfolio,
					'an authorized portfolio when supplied',
					this.#options.portfolios.map((entry) => entry.portfolio),
				)}`,
				{ code: 'USAGE' },
			)
		requireCaptureUnique(options.variants, 'selected variants', true)
		const scoped = entries.filter(
			(entry) =>
				matchesCaptureSelector(resolveCaptureOwner(entry), options.selector) &&
				(options.portfolio === undefined || entry.portfolio === options.portfolio),
		)
		if (scoped.length === 0)
			throw new CaptureError(
				`Empty selector; ${describeCaptureFault('selector', options.selector, 'a declared selector with destinations in the selected portfolio', ['all', ...selectors])}`,
				{
					code: 'USAGE',
				},
			)
		// An omitted variant list derives from the scoped destinations, so an unknown selector reads as
		// that before an empty list reads as an invalid one.
		if (options.variants.length === 0)
			throw new CaptureError(
				`Invalid capture selection; ${describeCaptureFault('selection.variants', options.variants, 'a nonempty selected variant list', [...new Set(scoped.map((entry) => entry.variant))])}`,
				{ code: 'USAGE' },
			)
		const variants = [
			...new Set(
				attributed
					? entries.map((entry) => this.#producer(entry, evidence))
					: entries.map((entry) => entry.variant),
			),
		]
		const unknown = options.variants.find((variant) => !variants.includes(variant))
		if (unknown !== undefined)
			throw new CaptureError(
				`Unknown or unattested selected variant; ${describeCaptureFault('selection.variants', unknown, 'an attested registry variant', variants)}`,
				{ code: 'USAGE' },
			)
		const selected = scoped.filter(
			(entry) =>
				options.variants.includes(attributed ? this.#producer(entry, evidence) : entry.variant) &&
				(options.state === undefined || entry.state === options.state) &&
				(options.case === undefined || entry.case === options.case),
		)
		if (selected.length === 0)
			throw new CaptureError(
				`Empty selection or state outside selector/case; ${describeCaptureFault('selection.state', options.state, 'a state in the selected selector/case', [...new Set(scoped.map((entry) => entry.state))])}; ${describeCaptureFault('selection.case', options.case, 'a case in the selected selector', [...new Set(scoped.map((entry) => entry.case))])}`,
				{
					code: 'USAGE',
				},
			)
		return selected
	}

	#producer(destination: CaptureDestination, evidence: CaptureEvidence): string {
		const sources = [...evidence.registry.receipts, ...evidence.runs.map((entry) => entry.run)]
		const variants = [
			...new Set(
				sources
					.filter((source) =>
						source.registry.some(
							(entry) =>
								describeCaptureDestination(entry) === describeCaptureDestination(destination),
						),
					)
					.map((source) => source.variant),
			),
		]
		if (variants.length !== 1 || variants[0] === undefined)
			throw new CaptureError('Destination has no unique producing variant', { code: 'EVIDENCE' })
		return variants[0]
	}

	#reportPath(args: readonly string[], paths?: Map<string, string>): string {
		const outputs = args.filter((argument) => argument.startsWith('--outputFile.json='))
		if (outputs.length !== 1 || outputs[0] === undefined)
			throw new CaptureError('Request has no unique JSON reporter path', { code: 'HOST' })
		const file: string = normalizeSlashes(
			relative(this.#root, resolve(this.#root, outputs[0].slice('--outputFile.json='.length))),
		)
		this.#path(file, paths)
		return file
	}

	#physicalIdentity(file: string, identities: Map<string, string>): string {
		const known = identities.get(file)
		if (known !== undefined) return known
		const path = this.#path(file)
		if (!existsSync(path)) {
			identities.set(file, path)
			return path
		}
		// Native file identifiers can exceed the exact integer range of a Number.
		const stat = statSync(path, { bigint: true })
		const identity = stat.ino === 0n ? realpathSync(path) : `${stat.dev}:${stat.ino}`
		identities.set(file, identity)
		return identity
	}

	#attributable(
		file: string,
		selected: readonly CaptureDestination[],
		registry: readonly CaptureDestination[],
		options: CaptureCheckOptions,
	): boolean {
		if (
			options.portfolio !== undefined &&
			!this.#options.portfolios.some(
				(entry) => entry.portfolio === options.portfolio && file.startsWith(`${entry.directory}/`),
			)
		)
			return false
		if (registry.some((entry) => entry.file === file)) return false
		const name = file.slice(file.lastIndexOf('/') + 1)
		if (selected.some((entry) => name === `${entry.state}--${entry.variant}.png`)) return true
		if (options.state !== undefined || options.case !== undefined) return false
		if (!options.variants.some((variant) => name.endsWith(`--${variant}.png`))) return false
		if (options.selector === 'all') return true
		return selected.some((entry) => {
			const portfolio = this.#options.portfolios.find(
				(candidate) => candidate.portfolio === entry.portfolio,
			)
			return (
				portfolio !== undefined &&
				options.selector === entry.scope &&
				file.startsWith(`${portfolio.directory}/${portfolio.scoped ? `${entry.scope}/` : ''}`)
			)
		})
	}

	// Runs one Git read in the workspace; a synchronous read of provenance starts no supervised child.
	#git(args: readonly string[]): string {
		const result = executeSync(
			{ file: 'git', arguments: args },
			{ workspace: this.#root, timeout: 30_000, limit: 64 * 1024 * 1024, strict: false },
		)
		if (result.failed || result.truncated)
			throw new CaptureError(
				`Git read failed${result.expired ? ' (deadline expired)' : ''}${result.truncated ? ' (output truncated)' : ''}: ${describeCaptureOutput(result.stderr.trim() || String(result.code ?? result.signal))}`,
				{ code: 'HOST' },
			)
		return result.stdout
	}

	#provenance(): { readonly commit: string; readonly dirty: readonly string[] } {
		const root = this.#git(['rev-parse', '--show-toplevel']).trim()
		if (realpathSync(root) !== this.#root)
			throw new CaptureError('Integrity root differs from the Git workspace root', {
				code: 'HOST',
			})
		const commit = this.#git(['rev-parse', 'HEAD']).trim()
		const dirty = readCaptureDirty(
			this.#git(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
		)
		if (!/^[a-f0-9]{40,64}$/u.test(commit) || !dirty.every(isCapturePath))
			throw new CaptureError('Invalid Git provenance', { code: 'EVIDENCE' })
		return { commit, dirty }
	}

	#commit(file: string, value: unknown, signal?: AbortSignal): void {
		const target = this.#path(file)
		mkdirSync(dirname(target), { recursive: true })
		this.#path(file)
		const temporary = `${file}.${randomUUID()}.tmp`
		const path = this.#path(temporary)
		try {
			writeFileSync(path, `${JSON.stringify(value)}\n`, { flag: 'wx', flush: true })
			signal?.throwIfAborted()
			this.#path(file)
			this.#path(temporary)
			renameSync(path, target)
		} finally {
			if (existsSync(path)) rmSync(path)
		}
	}
}
