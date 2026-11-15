import type { TestProjectInlineConfiguration } from 'vitest/config'
import { buildCaptureWrapper } from '@orkestrel/capture/server'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { persistConsumer } from './commands.js'
import {
	CONSUMER_DIRECTORY,
	CONSUMER_FINAL,
	CONSUMER_FIRST,
	CONSUMER_INPUTS,
	CONSUMER_OWNERS,
	CONSUMER_SOURCES,
	CONSUMER_VARIANTS,
} from './constants.js'

export default defineConfig(async () => ({
	server: { host: '127.0.0.1' },
	...(await buildCaptureWrapper({
		url: import.meta.url,
		variants: CONSUMER_VARIANTS,
		owners: CONSUMER_OWNERS,
		first: CONSUMER_FIRST,
		final: CONSUMER_FINAL,
		directory: CONSUMER_DIRECTORY,
		inputs: CONSUMER_INPUTS,
		sources: CONSUMER_SOURCES,
		portfolios: [{ portfolio: 'states', directory: CONSUMER_DIRECTORY, scoped: true }],
		uniform: ['pages'],
		project: (variant, override): TestProjectInlineConfiguration => ({
			test: {
				...override.test,
				name: `journey:${variant.name}`,
				include: ['specs/journey.ts'],
				fileParallelism: false,
				api: { host: '127.0.0.1', port: 0 },
				browser: {
					enabled: true,
					headless: true,
					provider: playwright(),
					viewport: { width: variant.width, height: variant.height },
					instances: [{ browser: 'chromium' }],
					commands: { ...override.test.browser.commands, persistConsumer },
				},
			},
		}),
	})),
}))
