import { linkSync, readFileSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { attempt, isNumber, isRecord, parseJSON } from '@orkestrel/contract'
import { killTree } from '@orkestrel/process/server'
import { waitForCondition } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { isCaptureError } from '@src/core'
import {
	CAPTURE_DEFAULTS,
	CaptureCLI,
	CaptureInvocation,
	CAPTURE_OWNER_FILE,
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
	leaveCaptureTemporary,
	readCaptureHeld,
	leaveCaptureSurvivor,
	leaveCaptureUnconfirmed,
	CAPTURE_OWNERSHIP_CASES,
} from '../../setupServer.js'

const REPORTER = resolve(import.meta.dirname, '../../fixtures/capture/Reporter.ts')
const SLEEPER = resolve(import.meta.dirname, '../../fixtures/capture/Sleeper.ts')
const OUTPUT = resolve(import.meta.dirname, '../../fixtures/capture/Output.ts')

// Each case spawns real Node children, which the default five-second budget leaves thin on a loaded host.
describe('CaptureInvocation', { timeout: FIXTURE_TIMEOUT }, () => {
	it('X7 refuses a request path occupied by a file with a CaptureError and a CLI diagnostic', async () => {
		const scratch = createScratch({ prefix: 'x7-requests-file-' })
		const invocation = new CaptureInvocation({
			command: 'journey',
			root: scratch.path,
			requests: CAPTURE_DEFAULTS.requests,
			stdout: () => undefined,
			stderr: () => undefined,
		})
		try {
			scratch.write(CAPTURE_DEFAULTS.requests, 'not a directory\n')
			const result = attempt(() => invocation.prepare())
			const error = result.success ? undefined : result.error
			const message = `Capture request directory is unavailable: ${resolve(scratch.path, CAPTURE_DEFAULTS.requests)}`
			expect
				.soft({
					refused: !result.success,
					capture: isCaptureError(error),
					message: error instanceof Error ? error.message : String(error),
				})
				.toEqual({ refused: true, capture: true, message })
			const stderr: string[] = []
			const code = await new CaptureCLI({
				root: scratch.path,
				stdout: () => undefined,
				stderr: (text) => stderr.push(text),
			}).execute(['journey', 'pages:mail'])
			expect(code).toBe(1)
			expect.soft(stderr.join('')).toContain(message)
			expect(stderr.join('')).not.toMatch(/^E[A-Z]+: /mu)
		} finally {
			await invocation.release()
			scratch.destroy()
		}
	})
	it('X6 writes a create-only survivor record and keeps the marker byte-identical', async () => {
		const fixture = new InvocationFixture()
		const confirmation = new AbortController()
		const invocation = fixture.next({
			terminate: async (child) => (confirmation.signal.aborted ? await child.stop() : false),
		})
		invocation.prepare()
		const marker = resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE)
		const before = readFileSync(marker, 'utf8')
		const record = resolve(invocation.directory, 'survivors.json')
		const executions = ['first', 'second'].map((name) =>
			invocation.spawn([OUTPUT], resolve(invocation.directory, `${name}.log`), false),
		)
		try {
			await waitForCondition(
				'both survivor children are ready',
				() => fixture.stdout.join('').split('ready').length === 3,
			)
			const pids = [...fixture.stdout.join('').matchAll(/pid=(\d+)/gu)].map((match) =>
				Number(match[1]),
			)
			const failure: unknown = await invocation.release().catch((error: unknown) => error)
			expect(failure).toMatchObject({ code: 'STAGE' })
			expect.soft(String(failure)).toContain(record)
			expect(String(failure)).toContain(marker)
			for (const pid of pids) expect(String(failure)).toContain(String(pid))
			expect.soft(readFileSync(marker, 'utf8')).toBe(before)
			const bytes = readFileSync(record, 'utf8')
			expect(parseJSON(bytes)).toEqual({
				pid: process.pid,
				id: invocation.id,
				command: 'journey',
				children: pids,
				at: expect.any(String),
			})
			writeFileSync(record, `${bytes}\n`)
			await expect(invocation.release()).rejects.toThrow(record)
			expect(readFileSync(record, 'utf8')).toBe(`${bytes}\n`)
			expect(readFileSync(marker, 'utf8')).toBe(before)
			confirmation.abort()
			await invocation.release()
			await Promise.all(executions)
			expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
			for (const pid of pids) expect(isRunning(pid)).toBe(false)
		} finally {
			confirmation.abort()
			await invocation.release().catch(() => undefined)
			await Promise.allSettled(executions)
			fixture.destroy()
		}
	})
	it.each(['present', 'absent', 'unreadable', 'malformed'])(
		'X6 reports a dead owner with its %s advisory record',
		async (state) => {
			const fixture = new InvocationFixture()
			const dead = await readExitedPid()
			const marker = resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE)
			const record = resolve(
				fixture.scratch.path,
				RUNNER_REQUESTS,
				'runs',
				'dead-record-owner',
				'survivors.json',
			)
			const content = JSON.stringify({ pid: dead, id: 'dead-record-owner' })
			fixture.scratch.write(marker, content)
			if (state === 'present')
				fixture.scratch.write(
					record,
					JSON.stringify({
						pid: dead,
						id: 'dead-record-owner',
						command: 'journey',
						children: [process.pid],
						at: new Date().toISOString(),
					}),
				)
			if (state === 'unreadable') mkdirSync(record, { recursive: true })
			if (state === 'malformed') fixture.scratch.write(record, '{')
			try {
				const result = attempt(() => fixture.invocation.prepare())
				expect(result.success).toBe(false)
				const message = result.success ? '' : String(result.error)
				expect(message).toContain(`process ${String(dead)} is not running`)
				expect.soft(message).toContain('invocation "dead-record-owner"')
				expect(message).toContain(marker)
				expect(message).toContain(record)
				expect(message).toContain(
					state === 'present'
						? `Unconfirmed child processes: ${String(process.pid)}`
						: state === 'absent'
							? 'No child record exists at'
							: 'Child record could not be read',
				)
				expect(message).toContain(
					state === 'unreadable'
						? 'EISDIR'
						: state === 'malformed'
							? 'EINVAL'
							: 'Confirm no capture process',
				)
				expect(readFileSync(marker, 'utf8')).toBe(content)
			} finally {
				fixture.destroy()
			}
		},
	)
	it.each(['ENOENT', 'EACCES', 'EBUSY', 'foreign'])(
		'X6 retains ownership on record write %s and retries only missing directory once',
		async (code) => {
			const fixture = new InvocationFixture()
			const confirmation = new AbortController()
			const writes: string[] = []
			const invocation = fixture.next({
				terminate: async (child) => (confirmation.signal.aborted ? await child.stop() : false),
				ownership: {
					write: (file, text) => {
						if (file.endsWith('survivors.json')) {
							writes.push(file)
							throw Object.assign(new Error('record write refused'), { code })
						}
						writeFileSync(file, text, { flag: 'wx' })
					},
				},
			})
			invocation.prepare()
			const marker = resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE)
			const foreign = JSON.stringify({ pid: process.pid, id: 'foreign-record-owner' })
			if (code === 'foreign') writeFileSync(marker, foreign)
			const before = readFileSync(marker, 'utf8')
			const record = resolve(invocation.directory, 'survivors.json')
			const execution = invocation.spawn(
				[OUTPUT],
				resolve(invocation.directory, 'refusal.log'),
				false,
			)
			try {
				await waitForCondition('the record-fault child is ready', () =>
					fixture.stdout.join('').includes('ready'),
				)
				const failure: unknown = await invocation.release().catch((error: unknown) => error)
				expect(failure).toMatchObject({ code: 'STAGE', message: expect.stringContaining(record) })
				if (!(failure instanceof Error) || !(failure.cause instanceof AggregateError))
					throw new Error('Missing shutdown cause')
				expect(failure.cause.errors.map(String).join('\n')).toContain(
					code === 'foreign' ? 'termination was not confirmed' : `(${code})`,
				)
				expect(writes).toHaveLength(code === 'foreign' ? 0 : code === 'ENOENT' ? 2 : 1)
				expect(readFileSync(marker, 'utf8')).toBe(before)
			} finally {
				confirmation.abort()
				await invocation.release().catch(() => undefined)
				await execution.catch(() => undefined)
				fixture.destroy()
			}
		},
	)
	it('X6 creates a missing run directory for the survivor record', async () => {
		const fixture = new InvocationFixture()
		const confirmation = new AbortController()
		const invocation = fixture.next({
			terminate: async (child) => (confirmation.signal.aborted ? await child.stop() : false),
		})
		invocation.prepare()
		const marker = resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE)
		const before = readFileSync(marker, 'utf8')
		const execution = invocation.spawn(
			[OUTPUT],
			resolve(invocation.directory, 'missing.log'),
			false,
		)
		try {
			await waitForCondition('the missing-directory child is ready', () =>
				fixture.stdout.join('').includes('ready'),
			)
			rmSync(invocation.directory, { recursive: true, force: true })
			const record = resolve(invocation.directory, 'survivors.json')
			await expect(invocation.release()).rejects.toThrow(record)
			expect(parseJSON(readFileSync(record, 'utf8'))).toMatchObject({
				id: invocation.id,
				command: 'journey',
			})
			expect(readFileSync(marker, 'utf8')).toBe(before)
		} finally {
			confirmation.abort()
			await invocation.release().catch(() => undefined)
			await execution.catch(() => undefined)
			fixture.destroy()
		}
	})
	it.each([false, true])(
		'X6 reads a dead holder record once and a live holder record never, alive=%s',
		async (alive) => {
			const fixture = new InvocationFixture()
			const reads: string[] = []
			const marker = resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE)
			const record = resolve(
				fixture.scratch.path,
				RUNNER_REQUESTS,
				'runs',
				'record-read-owner',
				'survivors.json',
			)
			const invocation = fixture.next({
				ownership: {
					alive: () => alive,
					read: (file) => {
						reads.push(file)
						if (file === record) throw Object.assign(new Error('record busy'), { code: 'EBUSY' })
						return readFileSync(file, 'utf8')
					},
				},
			})
			try {
				fixture.scratch.write(
					marker,
					JSON.stringify({
						pid: process.pid,
						id: 'record-read-owner',
						children: 'ignored extra member',
					}),
				)
				const refusal = attempt(() => invocation.prepare())
				expect(refusal.success).toBe(false)
				const message = refusal.success ? '' : String(refusal.error)
				expect(message).toContain(
					alive ? 'Another runner holds' : 'Child record could not be read (EBUSY)',
				)
				expect(reads).toEqual(alive ? [marker, marker] : [marker, marker, record])
			} finally {
				fixture.destroy()
			}
		},
	)
	it('X6 ignores a dead temporary removal failure and preserves a live temporary', async () => {
		const fixture = new InvocationFixture()
		try {
			const dead = await readExitedPid()
			const blocked = resolve(
				fixture.scratch.path,
				RUNNER_REQUESTS,
				`${CAPTURE_OWNER_FILE}.${String(dead)}.blocked.tmp`,
			)
			mkdirSync(blocked, { recursive: true })
			writeFileSync(resolve(blocked, 'content'), 'directory prevents nonrecursive removal')
			const live = resolve(
				fixture.scratch.path,
				RUNNER_REQUESTS,
				`${CAPTURE_OWNER_FILE}.${String(process.pid)}.live.tmp`,
			)
			writeFileSync(live, 'live claim bytes')
			expect(() => fixture.invocation.prepare()).not.toThrow()
			expect(readFileSync(live, 'utf8')).toBe('live claim bytes')
			expect(readFileSync(resolve(blocked, 'content'), 'utf8')).toBe(
				'directory prevents nonrecursive removal',
			)
			await fixture.invocation.release()
		} finally {
			fixture.destroy()
		}
	})
	it('X6 checks the id after a failed removal and leaves a foreign marker untouched', async () => {
		const fixture = new InvocationFixture()
		const removals: string[] = []
		const foreign = JSON.stringify({ pid: process.pid, id: 'foreign-after-remove' })
		const invocation = fixture.next({
			ownership: {
				remove: (file) => {
					removals.push(file)
					writeFileSync(file, foreign)
					throw Object.assign(new Error('busy removal'), { code: 'EBUSY' })
				},
			},
		})
		try {
			invocation.prepare()
			await invocation.release()
			expect(removals).toHaveLength(1)
			expect(fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`)).toBe(foreign)
		} finally {
			fixture.destroy()
		}
	})
	it('X6 retains the marker after removal exhaustion and reports the code without deletion advice', async () => {
		const fixture = new InvocationFixture()
		const inactive = new AbortController()
		const invocation = fixture.next({
			ownership: {
				remove: (file) => {
					if (!inactive.signal.aborted)
						throw Object.assign(new Error('busy removal'), { code: 'EBUSY' })
					rmSync(file, { force: true })
				},
			},
		})
		try {
			invocation.prepare()
			const marker = resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE)
			const before = readFileSync(marker, 'utf8')
			const failure: unknown = await invocation.release().catch((error: unknown) => error)
			if (!(failure instanceof Error) || !(failure.cause instanceof AggregateError))
				throw new Error('Missing shutdown cause')
			const message = failure.cause.errors.map(String).join('\n')
			expect(message).toContain('temporarily unavailable (EBUSY)')
			expect(message).not.toContain('delet')
			expect(readFileSync(marker, 'utf8')).toBe(before)
		} finally {
			inactive.abort()
			await invocation.release()
			fixture.destroy()
		}
	})
	it('X6 labels a permanent error on the liveness re-read as unreadable', () => {
		const fixture = new InvocationFixture()
		const probed = new AbortController()
		const invocation = fixture.next({
			ownership: {
				alive: () => {
					probed.abort()
					return false
				},
				read: (file) => {
					if (probed.signal.aborted) throw Object.assign(new Error('read fault'), { code: 'EIO' })
					return readFileSync(file, 'utf8')
				},
			},
		})
		try {
			fixture.scratch.write(
				`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`,
				JSON.stringify({ pid: process.pid, id: 'probe-error' }),
			)
			const refusal = attempt(() => invocation.prepare())
			expect(refusal).toMatchObject({
				success: false,
				error: { message: expect.stringContaining('marker is unreadable'), cause: { code: 'EIO' } },
			})
			expect(refusal.success ? '' : String(refusal.error)).not.toContain('delet')
		} finally {
			fixture.destroy()
		}
	})
	it.each(['linux', 'win32'] as const)(
		'H1x classifies read and remove errors on %s',
		async (platform) => {
			for (const operation of ['read', 'remove'] as const) {
				for (const code of ['EPERM', 'EACCES', 'EBUSY', 'EMFILE']) {
					const fixture = new InvocationFixture()
					const calls: string[] = []
					const inactive = new AbortController()
					const invocation = fixture.next({
						ownership: {
							platform,
							[operation]: (file: string) => {
								if (!inactive.signal.aborted) calls.push(code)
								if (!inactive.signal.aborted && calls.length === 1)
									throw Object.assign(new Error(code), { code })
								if (operation === 'read') return readFileSync(file, 'utf8')
								rmSync(file, { force: true })
							},
						},
					})
					try {
						invocation.prepare()
						const result = await invocation.release().then(
							() => true,
							() => false,
						)
						const transient = platform === 'win32' || ['EBUSY', 'EMFILE'].includes(code)
						expect(result).toBe(transient)
						expect(calls).toHaveLength(transient ? (operation === 'read' ? 3 : 2) : 1)
					} finally {
						inactive.abort()
						await invocation.release()
						fixture.destroy()
					}
				}
			}
		},
	)
	it.each(CAPTURE_OWNERSHIP_CASES)(
		'H1x classifies link $code on $platform',
		async ({ platform, code }) => {
			const fixture = new InvocationFixture()
			const calls: string[] = []
			const invocation = fixture.next({
				ownership: {
					platform,
					link: (source, target) => {
						calls.push(code)
						if (calls.length === 1) throw Object.assign(new Error(code), { code })
						linkSync(source, target)
					},
				},
			})
			try {
				const result = attempt(() => invocation.prepare())
				const transient = platform === 'win32' || ['EBUSY', 'EMFILE'].includes(code)
				expect(result.success).toBe(transient)
				expect(calls).toEqual(transient ? [code, code] : [code])
			} finally {
				await invocation.release()
				fixture.destroy()
			}
		},
	)
	it('X6 Survivor composition consumes production release after the real owner exits', async () => {
		const fixture = new InvocationFixture()
		const owner = await leaveCaptureUnconfirmed(fixture.scratch.path, RUNNER_REQUESTS)
		try {
			expect(owner.published).toBe(true)
			expect(isRunning(owner.owner)).toBe(false)
			expect(process.platform === 'win32' ? isRunning(owner.pid) : false).toBe(false)
			const marker = fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`)
			expect(parseJSON(marker ?? '')).toEqual({
				pid: owner.owner,
				id: expect.any(String),
			})
			const status: unknown = parseJSON(fixture.scratch.read('survivor-status.json') ?? '')
			if (!isRecord(status) || typeof status.record !== 'string')
				throw new Error('Missing survivor receipt')
			expect(marker).toBe(status.before)
			expect(String(status.error)).toContain(status.record)
			expect(String(status.error)).toContain(
				resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE),
			)
			expect(parseJSON(readFileSync(status.record, 'utf8'))).toMatchObject({
				pid: owner.owner,
				children: [owner.pid],
			})
			const refusal = attempt(() => fixture.invocation.prepare())
			expect(refusal).toMatchObject({
				success: false,
				error: expect.objectContaining({
					message: expect.stringContaining(`process ${String(owner.owner)} is not running`),
				}),
			})
			const message = refusal.success ? '' : String(refusal.error)
			expect(message).toContain(`Unconfirmed child processes: ${String(owner.pid)}`)
			expect(message).toContain(status.record)
			expect(message).toContain('Confirm no capture process or surviving child is running')
			expect(message).not.toMatch(/\b(?:live|running|surviving) child processes?: \d/iu)
			expect(fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`)).toBe(marker)
		} finally {
			if (isRunning(owner.pid)) await killTree(owner.pid, 5000)
			fixture.destroy()
		}
	})
	it.each(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'])(
		'H1w refuses unsupported POSIX link %s immediately',
		async (code) => {
			const fixture = new InvocationFixture()
			const calls: string[] = []
			const invocation = fixture.next({
				ownership: {
					platform: 'linux',
					link: () => {
						calls.push(code)
						throw Object.assign(new Error(code), { code })
					},
				},
			})
			try {
				expect(() => invocation.prepare()).toThrow(/link.*must support hard links/u)
				expect(calls).toEqual([code])
				await invocation.release()
				expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
			} finally {
				fixture.destroy()
			}
		},
	)
	it.each(['write', 'link'] as const)(
		'H1w names %s and its permanent failure code without hard-link advice',
		async (operation) => {
			for (const code of ['ENOSPC', 'EACCES']) {
				const fixture = new InvocationFixture()
				const calls: string[] = []
				const invocation = fixture.next({
					ownership: {
						platform: 'linux',
						[operation]: () => {
							calls.push(code)
							throw Object.assign(new Error(code), { code })
						},
					},
				})
				try {
					const result = attempt(() => invocation.prepare())
					expect(result).toMatchObject({
						success: false,
						error: expect.objectContaining({
							code: 'STAGE',
							message: expect.stringContaining(`${operation} capture ownership`),
						}),
					})
					const message = result.success ? '' : String(result.error)
					expect(message).toContain(code)
					expect(message).not.toContain('hard links')
					expect(calls).toEqual([code])
					await invocation.release()
					expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
				} finally {
					fixture.destroy()
				}
			}
		},
	)
	it('H1v retries a changed marker after the liveness probe and preserves its new holder', async () => {
		const fixture = new InvocationFixture()
		const probes: number[] = []
		const marker = `${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`
		const replacement = JSON.stringify({ pid: process.pid, id: 'replacement-after-probe' })
		const invocation = fixture.next({
			ownership: {
				alive: (pid) => {
					probes.push(pid)
					fixture.scratch.write(marker, replacement)
					return probes.length > 1
				},
			},
		})
		try {
			fixture.scratch.write(marker, JSON.stringify({ pid: process.pid, id: 'departed' }))
			expect(() => invocation.prepare()).toThrow('Another runner holds')
			expect(probes).toHaveLength(2)
			expect(fixture.scratch.read(marker)).toBe(replacement)
			rmSync(resolve(fixture.scratch.path, marker))
			expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})
	it('X6 DetachedSurvivor names a real surviving child after its owner process exits', async () => {
		const fixture = new InvocationFixture()
		try {
			const survivor = await leaveCaptureSurvivor(fixture.scratch.path, RUNNER_REQUESTS)
			try {
				expect(isRunning(survivor.owner)).toBe(false)
				expect(isRunning(survivor.pid)).toBe(true)
				const marker = fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`)
				const holder: unknown = parseJSON(marker ?? '')
				if (!isRecord(holder) || typeof holder.id !== 'string')
					throw new Error('Missing detached owner')
				const record = resolve(
					fixture.scratch.path,
					RUNNER_REQUESTS,
					'runs',
					holder.id,
					'survivors.json',
				)
				expect(() => fixture.invocation.prepare()).toThrow(
					`process ${String(survivor.owner)} is not running`,
				)
				expect(() => fixture.invocation.prepare()).toThrow(
					`Unconfirmed child processes: ${String(survivor.pid)}; stop them before deleting`,
				)
				expect(() => fixture.invocation.prepare()).toThrow(record)
				expect(() => fixture.invocation.prepare()).toThrow(holder.id)
				expect(isRunning(survivor.pid)).toBe(true)
				expect(fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`)).toBe(marker)
				expect(
					fixture.scratch
						.names(RUNNER_REQUESTS)
						.filter((name) => name.startsWith(`${CAPTURE_OWNER_FILE}.`)),
				).toEqual([])
			} finally {
				if (isRunning(survivor.pid)) await killTree(survivor.pid, 5_000)
				await waitForCondition('the survivor has exited', () => !isRunning(survivor.pid))
			}
		} finally {
			fixture.destroy()
		}
	})
	it('H1v records unconfirmed children and retries their stop on a later release', async () => {
		const fixture = new InvocationFixture()
		const calls: number[] = []
		const invocation = fixture.next({
			terminate: async (child) => {
				calls.push(child.pid ?? 0)
				return calls.length === 1 ? false : await child.stop()
			},
		})
		invocation.prepare()
		const execution = invocation.spawn([OUTPUT], resolve(invocation.directory, 'retry.log'), false)
		try {
			await waitForCondition('the retry child is ready', () =>
				fixture.stdout.join('').includes('ready'),
			)
			const pid = Number(/pid=(\d+)/u.exec(fixture.stdout.join(''))?.[1])
			await expect(invocation.release()).rejects.toThrow(`process ${String(pid)}`)
			expect(
				parseJSON(fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`) ?? ''),
			).toEqual({ pid: process.pid, id: invocation.id })
			expect(
				parseJSON(readFileSync(resolve(invocation.directory, 'survivors.json'), 'utf8')),
			).toMatchObject({ id: invocation.id, children: [pid] })
			await expect(invocation.release()).resolves.toBeUndefined()
			await execution
			expect(isRunning(pid)).toBe(false)
			expect(calls.length).toBeGreaterThan(1)
			expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
		} finally {
			await invocation.release().catch(() => undefined)
			await execution.catch(() => undefined)
			fixture.destroy()
		}
	})
	it.each(['EPERM', 'EACCES', 'EBUSY', 'EMFILE'])(
		'H1v retries transient %s on link and marker read',
		async (code) => {
			const fixture = new InvocationFixture()
			try {
				for (const operation of ['link', 'read'] as const) {
					const calls: string[] = []
					const invocation = fixture.next({
						ownership: {
							platform: 'win32',
							[operation]: (...paths: string[]) => {
								calls.push(operation)
								if (calls.length === 1) throw Object.assign(new Error(code), { code })
								if (operation === 'read') return readFileSync(paths[0] ?? '', 'utf8')
								linkSync(paths[0] ?? '', paths[1] ?? '')
							},
						},
					})
					if (operation === 'read') fixture.invocation.prepare()
					const start = performance.now()
					const result = attempt(() => invocation.prepare())
					expect(result.success).toBe(operation === 'link')
					expect(
						result.success
							? ''
							: result.error instanceof Error
								? result.error.message
								: String(result.error),
					).toContain(operation === 'link' ? '' : 'Another runner holds')
					expect(calls.length).toBeGreaterThanOrEqual(2)
					expect(performance.now() - start).toBeGreaterThanOrEqual(5)
					await invocation.release()
					await fixture.invocation.release()
					expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
				}
			} finally {
				fixture.destroy()
			}
		},
	)
	it.each(['link', 'read'] as const)(
		'H1v bounds persistent transient errors on %s without deletion advice',
		async (operation) => {
			const fixture = new InvocationFixture()
			const invocation = fixture.next({
				ownership: {
					[operation]: () => {
						throw Object.assign(new Error('busy'), { code: 'EBUSY' })
					},
				},
			})
			try {
				if (operation === 'read') fixture.invocation.prepare()
				const start = performance.now()
				expect(() => invocation.prepare()).toThrow(/temporarily unavailable.*EBUSY.*rerun/u)
				expect(performance.now() - start).toBeGreaterThanOrEqual(900)
				expect(performance.now() - start).toBeLessThan(3000)
				await fixture.invocation.release()
				expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
			} finally {
				fixture.destroy()
			}
		},
	)
	it.each(['EPERM', 'EBUSY'])('H1v retries %s while removing its own marker', async (code) => {
		const fixture = new InvocationFixture()
		const calls: string[] = []
		const invocation = fixture.next({
			ownership: {
				remove: (file) => {
					calls.push(file)
					if (calls.length === 1) throw Object.assign(new Error(code), { code })
					rmSync(file, { force: true })
				},
			},
		})
		try {
			invocation.prepare()
			await expect(invocation.release()).resolves.toBeUndefined()
			expect(calls).toHaveLength(2)
			expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})
	it('H1v retries when the marker vanishes during the liveness probe', async () => {
		const fixture = new InvocationFixture()
		const invocation = fixture.next({
			ownership: {
				alive: () => {
					rmSync(resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE))
					return false
				},
			},
		})
		try {
			fixture.scratch.write(
				`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`,
				JSON.stringify({ pid: process.pid, id: 'departed' }),
			)
			expect(() => invocation.prepare()).not.toThrow()
			await invocation.release()
			expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})
	it('H1v confirms malformed content twice before refusing without deletion advice', async () => {
		const fixture = new InvocationFixture()
		const reads: string[] = []
		const invocation = fixture.next({
			ownership: {
				read: (file) => {
					reads.push(file)
					return readFileSync(file, 'utf8')
				},
			},
		})
		try {
			fixture.scratch.write(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`, '')
			expect(() => invocation.prepare()).toThrow(/empty.*confirm no capture process/u)
			expect(reads).toHaveLength(2)
			rmSync(resolve(fixture.scratch.path, RUNNER_REQUESTS, CAPTURE_OWNER_FILE))
			expect(readCaptureHeld(fixture.scratch.path, RUNNER_REQUESTS)).toEqual([])
		} finally {
			fixture.destroy()
		}
	})
	it('H1t retains ownership and reports the child pid when real termination is unconfirmed', async () => {
		const fixture = new InvocationFixture()
		const dead = await readExitedPid()
		const invocation = fixture.next({ terminate: () => killTree(dead, 5_000) })
		invocation.prepare()
		const running = invocation.spawn(
			[OUTPUT],
			resolve(invocation.directory, 'unconfirmed.log'),
			false,
		)
		try {
			await waitForCondition('the unconfirmed child is ready', () =>
				fixture.stdout.join('').includes('ready'),
			)
			const pid = Number(/pid=(\d+)/u.exec(fixture.stdout.join(''))?.[1])
			await expect(invocation.release()).rejects.toThrow(`process ${String(pid)}`)
			expect(isRunning(pid)).toBe(true)
			expect(fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`)).toContain(
				invocation.id,
			)
			expect(() => fixture.invocation.prepare()).toThrow('Another runner holds')
		} finally {
			const pid = Number(/pid=(\d+)/u.exec(fixture.stdout.join(''))?.[1])
			if (isRunning(pid)) await killTree(pid, 5_000)
			await running.catch(() => undefined)
			await invocation.release().catch(() => undefined)
			fixture.destroy()
		}
	})
	it('H1t keeps at most one active owner while winners exit during repeated process races', async () => {
		const fixture = new InvocationFixture()
		try {
			for (const round of Array.from({ length: 6 }, (_, index) => index)) {
				const outcomes = await runCaptureOwnershipRace(fixture.scratch.path, RUNNER_REQUESTS)
				expect({ round, outcomes }).toMatchObject({
					outcomes: expect.arrayContaining(['released']),
				})
				expect({ round, invalid: outcomes.filter((outcome) => outcome !== 'released') }).toEqual({
					round,
					invalid: [],
				})
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
	it('H1t cleans a dead process temporary claim without removing a marker', async () => {
		const fixture = new InvocationFixture()
		try {
			const dead = await leaveCaptureTemporary(fixture.scratch.path, RUNNER_REQUESTS)
			const temporary = `${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}.${String(dead)}.crashed.tmp`
			const live = `${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}.${String(process.pid)}.pending.tmp`
			expect(fixture.scratch.has(temporary)).toBe(true)
			expect(isRunning(dead)).toBe(false)
			fixture.scratch.write(live, JSON.stringify({ pid: process.pid, id: 'pending-owner' }))
			fixture.invocation.prepare()
			expect(fixture.scratch.has(temporary)).toBe(false)
			expect(fixture.scratch.has(live)).toBe(true)
			expect(
				parseJSON(fixture.scratch.read(`${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`) ?? ''),
			).toMatchObject({ id: fixture.invocation.id })
		} finally {
			await fixture.invocation.release()
			fixture.destroy()
		}
	})
	it('H1t refuses dead and live owners with their recovery instructions and preserves the marker', async () => {
		const fixture = new InvocationFixture()
		const live = await startSleeper()
		try {
			const dead = await readExitedPid()
			const marker = `${RUNNER_REQUESTS}/${CAPTURE_OWNER_FILE}`
			fixture.scratch.write(marker, JSON.stringify({ pid: live.pid, id: 'live-holder' }))
			expect(() => fixture.invocation.prepare()).toThrow(`process ${String(live.pid)}`)
			expect(() => fixture.invocation.prepare()).toThrow('If this pid is not a capture run')
			const content = JSON.stringify({ pid: dead, id: 'dead-holder' })
			fixture.scratch.write(marker, content)
			expect(() => fixture.invocation.prepare()).toThrow(`process ${String(dead)} is not running`)
			expect(() => fixture.invocation.prepare()).toThrow(
				`re-read ${resolve(fixture.scratch.path, marker)} to confirm it still names pid ${String(dead)} before you delete`,
			)
			expect(fixture.scratch.read(marker)).toBe(content)
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
			expect(() => fixture.invocation.prepare()).toThrow(
				`confirm no capture process or surviving child is running and inspect this file: ${resolve(fixture.scratch.path, marker)}`,
			)
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
			expect(scratch.has(`${RUNNER_REQUESTS}/runs/${invocation.id}`)).toBe(false)
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
