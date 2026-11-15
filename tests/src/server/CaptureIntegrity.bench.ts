import type { CaptureDeclaration, CaptureDestination, CaptureRequest } from '@src/core'
import * as core from '@src/core'
import * as server from '@src/server'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseJSON } from '@orkestrel/contract'
import { waitForCondition } from '@orkestrel/test'
import { expect, it } from 'vitest'
import {
	INPUTS,
	INTEGRITY_OPERATIONS,
	INTEGRITY_POPULATIONS,
	IntegrityFixture,
	PopulationFixture,
} from '../../setupServer.js'

// The integrity cost of one journey stage, read as the latency of `stamp` over an in-process
// producer, at the population the capture cost map measured (131 owners declaring 185 states over
// 310 input files, one variant, each destination attributed to its own file, one shared file, and
// one test glob) and at a population of fixture size. A `stamp` call on a fresh engine pays both
// glob-matching passes over every attributed source triple, so this reading carries their cost.
//
// The integrity cost of a frames pass, read as the latency of a `capture` stamp that writes the
// manifest, of `read`, and of `check`, each over every destination after one stamp has written the
// manifest. The base arm runs one variant with one shared file; the veneer kind runs veneer's four
// variants over a shared list that matches most inputs, so its manifest repeats that list's map in
// every stamp, and its `read` resolves every destination's producer across four receipts. Each
// `stamp` reading runs on a fresh engine, because an engine keeps its matched subsets across stamps;
// `read` and `check` never read that memo and share the fixture's engine. Each reading
// line carries the manifest's bytes and the bytes its repeated file maps take beyond each distinct
// map's first copy. No gate collects this file; run it with
// `npm run test:bench -- tests/src/server/CaptureIntegrity.bench.ts`, and select one case with `-t`.

it.for([
	{ label: 'veneer', owners: 131, states: 185, inputs: 310 },
	{ label: 'fixture', owners: 3, states: 4, inputs: 8 },
])(
	'reads the journey stage integrity cost at the $label population',
	{ timeout: 600_000 },
	async ({ label, owners, states, inputs }, { bench }) => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			const parts = Array.from({ length: owners }, (_, index) => `part-${index}`)
			for (const part of parts) fixture.write(`src/parts/${part}.ts`, `// ${part}\n`)
			// The fixture tree holds 5 input files; filler files bring the population to its size.
			for (const index of Array.from({ length: inputs - owners - 5 }, (_, entry) => entry))
				fixture.write(`src/filler/file-${index}.ts`, `// filler ${index}\n`)
			// An anchor outside the staged variant attests the staged variant through unchanged inputs.
			fixture.seed({ variants: ['light-320'] })
			const variant = 'light-390'
			const project = `journey:${variant}`
			const cases = parts.map((part, index) => ({
				part,
				declaration: {
					case: `bench journeys ${part}`,
					owner: `pages:${part}`,
					variant,
					eligible: true,
					states: Array.from(
						{ length: index < states - owners ? 2 : 1 },
						(_, entry) => `${part}-state-${entry}`,
					),
				},
			}))
			const declarations: readonly CaptureDeclaration[] = cases.map((entry) => entry.declaration)
			const registry: readonly CaptureDestination[] = cases.flatMap(({ part, declaration }) =>
				declaration.states.map((state) => ({
					portfolio: 'states',
					state,
					scope: 'pages',
					part,
					variant,
					project,
					case: declaration.case,
					file: `tmp/captures/states/pages/${state}--${variant}.png`,
					sources: {
						own: [`src/parts/${part}.ts`],
						shared: ['src/shared/theme.ts'],
						tests: ['behavior/**'],
					},
				})),
			)
			expect(registry).toHaveLength(states)
			const result = await bench(`stamp ${label}`, async () => {
				const id = randomUUID()
				const report = `tmp/stages/${id}/selected.json`
				const record = `tmp/captures/states/runs/${id}/selected/${variant}.json`
				const artifact = `tmp/journey/runs/${id}/selected/${variant}.txt`
				const request: CaptureRequest = {
					version: core.CAPTURE_VERSION,
					id,
					stage: 'selected',
					pid: process.pid,
					config: 'fixture with spaces.config.ts',
					command: 'journey',
					selector: 'all',
					variants: [variant],
					args: [`--outputFile.json=${resolve(fixture.root, report)}`],
				}
				// An engine keeps its matched subsets across stamps, so each stage starts on a fresh engine.
				const stage = await server.createCaptureIntegrity(fixture.options).stamp({
					request,
					report,
					projects: [{ name: project, variant, inputs: INPUTS, record }],
					execute: async () => {
						const start = Date.now()
						const journal = `# ${variant}\ncoverage=complete\nrecord=${record}\n`
						// File times come from a coarser clock than `Date.now()`, and the engine refuses an
						// output stamped before its snapshot, so the outputs wait for that clock to pass.
						await waitForCondition('the file clock passes the stage start', () => {
							fixture.write(artifact, journal)
							const stat = statSync(resolve(fixture.root, artifact))
							return stat.mtimeMs >= start && stat.ctimeMs >= start
						})
						fixture.write(
							record,
							JSON.stringify({
								version: 1,
								request,
								identity: { id, stage: request.stage, pid: request.pid, config: request.config },
								variant,
								time: new Date().toISOString(),
								complete: true,
								reference: false,
								artifact: {
									file: artifact,
									digest: createHash('sha256').update(journal).digest('hex'),
								},
								declarations,
								registry,
								passed: declarations.map((declaration) => declaration.case),
								observed: declarations.flatMap((declaration) => declaration.states),
								entries: [],
							}),
						)
						fixture.write(
							report,
							JSON.stringify({
								success: true,
								numFailedTests: 0,
								numFailedTestSuites: 0,
								startTime: start,
								testResults: [
									{
										name: 'bench.test.ts',
										status: 'passed',
										startTime: start,
										endTime: Date.now(),
										assertionResults: declarations.map((declaration) => ({
											fullName: declaration.case,
											title: declaration.case,
											ancestorTitles: [],
											status: 'passed',
											duration: 1,
											meta: {
												owner: declaration.owner,
												variant,
												eligible: true,
												states: declaration.states,
											},
										})),
									},
								],
							}),
						)
						return { code: 0, signal: null }
					},
				})
				expect(stage.lookups).toHaveLength(owners)
			}).run({ iterations: 3, time: 0, warmupIterations: 1, warmupTime: 0 })
			console.log(`integrity ${label} ${String(result.latency.p50)}`)
			expect(result.latency.p50).toBeGreaterThan(0)
		} finally {
			fixture.destroy()
		}
	},
)

