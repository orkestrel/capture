import type { ScratchInterface } from '@orkestrel/test/server'
import type { CaptureReceipt, CaptureRequest } from '@src/core'
import type {
	CaptureExecutionResult,
	CaptureIntegrityInterface,
	CaptureIntegrityOptions,
	CaptureReceiptInput,
	CaptureStageOptions,
	CaptureStageResult,
} from '@src/server'
import type { FixtureSeed, FixtureStage, FixtureWrite } from '../../setupServer.js'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { globSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseJSON } from '@orkestrel/contract'
import { createScratch } from '@orkestrel/test/server'
import { CAPTURE_VERSION, isCaptureRun } from '@src/core'
import { buildCaptureRegistry, computeRegistryDigest, createCaptureIntegrity } from '@src/server'
import { INPUTS, PORTFOLIOS, VARIANTS } from '../../setupServer.js'

/**
 * Owns a real isolated Git workspace, producer children, and the engine under test.
 *
 * @remarks
 * The producer is a plain Node child that writes the reporter, the final records, and the frames
 * from inert fixture data. It validates nothing the engine owns, so every refusal the tests read
 * comes from the engine.
 */
export class IntegrityFixture {
	readonly root: string
	readonly options: CaptureIntegrityOptions
	readonly engine: CaptureIntegrityInterface
	readonly #scratch: ScratchInterface
	readonly #imports: CaptureReceiptInput[] = []

