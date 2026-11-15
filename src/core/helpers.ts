import type {
	CaptureArtifactLines,
	CaptureAssertion,
	CaptureCase,
	CaptureDeclaration,
	CaptureDestination,
	CaptureDestinationOptions,
	CaptureEntry,
	CaptureLookup,
	CaptureReceipt,
	CaptureReport,
	CaptureRequest,
	CaptureRules,
	CaptureRun,
	CaptureRunOptions,
	CaptureSelection,
	CaptureStatus,
	CaptureTask,
	CaptureTestInput,
	CaptureTestOptions,
} from './types.js'
import { arrayOf, isError, isFiniteNumber, isRecord, isString, preview } from '@orkestrel/contract'
import {
	CAPTURE_ARTIFACT_PREFIXES,
	CAPTURE_OWNER_PREFIX,
	CAPTURE_STATUS_PRECEDENCE,
	CAPTURE_VERSION,
} from './constants.js'
import { CaptureError } from './errors.js'
import { isCaptureDeclaration, isCapturePath, isCaptureSelector } from './validators.js'

/**
 * Describes a caught failure as one reportable line.
 *
 * @param error - The caught value, which need not be an `Error`
 * @returns The error's message, or the value's string form
 *
 * @example
 * ```ts
 * describeCaptureError(new Error('Unknown variant: phone')) // 'Unknown variant: phone'
 * describeCaptureError('refused') // 'refused'
 * ```
 */
export function describeCaptureError(error: unknown): string {
	return isError(error) ? error.message : String(error)
}

/**
 * Finds repeated identities before a keyed collection could discard them.
 *
 * @param values - The identity population
 * @param folded - If `true`, compares case-folded keys; if `false`, compares exact identities. Default: `false`
 * @returns Every member whose comparison key appears more than once
 *
 * @example
 * ```ts
 * collectCaptureDuplicates(['a', 'b', 'a']) // ['a', 'a']
 * collectCaptureDuplicates(['Pages', 'pages'], true) // ['Pages', 'pages']
 * ```
 */
export function collectCaptureDuplicates(
	values: readonly string[],
	folded = false,
): readonly string[] {
	const keys = values.map((value) => (folded ? value.toLowerCase() : value))
	return values.filter(
		(_value, index) => keys.indexOf(keys[index] ?? '') !== keys.lastIndexOf(keys[index] ?? ''),
	)
}

/**
 * Refuses duplicate declarations or portable storage-key collisions before indexing.
 *
 * @param values - The complete identity population
 * @param label - The diagnostic subject
 * @param folded - If `true`, refuses case-colliding keys; if `false`, requires exact uniqueness. Default: `false`
 * @throws Thrown as an `EVIDENCE` capture error when an identity repeats.
 *
 * @example
 * ```ts
 * requireCaptureUnique(['mail', 'files'], 'owners') // returns
 * requireCaptureUnique(['mail', 'mail'], 'owners') // throws 'Duplicate owners: mail, mail'
 * ```
 */
export function requireCaptureUnique(
	values: readonly string[],
	label: string,
	folded = false,
): void {
	const duplicates = collectCaptureDuplicates(values, folded)
	if (duplicates.length > 0)
		throw new CaptureError(`Duplicate ${label}: ${duplicates.join(', ')}`, {
			code: 'EVIDENCE',
			context: { label, duplicates },
		})
}

/**
 * Compares complete populations without erasing duplicates.
 *
 * @param left - The first population
 * @param right - The second population
 * @returns True if the sorted populations are equal; false otherwise
 *
 * @example
 * ```ts
 * matchesCaptureMembers(['b', 'a'], ['a', 'b']) // true
 * matchesCaptureMembers(['a', 'a'], ['a']) // false
 * ```
 */
export function matchesCaptureMembers(left: readonly string[], right: readonly string[]): boolean {
	const ordered = right.toSorted()
	return (
		left.length === right.length &&
		left.toSorted().every((entry, index) => entry === ordered[index])
	)
}

/**
 * Compares an owner with an explicit selector at colon boundaries.
 *
 * @param owner - The canonical owner
 * @param selector - The requested owner or the `all` selector
 * @returns True if the owner belongs to the selection; false otherwise
 *
 * @example
 * ```ts
 * matchesCaptureSelector('pages:mail', 'pages') // true
 * matchesCaptureSelector('pages:mailbox', 'pages:mail') // false
 * ```
 */
export function matchesCaptureSelector(owner: string, selector: string): boolean {
	return selector === 'all' || owner === selector || owner.startsWith(`${selector}:`)
}

/**
 * Builds the canonical owner from a destination's registry identity.
 *
 * @param entry - The destination
 * @returns The scope, part, and optional section selector
 *
 * @example
 * ```ts
 * resolveCaptureOwner({ ...destination, scope: 'pages', part: 'mail' }) // 'pages:mail'
 * ```
 */
