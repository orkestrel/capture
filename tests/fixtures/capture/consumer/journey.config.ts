import type { UserConfig } from 'vite'
import { appendFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	answerCaptureDiscovery,
	buildCaptureDiscoveryConfig,
	readCaptureRequest,
} from '@orkestrel/capture/server'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { persistConsumer } from './commands.js'
import {
	CONSUMER_CONFIG,
	CONSUMER_DIRECTORY,
	CONSUMER_FINAL,
	CONSUMER_VARIANTS,
} from './constants.js'

// Discovery precedes output initialization and collection, as it does in a consumer wrapper.
export default defineConfig(async (): Promise<UserConfig> => {
	const projects = CONSUMER_VARIANTS.map((variant) => ({
		test: {
			name: `journey:${variant.name}`,
			tags: [
				{ name: 'owner:pages' },
				{ name: 'owner:pages:mail' },
				{ name: 'owner:pages:board' },
				{ name: 'pages' },
				{ name: 'pages:mail' },
				{ name: 'pages:board' },
			],
			provide: {
				directory: resolve(CONSUMER_DIRECTORY),
				record: `${CONSUMER_DIRECTORY}/runs/unselected/${variant.name}.json`,
				inputs: ['*.ts', 'src/**', 'specs/**'],
				variant: variant.name,
				variants: CONSUMER_VARIANTS,
				final: CONSUMER_FINAL,
				first: 'narrow',
				uniform: ['pages'],
				portfolios: [{ portfolio: 'states', directory: CONSUMER_DIRECTORY, scoped: true }],
			},
		},
	}))
	if (
		await answerCaptureDiscovery({
			ppid: process.ppid,
			argv: process.argv.slice(1),
			config: CONSUMER_CONFIG,
			projects,
		})
	)
		return buildCaptureDiscoveryConfig()
	const request = readCaptureRequest({
		ppid: process.ppid,
		argv: process.argv.slice(1),
		config: CONSUMER_CONFIG,
		owners: ['pages:mail', 'pages:board'],
		variants: CONSUMER_VARIANTS.map((variant) => variant.name),
	})
	if (request === undefined) throw new Error('Run the consumer through capture')
	mkdirSync('tmp', { recursive: true })
	appendFileSync('tmp/selections.jsonl', `${JSON.stringify(request)}\n`)
	return {
		server: { host: '127.0.0.1' },
		test: {
			fileParallelism: false,
			projects: projects.map((project) => ({
				...project,
				test: {
					...project.test,
					name: `${project.test.name} suite`,
					include: ['specs/journey.ts'],
					provide: {
						...project.test.provide,
						consumer: {
							request,
							variant: project.test.provide.variant,
							capture: process.env.CAPTURE === '1',
						},
					},
					browser: {
						enabled: true,
						headless: true,
						api: { host: '127.0.0.1', port: 0 },
						provider: playwright(),
						viewport: { width: project.test.provide.variant === 'narrow' ? 320 : 480, height: 320 },
						instances: [{ browser: 'chromium', name: project.test.name }],
						commands: { persistConsumer },
					},
				},
			})),
		},
	}
})
