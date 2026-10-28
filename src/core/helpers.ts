import type {
	CaptureAssertion,
	CaptureDeclaration,
	CaptureDestination,
	CaptureLookup,
	CaptureReceipt,
	CaptureReport,
	CaptureRequest,
	CaptureRun,
	CaptureStatus,
} from './types.js'
import { arrayOf, isError, isFiniteNumber, isRecord, isString } from '@orkestrel/contract'
import { CAPTURE_STATUS_PRECEDENCE } from './constants.js'
import { CaptureError } from './errors.js'
import { isCaptureDeclaration } from './validators.js'

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
		start: Math.min(value.startTime, ...files.map((file) => file.start)),
		end: Math.max(...files.map((file) => file.end)),
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