export function resolveCaptureOwner(entry: CaptureDestination): string {
	return [entry.scope, entry.part, ...(entry.section === undefined ? [] : [entry.section])].join(
		':',
	)
}

/**
 * Builds a manifest identity independently of the physical image path.
 *
 * @param entry - The registry destination
 * @returns The scope-qualified state and output-variant key
 *
 * @example
 * ```ts
 * resolveCaptureKey({ ...destination, scope: 'pages', state: 'inbox', variant: 'light-390' })
 * // 'pages/inbox--light-390.png'
 * ```
 */
export function resolveCaptureKey(entry: CaptureDestination): string {
	return `${entry.scope}/${entry.state}--${entry.variant}.png`
}

/**
 * Serializes a destination's identity and attribution in a deterministic field order.
 *
 * @param entry - The destination
 * @returns The comparison representation, excluding image and duration readings
 *
 * @example
 * ```ts
 * describeCaptureDestination(destination) === describeCaptureDestination({ ...destination })
 * // true
 * ```
 */
export function describeCaptureDestination(entry: CaptureDestination): string {
	return JSON.stringify([
		entry.portfolio,
		entry.state,
		entry.scope,
		entry.part,
		entry.section,
		entry.variant,
		entry.project,
		entry.file,
		entry.case,
		entry.sources.own.toSorted(),
		entry.sources.shared.toSorted(),
		entry.sources.tests.toSorted(),
	])
}

/**
 * Serializes only the registry's execution and output identity, independent of input revisions.
 *
 * @param entry - The destination or inherited stamp
 * @returns The identity used for relevant manifest agreement during state resolution
 *
 * @example
 * ```ts
 * describeCaptureIdentity(destination) === describeCaptureIdentity({
 * 	...destination,
 * 	sources: { own: [], shared: [], tests: [] },
 * })
 * // true
 * ```
 */
export function describeCaptureIdentity(entry: CaptureDestination): string {
	return JSON.stringify([
		entry.portfolio,
		entry.state,
		entry.scope,
		entry.part,
		entry.section,
		entry.variant,
		entry.project,
		entry.file,
		entry.case,
	])
}

/**
 * Serializes a complete behavioral declaration without dropping eligibility or states.
 *
 * @param entry - The collected declaration
 * @returns The deterministic comparison representation
 *
 * @example
 * ```ts
 * describeCaptureDeclaration({ ...declaration, states: ['b', 'a'] }) ===
 * 	describeCaptureDeclaration({ ...declaration, states: ['a', 'b'] })
 * // true
 * ```
 */
export function describeCaptureDeclaration(entry: CaptureDeclaration): string {
	return JSON.stringify([
		entry.case,
		entry.owner,
		entry.variant,
		entry.eligible,
		entry.states.toSorted(),
	])
}

/**
 * Serializes every request field, retaining the exact argv order.
 *
 * @param request - The transported request
 * @returns The exact request comparison representation
 *
 * @example
 * ```ts
 * describeCaptureRequest(request) === describeCaptureRequest({ ...request, args: [] })
 * // false when the request carried argv
 * ```
 */
export function describeCaptureRequest(request: CaptureRequest): string {
	return JSON.stringify([
		request.version,
		request.id,
		request.stage,
		request.pid,
		request.config,
		request.command,
		request.mode,
		request.selector,
		request.case,
		request.state,
		request.variants,
		request.args,
	])
}

/**
 * Names every changed, added, or removed file in hash populations.
 *
 * @param previous - The retained file hashes
 * @param current - The observed file hashes
 * @returns The sorted changed membership
 *
 * @example
 * ```ts
 * collectCaptureChanges({ 'a.ts': 'x', 'b.ts': 'y' }, { 'a.ts': 'x', 'b.ts': 'z', 'c.ts': 'w' })
 * // ['b.ts', 'c.ts']
 * ```
 */
export function collectCaptureChanges(
	previous: Readonly<Record<string, string>>,
	current: Readonly<Record<string, string>>,
): readonly string[] {
	return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
		.filter((file) => previous[file] !== current[file])
		.toSorted()
}

/**
 * Builds the stable case identity used to merge separate lookup receipts.
 *
 * @param lookup - The lookup identity
 * @returns The producing variant and full case key
 *
 * @example
 * ```ts
 * resolveLookupKey({ variant: 'light-390', case: 'mail shows the inbox' })
 * // '["light-390","mail shows the inbox"]'
 * ```
 */
export function resolveLookupKey(lookup: Pick<CaptureLookup, 'variant' | 'case'>): string {
	return JSON.stringify([lookup.variant, lookup.case])
}

