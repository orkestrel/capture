import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { attempt, isNumber, parseJSON } from '@orkestrel/contract'
import { killTree } from '@orkestrel/process/server'
import { waitForCondition } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import { isCaptureError } from '@src/core'
import {
	CAPTURE_OWNER_FILE,
	computeCaptureHash,
	escapeCapturePattern,
	settleCaptureShutdown,
} from '@src/server'
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
	runCaptureOwnershipRace,
} from '../../setupServer.js'

const REPORTER = resolve(import.meta.dirname, '../../fixtures/capture/Reporter.ts')
const SLEEPER = resolve(import.meta.dirname, '../../fixtures/capture/Sleeper.ts')
const OUTPUT = resolve(import.meta.dirname, '../../fixtures/capture/Output.ts')

// Each case spawns real Node children, which the default five-second budget leaves thin on a loaded host.
describe('CaptureInvocation', { timeout: FIXTURE_TIMEOUT }, () => {
	it('H1s keeps exactly one owner during repeated stale-marker process races', async () => {
		const fixture = new InvocationFixture()
		try {
			const dead = await readExitedPid()
			for (const round of Array.from({ length: 6 }, (_, index) => index)) {
				fixture.scratch.write(
					`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`,
					JSON.stringify({ pid: dead, id: `stale-${String(round)}` }),
				)
				const outcomes = await runCaptureOwnershipRace(fixture.scratch.path, RUNNER_REQUESTS)
				expect({ round, outcomes }).toMatchObject({ outcomes: expect.arrayContaining(['owner']) })
				expect({ round, owners: outcomes.filter((outcome) => outcome === 'owner') }).toEqual({
					round,
					owners: ['owner'],
				})
				expect({
					round,
					invalid: outcomes.filter(
						(outcome) =>
							outcome !== 'owner' &&
							!(
								typeof outcome === 'string' &&
								outcome.includes('Another runner holds this workspace')
							),
					),
				}).toEqual({ round, invalid: [] })
			}
		} finally {
			fixture.destroy()
		}
	})
	it('H1s release leaves a replacement owner marker intact', async () => {
		const fixture = new InvocationFixture()
		try {
			fixture.invocation.prepare()
			const replacement = JSON.stringify({ pid: process.pid, id: 'replacement-owner' })
			fixture.scratch.write(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`, replacement)
			await fixture.invocation.release()
			expect(fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`)).toBe(replacement)
		} finally {
			fixture.destroy()
		}
	})
	it('H1s recovers when a previous stale-reclaim winner crashed before moving the marker', async () => {
		const fixture = new InvocationFixture()
		try {
			const dead = await readExitedPid()
			const marker = JSON.stringify({ pid: dead, id: 'stale-owner' })
			const fence = JSON.stringify({ pid: dead, id: 'crashed-reclaimer' })
			fixture.scratch.write(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`, marker)
			fixture.scratch.write(
				`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}.reclaim-${computeCaptureHash(marker)}`,
				fence,
			)
			fixture.invocation.prepare()
			expect(
				parseJSON(fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`) ?? ''),
			).toMatchObject({ id: fixture.invocation.id })
		} finally {
			await fixture.invocation.release()
			fixture.destroy()
		}
	})
	it('H1r reclaims a dead owner and reports it while refusing a live owner', async () => {
		const fixture = new InvocationFixture()
		const live = await startSleeper()
		try {
			const dead = await readExitedPid()
			const marker = `${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`
			fixture.scratch.write(marker, JSON.stringify({ pid: live.pid, id: 'live-holder' }))
			expect(() => fixture.invocation.prepare()).toThrow(`process ${String(live.pid)}`)
			expect(() => fixture.invocation.prepare()).toThrow('If this pid is not a capture run')
			fixture.scratch.write(marker, JSON.stringify({ pid: dead, id: 'dead-holder' }))
			fixture.invocation.prepare()
			expect(fixture.stderr.join('')).toContain(
				`Reclaimed stale capture ownership from process ${String(dead)}`,
			)
			expect(parseJSON(fixture.scratch.read(marker) ?? '')).toMatchObject({
				pid: process.pid,
				id: fixture.invocation.id,
			})
		} finally {
			await stopFixtureChild(live)
			await fixture.invocation.release()
			fixture.destroy()
		}
	})
	it('H1r distinguishes empty, unreadable, and absent ownership paths', async () => {
		const fixture = new InvocationFixture()
		const marker = `${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`
		try {
			expect(() => fixture.invocation.publish(createRequestFixture())).toThrow(
				'Capture request directory is unavailable',
			)
			fixture.scratch.write(marker, '')
			expect(() => fixture.invocation.prepare()).toThrow('Capture ownership marker is empty')
			fixture.scratch.write(marker, 'not json')
			expect(() => fixture.invocation.prepare()).toThrow('Capture ownership marker is malformed')
			rmSync(resolve(fixture.scratch.path, marker))
			mkdirSync(resolve(fixture.scratch.path, marker))
			expect(() => fixture.invocation.prepare()).toThrow('Capture ownership marker is unreadable')
		} finally {
			await fixture.invocation.release()
			fixture.destroy()
		}
	})
	it('H1r preserves the shutdown failure when the ownership marker cannot be removed', async () => {
		const fixture = new InvocationFixture()
		try {
			fixture.invocation.prepare()
			fixture.invocation.attach()
			mkdirSync(fixture.invocation.request)
			const marker = resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE)
			rmSync(marker)
			mkdirSync(marker)
			const failure: unknown = await fixture.invocation.release().catch((error: unknown) => error)
			expect(failure).toMatchObject({
				code: 'STAGE',
				message: 'Capture shutdown failed',
				cause: expect.any(AggregateError),
			})
			if (!(failure instanceof Error) || !(failure.cause instanceof AggregateError))
				throw new Error('Missing aggregate shutdown cause')
			expect(failure.cause.errors).toMatchObject([
				{ code: 'STAGE', message: 'Capture request removal failed' },
				{ code: 'EISDIR' },
			])
		} finally {
			await fixture.invocation.release().catch(() => undefined)
			fixture.destroy()
		}
	})
	it('H1r removes the request before beginning even a synchronously refused termination', async () => {
		const fixture = new InvocationFixture()
		try {
			fixture.invocation.prepare()
			fixture.invocation.publish(createRequestFixture())
			const failures = await settleCaptureShutdown(
				() => fixture.invocation.retract(),
				[
					() => {
						expect(fixture.scratch.has(fixture.invocation.request)).toBe(false)
						throw new Error('termination refused synchronously')
					},
				],
			)
			expect(failures).toMatchObject([{ message: 'termination refused synchronously' }])
		} finally {
			await fixture.invocation.release()
			fixture.destroy()
		}
	})
	it('keeps ownership until release has ended a live child', async () => {
		const fixture = new InvocationFixture()
		const other = fixture.next()
		fixture.invocation.prepare()
		fixture.invocation.attach()
		const running = fixture.invocation.spawn(
			[OUTPUT],
			resolve(fixture.invocation.directory, 'release-live.log'),
			false,
		)
		try {
			await waitForCondition('the release child is ready', () =>
				fixture.stdout.join('').includes('ready'),
			)
			const pid = Number(/pid=(\d+)/u.exec(fixture.stdout.join(''))?.[1])
			await fixture.invocation.release()
			expect(isRunning(pid)).toBe(false)
			other.prepare()
			const outcome = await running
			expect(outcome.code !== 0 || outcome.signal !== null).toBe(true)
		} finally {
			const pid = Number(/pid=(\d+)/u.exec(fixture.stdout.join(''))?.[1])
			if (isRunning(pid)) attempt(() => process.kill(pid, 'SIGKILL'))
			await running
			await other.release()
			await fixture.invocation.release()
			fixture.destroy()
		}
	})
	it('settles real child failures and removal failures independently', async () => {
		const fixture = new InvocationFixture()
		try {
			fixture.invocation.prepare()
			mkdirSync(fixture.invocation.request)
			fixture.scratch.write(`${fixture.invocation.request}.tmp`, 'pending')
			const termination = fixture.invocation
				.spawn([REPORTER, '3'], resolve(fixture.invocation.directory, 'termination.log'), false)
				.then((outcome) => {
					if (outcome.code !== 0)
						throw new Error(`Termination command exited ${String(outcome.code)}`)
					return true
				})
			const failures = await settleCaptureShutdown(
				() => fixture.invocation.retract(),
				[() => termination],
			)
			expect(failures).toHaveLength(2)
			expect(fixture.scratch.has(`${fixture.invocation.request}.tmp`)).toBe(false)
			expect(failures[1]).toMatchObject({ message: 'Termination command exited 3' })
			const dead = await readExitedPid()
			expect(
				await settleCaptureShutdown(() => undefined, [() => killTree(dead, 5_000)]),
			).toMatchObject([{ code: 'STAGE', message: 'Capture child termination was not confirmed' }])
		} finally {
			await fixture.invocation.release().catch(() => undefined)
			fixture.destroy()
		}
	})
	it('refuses overlapping ownership and preserves the named holder request', async () => {
		const fixture = new InvocationFixture()
		const other = fixture.next()
		try {
			fixture.invocation.prepare()
			fixture.invocation.publish(createRequestFixture({ pid: process.pid }))
			const before = fixture.scratch.read(fixture.invocation.request)
			expect(() => other.prepare()).toThrow(`process ${String(process.pid)}`)
			expect(() => other.publish(createRequestFixture({ pid: process.pid }))).toThrow(
				fixture.invocation.id,
			)
			other.retract()
			expect(fixture.scratch.read(fixture.invocation.request)).toBe(before)
			await fixture.invocation.release()
			other.prepare()
			other.publish(createRequestFixture({ pid: process.pid }))
			expect(fixture.scratch.has(other.request)).toBe(true)
		} finally {
			await other.release()
			await fixture.invocation.release()
			fixture.destroy()
		}
	})

	it('removes listeners and ends a real child when request removal fails during shutdown', async () => {
		const fixture = new InvocationFixture()
		const { invocation, stdout } = fixture
		const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]
		try {
			invocation.prepare()
			invocation.attach()
			const running = invocation.spawn(
				[OUTPUT],
				resolve(invocation.directory, 'shutdown.log'),
				false,
			)
			await waitForCondition('the shutdown child is ready', () => stdout.join('').includes('ready'))
			mkdirSync(invocation.request)
			expect(() => process.emit('SIGINT')).not.toThrow()
			await expect(invocation.release()).rejects.toMatchObject({ code: 'STAGE' })
			const result = await running
			expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before)
			expect(result.pid).toBeDefined()
			if (result.pid === undefined) throw new Error('Missing child pid')
			expect(isRunning(result.pid)).toBe(false)
		} finally {
			await invocation.release().catch(() => undefined)
			fixture.destroy()
		}
	})
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
			for (const stream of ['€\rprogress\rcomplete', 'diagnostic\rno newline'])
				expect(text).toMatch(
					new RegExp([...stream].map(escapeCapturePattern).join('[\\s\\S]*'), 'u'),
				)
			expect(text.length).toBe('€\rprogress\rcomplete'.length + 'diagnostic\rno newline'.length)
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

	it('refuses a writer failure on the flushed final sequence', async () => {
		const fixture = new InvocationFixture()
		const invocation = fixture.next({
			stdout: (text: string) => {
				if (text !== '' && !text.startsWith('pid=')) throw new Error('writer refused')
			},
		})
		try {
			invocation.prepare()
			await expect(
				invocation.spawn([OUTPUT, 'partial'], resolve(invocation.directory, 'tail.log'), false),
			).rejects.toMatchObject({
				code: 'STAGE',
				message: 'Capture child output could not be recorded',
			})
		} finally {
			fixture.destroy()
		}
	})

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
			const execution = invocation.spawn(
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
			const outcome = await execution
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
					.filter((name) => name !== 'runs' && !name.startsWith(CAPTURE_OWNER_FILE))
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
			const execution = invocation.spawn(
				[SLEEPER],
				resolve(invocation.directory, 'sleep.log'),
				false,
			)
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
			const outcome = await execution
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

	it('lists every other holder including a request under the same process id', async () => {
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
			expect(invocation.holders().toSorted()).toEqual([live.pid, process.pid].toSorted())
			// Listing changes nothing: the dead process's file is pruned by `prepare`, not by this read.
			expect(scratch.has(`${RUNNER_REQUESTS}/journey-selection-${String(dead)}.json`)).toBe(true)
		} finally {
			await stopFixtureChild(live)
			fixture.destroy()
		}
	})
})
