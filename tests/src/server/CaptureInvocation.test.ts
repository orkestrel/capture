import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { attempt, isNumber, parseJSON } from '@orkestrel/contract'
import { killTree } from '@orkestrel/process/server'
import { waitForCondition } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { isCaptureError } from '@src/core'
import { describe, expect, it } from 'vitest'
import { InvocationFixture } from '../../fixtures/capture/InvocationFixture.js'
import {
	readExitedPid,
	startSleeper,
	stopFixtureChild,
} from '../../fixtures/capture/ProcessFixture.js'
import { createRequestFixture } from '../../setup.js'
import {
	FIXTURE_TIMEOUT,
	RUNNER_REQUESTS,
	SUPPORTS_GROUP_SIGNAL,
	withEnvironment,
} from '../../setupServer.js'

const REPORTER = resolve(import.meta.dirname, '../../fixtures/capture/Reporter.ts')
const SLEEPER = resolve(import.meta.dirname, '../../fixtures/capture/Sleeper.ts')
const OUTPUT = resolve(import.meta.dirname, '../../fixtures/capture/Output.ts')

// Each case spawns real Node children, which the default five-second budget leaves thin on a loaded host.
describe('CaptureInvocation', { timeout: FIXTURE_TIMEOUT }, () => {
	it('passes the complete filtered environment without reintroducing case-folded request aliases', async () => {
		const fixture = new InvocationFixture()
		try {
			const { invocation, stdout, scratch } = fixture
			invocation.prepare()
			await withEnvironment(
				{ Capture: 'old', capture_requests: 'wrong', CAPTURE_FIXTURE: 'inherited' },
				() =>
					invocation.spawn(
						[OUTPUT, 'environment'],
						resolve(invocation.directory, 'environment.log'),
						true,
					),
			)
			expect(parseJSON(stdout.join('').replace(/^pid=\d+\n/u, ''))).toEqual({
				capture: [['CAPTURE', '1']],
				requests: [['CAPTURE_REQUESTS', resolve(scratch.path, RUNNER_REQUESTS)]],
				inherited: 'inherited',
			})
		} finally {
			fixture.destroy()
		}
	})

	it('destroys a launched child when the initial pid writer throws', async () => {
		const fixture = new InvocationFixture()
		const invocation = fixture.next({
			stdout: (text) => {
				fixture.stdout.push(text)
				throw new Error('pid writer refused')
			},
		})
		try {
			invocation.prepare()
			await expect(
				invocation.spawn([OUTPUT], resolve(invocation.directory, 'pid.log'), false),
			).rejects.toMatchObject({
				code: 'STAGE',
				cause: expect.objectContaining({ message: 'pid writer refused' }),
			})
			const pid = Number(/pid=(\d+)/u.exec(fixture.stdout.join(''))?.[1])
			expect(Number.isInteger(pid)).toBe(true)
			await waitForCondition('the child with a failed pid writer is gone', () => !isRunning(pid))
		} finally {
			fixture.destroy()
		}
	})
	it('preserves split UTF-8, carriage returns, and absent final newlines in the tee', async () => {
		const fixture = new InvocationFixture()
		try {
			const { invocation, stdout, stderr, scratch } = fixture
			invocation.prepare()
			const log = resolve(invocation.directory, 'bytes.log')
			const outcome = await invocation.spawn([OUTPUT, 'bytes'], log, false)
			expect(outcome.code).toBe(0)
			expect(stdout.join('')).toBe(`pid=${String(outcome.pid)}\n€\rprogress\rcomplete`)
			expect(stderr.join('')).toBe('diagnostic\rno newline')
			const text = scratch.read(log) ?? ''
			expect(text).toContain('€\rprogress\rcomplete')
			expect(text).toContain('diagnostic\rno newline')
			expect(text).not.toContain('\uFFFD')
			expect(text.endsWith('\n')).toBe(false)
		} finally {
			fixture.destroy()
		}
	})

	it('flushes an incomplete final UTF-8 sequence at termination', async () => {
		const fixture = new InvocationFixture()
		try {
			const { invocation, stdout, scratch } = fixture
			invocation.prepare()
			const log = resolve(invocation.directory, 'partial.log')
			const outcome = await invocation.spawn([OUTPUT, 'partial'], log, false)
			expect(stdout.join('')).toBe(`pid=${String(outcome.pid)}\n\uFFFD`)
			expect(scratch.read(log)).toBe('\uFFFD')
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a pre-aborted invocation before launching a child or opening its log', async () => {
		const fixture = new InvocationFixture()
		const { invocation, scratch, stdout } = fixture
		try {
			invocation.prepare()
			invocation.attach()
			process.emit('SIGINT')
			const log = resolve(invocation.directory, 'never.log')
			await expect(invocation.spawn([OUTPUT], log, false, 0)).rejects.toMatchObject({
				code: 'STAGE',
				message: 'Runner interrupted',
			})
			expect(invocation.launched(log)).toBe(false)
			expect(scratch.has(log)).toBe(false)
			expect(stdout).toEqual([])
		} finally {
			await invocation.release()
			fixture.destroy()
		}
	})

	it.each(['stdout', 'stderr'] as const)(
		'refuses a %s writer failure despite session listener isolation',
		async (stream) => {
			const fixture = new InvocationFixture()
			const invocation = fixture.next({
				[stream]: (text: string) => {
					if (text.startsWith('pid=')) fixture.stdout.push(text)
					else throw new Error('writer refused')
				},
			})
			try {
				invocation.prepare()
				await expect(
					invocation.spawn([OUTPUT, 'bytes'], resolve(invocation.directory, 'writer.log'), false),
				).rejects.toMatchObject({
					code: 'STAGE',
					message: 'Capture child output could not be recorded',
				})
				const pid = Number(/pid=(\d+)/u.exec(fixture.stdout.join(''))?.[1])
				await waitForCondition('the child with a failed writer is gone', () => !isRunning(pid))
			} finally {
				fixture.destroy()
			}
		},
	)

	it('refuses a log append failure and destroys the child', async () => {
		const fixture = new InvocationFixture()
		const invocation = fixture.next({
			stdout: (text) => {
				fixture.stdout.push(text)
				if (text.startsWith('pid=')) {
					const log = resolve(invocation.directory, 'broken.log')
					rmSync(log)
					mkdirSync(log)
				}
			},
		})
		try {
			invocation.prepare()
			await expect(
				invocation.spawn([OUTPUT], resolve(invocation.directory, 'broken.log'), false),
			).rejects.toMatchObject({
				code: 'STAGE',
				message: 'Capture child output could not be recorded',
			})
			const pid = Number(/pid=(\d+)/u.exec(fixture.stdout.join(''))?.[1])
			await waitForCondition('the child with a failed log is gone', () => !isRunning(pid))
		} finally {
			fixture.destroy()
		}
	})

	it('ends a child and its descendant together on interruption', async () => {
		const fixture = new InvocationFixture()
		const { invocation, stdout, scratch } = fixture
		try {
			invocation.prepare()
			invocation.attach()
			const closing = invocation.spawn(
				[OUTPUT, 'tree'],
				resolve(invocation.directory, 'tree.log'),
				false,
			)
			await waitForCondition('the descendant is ready', () =>
				stdout.join('').includes('descendant='),
			)
			const descendant: unknown = parseJSON(scratch.read('descendant.json') ?? '')
			expect(isNumber(descendant)).toBe(true)
			process.emit('SIGINT')
			const outcome = await closing
			await waitForCondition(
				'the whole tree has exited',
				() =>
					isNumber(descendant) &&
					!isRunning(descendant) &&
					outcome.pid !== undefined &&
					!isRunning(outcome.pid),
			)
		} finally {
			await invocation.release()
			fixture.destroy()
		}
	})

	it('refuses a successful root exit when an inherited pipe cuts observation off', async () => {
		const fixture = new InvocationFixture()
		const { invocation, scratch } = fixture
		try {
			invocation.prepare()
			await expect(
				invocation.spawn([OUTPUT, 'orphan'], resolve(invocation.directory, 'orphan.log'), false),
			).rejects.toMatchObject({
				code: 'STAGE',
				message: 'Capture child observation was cut off before its output drained',
			})
		} finally {
			const descendant: unknown = parseJSON(scratch.read('descendant.json') ?? 'null')
			if (isNumber(descendant) && isRunning(descendant)) {
				if (process.platform === 'win32') await killTree(descendant, 5_000)
				else attempt(() => process.kill(descendant, 'SIGKILL'))
				await waitForCondition('the orphan fixture is gone', () => !isRunning(descendant))
			}
			fixture.destroy()
		}
	})

	it('keeps interruption ahead of a still-armed deadline', async () => {
		const fixture = new InvocationFixture()
		const invocation = fixture.next({
			stdout: (text) => {
				fixture.stdout.push(text)
				if (text.includes('ready')) process.emit('SIGINT')
			},
		})
		try {
			invocation.prepare()
			invocation.attach()
			const outcome = await invocation.spawn(
				[OUTPUT],
				resolve(invocation.directory, 'interrupt-first.log'),
				false,
				10_000,
			)
			expect(outcome.expired).toBeUndefined()
			expect(invocation.interrupted).toBe(true)
		} finally {
			await invocation.release()
			fixture.destroy()
		}
	})

	// Windows tree termination delivers no SIGTERM callback in which to schedule this interrupt.
	it.runIf(SUPPORTS_GROUP_SIGNAL)(
		'retains deadline expiry when an interrupt arrives during the POSIX grace window',
		async () => {
			const fixture = new InvocationFixture()
			const invocation = fixture.next({
				stdout: (text) => {
					fixture.stdout.push(text)
					if (text.includes('terminating')) process.emit('SIGINT')
				},
			})
			try {
				invocation.prepare()
				invocation.attach()
				const outcome = await invocation.spawn(
					[OUTPUT, 'grace'],
					resolve(invocation.directory, 'deadline-first.log'),
					false,
					1_500,
				)
				expect(fixture.stdout.join('')).toContain('terminating')
				expect(outcome.expired).toBe(true)
				expect(invocation.interrupted).toBe(true)
			} finally {
				await invocation.release()
				fixture.destroy()
			}
		},
	)
	it('names its request by the process id and its report directory by its own identity', () => {
		const fixture = new InvocationFixture()
		try {
			const { invocation, scratch } = fixture
			const other = fixture.next()
			expect(invocation.request).toBe(
				resolve(scratch.path, RUNNER_REQUESTS, `journey-selection-${String(process.pid)}.json`),
			)
			expect(invocation.directory).toBe(
				resolve(scratch.path, RUNNER_REQUESTS, 'runs', invocation.id),
			)
			expect(invocation.id).not.toBe(other.id)
			expect(invocation.directory).not.toBe(other.directory)
			expect(invocation.interrupted).toBe(false)
			expect(invocation.signal.aborted).toBe(false)
		} finally {
			fixture.destroy()
		}
	})

	it('publishes the request whole and retracts it with its temporary sibling', () => {
		const fixture = new InvocationFixture()
		try {
			const { invocation, scratch } = fixture
			const request = createRequestFixture({ pid: process.pid })
			scratch.ensure(RUNNER_REQUESTS)
			invocation.publish(request)
			expect(parseJSON(scratch.read(invocation.request) ?? '')).toEqual(request)
			expect(scratch.read(invocation.request)?.endsWith('}\n')).toBe(true)
			expect(scratch.has(`${invocation.request}.tmp`)).toBe(false)
			scratch.write(`${invocation.request}.tmp`, 'leftover')
			invocation.retract()
			expect(scratch.has(invocation.request)).toBe(false)
			expect(scratch.has(`${invocation.request}.tmp`)).toBe(false)
			expect(() => invocation.retract()).not.toThrow()
		} finally {
			fixture.destroy()
		}
	})

	it('prunes a request under a dead process id and keeps a live one, an unrelated name, and its own', async () => {
		const fixture = new InvocationFixture()
		const live = await startSleeper()
		try {
			const { invocation, scratch } = fixture
			const dead = await readExitedPid()
			const kept = [
				`journey-selection-${String(live.pid)}.json`,
				`journey-selection-${String(live.pid)}.json.tmp`,
				`journey-selection-${String(process.pid)}.json`,
				'journey-selection.json',
				'journey-selection-0.json',
				'journey-selection-abc.json',
				'unrelated.txt',
			]
			const pruned = [
				`journey-selection-${String(dead)}.json`,
				`journey-selection-${String(dead)}.json.tmp`,
			]
			for (const name of [...kept, ...pruned])
				scratch.write(`${RUNNER_REQUESTS}/${name}`, `bytes of ${name}`)
			invocation.prepare()
			expect(
				scratch
					.names(RUNNER_REQUESTS)
					.filter((name) => name !== 'runs')
					.toSorted(),
			).toEqual(kept.toSorted())
			for (const name of kept)
				expect(scratch.read(`${RUNNER_REQUESTS}/${name}`)).toBe(`bytes of ${name}`)
			expect(scratch.has(`${RUNNER_REQUESTS}/runs/${invocation.id}`)).toBe(true)
		} finally {
			await stopFixtureChild(live)
			fixture.destroy()
		}
	})

	it('tees child output to both writers and the log, runs the child in the workspace, and reports its exit', async () => {
		const fixture = new InvocationFixture()
		try {
			const { invocation, scratch, stdout, stderr } = fixture
			invocation.prepare()
			const log = resolve(invocation.directory, 'journey-narrow.log')
			expect(invocation.launched(log)).toBe(false)
			const outcome = await invocation.spawn([REPORTER, '3'], log, false)
			expect(outcome).toEqual({ code: 3, signal: null, pid: expect.any(Number) })
			expect(stdout.join('')).toContain(`pid=${String(outcome.pid)}\n`)
			expect(invocation.launched(log)).toBe(true)
			expect(stdout.join('')).toMatch(/^pid=\d+\n/u)
			// The child reads the request directory the runner publishes to, so a wrapper never repeats it.
			expect(parseJSON(stdout.join('').split(/\r\n|\n/u)[1] ?? '')).toEqual({
				cwd: realpathSync(scratch.path),
				capture: [],
				requests: resolve(scratch.path, RUNNER_REQUESTS),
			})
			expect(stderr.join('')).toBe('reporter stderr\n')
			const text = scratch.read(log) ?? ''
			expect(text).toContain('reporter stderr')
			expect(text).toContain('"capture":[]')
		} finally {
			fixture.destroy()
		}
	})

	it.each([
		{ capture: false, expected: [] },
		{ capture: true, expected: [['CAPTURE', '1']] },
	])(
		'folds an inherited capture variable when capture is $capture',
		async ({ capture, expected }) => {
			const fixture = new InvocationFixture()
			try {
				const { invocation, stdout } = fixture
				invocation.prepare()
				await withEnvironment({ Capture: 'old' }, () =>
					invocation.spawn([REPORTER], resolve(invocation.directory, 'fold.log'), capture),
				)
				expect(parseJSON(stdout.join('').split(/\r\n|\n/u)[1] ?? '')).toMatchObject({
					capture: expected,
				})
			} finally {
				fixture.destroy()
			}
		},
	)

	it('ends a running child on an interrupt, aborts its signal, and restores the handlers', async () => {
		const fixture = new InvocationFixture()
		try {
			const { invocation, scratch, stdout } = fixture
			invocation.prepare()
			const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]
			invocation.attach()
			expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual([
				(before[0] ?? 0) + 1,
				(before[1] ?? 0) + 1,
			])
			const closing = invocation.spawn([SLEEPER], resolve(invocation.directory, 'sleep.log'), false)
			await waitForCondition('the sleeper reports ready', () =>
				stdout.join('').includes('descendant ready'),
			)
			const pid = Number(/pid=(\d+)/u.exec(stdout.join(''))?.[1])
			expect(isRunning(pid)).toBe(true)
			scratch.write(invocation.request, 'a published request')
			process.emit('SIGINT')
			// A second interrupt reaches the same handler and changes nothing.
			process.emit('SIGINT')
			await invocation.release()
			const outcome = await closing
			await waitForCondition('the sleeper has exited', () => !isRunning(pid))
			expect(outcome.code !== 0 || outcome.signal !== null).toBe(true)
			expect(invocation.interrupted).toBe(true)
			expect(invocation.signal.aborted).toBe(true)
			expect(isCaptureError(invocation.signal.reason)).toBe(true)
			expect(scratch.has(invocation.request)).toBe(false)
			expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before)
		} finally {
			fixture.destroy()
		}
	})

	it('ends a child that outlives its deadline and says the deadline ended it, not an interrupt', async () => {
		const fixture = new InvocationFixture()
		try {
			const { invocation, stdout } = fixture
			invocation.prepare()
			const outcome = await invocation.spawn(
				[SLEEPER],
				resolve(invocation.directory, 'late.log'),
				false,
				1_500,
			)
			const pid = Number(/pid=(\d+)/u.exec(stdout.join(''))?.[1])
			expect(outcome).toMatchObject({ pid, expired: true })
			await waitForCondition('the expired child has exited', () => !isRunning(pid))
			expect(invocation.interrupted).toBe(false)
			expect(invocation.signal.aborted).toBe(false)
		} finally {
			fixture.destroy()
		}
	})

	it('releases without an interrupt and leaves no handler behind', async () => {
		const fixture = new InvocationFixture()
		try {
			const { invocation } = fixture
			const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]
			invocation.attach()
			await invocation.release()
			expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before)
			expect(invocation.interrupted).toBe(false)
		} finally {
			fixture.destroy()
		}
	})

	it('lists each other live process that holds a request file once, and no dead, unrelated, or own file', async () => {
		const fixture = new InvocationFixture()
		const live = await startSleeper()
		try {
			const { invocation, scratch } = fixture
			scratch.ensure(RUNNER_REQUESTS)
			expect(invocation.holders()).toEqual([])
			const dead = await readExitedPid()
			for (const name of [
				`journey-selection-${String(live.pid)}.json`,
				`journey-selection-${String(live.pid)}.json.tmp`,
				`journey-selection-${String(process.pid)}.json`,
				`journey-selection-${String(dead)}.json`,
				'journey-selection-abc.json',
				'unrelated.txt',
			])
				scratch.write(`${RUNNER_REQUESTS}/${name}`, `bytes of ${name}`)
			expect(invocation.holders()).toEqual([live.pid])
			// Listing changes nothing: the dead process's file is pruned by `prepare`, not by this read.
			expect(scratch.has(`${RUNNER_REQUESTS}/journey-selection-${String(dead)}.json`)).toBe(true)
		} finally {
			await stopFixtureChild(live)
			fixture.destroy()
		}
	})
})