/**
 * Reads successful Vitest JSON output and validates every owner-bearing assertion.
 *
 * @param value - The parsed external reporter document
 * @returns A validated projection of the fields used by integrity
 * @throws Thrown as an `EVIDENCE` capture error for failed reporters, malformed assertions, or duplicate case identities.
 *
 * @example
 * ```ts
 * const report = readCaptureReport(parseJSON(text))
 * report.assertions.map((assertion) => assertion.case)
 * ```
 */
export function readCaptureReport(value: unknown): CaptureReport {
	if (
		!isRecord(value) ||
		value.success !== true ||
		value.numFailedTests !== 0 ||
		value.numFailedTestSuites !== 0 ||
		!isFiniteNumber(value.startTime) ||
		!arrayOf(isRecord)(value.testResults) ||
		value.testResults.length === 0
	)
		throw new CaptureError('Invalid or unsuccessful Vitest JSON report', { code: 'EVIDENCE' })
	const files = value.testResults.map((file) => {
		if (
			file.status !== 'passed' ||
			!isFiniteNumber(file.startTime) ||
			!isFiniteNumber(file.endTime) ||
			file.endTime < file.startTime ||
			!arrayOf(isRecord)(file.assertionResults)
		)
			throw new CaptureError('Invalid Vitest file report', { code: 'EVIDENCE' })
		return { start: file.startTime, end: file.endTime, assertions: file.assertionResults }
	})
	const assertions: readonly CaptureAssertion[] = files.flatMap((file) =>
		file.assertions.flatMap((assertion) => {
			if (!isRecord(assertion.meta))
				throw new CaptureError('Invalid Vitest assertion metadata', { code: 'EVIDENCE' })
			if (assertion.meta.owner === undefined) return []
			const declaration = {
				case: assertion.fullName,
				owner: assertion.meta.owner,
				variant: assertion.meta.variant,
				eligible: assertion.meta.eligible === undefined ? true : assertion.meta.eligible,
				states: assertion.meta.states === undefined ? [] : assertion.meta.states,
			}
			if (
				!isCaptureDeclaration(declaration) ||
				!isString(assertion.status) ||
				(assertion.duration !== undefined &&
					assertion.duration !== null &&
					(!isFiniteNumber(assertion.duration) || assertion.duration < 0))
			)
				throw new CaptureError('Invalid owner-bearing Vitest assertion', { code: 'EVIDENCE' })
			return [
				{
					...declaration,
					status: assertion.status,
					...(typeof assertion.duration === 'number' ? { duration: assertion.duration } : {}),
				},
			]
		}),
	)
	requireCaptureUnique(assertions.map(resolveLookupKey), 'reporter case identities')
	return {
		start: files.reduce((start, file) => Math.min(start, file.start), value.startTime),
		end: files.reduce((end, file) => Math.max(end, file.end), -Infinity),
		assertions,
	}
}

/**
 * Validates declaration, reporter, observation, completeness, and output-projection agreement.
 *
 * @param run - The final record
 * @param report - The validated external reporter
 * @param project - The actual producing project name
 * @throws Thrown as an `EVIDENCE` capture error when a record differs from the actual selected results or declarations.
 *
 * @example
 * ```ts
 * validateCaptureRun(run, readCaptureReport(parseJSON(text)), 'journey:light-390')
 * ```
 */
