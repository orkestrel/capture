import { captureError } from '@orkestrel/test'
import * as core from '@src/core'
import * as server from '@src/server'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	CaptureDiscovery,
	CaptureIntegrity,
	CaptureInvocation,
	CapturePreflight,
	CaptureRegistrar,
	CaptureRunner,
	CaptureSheets,
	createCaptureDiscovery,
	createCaptureIntegrity,
	createCapturePreflight,
	createCaptureRegistrar,
	createCaptureRunner,
	createCaptureSheets,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import {
	ComposedFixture,
	IntegrityFixture,
	ReaderFixture,
	FIXTURE_TIMEOUT,
	READER_CONFIG,
	READER_JOURNEYS,
	RUNNER_REQUESTS,
	VARIANTS,
} from '../../setupServer.js'
describe('createCaptureIntegrity', { timeout: FIXTURE_TIMEOUT }, () => {
	it('creates an engine bound to the options, reading the workspace they name', async () => {
		const fixture = await IntegrityFixture.current({ core, server })
		try {
			const created = createCaptureIntegrity(fixture.options)
			const result = await created.check({ selector: 'pages:mail', variants: ['light-390'] })
			expect(created).toBeInstanceOf(CaptureIntegrity)
			expect(result.entries.map((entry) => entry.status)).toEqual(['current', 'current', 'current'])
		} finally {
			fixture.destroy()
		}
	})

	it('refuses options the class refuses, under the same condition', () => {
		const fixture = new IntegrityFixture({ core, server })
		try {
			expect(
				captureError(() => createCaptureIntegrity({ ...fixture.options, root: 'relative' })),
			).toMatchObject({ message: 'Integrity root must be absolute', code: 'HOST' })
		} finally {
			fixture.destroy()
		}
	})
})

describe('createCaptureRunner', () => {
	it('creates a runner bound to the command line, whose execute reports a refusal as exit 64', async () => {
		const lines: string[] = []
		const runner = createCaptureRunner({
			command: 'journey',
			root: process.cwd(),
			config: 'configs/none.config.ts',
			requests: RUNNER_REQUESTS,
			argv: ['--mode'],
			stdout: (text) => lines.push(text),
			stderr: (text) => lines.push(text),
		})
		expect(runner).toBeInstanceOf(CaptureRunner)
		expect(await runner.execute()).toBe(64)
		expect(lines.join('')).toContain("Unknown option '--mode'")
	})
})

describe('createCaptureRegistrar', () => {
	it('creates a refresh bound to the command line, whose execute reports a refusal as exit 64', async () => {
		const lines: string[] = []
		const registrar = createCaptureRegistrar({
			root: process.cwd(),
			config: 'configs/none.config.ts',
			requests: RUNNER_REQUESTS,
			argv: ['pages:mail'],
			stdout: (text) => lines.push(text),
			stderr: (text) => lines.push(text),
		})
		expect(registrar).toBeInstanceOf(CaptureRegistrar)
		expect(await registrar.execute()).toBe(64)
		expect(lines.join('')).toContain('the registry command takes no selector')
	})
})

describe('createCapturePreflight', { timeout: FIXTURE_TIMEOUT }, () => {
	it('creates a preflight bound to the selection, whose execute reads the workspace it names', async () => {
		const fixture = new ReaderFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', picture: true })
			const lines: string[] = []
			const preflight = createCapturePreflight({
				root: fixture.root,
				config: resolve(fixture.root, READER_CONFIG),
				selection: { selector: 'pages:mail', variants: ['light-390'] },
				journeys: resolve(fixture.root, READER_JOURNEYS),
				stdout: (text) => lines.push(text),
			})
			expect(preflight).toBeInstanceOf(CapturePreflight)
			expect(await preflight.execute()).toBe(0)
			expect(lines.join('')).toContain('"acceptance":false')
		} finally {
			fixture.destroy()
		}
	})

	it('reports a refused selection as exit 64 on the error writer, printing no report', async () => {
		const lines: string[] = []
		const errors: string[] = []
		const preflight = createCapturePreflight({
			root: process.cwd(),
			config: resolve(process.cwd(), '../outside.config.ts'),
			selection: { selector: 'pages:mail' },
			journeys: resolve(process.cwd(), 'tmp/journey'),
			stdout: (text) => lines.push(text),
			stderr: (text) => errors.push(text),
		})
		expect(await preflight.execute()).toBe(64)
		expect(errors.join('')).toContain('--config resolves outside the repository')
		expect(lines).toEqual([])
	})
})

describe('createCaptureSheets', { timeout: FIXTURE_TIMEOUT }, () => {
	it('creates a sheet writer bound to the output, whose execute writes the sheets', async () => {
		const fixture = new ReaderFixture({ core, server })
		try {
			fixture.seed()
			await fixture.capture({ selector: 'pages:mail', picture: true })
			const lines: string[] = []
			const sheets = createCaptureSheets({
				reader: {
					root: fixture.root,
					config: resolve(fixture.root, READER_CONFIG),
					selection: { selector: 'pages:mail', variants: ['light-390'] },
					journeys: resolve(fixture.root, READER_JOURNEYS),
					stdout: (text) => lines.push(text),
				},
				output: resolve(fixture.root, 'tmp/sheets'),
			})
			expect(sheets).toBeInstanceOf(CaptureSheets)
			expect(await sheets.execute()).toBe(0)
			expect(existsSync(resolve(fixture.root, 'tmp/sheets/sheet-001.png'))).toBe(true)
			expect(lines.join('')).toContain('"acceptance":false')
		} finally {
			fixture.destroy()
		}
	})
})

describe('createCaptureDiscovery', { timeout: FIXTURE_TIMEOUT }, () => {
	it('creates a discovery bound to the wrapper, whose describe returns the host description it answers', async () => {
		const fixture = new ComposedFixture({ core, server })
		try {
			const invocation = new CaptureInvocation({
				command: 'journey',
				root: fixture.root,
				requests: fixture.requests,
				stdout: () => undefined,
				stderr: () => undefined,
			})
			const discovery = createCaptureDiscovery({
				root: fixture.root,
				config: resolve(fixture.root, fixture.config),
				invocation,
			})
			expect(discovery).toBeInstanceOf(CaptureDiscovery)
			const description = await discovery.describe()
			expect(description.projects.map((entry) => entry.project.variant)).toEqual([...VARIANTS])
		} finally {
			fixture.destroy()
		}
	})
})
