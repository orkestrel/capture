import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseJSON } from '@orkestrel/contract'
import { FIXTURE_FAULTS, isFixtureRequest, writeFixtureOutputs } from '../../setupServer.ts'

// A plain Node process stands in for the installed Vitest entry of a composed workspace. It reads the
// request the runner wrote for its parent, writes the reporter, the closing records, and the frames
// the request selects from the fixture's inert declarations, and validates nothing the engine owns,
// so every refusal a proof reads comes from the real engine. The environment names the one fault a
// case needs: a protocol fault the fixture writer injects, or a hang that waits to be ended.
const requests = process.env.CAPTURE_PRODUCER_REQUESTS ?? ''
const directory = process.env.CAPTURE_PRODUCER_DIRECTORY ?? ''
const mode = process.env.CAPTURE_PRODUCER_MODE
const request: unknown = parseJSON(
	readFileSync(resolve(requests, `journey-selection-${String(process.ppid)}.json`), 'utf8'),
)
if (!isFixtureRequest(request)) throw new Error('Invalid stage request')
const output = process.argv.find((argument) => argument.startsWith('--outputFile.json='))
if (output === undefined) throw new Error('Missing JSON output argument')
if (mode === 'hang') {
	// The ready file names this process, so a proof signals the runner only once a child exists.
	writeFileSync('ready.json', JSON.stringify({ pid: process.pid }))
	setInterval(() => undefined, 1_000)
	await new Promise(() => undefined)
}
const fault = FIXTURE_FAULTS.find((name) => name === mode)
writeFixtureOutputs({
	request,
	variants: request.variants,
	report: output.slice('--outputFile.json='.length),
	records: Object.fromEntries(
		request.variants.map((variant) => [
			variant,
			`${directory}/runs/${request.id}/${request.stage}/${variant}.json`,
		]),
	),
	capture: request.command === 'capture',
	...(process.env.CAPTURE_PRODUCER_PICTURE === '1' ? { picture: true } : {}),
	...(fault === undefined ? {} : { fault }),
})