export function validateCaptureRun(run: CaptureRun, report: CaptureReport, project: string): void {
	const assertions = report.assertions.filter((entry) => entry.variant === run.variant)
	requireCaptureUnique(
		run.declarations.map((entry) => entry.case),
		'declaring cases',
	)
	requireCaptureUnique(
		run.declarations.flatMap((entry) => entry.states),
		'declared states',
		true,
	)
	requireCaptureUnique(run.registry.map(resolveCaptureKey), 'registry identities', true)
	requireCaptureUnique(
		run.registry.map((entry) => entry.file),
		'registry paths',
		true,
	)
	requireCaptureUnique(run.entries.map(resolveCaptureKey), 'emitted identities', true)
	requireCaptureUnique(run.passed, 'passed cases')
	requireCaptureUnique(run.observed, 'observed states', true)
	if (
		!matchesCaptureMembers(
			run.declarations.map(describeCaptureDeclaration),
			assertions.map(describeCaptureDeclaration),
		)
	)
		throw new CaptureError('Run declarations differ from full reporter declarations', {
			code: 'EVIDENCE',
		})
	const eligible = run.declarations.filter((entry) => entry.eligible)
	const passed = assertions.filter((entry) => entry.eligible && entry.status === 'passed')
	if (
		!matchesCaptureMembers(
			run.passed,
			passed.map((entry) => entry.case),
		)
	)
		throw new CaptureError('Run passed cases differ from reporter results', { code: 'EVIDENCE' })
	if (
		!matchesCaptureMembers(
			run.observed,
			passed.flatMap((entry) => entry.states),
		)
	)
		throw new CaptureError('Run observations differ from full passed declarations', {
			code: 'EVIDENCE',
		})
	if (run.complete !== (eligible.length > 0 && eligible.length === passed.length))
		throw new CaptureError('Run completeness differs from eligible results', { code: 'EVIDENCE' })
	for (const declaration of eligible) {
		const destinations = run.registry.filter((entry) => entry.case === declaration.case)
		if (
			!matchesCaptureMembers(
				destinations.map((entry) => entry.state),
				declaration.states,
			) ||
			destinations.some(
				(entry) =>
					entry.project !== project ||
					!matchesCaptureSelector(resolveCaptureOwner(entry), declaration.owner),
			)
		)
			throw new CaptureError(`Registry differs from eligible declaration: ${declaration.case}`, {
				code: 'EVIDENCE',
			})
	}
	if (
		run.registry.some((entry) => !eligible.some((declaration) => declaration.case === entry.case))
	)
		throw new CaptureError('Registry contains an ineligible or undeclared case', {
			code: 'EVIDENCE',
		})
	const reference = run.registry.filter((entry) => entry.section === entry.state)
	if (
		run.reference !==
		(reference.length > 0 && reference.every((entry) => run.passed.includes(entry.case)))
	)
		throw new CaptureError('Reference completeness differs from declaring section results', {
			code: 'EVIDENCE',
		})
	const request = run.request
	if (request !== undefined) {
		if (
			run.identity === undefined ||
			run.identity.id !== request.id ||
			run.identity.stage !== request.stage ||
			run.identity.pid !== request.pid ||
			run.identity.config !== request.config ||
			!request.variants.includes(run.variant)
		)
			throw new CaptureError('Run identity differs from its request', { code: 'EVIDENCE' })
		const selected = eligible.filter(
			(entry) =>
				matchesCaptureSelector(entry.owner, request.selector) &&
				(request.case === undefined || entry.case === request.case) &&
				(request.command === 'journey' || entry.states.length > 0),
		)
		if (
			!matchesCaptureMembers(
				selected.map((entry) => entry.case),
				run.passed,
			)
		)
			throw new CaptureError('Selected full case names differ from passed results', {
				code: 'EVIDENCE',
			})
		if (
			request.state !== undefined &&
			selected.some((entry) => !entry.states.includes(request.state ?? ''))
		)
			throw new CaptureError('Requested state differs from its selected declaring case', {
				code: 'EVIDENCE',
			})
	}
	const expected =
		request?.command === 'journey' || (request === undefined && run.entries.length === 0)
			? []
			: run.registry.filter(
					(entry) =>
						run.passed.includes(entry.case) &&
						(request?.state === undefined || entry.state === request.state),
				)
	if (
		!matchesCaptureMembers(
			run.entries.map(describeCaptureDestination),
			expected.map(describeCaptureDestination),
		)
	)
		throw new CaptureError('Emitted entries differ from exact requested projection', {
			code: 'EVIDENCE',
		})
	for (const entry of run.entries) {
		if (passed.find((assertion) => assertion.case === entry.case)?.duration !== entry.duration)
			throw new CaptureError(`Emitted duration differs from its producing case: ${entry.case}`, {
				code: 'EVIDENCE',
			})
	}
}

/**
 * Chooses the primary classification while retaining all findings separately.
 *
 * @param statuses - Every classification justified by the reading
 * @returns The highest-precedence classification, or `current` when none applies
 *
 * @example
 * ```ts
 * resolveCaptureStatus(['stale-own', 'missing']) // 'missing'
 * resolveCaptureStatus([]) // 'current'
 * ```
 */
export function resolveCaptureStatus(statuses: readonly CaptureStatus[]): CaptureStatus {
	return CAPTURE_STATUS_PRECEDENCE.find((status) => statuses.includes(status)) ?? 'current'
}

/**
 * Reads Git's NUL-delimited porcelain paths without treating spaces or quoted names as separators.
 *
 * @param output - The exact `status --porcelain=v1 -z` output
 * @returns Dirty repository-relative paths, including both sides of renames, sorted without repeats
 * @throws Thrown as an `EVIDENCE` capture error when a rename or copy record has no original path.
 *
 * @example
 * ```ts
 * readCaptureDirty(' M src/a.ts\0R  src/b.ts\0src/c.ts\0') // ['src/a.ts', 'src/b.ts', 'src/c.ts']
 * ```
 */
export function readCaptureDirty(output: string): readonly string[] {
	// A rename or copy record is followed by its original path as a bare record, so whether a record
	// is an original depends on the record before it, and the result carries that in its accumulator.
	const result = output
		.split('\0')
		.filter((record) => record !== '')
		.reduce<{ readonly paths: readonly string[]; readonly pending: boolean }>(
			(state, record) =>
				state.pending
					? { paths: [...state.paths, record], pending: false }
					: {
							paths: [...state.paths, record.slice(3)],
							pending: /[RC]/u.test(record.slice(0, 2)),
						},
			{ paths: [], pending: false },
		)
	if (result.pending)
		throw new CaptureError('Incomplete Git rename provenance', { code: 'EVIDENCE' })
	return [...new Set(result.paths)].toSorted()
}

