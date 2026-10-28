import { CaptureInvocation } from '../../../dist/src/server/index.js'

const root = process.argv[2]
const requests = process.argv[3]
if (root === undefined || requests === undefined) throw new Error('Missing ownership fixture paths')
const invocation = new CaptureInvocation({
	command: 'journey',
	root,
	requests,
	stdout: () => undefined,
	stderr: () => undefined,
})
process.on('message', async (message: unknown) => {
	if (message === 'claim') {
		try {
			invocation.prepare()
			process.send?.('owner')
		} catch (error) {
			process.send?.(error instanceof Error ? error.message : String(error))
		}
	}
	if (message === 'release') {
		await invocation.release()
		process.disconnect()
	}
})
process.send?.('ready')
