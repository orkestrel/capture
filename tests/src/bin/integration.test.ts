import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createScratch } from '@orkestrel/test/server'
import { createCaptureRunner } from '@src/server'
import { describe, expect, it } from 'vitest'
import { countCaptureChildren } from '../../setupServer.js'
import { FIXTURE_TIMEOUT } from '../../setupServer.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BUILT = resolve(ROOT, 'dist/src/server/index.js')
const VITEST = resolve(ROOT, 'node_modules/vitest/vitest.mjs')
const CONFIG = 'configs/journey.config.ts'
const REQUESTS = 'tmp/capture'

// The wrapper a consumer would write: it answers the discovery request first, ahead of the output
// initialization, the setup file, and the test files, and returns the empty configuration once it
// has answered. Outside discovery it initializes an output file and names a test and a setup file,
// each of which records itself, so the proofs below can see what a real Vitest touched.
const WRAPPER = `import { writeFileSync } from 'node:fs'
import { answerCaptureDiscovery, buildCaptureDiscoveryConfig } from '@orkestrel/capture/server'

const projects = ['wide', 'narrow'].map((variant) => ({
	test: {
		name: { label: 'journey:' + variant, color: 'green' },
		tags: [{ name: 'owner:app' }, { name: 'owner:app:mail' }],
		provide: {
			directory: 'out/frames',
			record: 'out/frames/runs/a/' + variant + '.json',
			inputs: ['configs/**'],
			variant,
			variants: [{ name: 'wide', width: 1024, height: 768 }, { name: 'narrow', width: 390, height: 844 }],
			final: 'closes the run',
			first: 'narrow',
			portfolios: [{ portfolio: 'frames', directory: 'out/frames', scoped: true }],
		},
	},
}))
const answered = await answerCaptureDiscovery({
	ppid: process.ppid,
	argv: process.argv.slice(1),
	config: ${JSON.stringify(CONFIG)},
	projects,
})
if (!answered) writeFileSync('initialized.txt', 'output initialized')
export default answered
	? buildCaptureDiscoveryConfig()
	: { test: { projects, include: ['specs/**/*.test.ts'], setupFiles: ['specs/setup.ts'] } }
`

// A wrapper that never calls the answer, as a consumer that has not adopted the contract would write.
const SILENT = `export default { test: { projects: [], include: ['specs/**/*.test.ts'] } }\n`

function createWorkspace(wrapper: string) {
	const scratch = createScratch({ prefix: 'real-' })
	scratch.write(
		'node_modules/vitest/vitest.mjs',
		`import ${JSON.stringify(pathToFileURL(VITEST).href)}\n`,
	)
	scratch.write(
		'node_modules/@orkestrel/capture/package.json',
		JSON.stringify({
			name: '@orkestrel/capture',
			type: 'module',
			exports: { './server': './server.js' },
		}),
	)
	scratch.write(
		'node_modules/@orkestrel/capture/server.js',
		`export * from ${JSON.stringify(pathToFileURL(BUILT).href)}\n`,
	)
	scratch.write(CONFIG, wrapper)
	scratch.write(
		'specs/sentinel.test.ts',
		"import { writeFileSync } from 'node:fs'\nimport { test } from 'vitest'\nwriteFileSync('collected.txt', 'collected')\ntest('collected', () => undefined)\n",
	)
	scratch.write(
		'specs/setup.ts',
		"import { writeFileSync } from 'node:fs'\nwriteFileSync('setup.txt', 'setup')\n",
	)
	return scratch
}

async function run(root: string, argv: readonly string[]) {
	const stdout: string[] = []
	const stderr: string[] = []
	const code = await createCaptureRunner({
		command: 'journey',
		root,
		config: CONFIG,
		requests: REQUESTS,
		argv,
		stdout: (text) => stdout.push(text),
		stderr: (text) => stderr.push(text),
	}).execute()
	return { code, stdout: stdout.join(''), stderr: stderr.join('') }
}

// Every child the runner spawns announces its process id, so the count tells discovery's one child from an execution child.

function listFiles(root: string, directory: string): readonly string[] {
	return existsSync(resolve(root, directory)) ? readdirSync(resolve(root, directory)) : []
}

// Each case starts a real Vitest, which loads the wrapper through Vite's runner loader.
describe('discovery through a real Vitest and a real wrapper', { timeout: FIXTURE_TIMEOUT }, () => {
	it('is built, so the wrapper imports the same package a consumer installs', () => {
		expect(existsSync(BUILT) ? BUILT : 'run `npm run build` before this proof').toBe(BUILT)
		expect(existsSync(VITEST) ? VITEST : 'install vitest before this proof').toBe(VITEST)
	})

	it('round-trips the host data of the wrapper to the runner, which lists the owners the wrapper declares', async () => {
		const scratch = createWorkspace(WRAPPER)
		try {
			const result = await run(scratch.path, [])
			expect(result.code).toBe(64)
			for (const owner of ['app', 'app:mail'])
				expect(result.stderr).toContain(JSON.stringify(owner))
			const runs = listFiles(scratch.path, `${REQUESTS}/runs`)
			expect(runs).toHaveLength(1)
			expect(listFiles(scratch.path, `${REQUESTS}/runs/${runs[0] ?? ''}`).toSorted()).toEqual([
				'description.json',
				'discovery.log',
			])
		} finally {
			scratch.destroy()
		}
	})

	it('collects no test, runs no setup file, initializes no output, and starts no stage', async () => {
		const scratch = createWorkspace(WRAPPER)
		try {
			const result = await run(scratch.path, ['app:mail'])
			// A selector the wrapper declares passes discovery and meets the registry check next, so the only child is the discovery one.
			expect(countCaptureChildren(result.stdout)).toBe(1)
			for (const file of ['collected.txt', 'setup.txt', 'initialized.txt'])
				expect(scratch.has(file)).toBe(false)
			expect(scratch.has('out')).toBe(false)
			expect(scratch.has(`${REQUESTS}/journey-selection-${String(process.pid)}.json`)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('shows the same wrapper initializing and collecting when it is not asked for a description', () => {
		const scratch = createWorkspace(WRAPPER)
		try {
			const child = spawnSync(
				process.execPath,
				[
					resolve(scratch.path, 'node_modules/vitest/vitest.mjs'),
					'list',
					'--filesOnly',
					'--config',
					resolve(scratch.path, CONFIG),
					'--configLoader',
					'runner',
				],
				{ cwd: scratch.path, encoding: 'utf8', windowsHide: true, timeout: 60_000 },
			)
			// The control: without a request the wrapper does its other work, so the proof above could fail.
			expect(scratch.has('initialized.txt')).toBe(true)
			expect(child.stdout).toContain('sentinel.test.ts')
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a wrapper that never answers, naming it, and starts no stage', async () => {
		const scratch = createWorkspace(SILENT)
		try {
			const result = await run(scratch.path, ['app:mail'])
			expect(result.code).toBe(1)
			expect(countCaptureChildren(result.stdout)).toBe(1)
			const runs = listFiles(scratch.path, `${REQUESTS}/runs`)
			expect(listFiles(scratch.path, `${REQUESTS}/runs/${runs[0] ?? ''}`)).not.toContain(
				'description.json',
			)
			for (const file of ['collected.txt', 'initialized.txt']) expect(scratch.has(file)).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
})
