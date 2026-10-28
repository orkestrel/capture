import type { CaptureRegistry, CaptureRun, CaptureStoredManifest } from '@orkestrel/capture'
import type { ExecuteResult } from '@orkestrel/process'
import type { ScratchInterface } from '@orkestrel/test/server'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { execute, executeSync } from '@orkestrel/process/server'
import { createScratch } from '@orkestrel/test/server'
import { isCaptureRegistry, isCaptureRun, isCaptureStoredManifest } from '@orkestrel/capture'

/** Owns an isolated consumer workspace using the checkout's built capture and installed test tools. */
export class CaptureConsumer {
	readonly #scratch: ScratchInterface
	readonly #root: string

	constructor() {
		this.#root = resolve(import.meta.dirname, '..')
		for (const file of [
			'dist/bin/main.js',
			'dist/src/server/index.js',
			'node_modules/vitest/vitest.mjs',
			'node_modules/@vitest/browser-playwright/package.json',
			'node_modules/playwright/package.json',
		]) {
			if (!existsSync(resolve(this.#root, file)))
				throw new Error(
					`Consumer proof requires ${file}; build capture and provision its browser tools before running test:studies`,
				)
		}
		const vitest = parseJSON(
			readFileSync(resolve(this.#root, 'node_modules/vitest/package.json'), 'utf8'),
		)
		const provider = parseJSON(
			readFileSync(
				resolve(this.#root, 'node_modules/@vitest/browser-playwright/package.json'),
				'utf8',
			),
		)
		if (
			!isRecord(vitest) ||
			!isRecord(provider) ||
			!isRecord(provider.peerDependencies) ||
			provider.peerDependencies.vitest !== vitest.version
		)
			throw new Error(
				'The installed browser provider must declare the installed Vitest version as its peer',
			)
		mkdirSync(resolve(this.#root, 'tmp'), { recursive: true })
		this.#scratch = createScratch({
			parent: resolve(this.#root, 'tmp'),
			prefix: 'capture-consumer-',
		})
		try {
			executeSync({
				file: 'git',
				arguments: [
					'clone',
					'--shared',
					'--no-checkout',
					'--quiet',
					this.#root,
					this.#scratch.path,
				],
			})
			cpSync(resolve(import.meta.dirname, 'fixtures/capture/consumer'), this.#scratch.path, {
				recursive: true,
			})
			this.#scratch.ensure('specs')
			for (const file of ['journey.ts', 'ConsumerJourney.ts', 'constants.ts', 'types.ts'])
				cpSync(resolve(this.#scratch.path, file), resolve(this.#scratch.path, 'specs', file))
			this.#scratch.write('package.json', JSON.stringify({ type: 'module' }))
			this.#scratch.write('.gitignore', 'node_modules/\ntmp/\n')
			this.#scratch.link('node_modules/vitest', resolve(this.#root, 'node_modules/vitest'))
			// Shared package roots keep Vitest's runner and provider on one module instance.
			for (const name of [
				'@vitest/browser-playwright',
				'@vitest/browser',
				'playwright',
				'@orkestrel/contract',
			]) {
				const require = createRequire(resolve(this.#root, 'package.json'))
				this.#scratch.link(`node_modules/${name}`, dirname(require.resolve(`${name}/package.json`)))
			}
			this.#scratch.link('node_modules/@orkestrel/capture', this.#root)
			this.#scratch.ensure('tmp')
		} catch (error) {
			this.#scratch.destroy()
			throw error
		}
	}

	get root(): string {
		return this.#scratch.path
	}

	async execute(argv: readonly string[]): Promise<ExecuteResult> {
		const started = performance.now()
		const result = await execute(
			{
				file: process.execPath,
				arguments: [
					resolve(this.#root, 'dist/bin/main.js'),
					...argv,
					'--config',
					'journey.config.ts',
				],
				environment: { FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
			},
			{ workspace: this.root, timeout: 120_000, limit: 4_194_304, strict: false },
		)
		console.log(
			`${argv.join(' ')}: exit=${result.code} durationMs=${Math.round(performance.now() - started)}`,
		)
		if (result.failed) console.log(result.stdout + result.stderr)
		this.#scratch.write(
			`tmp/command-${String(argv[0])}-${String(performance.now())}.json`,
			JSON.stringify(result),
		)
		return result
	}

	read(file: string): unknown {
		return parseJSON(readFileSync(resolve(this.root, file), 'utf8'))
	}

	registry(): CaptureRegistry {
		const registry = this.read('tmp/captures/states/registry.json')
		if (!isCaptureRegistry(registry)) throw new Error('Consumer emitted an invalid registry')
		return registry
	}

	manifest(): CaptureStoredManifest {
		const manifest = this.read('tmp/captures/states/manifest.json')
		if (!isCaptureStoredManifest(manifest)) throw new Error('Consumer emitted an invalid manifest')
		return manifest
	}

	run(file: string): CaptureRun {
		const run = this.read(file)
		if (!isCaptureRun(run)) throw new Error(`Consumer emitted an invalid run: ${file}`)
		return run
	}

	destroy(): void {
		this.#scratch.destroy()
	}
}

/** Reads an emitted JSON report line, refusing absent or malformed reports. */
export function readConsumerReport(
	stdout: string,
	prefix: string,
): Readonly<Record<string, unknown>> {
	const line = stdout.split(/\r\n|\n/u).find((entry) => entry.startsWith(`${prefix} `))
	const report = line === undefined ? undefined : parseJSON(line.slice(prefix.length + 1))
	if (!isRecord(report)) throw new Error(`Missing ${prefix} report in ${stdout}`)
	return report
}