/**
 * Validates a complete receipt against full reporter declarations and eligible output coverage.
 *
 * @param receipt - The retained complete-run receipt
 * @param report - The authenticated reporter projection
 * @throws Thrown as an `EVIDENCE` capture error when the receipt omits, invents, or changes a collected declaration or output.
 *
 * @example
 * ```ts
 * validateCaptureReceipt(receipt, readCaptureReport(parseJSON(text)))
 * ```
 */
export function validateCaptureReceipt(receipt: CaptureReceipt, report: CaptureReport): void {
	const assertions = report.assertions.filter((entry) => entry.variant === receipt.variant)
	if (
		!receipt.complete ||
		!matchesCaptureMembers(
			assertions.map(describeCaptureDeclaration),
			receipt.declarations.map(describeCaptureDeclaration),
		) ||
		!assertions.some((entry) => entry.eligible) ||
		assertions.some((entry) => entry.eligible && entry.status !== 'passed')
	)
		throw new CaptureError('Registry receipt does not prove complete eligible behavior', {
			code: 'EVIDENCE',
		})
	const eligible = receipt.declarations.filter((entry) => entry.eligible)
	for (const declaration of eligible) {
		requireCaptureUnique(declaration.states, 'states within a declaration', true)
		const entries = receipt.registry.filter((entry) => entry.case === declaration.case)
		if (
			!matchesCaptureMembers(
				entries.map((entry) => entry.state),
				declaration.states,
			) ||
			entries.some(
				(entry) => !matchesCaptureSelector(resolveCaptureOwner(entry), declaration.owner),
			)
		)
			throw new CaptureError('Registry receipt destination coverage differs from declarations', {
				code: 'EVIDENCE',
			})
	}
	if (
		receipt.registry.some(
			(entry) => !eligible.some((declaration) => declaration.case === entry.case),
		) ||
		new Set(receipt.registry.map((entry) => entry.project)).size > 1
	)
		throw new CaptureError(
			'Registry receipt contains an undeclared output or mixes producing projects',
			{ code: 'EVIDENCE' },
		)
}

/**
 * Expands an owner path into its prefixes, from its scope through the owner itself.
 *
 * @param owner - A canonical owner path
 * @returns Each colon-bounded prefix, shortest first
 *
 * @example
 * ```ts
 * collectCaptureAncestors('pages:mail:inbox') // ['pages', 'pages:mail', 'pages:mail:inbox']
 * ```
 */
export function collectCaptureAncestors(owner: string): readonly string[] {
	return owner.split(':').map((_part, index, parts) => parts.slice(0, index + 1).join(':'))
}

/**
 * Builds the owner and capture tags a wrapper declares for its owner population.
 *
 * @param owners - Every canonical owner path the host declares
 * @returns The unique `owner:` tag of each owner and ancestor, and each owner's scope and part tags
 * @throws Thrown as a `HOST` capture error naming each owner that is not a canonical selector.
 *
 * @example
 * ```ts
 * buildCaptureTags(['pages:mail'])
 * // ['owner:pages', 'owner:pages:mail', 'pages', 'pages:mail']
 * ```
 */
export function buildCaptureTags(owners: readonly string[]): readonly string[] {
	const invalid = owners.filter((owner) => !isCaptureSelector(owner))
	if (invalid.length > 0)
		throw new CaptureError(
			`Invalid capture owners: ${invalid.map((owner) => preview(owner)).join(', ')}; expected colon-separated portable segments such as "pages:mail"`,
			{ code: 'HOST', context: { owners: invalid } },
		)
	return [
		...new Set(
			owners.flatMap((owner) => [
				...collectCaptureAncestors(owner).map((path) => `${CAPTURE_OWNER_PREFIX}${path}`),
				...collectCaptureAncestors(owner).slice(0, 2),
			]),
		),
	]
}

/**
 * Builds the Vitest test options of one capture case from its declaration.
 *
 * @param input - The case's owner, states, producing variant, and harness values
 * @param rules - The host's owners and part resolver
 * @returns The derived tags, the capture metadata, and the optional timeout
 * @throws Thrown as a `HOST` capture error for an undeclared owner or tag, tags beside an owner, capture tags with no states, or a state whose part is undeclared or outside the owner.
 *
 * @example
 * ```ts
 * buildCaptureTest({ owner: 'pages:mail', states: ['inbox'], variant: 'light-390' }, rules).tags
 * // ['owner:pages', 'owner:pages:mail', 'pages', 'pages:mail']
 * ```
 */
