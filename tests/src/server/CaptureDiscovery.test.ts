import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { waitForCondition } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { CaptureDiscovery, CaptureInvocation, createCaptureDiscovery } from '@src/server'
import { describe, expect, it } from 'vitest'
import { ComposedFixture } from '../../fixtures/capture/ComposedFixture.js'
import {
	COMPOSED_FIRST,
	COMPOSED_OWNERS,
	FIXTURE_DISCOVERY_FAULTS,
	FIXTURE_DISCOVERY_MESSAGES,
	FIXTURE_TIMEOUT,
	INPUTS,
	READER_CLOSING,
	VARIANTS,
	withEnvironment,
} from '../../setupServer.js'

interface Discovered {
	readonly description?: Awaited<ReturnType<CaptureDiscovery['describe']>>
	readonly error?: unknown
	readonly output: string
	readonly invocation: CaptureInvocation
}

// Each case builds a Git workspace and spawns a real Node child, so the default budget is thin.
async function discover(
	fixture: ComposedFixture,
	options: {
		readonly fault?: string
		readonly deadline?: number
		readonly config?: string
		readonly interrupt?: boolean
	} = {},
): Promise<Discovered> {
	const output: string[] = []
	const invocation = new CaptureInvocation({
		command: 'journey',
		root: fixture.root,
		requests: fixture.requests,
		stdout: (text) => output.push(text),
		stderr: (text) => output.push(text),
	})
	const discovery = new CaptureDiscovery({
		root: fixture.root,
		config: resolve(fixture.root, options.config ?? fixture.config),
		invocation,
		...(options.deadline === undefined ? {} : { deadline: options.deadline }),
	})
	invocation.attach()
	try {
		return await withEnvironment(
			options.fault === undefined ? {} : { CAPTURE_PRODUCER_DISCOVERY: options.fault },
			async () => {
				const running = discovery.describe().then(
					(description) => ({ description, output: output.join(''), invocation }),
					(error: unknown) => ({ error, output: output.join(''), invocation }),
				)
				if (options.interrupt === true) {
					await waitForCondition(
						'the discovery child reports ready',
						() => fixture.readReady().length > 0,
						{
							budget: 20_000,
						},
					)
					process.emit('SIGINT')
				}
				return await running
			},
		)
	} finally {
		await invocation.release()
	}
}

function readHeld(fixture: ComposedFixture): readonly string[] {
	return readdirSync(resolve(fixture.root, fixture.requests)).filter((name) =>
		name.startsWith('journey-selection'),
	)
}

