import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A plain Node process stands in for the installed Vitest entry and records the process boundary
// the runner establishes. It imports only `node:` modules, so the harness can copy its stripped
// source beside any scratch workspace. The mode names the one fault the case under test needs.
class Recorder {
	readonly #args = process.argv.slice(1)

	async execute(): Promise<void> {
		const requests = process.env.CAPTURE_FIXTURE_REQUESTS ?? ''
		const request: unknown = JSON.parse(
			readFileSync(resolve(requests, `journey-selection-${String(process.ppid)}.json`), 'utf8'),
		)
		if (typeof request !== 'object' || request === null || !('id' in request))
			throw new Error('Missing stage request')
		const output = process.argv.find((argument) => argument.startsWith('--outputFile.json='))
		if (output === undefined) throw new Error('Missing JSON output argument')
		if (typeof request.id !== 'string') throw new Error('Missing request identity')
		const report = output.slice('--outputFile.json='.length)
		if (!report.replaceAll('\\', '/').includes(`/runs/${request.id}/`))
			throw new Error('Report path does not belong to the invocation')
		// A leftover temporary file distinguishes removal from a rename that merely consumed it.
		writeFileSync(
			resolve(requests, `journey-selection-${String(process.ppid)}.json.tmp`),
			'cleanup control',
		)
		writeFileSync(
			resolve('receipt.json'),
			JSON.stringify({
				request,
				report,
				files: readdirSync(resolve(requests)).filter((name) =>
					name.startsWith('journey-selection'),
				),
				args: this.#args,
				parent: process.ppid,
				capture: Object.entries(process.env).filter(([name]) => name.toLowerCase() === 'capture'),
			}),
		)
		process.stdout.write('fixture stdout\n')
		process.stderr.write('fixture stderr\n')
		if (process.env.CAPTURE_FIXTURE_MODE === 'interrupt') {
			const entry = process.env.CAPTURE_FIXTURE_DESCENDANT
			if (entry === undefined) throw new Error('Missing descendant fixture')
			const child = spawn(process.execPath, [entry], {
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			})
			child.stdout.once('data', () =>
				writeFileSync(
					resolve('tree.json'),
					JSON.stringify({ child: process.pid, descendant: child.pid }),
				),
			)
			await new Promise<void>((done) => child.once('close', () => done()))
			return
		}
		writeFileSync(report, process.env.CAPTURE_FIXTURE_MODE === 'invalid' ? '{' : '{"success":true}')
		process.exitCode = process.env.CAPTURE_FIXTURE_MODE === 'fail' ? 7 : 0
	}
}

await new Recorder().execute()