it.for(
	INTEGRITY_POPULATIONS.flatMap((entry) =>
		INTEGRITY_OPERATIONS.map((operation) => ({ ...entry, operation })),
	),
)(
	'reads the $operation cost at the $label population',
	{ timeout: 600_000 },
	async ({ label, population, iterations, operation }, { bench }) => {
		const fixture = new PopulationFixture({ core, server }, population)
		try {
			const total = population.states * population.variants.length
			expect((await fixture.engine.stamp(fixture.stage())).entries).toHaveLength(total)
			// Each call logs how many destinations it stamped, selected, or read as current.
			const reached: number[] = []
			const result = await bench(`${operation} ${label}`, async () => {
				reached.push(
					operation === 'stamp'
						? (await server.createCaptureIntegrity(fixture.options).stamp(fixture.stage())).entries
								.length
						: operation === 'read'
							? (await fixture.engine.read({ selector: 'all' })).entries.length
							: (await fixture.engine.check({ selector: 'all' })).entries.filter(
									(entry) => entry.status === 'current',
								).length,
				)
			}).run({ iterations, time: 0, warmupIterations: 1, warmupTime: 0 })
			expect(reached.length).toBeGreaterThan(iterations)
			expect(new Set(reached)).toEqual(new Set([total]))
			const text = readFileSync(resolve(fixture.root, fixture.options.manifest), 'utf8')
			const manifest: unknown = parseJSON(text)
			if (!core.isCaptureStoredManifest(manifest)) throw new Error('Invalid population manifest')
			const maps = [
				...Object.values(manifest.entries).map((stamp) => JSON.stringify(stamp.shared.files)),
				...manifest.lookups.map((lookup) => JSON.stringify(lookup.inputs)),
			]
			const repeated =
				Buffer.byteLength(maps.join('')) - Buffer.byteLength([...new Set(maps)].join(''))
			console.log(
				`integrity ${operation} ${label} manifest=${String(Buffer.byteLength(text))} repeated=${String(repeated)} p50=${String(result.latency.p50)}`,
			)
			expect(result.latency.p50).toBeGreaterThan(0)
		} finally {
			fixture.destroy()
		}
	},
)
