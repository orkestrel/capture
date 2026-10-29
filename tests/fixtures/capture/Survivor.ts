import { resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { attempt, isRecord, parseJSON } from '@orkestrel/contract'
import { waitForCondition } from '@orkestrel/test'
import { requireCaptureBuild } from '../../setupServer.ts'

requireCaptureBuild()
const { CaptureInvocation, CAPTURE_OWNER_FILE, CAPTURE_SURVIVORS_FILE } =
	await import('../../../dist/src/server/index.js')
const [root, requests] = process.argv.slice(2)
if (root === undefined || requests === undefined) throw new Error('Missing survivor fixture paths')
const marker = resolve(root, requests, CAPTURE_OWNER_FILE)
const invocation = new CaptureInvocation({
	command: 'journey',
	root,
	requests,
	stdout: () => undefined,
	stderr: () => undefined,
	terminate: async () => false,
})
invocation.prepare()
const before = readFileSync(marker, 'utf8')
const record = resolve(invocation.directory, CAPTURE_SURVIVORS_FILE)
const execution = invocation.spawn(
	[resolve(import.meta.dirname, 'SurvivorChild.ts'), resolve(root, 'survivor-ready')],
	resolve(invocation.directory, 'survivor.log'),
	false,
)
void execution.catch(() => undefined)
await waitForCondition('the supervised child reports ready', () =>
	existsSync(resolve(root, 'survivor-ready')),
)
const pid = Number(readFileSync(resolve(root, 'survivor-ready'), 'utf8'))
if (!Number.isSafeInteger(pid) || pid <= 0)
	throw new Error('Supervised child reported an invalid pid')
const failure: unknown = await invocation.release().then(
	() => undefined,
	(error: unknown) => error,
)
const retained = attempt(() => parseJSON(readFileSync(marker, 'utf8')))
const recorded = attempt(() => parseJSON(readFileSync(record, 'utf8')))
const published =
	retained.success &&
	isRecord(retained.value) &&
	retained.value.pid === process.pid &&
	retained.value.id === invocation.id &&
	readFileSync(marker, 'utf8') === before &&
	recorded.success &&
	isRecord(recorded.value) &&
	recorded.value.pid === process.pid &&
	recorded.value.id === invocation.id &&
	recorded.value.command === 'journey' &&
	typeof recorded.value.at === 'string' &&
	Array.isArray(recorded.value.children) &&
	recorded.value.children.includes(pid) &&
	String(failure).includes(marker) &&
	String(failure).includes(record)
writeFileSync(
	resolve(root, 'survivor-status.json'),
	JSON.stringify({
		owner: process.pid,
		pid,
		published,
		before,
		record,
		error: String(failure),
		cause:
			failure instanceof Error && failure.cause instanceof AggregateError
				? failure.cause.errors.map(String)
				: [],
	}),
)
if (failure === undefined) throw new Error('Unconfirmed child release unexpectedly succeeded')
if (!published)
	throw new Error('Production release did not publish its surviving child', { cause: failure })
await waitForCondition(
	'the parent requests owner exit',
	() => existsSync(resolve(root, 'survivor-exit')),
	{ budget: 20_000 },
)
process.exit(0)
