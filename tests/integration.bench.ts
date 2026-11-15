import type { CaptureTiming } from './setupServer.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
	CAPTURE_ARMS,
	CAPTURE_BENCH_TIMEOUT,
	CAPTURE_PASS,
	CAPTURE_SCALES,
	CAPTURE_WORKSPACE_ROOT,
	CaptureConsumer,
	computeCapturePhases,
	renderCapturePass,
} from './setupServer.js'

// Times the six-command capture pass on a generated consumer workspace, built capture and Chromium
// included, and reports each phase from capture's timestamped lines. After `npm run build`, select
// one arm and scale by its full name, whose parts Vitest joins with ` > `, and read the table on the
// verbose reporter: `npm run test:bench -- -t "base arm.+full" --reporter=verbose`.
describe.for(Object.entries(CAPTURE_ARMS))('%s arm', ([arm, variants]) => {
	test.for(Object.entries(CAPTURE_SCALES))(
		'%s',
		{ timeout: CAPTURE_BENCH_TIMEOUT },
		async ([scale, size], { bench, signal }) => {
			const population = { ...size, ...variants }
			const consumer = new CaptureConsumer(signal, population)
			try {
				const timings: CaptureTiming[] = []
				await bench(`${arm} ${scale} pass`, async () => {
					for (const argv of CAPTURE_PASS) timings.push(await consumer.measure(argv))
				}).run({ iterations: 1, time: 0, warmup: false, throws: true })
				expect(timings.map((timing) => timing.code)).toEqual(CAPTURE_PASS.map(() => 0))
				const file = resolve(CAPTURE_WORKSPACE_ROOT, 'tmp/probes/bench', `${arm}-${scale}.json`)
				mkdirSync(dirname(file), { recursive: true })
				writeFileSync(
					file,
					JSON.stringify({
						arm,
						scale,
						population,
						host: { cpus: cpus().length, model: cpus()[0]?.model },
						phases: computeCapturePhases(timings),
						timings,
					}),
				)
				console.log(`${arm} arm, ${scale} scale\n${renderCapturePass(timings)}\nlines: ${file}`)
			} finally {
				consumer.destroy()
			}
		},
	)
})