describe('CaptureDiscovery', { timeout: FIXTURE_TIMEOUT }, () => {
	it('describes every wrapper project in declaration order, with the host data and viewport it declares', async () => {
		const fixture = new ComposedFixture()
		try {
			const { description, error, invocation, output } = await discover(fixture)
			expect(error).toBeUndefined()
			expect(description?.projects.map((entry) => entry.project.variant)).toEqual([...VARIANTS])
			expect(description?.projects.map((entry) => entry.project.name)).toEqual(
				VARIANTS.map((variant) => `journey:${variant}`),
			)
			const project = description?.projects.at(0)?.project
			expect(project).toMatchObject({
				first: COMPOSED_FIRST,
				closing: READER_CLOSING,
				tags: COMPOSED_OWNERS.map((owner) => `owner:${owner}`),
				inputs: [...INPUTS],
			})
			expect(description?.projects.at(0)?.viewport).toEqual({
				name: VARIANTS[0],
				width: 128,
				height: 128,
			})
			expect(description).toMatchObject({
				id: invocation.id,
				config: fixture.config,
				parent: process.pid,
			})
			// The exchange leaves the answer beside the invocation's logs and the request withdrawn.
			expect(existsSync(resolve(invocation.directory, 'description.json'))).toBe(true)
			expect(existsSync(resolve(invocation.directory, 'discovery.log'))).toBe(true)
			expect(readHeld(fixture)).toEqual([])
			expect(output).toMatch(/^pid=\d+\n/u)
		} finally {
			fixture.destroy()
		}
	})

	it('hands the child the request directory it publishes to, so the wrapper side names none', async () => {
		const fixture = new ComposedFixture({ requests: 'var/elsewhere' })
		try {
			const { error, description } = await discover(fixture)
			expect(error).toBeUndefined()
			expect(description?.projects).toHaveLength(VARIANTS.length)
		} finally {
			fixture.destroy()
		}
	})

	it('is a second, independent exchange for a second invocation of the same workspace', async () => {
		const fixture = new ComposedFixture()
		try {
			const first = await discover(fixture)
			const second = await discover(fixture)
			expect(first.error).toBeUndefined()
			expect(second.error).toBeUndefined()
			expect(first.invocation.id).not.toBe(second.invocation.id)
			expect(second.description?.nonce).not.toBe(first.description?.nonce)
		} finally {
			fixture.destroy()
		}
	})

	describe.each(FIXTURE_DISCOVERY_FAULTS.filter((fault) => fault !== 'hang'))(
		'when the wrapper %s',
		(fault) => {
			it('is refused with the refusal that names the fault, and leaves no request behind', async () => {
				const fixture = new ComposedFixture()
				try {
					const { error, description } = await discover(fixture, { fault })
					expect(description).toBeUndefined()
					expect(error).toMatchObject({ code: 'HOST' })
					expect(error instanceof Error ? error.message : '').toContain(
						FIXTURE_DISCOVERY_MESSAGES[fault],
					)
					expect(readHeld(fixture)).toEqual([])
				} finally {
					fixture.destroy()
				}
			})
		},
	)

	it('ends a wrapper that never answers at the deadline, and refuses it by name', async () => {
		const fixture = new ComposedFixture()
		try {
			const { error, description, invocation } = await discover(fixture, {
				fault: 'hang',
				deadline: 1_500,
			})
			expect(description).toBeUndefined()
			expect(error).toMatchObject({ code: 'HOST' })
			expect(invocation.interrupted).toBe(false)
			expect(invocation.signal.aborted).toBe(false)
			expect(error instanceof Error ? error.message : '').toContain(FIXTURE_DISCOVERY_MESSAGES.hang)
			const pids = fixture.readReady()
			expect(pids).toHaveLength(1)
			await waitForCondition('the hung child has exited', () =>
				pids.every((pid) => !isRunning(pid)),
			)
			expect(readHeld(fixture)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('ends the child and refuses as an interrupted run when an interrupt arrives mid-exchange', async () => {
		const fixture = new ComposedFixture()
		try {
			const { error, description, invocation } = await discover(fixture, {
				fault: 'hang',
				interrupt: true,
				deadline: 10_000,
			})
			expect(description).toBeUndefined()
			expect(error).toMatchObject({ code: 'STAGE', message: 'Runner interrupted' })
			expect(invocation.interrupted).toBe(true)
			const pids = fixture.readReady()
			await waitForCondition('the interrupted child has exited', () =>
				pids.every((pid) => !isRunning(pid)),
			)
			expect(readHeld(fixture)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a wrapper that does not exist before any child starts', async () => {
		const fixture = new ComposedFixture()
		try {
			const { error, output } = await discover(fixture, { config: 'configs/missing.config.ts' })
			expect(error).toMatchObject({ code: 'USAGE' })
			expect(error instanceof Error ? error.message : '').toContain(
				'Cannot find the journey wrapper: configs/missing.config.ts',
			)
			expect(output).toBe('')
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a wrapper outside the workspace before any child starts', async () => {
		const fixture = new ComposedFixture()
		try {
			const { error, output } = await discover(fixture, { config: '../outside.config.ts' })
			expect(error).toMatchObject({
				code: 'USAGE',
				message: 'Config must be a contained repository path',
			})
			expect(output).toBe('')
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a workspace with no installed Vitest before any child starts', async () => {
		const fixture = new ComposedFixture()
		try {
			rmSync(resolve(fixture.root, 'node_modules'), { recursive: true, force: true })
			const { error, output } = await discover(fixture)
			expect(error).toMatchObject({ code: 'HOST' })
			expect(error instanceof Error ? error.message : '').toContain(
				"Cannot find the consumer's installed Vitest",
			)
			expect(output).toBe('')
		} finally {
			fixture.destroy()
		}
	})
})

describe('createCaptureDiscovery', () => {
	it('builds the class the factory documents', () => {
		const invocation = new CaptureInvocation({
			command: 'journey',
			root: resolve('workspace'),
			requests: 'tmp/capture',
			stdout: () => undefined,
			stderr: () => undefined,
		})
		expect(
			createCaptureDiscovery({
				root: resolve('workspace'),
				config: resolve('workspace/a.ts'),
				invocation,
			}),
		).toBeInstanceOf(CaptureDiscovery)
	})
})