	/**
	 * Creates the passing baseline used beside every filesystem and record control.
	 *
	 * @returns A caller-owned fixture with actual successful child stamps
	 */
	static async current(): Promise<IntegrityFixture> {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			await fixture.capture()
			return fixture
		} catch (error) {
			fixture.destroy()
			throw error
		}
	}

	/** Creates a private committed Git workspace holding the fixture's sources. */
	constructor(parent?: string) {
		this.#scratch = createScratch({
			prefix: 'integrity-',
			...(parent === undefined ? {} : { parent }),
		})
		this.root = this.#scratch.path
		try {
			for (const path of [
				'src/mail/view.ts',
				'src/board/view.ts',
				'src/shared/theme.ts',
				'behavior/journeys.ts',
			])
				this.write(path, `// ${path}\n`)
			this.write('outside.ts', '// deliberately outside the bounded inputs\n')
			this.write('fixture with spaces.config.ts', 'export default {}\n')
			this.write('.gitignore', 'tmp/\n')
			execFileSync('git', ['init', '--quiet'], { cwd: this.root, windowsHide: true })
			execFileSync('git', ['add', '.'], { cwd: this.root, windowsHide: true })
			execFileSync(
				'git',
				[
					'-c',
					'user.name=Integrity Fixture',
					'-c',
					'user.email=fixture@example.invalid',
					'commit',
					'--quiet',
					'--no-gpg-sign',
					'-m',
					'fixture',
				],
				{ cwd: this.root, windowsHide: true },
			)
			this.options = {
				root: this.root,
				inputs: INPUTS,
				directory: 'tmp/captures/states',
				registry: 'tmp/captures/states/registry.json',
				manifest: 'tmp/captures/states/manifest.json',
				lookups: 'tmp/captures/states/lookups.json',
				portfolios: PORTFOLIOS,
			}
			this.engine = createCaptureIntegrity(this.options)
		} catch (error) {
			// A throwing constructor returns no instance, so no caller's finally block can destroy it.
			this.#scratch.destroy()
			throw error
		}
	}

	/** Lists every complete-run receipt the producer imported, in the order it seeded them. */
	get imports(): readonly CaptureReceiptInput[] {
		return this.#imports
	}

	/**
	 * Writes exact bytes within the owned scratch tree.
	 *
	 * @param file - The fixture-relative path
	 * @param bytes - The desired bytes
	 */
	write(file: string, bytes: string | Uint8Array): void {
		const path = resolve(this.root, file)
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, bytes)
	}

	/**
	 * Reads exact bytes without decoding or normalizing them.
	 *
	 * @param file - The fixture-relative path
	 * @returns The original bytes
	 */
	read(file: string): Buffer {
		return readFileSync(resolve(this.root, file))
	}

	/**
	 * Reads the native glob population through a separate SHA-256 implementation.
	 *
	 * @returns Exact file membership and byte hashes
	 */
	hashes(): Readonly<Record<string, string>> {
		return Object.fromEntries(
			globSync([...INPUTS], { cwd: this.root })
				.map((file) => file.replaceAll('\\', '/'))
				.filter((file) => statSync(resolve(this.root, file)).isFile())
				.toSorted()
				.map((file) => [file, createHash('sha256').update(this.read(file)).digest('hex')]),
		)
	}

	/**
	 * Runs an actual producer child and imports its complete report and raw declarations.
	 *
	 * @param options - The complete variants and optional separate portfolio or collision control
	 * @throws Thrown when the producer fails or the bounded inputs drift while it runs.
	 */
	seed(options: FixtureSeed = {}): void {
		const variants = options.variants ?? VARIANTS
		const id = randomUUID()
		const report = `tmp/evidence/${id}/report.json`
		const records = Object.fromEntries(
			variants.map((variant) => [variant, `tmp/evidence/${id}/${variant}.json`]),
		)
		const inputs = this.hashes()
		const outcome = this.execute({
			...options,
			variants,
			report,
			records,
			capture: options.vue ?? false,
		})
		if (outcome.code !== 0 || outcome.signal !== null)
			throw new Error('Complete fixture producer failed')
		if (JSON.stringify(inputs) !== JSON.stringify(this.hashes()))
			throw new Error('Fixture inputs drifted while seeding')
		const text = this.read(report).toString('utf8')
		const receipts: readonly CaptureReceipt[] = variants.map((variant) => {
			const run: unknown = parseJSON(this.read(records[variant] ?? '').toString('utf8'))
			if (!isCaptureRun(run)) throw new Error('Invalid complete fixture record')
			return {
				version: CAPTURE_VERSION,
				variant,
				time: run.time,
				report: { file: report, digest: createHash('sha256').update(text).digest('hex') },
				inputs,
				declarations: run.declarations,
				registry: run.registry,
				complete: run.complete,
			}
		})
		const imports = receipts.map((receipt) => ({ receipt, report: text, outcome, capped: false }))
		this.#imports.push(...imports)
		// Collision controls deliberately bypass the importer so check() sees the malformed external population.
		const raw = {
			version: CAPTURE_VERSION,
			receipts,
			entries: receipts.flatMap((receipt) => receipt.registry),
		}
		const registry = options.duplicate
			? { ...raw, digest: computeRegistryDigest(raw) }
			: buildCaptureRegistry(imports)
		this.write(
			`tmp/captures/${options.vue ? 'vue' : 'states'}/registry.json`,
			JSON.stringify(registry),
		)
	}

	/**
	 * Builds a complete stage contract without running it, for boundary mutations.
	 *
	 * @param options - The selected work and optional producer fault
	 * @returns The stage passed directly to the engine
	 */
	stage(options: FixtureStage = {}): CaptureStageOptions {
		const id = randomUUID()
		const variants = options.variants ?? ['light-390']
		const stage = options.command === 'journey' ? 'selected' : 'narrow'
		const report = `tmp/stages/${id}/${stage}.json`
		const request: CaptureRequest = {
			version: CAPTURE_VERSION,
			id,
			stage,
			pid: process.pid,
			config: 'fixture with spaces.config.ts',
			command: options.command ?? 'capture',
			selector: options.selector ?? 'all',
			...(options.case === undefined ? {} : { case: options.case }),
			...(options.state === undefined ? {} : { state: options.state }),
			variants,
			args: [`--outputFile.json=${resolve(this.root, report)}`],
		}
		const projects = variants.map((variant) => ({
			name: `journey:${variant}`,
			variant,
			inputs: INPUTS,
			record: `tmp/captures/states/runs/${id}/${stage}/${variant}.json`,
		}))
		const input: FixtureWrite = {
			...(options.ending === undefined ? {} : { ending: options.ending }),
			request,
			variants,
			report,
			capture: request.command === 'capture',
			...(options.fault === undefined ? {} : { fault: options.fault }),
			...(options.picture === undefined ? {} : { picture: options.picture }),
			...(options.population === undefined ? {} : { population: options.population }),
			...(options.journal === undefined ? {} : { journal: options.journal }),
			records: Object.fromEntries(projects.map((project) => [project.variant, project.record])),
		}
		return {
			request,
			report,
			projects,
			...(options.signal === undefined ? {} : { signal: options.signal }),
			execute: async () => this.execute(input),
		}
	}

	/**
	 * Executes the engine over a fresh external child.
	 *
	 * @param options - The selected work and optional producer fault
	 * @returns The engine's committed result
	 */
	async capture(options: FixtureStage = {}): Promise<CaptureStageResult> {
		return this.engine.stamp(this.stage(options))
	}

	/**
	 * Executes the protocol producer without replacing any engine operation.
	 *
	 * @param input - The child transport
	 * @returns The actual child exit and signal
	 * @throws Thrown when the child cannot start, or fails without an injected fault that explains it.
	 */
	execute(input: FixtureWrite): CaptureExecutionResult {
		const file = `tmp/fixture-input-${randomUUID()}.json`
		this.write(file, JSON.stringify(input))
		const child = spawnSync(
			process.execPath,
			[resolve(import.meta.dirname, 'Writer.ts'), resolve(this.root, file)],
			{
				cwd: this.root,
				windowsHide: true,
				encoding: 'utf8',
				timeout: 15000,
			},
		)
		if (child.error !== undefined) throw child.error
		if (child.status !== 0 && input.fault !== 'failed-child' && input.fault !== 'signal')
			throw new Error(child.stderr)
		return { code: child.status, signal: child.signal }
	}

	/** Releases the scratch workspace this instance created. */
	destroy(): void {
		this.#scratch.destroy()
	}
}
