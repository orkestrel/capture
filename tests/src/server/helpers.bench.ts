import type { CapturePicture } from '@src/server'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { CAPTURE_PNG_SIGNATURE } from '@src/core'
import {
	CAPTURE_SHEET,
	composeCapturePictures,
	decodeCapturePicture,
	encodeCaptureChunk,
	encodeCaptureWord,
	predictCaptureByte,
	shrinkCapturePicture,
} from '@src/server'
import { expect, it } from 'vitest'
import { createThumbnailPicture } from '../../setupServer.js'

// The pixel-loop cost the preflight and the sheets pay, read as the p50 latency of decode, shrink,
// and compose. A viewport frame carries veneer's widest viewport, a narrow frame its 390 × 844
// phone viewport, the largest frame sits at the decoded pixel budget, and a sheet page holds the
// rows, pairs, and variant cells `CaptureSheets` composes. The viewport frame shrinks by 4 and the
// narrow frame by 2, the factors the preflight derives toward the 320-pixel cell. Each frame is filtered as the browser provider filters its screenshots: Sub on the
// first row, Up on a row equal to the row above, and Paeth on every other row. Each reading line
// carries the output digest, so two trees compare bytes as well as time. No gate collects this
// file; run it with `npm run test:bench -- tests/src/server/helpers.bench.ts`.

it.for([
	{ label: 'viewport', feature: 'rule', width: 1280, height: 800, iterations: 20 },
	{ label: 'narrow', feature: 'rule', width: 390, height: 844, iterations: 100 },
	{ label: 'largest', feature: 'speckle', width: 5120, height: 4096, iterations: 3 },
])(
	'reads the decode cost of the $label frame',
	{ timeout: 600_000 },
	async ({ label, feature, width, height, iterations }, { bench }) => {
		const source = createThumbnailPicture(feature, width, height)
		const stride = width * 3
		const filters = Array.from({ length: height }, (_, row) =>
			row === 0
				? 1
				: Buffer.compare(
							source.pixels.subarray(row * stride, (row + 1) * stride),
							source.pixels.subarray((row - 1) * stride, row * stride),
					  ) === 0
					? 2
					: 4,
		)
		const filtered = source.pixels.map((value, index) => {
			const row = Math.floor(index / stride)
			const left = index % stride >= 3 ? (source.pixels[index - 3] ?? 0) : 0
			const up = row > 0 ? (source.pixels[index - stride] ?? 0) : 0
			const corner = row > 0 && index % stride >= 3 ? (source.pixels[index - stride - 3] ?? 0) : 0
			const filter = filters[row]
			return (
				value - (filter === 1 ? left : filter === 2 ? up : predictCaptureByte(left, up, corner))
			)
		})
		const png = Buffer.concat([
			Buffer.from(CAPTURE_PNG_SIGNATURE),
			encodeCaptureChunk(
				'IHDR',
				Buffer.concat([
					encodeCaptureWord(width),
					encodeCaptureWord(height),
					Buffer.from([8, 2, 0, 0, 0]),
				]),
			),
			encodeCaptureChunk(
				'IDAT',
				deflateSync(
					Buffer.concat(
						filters.map((filter, row) =>
							Buffer.concat([
								Buffer.from([filter]),
								filtered.subarray(row * stride, (row + 1) * stride),
							]),
						),
					),
				),
			),
			encodeCaptureChunk('IEND', Buffer.alloc(0)),
		])
		const decoded = decodeCapturePicture(png)
		expect(Buffer.compare(decoded.pixels, source.pixels)).toBe(0)
		const result = await bench(`decode ${label}`, () => {
			decodeCapturePicture(png)
		}).run({ iterations, time: 0, warmupIterations: 1, warmupTime: 0 })
		const digest = createHash('sha256').update(decoded.pixels).digest('hex')
		console.log(`pixels decode-${label} digest=${digest} p50=${String(result.latency.p50)}`)
		expect(result.latency.p50).toBeGreaterThan(0)
	},
)

it.for([
	{ label: 'viewport', feature: 'rule', width: 1280, height: 800, iterations: 40 },
	{ label: 'narrow', feature: 'rule', width: 390, height: 844, iterations: 100 },
	{ label: 'largest', feature: 'speckle', width: 5120, height: 4096, iterations: 10 },
])(
	'reads the shrink cost of the $label frame',
	{ timeout: 600_000 },
	async ({ label, feature, width, height, iterations }, { bench }) => {
		const source = createThumbnailPicture(feature, width, height)
		const factor = Math.max(1, Math.ceil(width / CAPTURE_SHEET.cell))
		const thumbnail = shrinkCapturePicture(source, factor, CAPTURE_SHEET.limit)
		const result = await bench(`shrink ${label}`, () => {
			shrinkCapturePicture(source, factor, CAPTURE_SHEET.limit)
		}).run({ iterations, time: 0, warmupIterations: 1, warmupTime: 0 })
		const digest = createHash('sha256').update(thumbnail.pixels).digest('hex')
		console.log(`pixels shrink-${label} digest=${digest} p50=${String(result.latency.p50)}`)
		expect(result.latency.p50).toBeGreaterThan(0)
	},
)

it.for([
	{
		label: 'page',
		// Each pair holds two states, and each state holds its variant cells side by side.
		compose: (cells: readonly CapturePicture[]): CapturePicture =>
			composeCapturePictures(
				Array.from({ length: CAPTURE_SHEET.rows }, () =>
					composeCapturePictures(
						Array.from({ length: CAPTURE_SHEET.pairs }, () => composeCapturePictures(cells, false)),
						false,
						CAPTURE_SHEET.gap,
					),
				),
				true,
				CAPTURE_SHEET.gap,
			),
	},
])(
	'reads the compose cost of one sheet $label',
	{ timeout: 600_000 },
	async ({ label, compose }, { bench }) => {
		// Four variant cells per state, as veneer declares, at the 1280 × 800 thumbnail size.
		const cells = Array.from({ length: 4 }, (_, variant) =>
			createThumbnailPicture(variant % 2 === 0 ? 'stripe' : 'rule', CAPTURE_SHEET.cell, 200),
		)
		const sheet = compose(cells)
		expect([sheet.width, sheet.height]).toEqual([2608, 836])
		const result = await bench(`compose ${label}`, () => {
			compose(cells)
		}).run({ iterations: 10, time: 0, warmupIterations: 1, warmupTime: 0 })
		const digest = createHash('sha256').update(sheet.pixels).digest('hex')
		console.log(`pixels compose-${label} digest=${digest} p50=${String(result.latency.p50)}`)
		expect(result.latency.p50).toBeGreaterThan(0)
	},
)
