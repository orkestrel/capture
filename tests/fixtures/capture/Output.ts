import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'

// Real pipe boundaries and process trees drive the invocation's public observation contract.
const mode = process.argv[2]
if (mode === 'environment') {
	process.stdout.write(
		JSON.stringify({
			capture: Object.entries(process.env).filter(([name]) => name.toLowerCase() === 'capture'),
			requests: Object.entries(process.env).filter(
				([name]) => name.toLowerCase() === 'capture_requests',
			),
			inherited: process.env.CAPTURE_FIXTURE,
		}),
	)
} else if (mode === 'bytes') {
	process.stdout.write(Uint8Array.from([0xe2]))
	await setTimeout(100)
	process.stdout.write(Uint8Array.from([0x82]))
	await setTimeout(100)
	process.stdout.write(Uint8Array.from([0xac]))
	process.stdout.write('\rprogress\rcomplete')
	process.stderr.write('diagnostic\rno newline')
} else if (mode === 'partial') {
	process.stdout.write(Uint8Array.from([0xe2, 0x82]))
} else if (mode === 'tree' || mode === 'orphan') {
	const child = spawn(process.execPath, [resolve(import.meta.dirname, 'Sleeper.ts')], {
		windowsHide: true,
		// A Windows descendant outlives the supervised tree, and keeps its inherited pipe, only detached.
		detached: mode === 'orphan' && process.platform === 'win32',
		stdio: ['ignore', 'pipe', 'inherit'],
	})
	await once(child.stdout, 'data')
	writeFileSync('descendant.json', JSON.stringify(child.pid))
	process.stdout.write(`descendant=${String(child.pid)}\n`)
	if (mode === 'orphan') {
		child.unref()
		process.exit(0)
	}
	setInterval(() => undefined, 1_000)
} else if (mode === 'grace') {
	process.on('SIGTERM', () => process.stdout.write('terminating\n'))
	process.stdout.write('ready\n')
	setInterval(() => undefined, 1_000)
} else {
	process.stdout.write('ready\n')
	setInterval(() => undefined, 1_000)
}
