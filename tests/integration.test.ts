import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONSUMER_CASE } from './fixtures/capture/consumer/constants.js'
import { CaptureConsumer, CONSUMER_TIMEOUT, readConsumerReport } from './setupServer.js'

describe(
	'built executable through a real Vitest and Chromium consumer',
	{ timeout: CONSUMER_TIMEOUT },
	() => {
		it('drives built capture through a real Vitest Chromium consumer and judges its evidence', async ({
			signal,
		}) => {
			const consumer = new CaptureConsumer(signal)
			try {
				const registryResult = await consumer.execute(['registry'])
				expect(registryResult).toMatchObject({
					code: 0,
					signal: null,
					expired: false,
				})
				const registry = await consumer.registry()
				expect(readConsumerReport(registryResult.stdout, 'REGISTRY')).toMatchObject({
					digest: registry.digest,
					refreshed: ['wide', 'narrow'],
					entries: 6,
				})
				expect(registry.entries.map((entry) => [entry.case, entry.variant])).toEqual(
					expect.arrayContaining([
						[CONSUMER_CASE, 'narrow'],
						[CONSUMER_CASE, 'wide'],
						['opens board', 'wide'],
					]),
				)
				for (const receipt of registry.receipts) {
					expect(receipt.complete).toBe(true)
					expect(
						createHash('sha256')
							.update(readFileSync(resolve(consumer.root, receipt.report.file)))
							.digest('hex'),
					).toBe(receipt.report.digest)
					for (const entry of receipt.registry)
						expect(existsSync(resolve(consumer.root, entry.file))).toBe(false)
				}

				const journey = await consumer.execute(['journey', 'pages:mail', '--case', CONSUMER_CASE])
				expect(journey).toMatchObject({ code: 0, signal: null })
				expect(readConsumerReport(journey.stdout, 'STAGES')).toMatchObject({
					selector: 'pages:mail',
					run: ['selected'],
					passed: ['selected'],
					failed: [],
					notrun: [],
				})
				expect(readConsumerReport(journey.stdout, 'INTEGRITY')).toMatchObject({
					command: 'journey',
					stage: 'selected',
					stamps: 0,
					lookups: 2,
				})
				expect(existsSync(resolve(consumer.root, 'tmp/captures/states/manifest.json'))).toBe(false)
				const journal = consumer.read('tmp/captures/states/lookups.json')
				expect(journal).toMatchObject({
					lookups: expect.arrayContaining([
						expect.objectContaining({ case: CONSUMER_CASE, variant: 'narrow' }),
						expect.objectContaining({ case: CONSUMER_CASE, variant: 'wide' }),
					]),
				})

				const frames = await consumer.execute(['frames', 'pages:mail', '--case', CONSUMER_CASE])
				expect(frames).toMatchObject({ code: 0, signal: null })
				expect(frames.stdout.indexOf('capture narrow:')).toBeLessThan(
					frames.stdout.indexOf('capture rest:'),
				)
				expect(readConsumerReport(frames.stdout, 'STAGES')).toMatchObject({
					run: ['narrow', 'rest'],
					passed: ['narrow', 'rest'],
					failed: [],
					notrun: [],
				})
				expect(
					frames.stdout
						.split(/\r\n|\n/u)
						.filter((line) => line.startsWith('INTEGRITY '))
						.map((line) => readConsumerReport(line, 'INTEGRITY')),
				).toMatchObject([
					{ command: 'capture', stage: 'narrow', variants: ['narrow'], stamps: 1, lookups: 1 },
					{ command: 'capture', stage: 'rest', variants: ['wide'], stamps: 1, lookups: 1 },
				])
				const manifest = await consumer.manifest()
				expect(
					Object.values(manifest.entries)
						.map((entry) => [entry.case, entry.variant])
						.toSorted(),
				).toEqual([
					[CONSUMER_CASE, 'narrow'],
					[CONSUMER_CASE, 'wide'],
				])
				for (const stamp of Object.values(manifest.entries)) {
					expect(stamp.registry).toBe(registry.digest)
					expect(stamp.image.size).toBeGreaterThan(4000)
					const image = readFileSync(resolve(consumer.root, stamp.file))
					expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
					expect(createHash('sha256').update(image).digest('hex')).toBe(stamp.image.digest)
					const record = await consumer.run(
						`tmp/captures/states/runs/${stamp.identity.id}/${stamp.identity.stage}/${stamp.variant}.json`,
					)
					expect(record.identity).toEqual(stamp.identity)
					expect(record).toMatchObject({
						complete: false,
						passed: [CONSUMER_CASE],
						observed: ['inbox'],
						request: { command: 'capture', selector: 'pages:mail', case: CONSUMER_CASE },
						entries: [{ duration: stamp.duration }],
					})
					expect(record.declarations.map((entry) => entry.case)).toEqual([
						CONSUMER_CASE,
						'mail [workspace] opens (inbox) extra',
						'opens board',
					])
					if (record.artifact === undefined) throw new Error('Missing actual journey artifact')
					expect(
						createHash('sha256')
							.update(readFileSync(resolve(consumer.root, record.artifact.file)))
							.digest('hex'),
					).toBe(record.artifact.digest)
				}

				const stale = await consumer.execute(['stale', 'pages:mail', '--case', CONSUMER_CASE])
				expect(stale).toMatchObject({ code: 0 })
				expect(readConsumerReport(stale.stdout, 'INTEGRITY')).toMatchObject({
					command: 'stale',
					entries: [
						expect.objectContaining({ status: 'current' }),
						expect.objectContaining({ status: 'current' }),
					],
					warnings: [],
				})
				const missing = await consumer.execute(['stale', 'pages:board'])
				expect(missing).toMatchObject({ code: 1 })
				expect(readConsumerReport(missing.stdout, 'INTEGRITY')).toMatchObject({
					entries: [
						expect.objectContaining({ status: 'missing' }),
						expect.objectContaining({ status: 'missing' }),
					],
				})

				const preflight = await consumer.execute([
					'preflight',
					'pages:mail',
					'--case',
					CONSUMER_CASE,
					'--checks',
					'checks.ts',
				])
				expect(preflight).toMatchObject({ code: 0 })
				expect(readConsumerReport(preflight.stdout, 'READER')).toMatchObject({
					issues: [],
					mixed: [],
					acceptance: false,
					sizes: expect.arrayContaining([
						expect.objectContaining({ width: 320, height: 320 }),
						expect.objectContaining({ width: 480, height: 320 }),
					]),
				})
				expect(
					readFileSync(resolve(consumer.root, 'tmp/checks.jsonl'), 'utf8')
						.split(/\r\n|\n/u)
						.filter(Boolean),
				).toHaveLength(2)

				const sheets = await consumer.execute([
					'sheets',
					'pages:mail',
					'--case',
					CONSUMER_CASE,
					'--checks',
					'checks.ts',
					'--output',
					'tmp/sheets',
				])
				expect(sheets).toMatchObject({ code: 0 })
				expect(readConsumerReport(sheets.stdout, 'SHEETS')).toEqual(
					consumer.read('tmp/sheets/index.json'),
				)
				expect(consumer.read('tmp/sheets/index.json')).toMatchObject({
					issues: [],
					acceptance: false,
					sheets: [expect.objectContaining({ file: 'sheet-001.png' })],
				})
				expect(
					readFileSync(resolve(consumer.root, 'tmp/sheets/sheet-001.png')).byteLength,
				).toBeGreaterThan(4000)
				expect(readFileSync(resolve(consumer.root, 'tmp/sheets/index.md'), 'utf8')).toContain(
					'inbox',
				)
				expect(
					readFileSync(resolve(consumer.root, 'tmp/checks.jsonl'), 'utf8')
						.split(/\r\n|\n/u)
						.filter(Boolean),
				).toHaveLength(4)

				writeFileSync(
					resolve(consumer.root, 'src/mail.ts'),
					"export const label = 'mail changed'\n",
				)
				const refresh = await consumer.execute(['journey', 'pages:mail', '--case', CONSUMER_CASE])
				expect(refresh).toMatchObject({ code: 0 })
				expect(readConsumerReport(refresh.stdout, 'INTEGRITY')).toMatchObject({
					command: 'journey',
					stage: 'selected',
					stamps: 0,
					lookups: 2,
				})
				const changed = await consumer.execute(['stale', 'pages:mail', '--case', CONSUMER_CASE])
				expect(changed).toMatchObject({ code: 1 })
				expect(readConsumerReport(changed.stdout, 'INTEGRITY')).toMatchObject({
					entries: [
						expect.objectContaining({ status: 'stale-own' }),
						expect.objectContaining({ status: 'stale-own' }),
					],
				})
			} finally {
				consumer.destroy()
			}
		})
	},
)
