import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseJSON } from '@orkestrel/contract'
import {
	FIXTURE_DISCOVERY_FAULTS,
	FIXTURE_FAULTS,
	isFixtureDiscovery,
	isFixtureRequest,
	writeFixtureDescription,
	writeFixtureOutputs,
} from '../../setupServer.ts'

// A plain Node process stands in for the installed Vitest entry of a composed workspace. It reads the
// request the runner wrote for its parent from the directory the runner handed it, and it names no
// directory of its own. A discovery request gets the description the wrapper's projects make; a stage
// request gets the reporter, the closing records, and the frames the request selects from the
// fixture's inert declarations. It validates nothing the engine owns, so every refusal a proof reads
// comes from the real runner and the real engine. The environment names the one fault a case needs:
// a protocol fault the fixture writer injects, a hang that waits to be ended, or a discovery fault.
const requests = process.env.CAPTURE_REQUESTS ?? ''
const directory = process.env.CAPTURE_PRODUCER_DIRECTORY ?? ''
const mode = process.env.CAPTURE_PRODUCER_MODE
const request: unknown = parseJSON(
	readFileSync(resolve(requests, `journey-selection-${String(process.ppid)}.json`), 'utf8'),
)
if (isFixtureDiscovery(request)) {
	const flag = process.argv.indexOf('--config')
	const config = process.argv[flag + 1]
	if (flag === -1 || config === undefined) throw new Error('Missing discovery wrapper argument')
	const fault = FIXTURE_DISCOVERY_FAULTS.find(
		(name) => name === process.env.CAPTURE_PRODUCER_DISCOVERY,
	)
	await writeFixtureDescription({
		request,
		config,
		requests,
		...(fault === undefined ? {} : { fault }),
	})
} else {
	if (!isFixtureRequest(request)) throw new Error('Invalid stage request')
	const output = process.argv.find((argument) => argument.startsWith('--outputFile.json='))
	if (output === undefined) throw new Error('Missing JSON output argument')
	// The receipt names what this child inherited, so a proof reads the environment the runner built.
	writeFileSync(
		'receipt.json',
		JSON.stringify({
			capture: Object.entries(process.env).filter(([name]) => name.toLowerCase() === 'capture'),
			requests,
			parent: process.ppid,
		}),
	)
	if (mode === 'hang') {
		// A descendant that survives its parent proves the runner ends the whole tree. The ready file
		// names both once the descendant is up, so a proof signals the runner only then.
		const descendant = spawn(process.execPath, [resolve(import.meta.dirname, 'Sleeper.ts')], {
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		descendant.stdout.once('data', () =>
			writeFileSync('ready.json', JSON.stringify({ pid: process.pid, descendant: descendant.pid })),
		)
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
}