export function buildCaptureTest(input: CaptureTestInput, rules: CaptureRules): CaptureTestOptions {
	const declared = buildCaptureTags(rules.owners)
	const owner = input.owner
	if (owner !== undefined && !declared.includes(`${CAPTURE_OWNER_PREFIX}${owner}`))
		throw new CaptureError(
			`Unknown capture owner: ${preview(owner)}; expected a declared owner path or one of its ancestors`,
			{ code: 'HOST', context: { owner } },
		)
	if (owner !== undefined && input.tags !== undefined)
		throw new CaptureError(
			`Capture case owned by ${owner} derives its tags from its owner and states; remove its tags`,
			{ code: 'HOST', context: { owner } },
		)
	const unknown = (input.tags ?? []).filter((tag) => !declared.includes(tag))
	if (unknown.length > 0)
		throw new CaptureError(
			`Unknown capture tags: ${unknown.map((tag) => preview(tag)).join(', ')}; expected tags the owners declare`,
			{ code: 'HOST', context: { tags: unknown } },
		)
	if (
		input.states === undefined &&
		(input.tags ?? []).some((tag) => !tag.startsWith(CAPTURE_OWNER_PREFIX))
	)
		throw new CaptureError(
			'Capture case names capture tags but declares no states; declare its states, an empty list included',
			{ code: 'HOST' },
		)
	const parts = (input.states ?? []).map((state) => {
		const part = rules.part(state)
		if (!declared.includes(`${CAPTURE_OWNER_PREFIX}${part}`))
			throw new CaptureError(
				`Capture state ${state} resolves to an undeclared owner: ${preview(part)}`,
				{ code: 'HOST', context: { state, part } },
			)
		if (owner !== undefined && !matchesCaptureSelector(part, owner))
			throw new CaptureError(
				`Capture state ${state} belongs to ${part}, outside owner ${owner}; split the case by owner`,
				{ code: 'HOST', context: { state, part, owner } },
			)
		return part
	})
	return {
		tags: [
			...new Set([
				...(input.owner === undefined
					? (input.tags ?? [])
					: collectCaptureAncestors(input.owner).map((path) => `${CAPTURE_OWNER_PREFIX}${path}`)),
				...parts.flatMap((part) => collectCaptureAncestors(part).slice(0, 2)),
			]),
		],
		meta: {
			...(input.owner === undefined ? {} : { owner: input.owner }),
			...(input.states === undefined ? {} : { states: [...input.states] }),
			variant: input.variant,
			...(input.eligible === undefined ? {} : { eligible: input.eligible }),
		},
		...(input.timeout === undefined ? {} : { timeout: input.timeout }),
	}
}

/**
 * Collects every leaf case under a task, keeping cases a runner filter excluded and their results.
 *
 * @param task - A Vitest file, suite, or test task
 * @param ancestors - The titles of the suites that enclose the task, excluding the file name. Default: none
 * @returns Each case with its suite titles and own title joined by spaces, as the Vitest JSON reporter names it
 *
 * @example
 * ```ts
 * collectCaptureCases({ name: 'mail', mode: 'run', meta: {}, tasks: [inbox] })[0]?.name
 * // 'mail opens the inbox'
 * ```
 */
export function collectCaptureCases(
	task: CaptureTask,
	ancestors: readonly string[] = [],
): readonly CaptureCase[] {
	const names = task.filepath === undefined ? [...ancestors, task.name] : ancestors
	if (task.tasks !== undefined)
		return task.tasks.flatMap((child) => collectCaptureCases(child, names))
	return [
		{
			name: names.join(' '),
			mode: task.mode,
			tags: [...(task.tags ?? [])],
			meta: {
				...(task.meta.owner === undefined ? {} : { owner: task.meta.owner }),
				...(task.meta.states === undefined ? {} : { states: [...task.meta.states] }),
				...(task.meta.variant === undefined ? {} : { variant: task.meta.variant }),
				...(task.meta.eligible === undefined ? {} : { eligible: task.meta.eligible }),
			},
			...(task.result === undefined
				? {}
				: {
						result: {
							state: task.result.state,
							...(task.result.duration === undefined ? {} : { duration: task.result.duration }),
						},
					}),
		},
	]
}

/**
 * Refuses a selection whose cases place states owned outside the selected owner.
 *
 * @param cases - Every collected case, including cases a runner filter excluded
 * @param rules - The host's owners and part resolver
 * @param selection - The runner's selection, absent when no runner is the parent
 * @throws Thrown as a `SELECTION` capture error for an undeclared selector, and as a `HOST` capture error naming each case that places a selected state from outside the selected owner.
 *
 * @example
 * ```ts
 * requireCaptureCases(cases, rules, { selector: 'pages:mail' }) // returns when no case is parked
 * ```
 */
