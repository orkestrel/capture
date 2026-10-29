import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { waitForCondition } from '@orkestrel/test'
import { requireCaptureBuild } from '../../setupServer.ts'

requireCaptureBuild()
const { CAPTURE_OWNER_FILE, CaptureInvocation } = await import('../../../dist/src/server/index.js')

const root = process.argv[2]
const requests = process.argv[3]
if (root === undefined || requests === undefined) throw new Error('Missing ownership fixture paths')
if (process.argv[4] === 'crash') {
	mkdirSync(resolve(root, requests), { recursive: true })
	writeFileSync(
		resolve(root, requests, `${CAPTURE_OWNER_FILE}.${String(process.pid)}.crashed.tmp`),
		JSON.stringify({ pid: process.pid, id: 'crashed-owner' }),
	)
	process.exit(7)
}
const invocation = new CaptureInvocation({
	command: 'journey',
	root,
	requests,
	stdout: () => undefined,
	stderr: () => undefined,
})
const samples = resolve(root, 'ownership-samples')
mkdirSync(samples, { recursive: true })
const active = resolve(samples, `${String(process.pid)}.json`)
process.once('message', async () => {
	try {
		await waitForCondition(
			'a contender acquires ownership after earlier winners exit',
			() => {
				try {
					invocation.prepare()
					return true
				} catch (error) {
					if (!(error instanceof Error) || !error.message.includes('Another runner holds'))
						throw error
					return false
				}
			},
			{ budget: 20_000, interval: 1 },
		)
		writeFileSync(active, invocation.id)
		for (const sample of new Array(64).keys()) {
			await setImmediate()
			const owners = readdirSync(samples)
			if (owners.length !== 1 || !owners.includes(`${String(process.pid)}.json`))
				throw new Error(`Concurrent owners sampled at ${String(sample)}: ${owners.join(', ')}`)
			if (
				!readFileSync(resolve(root, requests, CAPTURE_OWNER_FILE), 'utf8').includes(invocation.id)
			)
				throw new Error('Active owner lost its marker')
		}
		rmSync(active)
		await invocation.release()
		process.send?.('released')
	} catch (error) {
		process.send?.(error instanceof Error ? error.message : String(error))
	} finally {
		rmSync(active, { force: true })
		await invocation.release()
		process.disconnect()
	}
})
process.send?.('ready')
