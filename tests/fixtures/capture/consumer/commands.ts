import type { CaptureRun } from '@orkestrel/capture'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { renderCaptureArtifact } from '@orkestrel/capture'
import { defineBrowserCommand } from '@vitest/browser-playwright'
import { CONSUMER_DIRECTORY } from './constants.js'

/** Persists the browser final case's record at its provided path, bound to its journey artifact. */
export const persistConsumer = defineBrowserCommand<[string, CaptureRun]>(
	async (context, record, run) => {
		const file = `tmp/journey/${record.slice(CONSUMER_DIRECTORY.length + 1).replace(/\.json$/u, '.txt')}`
		const text = [...renderCaptureArtifact(record, run), ''].join('\n')
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
	},
)