export function requireCaptureCases(
	cases: readonly CaptureCase[],
	rules: CaptureRules,
	selection?: CaptureSelection,
): void {
	if (selection === undefined || selection.selector === 'all') return
	const { selector } = selection
	if (!buildCaptureTags(rules.owners).includes(`${CAPTURE_OWNER_PREFIX}${selector}`))
		throw new CaptureError(
			`Unknown capture selector: ${preview(selector)}; expected all or a declared owner path`,
			{ code: 'SELECTION', context: { selector } },
		)
	const parked = cases
		.filter((entry) => selection.case === undefined || entry.name === selection.case)
		.flatMap((entry) => {
			const owner = entry.meta.owner
			if (owner === undefined || matchesCaptureSelector(owner, selector)) return []
			const states = (entry.meta.states ?? []).filter((state) =>
				matchesCaptureSelector(rules.part(state), selector),
			)
			return states.length > 0
				? [`${entry.name}: owner ${owner}; foreign states ${states.join(', ')}`]
				: []
		})
	if (parked.length > 0)
		throw new CaptureError(
			`Capture selection ${selector} is parked; split each case so its states stay inside its owner:\n${parked.join('\n')}`,
			{ code: 'HOST', context: { selector, parked } },
		)
}

/**
 * Builds the required output pair of each state an eligible owner-bearing case declares.
 *
 * @param cases - Every collected case, including cases a runner filter excluded
 * @param rules - The host's part and source resolvers
 * @param options - The producing project and the portfolio mapping of each state
 * @returns One destination per declared state, in case and state order
 * @throws Thrown as a `HOST` capture error when a state has no single mapping or resolves outside its case's owner or the scope, part, and optional section form.
 *
 * @example
 * ```ts
 * buildCaptureDestinations(cases, rules, { project: 'journey:light-390', portfolios })[0]?.file
 * // 'tmp/captures/states/pages/inbox--light-390.png'
 * ```
 */
export function buildCaptureDestinations(
	cases: readonly CaptureCase[],
	rules: CaptureRules,
	options: CaptureDestinationOptions,
): readonly CaptureDestination[] {
	return cases.flatMap((entry) => {
		const declared = entry.meta.owner
		if (declared === undefined || entry.meta.eligible === false) return []
		return (entry.meta.states ?? []).map((state): CaptureDestination => {
			const mappings = options.portfolios.filter((portfolio) => portfolio.states.includes(state))
			const [mapping] = mappings
			if (mapping === undefined || mappings.length > 1)
				throw new CaptureError(
					`Capture state ${state} needs exactly one portfolio mapping; mapped by: ${mappings.map((candidate) => preview(candidate.portfolio)).join(', ') || 'none'}`,
					{ code: 'HOST', context: { state } },
				)
			const owner = rules.part(state)
			if (!matchesCaptureSelector(owner, declared))
				throw new CaptureError(
					`Capture state ${state} belongs to ${owner}, outside owner ${declared} of ${entry.name}`,
					{ code: 'HOST', context: { state, owner, declared } },
				)
			const [scope, part, section, ...rest] = owner.split(':')
			if (scope === undefined || part === undefined || rest.length > 0)
				throw new CaptureError(
					`Capture state ${state} resolves to ${preview(owner)}; expected scope:part or scope:part:section`,
					{ code: 'HOST', context: { state, owner } },
				)
			return {
				portfolio: mapping.portfolio,
				state,
				scope,
				part,
				...(section === undefined ? {} : { section }),
				variant: mapping.variant,
				project: options.project,
				file: `${mapping.directory}/${mapping.scoped ? `${scope}/` : ''}${state}--${mapping.variant}.png`,
				case: entry.name,
				sources: rules.sources(owner),
			}
		})
	})
}

/**
 * Builds a run record from collected cases, the run's destinations, and its observed and emitted states.
 *
 * @param options - The cases, registry, observed states, emitted state-to-path pairs, and execution context
 * @returns The final record, without the journey artifact the caller binds after rendering it
 * @throws Thrown as a `HOST` capture error for an owner-bearing case with no variant, and as an `EVIDENCE` capture error for an emitted state with no destination, a path other than its destination's file, or a producing case with no measured duration.
 *
 * @example
 * ```ts
 * const run = buildCaptureRun({ cases, registry, observed, emitted, variant: 'light-390', time })
 * validateCaptureRun(run, readCaptureReport(parseJSON(text)), 'journey:light-390')
 * ```
 */
