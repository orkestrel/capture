import type { CaptureRun } from '@orkestrel/capture'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineBrowserCommand } from '@vitest/browser-playwright'
import { CONSUMER_DIRECTORY } from './constants.js'

/** Persists the browser final case's record and bound journey artifact. */
export const persistConsumer = defineBrowserCommand<[CaptureRun]>(async (context, run) => {
	if (run.identity === undefined) throw new Error('The consumer run has no identity')
	const suffix = `${run.identity.id}/${run.identity.stage}/${run.variant}`
	const record = `${CONSUMER_DIRECTORY}/runs/${suffix}.json`
	const file = `tmp/journey/runs/${suffix}.txt`
	const text = [
		`coverage=${run.complete ? 'complete' : 'case-scoped'}`,
		`record=${record}`,
		...run.passed.map((name) => `case-ran=${name}`),
		'',
	].join('\n')
	for (const path of [file, record])
		mkdirSync(dirname(resolve(context.project.config.root, path)), { recursive: true })
	writeFileSync(resolve(context.project.config.root, file), text)
	writeFileSync(
		resolve(context.project.config.root, record),
		JSON.stringify({
			...run,
			artifact: { file, digest: createHash('sha256').update(text).digest('hex') },
		}),
	)
})
