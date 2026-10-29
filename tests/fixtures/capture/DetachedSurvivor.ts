import { resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { detach } from '@orkestrel/process/server'
import { waitForCondition } from '@orkestrel/test'
import { importCaptureBuild } from '../../setupServer.ts'

const { CaptureInvocation, CAPTURE_SURVIVORS_FILE } = await importCaptureBuild()
const [root, requests] = process.argv.slice(2)
if (root === undefined || requests === undefined) throw new Error('Missing survivor fixture paths')
const invocation = new CaptureInvocation({
	command: 'journey',
	root,
	requests,
	stdout: () => undefined,
	stderr: () => undefined,
})
invocation.prepare()
await invocation.spawn(
	[resolve(import.meta.dirname, 'Reporter.ts')],
	resolve(invocation.directory, 'owner.log'),
	false,
)
detach(
	{
		file: process.execPath,
		arguments: [resolve(import.meta.dirname, 'SurvivorChild.ts'), resolve(root, 'survivor-ready')],
	},
	{ workspace: root },
)
await waitForCondition('the detached child reports ready', () =>
	existsSync(resolve(root, 'survivor-ready')),
)
const pid = Number(readFileSync(resolve(root, 'survivor-ready'), 'utf8'))
if (!Number.isSafeInteger(pid) || pid <= 0)
	throw new Error('Detached child reported an invalid pid')
// Production publication is proven separately; this fixture supplies the retained protocol artifact.
writeFileSync(
	resolve(invocation.directory, CAPTURE_SURVIVORS_FILE),
	JSON.stringify({
		pid: process.pid,
		id: invocation.id,
		command: 'journey',
		children: [pid],
		at: new Date().toISOString(),
	}),
	{ flag: 'wx' },
)
process.once('message', () => process.exit(0))
process.send?.({ pid })