export function buildCaptureRun(options: CaptureRunOptions): CaptureRun {
	const declarations = options.cases.flatMap((entry): readonly CaptureDeclaration[] => {
		const { owner, variant } = entry.meta
		if (owner === undefined) return []
		if (variant === undefined)
			throw new CaptureError(`Owner-bearing case declares no variant: ${entry.name}`, {
				code: 'HOST',
			})
		return [
			{
				case: entry.name,
				owner,
				variant,
				eligible: entry.meta.eligible !== false,
				states: [...(entry.meta.states ?? [])],
			},
		]
	})
	const passed = declarations
		.filter(
			(declaration) =>
				declaration.eligible &&
				options.cases.some(
					(entry) => entry.name === declaration.case && entry.result?.state === 'pass',
				),
		)
		.map((declaration) => declaration.case)
	const entries = options.emitted.map(([state, path]): CaptureEntry => {
		const destination = options.registry.find((entry) => entry.state === state)
		if (destination === undefined)
			throw new CaptureError(`Emitted state has no registry destination: ${preview(state)}`, {
				code: 'EVIDENCE',
				context: { state },
			})
		const written = path.replaceAll('\\', '/')
		if (written !== destination.file && !written.endsWith(`/${destination.file}`))
			throw new CaptureError(
				`Emitted state ${state} was written at ${preview(path)}, not at its destination ${destination.file}`,
				{ code: 'EVIDENCE', context: { state, path, file: destination.file } },
			)
		const duration = options.cases.find((entry) => entry.name === destination.case)?.result
			?.duration
		if (duration === undefined)
			throw new CaptureError(`Emitting case has no measured duration: ${destination.case}`, {
				code: 'EVIDENCE',
				context: { state, case: destination.case },
			})
		return { ...destination, duration }
	})
	const eligible = declarations.filter((declaration) => declaration.eligible)
	const reference = options.registry.filter((entry) => entry.section === entry.state)
	const request = options.request
	return {
		version: CAPTURE_VERSION,
		...(request === undefined
			? {}
			: {
					identity: {
						id: request.id,
						stage: request.stage,
						pid: request.pid,
						config: request.config,
					},
					request,
				}),
		variant: options.variant,
		time: options.time,
		complete: eligible.length > 0 && eligible.every((entry) => passed.includes(entry.case)),
		reference: reference.length > 0 && reference.every((entry) => passed.includes(entry.case)),
		declarations,
		registry: [...options.registry],
		passed,
		observed: [...options.observed],
		entries,
	}
}

/**
 * Renders the journey artifact lines that bind a run record and each case that passed in it.
 *
 * @param record - The run record's portable path
 * @param run - The run whose passed cases the artifact names
 * @returns The `record=` line, then one `case-ran=` line per passed case, without line endings
 * @throws Thrown as an `EVIDENCE` capture error for a record path that is not portable or a case name that holds a line break.
 *
 * @example
 * ```ts
 * renderCaptureArtifact('tmp/captures/states/runs/run-1/selected/light-390.json', {
 * 	passed: ['mail opens the inbox'],
 * })
 * // ['record=tmp/captures/states/runs/run-1/selected/light-390.json', 'case-ran=mail opens the inbox']
 * ```
 */
export function renderCaptureArtifact(
	record: string,
	run: Pick<CaptureRun, 'passed'>,
): readonly string[] {
	if (!isCapturePath(record))
		throw new CaptureError(
			`Artifact record path is not a portable relative path: ${preview(record)}`,
			{ code: 'EVIDENCE', context: { record } },
		)
	const broken = run.passed.filter((name) => /[\r\n]/u.test(name))
	if (broken.length > 0)
		throw new CaptureError(
			`Artifact cannot carry case names with line breaks: ${broken.map((name) => preview(name)).join(', ')}`,
			{ code: 'EVIDENCE', context: { cases: broken } },
		)
	return [
		`${CAPTURE_ARTIFACT_PREFIXES.record}${record}`,
		...run.passed.map((name) => `${CAPTURE_ARTIFACT_PREFIXES.case}${name}`),
	]
}

/**
 * Reads the record bindings and the ran cases from a journey artifact's text.
 *
 * @param text - The artifact text, with LF or CRLF line endings
 * @returns The path of each `record=` line and the full name of each `case-ran=` line, in text order
 *
 * @example
 * ```ts
 * readCaptureArtifact('# light-390\r\nrecord=tmp/run.json\r\ncase-ran=mail opens the inbox\r\n')
 * // { records: ['tmp/run.json'], cases: ['mail opens the inbox'] }
 * ```
 */
export function readCaptureArtifact(text: string): CaptureArtifactLines {
	const lines = text.split(/\r\n|\n/u)
	return {
		records: lines
			.filter((line) => line.startsWith(CAPTURE_ARTIFACT_PREFIXES.record))
			.map((line) => line.slice(CAPTURE_ARTIFACT_PREFIXES.record.length)),
		cases: lines
			.filter((line) => line.startsWith(CAPTURE_ARTIFACT_PREFIXES.case))
			.map((line) => line.slice(CAPTURE_ARTIFACT_PREFIXES.case.length)),
	}
}
