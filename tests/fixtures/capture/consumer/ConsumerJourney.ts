import type { CaptureCase, CaptureDestination, CaptureRules } from '@orkestrel/capture'
import type { TestContext } from 'vitest'
import { buildCaptureDestinations, buildCaptureRun, collectCaptureCases } from '@orkestrel/capture'
import { inject } from 'vitest'
import { page, server } from 'vitest/browser'
import { CONSUMER_CASES, CONSUMER_DIRECTORY, CONSUMER_OWNERS } from './constants.js'

/** Owns the real browser tasks whose final results become consumer evidence. */
export class ConsumerJourney {
	readonly #variant = inject('variant')
	readonly #capture = inject('capture')
	readonly #request = inject('request')
	readonly #record = inject('record')
	readonly #sources = inject('sources')
	readonly #portfolios = inject('portfolios')
	readonly #observed: string[] = []
	readonly #emitted: Array<readonly [state: string, path: string]> = []

	async observe(context: TestContext, name: string): Promise<HTMLCanvasElement> {
		const destination = this.#destinations(collectCaptureCases(context.task.file)).find(
			(entry) => entry.case === name,
		)
		if (destination === undefined) throw new Error('Missing consumer destination')
		const canvas = document.createElement('canvas')
		canvas.width = 280
		canvas.height = 240
		const drawing = canvas.getContext('2d')
		if (drawing === null) throw new Error('Chromium supplies no canvas context')
		const pixels = drawing.createImageData(canvas.width, canvas.height)
		pixels.data.set(
			Uint8ClampedArray.from({ length: pixels.data.length }, (_, index) =>
				index % 4 === 3
					? 255
					: (index * 73 +
							Math.floor(index / 97) * 31 +
							name.length * 43 +
							this.#variant.length * 17) %
						256,
			),
		)
		drawing.putImageData(pixels, 0, 0)
		document.body.replaceChildren(canvas)
		if (
			this.#capture &&
			(this.#request?.state === undefined || this.#request.state === destination.state)
		)
			this.#emitted.push([
				destination.state,
				await page.screenshot({ path: `../${destination.file}` }),
			])
		this.#observed.push(destination.state)
		return canvas
	}

	async finish(context: TestContext): Promise<readonly string[]> {
		const cases = collectCaptureCases(context.task.file)
		const request = this.#request
		const run = buildCaptureRun({
			cases,
			registry: this.#destinations(cases),
			observed: this.#observed,
			emitted: this.#emitted,
			variant: this.#variant,
			time: new Date().toISOString(),
			...(request === undefined ? {} : { request }),
		})
		await server.commands.persistConsumer(this.#record, run)
		const frames = await server.commands.readCaptureFrames()
		const missing = run.entries.filter(
			(entry) => !frames.includes(entry.file.slice(CONSUMER_DIRECTORY.length + 1)),
		)
		if (missing.length > 0)
			throw new Error(`The frame command lists no ${missing.map((entry) => entry.file).join(', ')}`)
		return run.passed
	}

	#destinations(cases: readonly CaptureCase[]): readonly CaptureDestination[] {
		return buildCaptureDestinations(cases, this.#rules(), {
			project: `journey:${this.#variant}`,
			portfolios: this.#portfolios
				.filter((root) => root.directory === CONSUMER_DIRECTORY)
				.map((root) => ({
					...root,
					variant: this.#variant,
					states: CONSUMER_CASES.map((entry) => entry.state),
				})),
		})
	}

	#rules(): CaptureRules {
		return {
			owners: CONSUMER_OWNERS,
			part: (state) => {
				const entry = CONSUMER_CASES.find((candidate) => candidate.state === state)
				if (entry === undefined) throw new Error(`Undeclared consumer state: ${state}`)
				return entry.owner
			},
			sources: (owner) => {
				const entry = CONSUMER_CASES.find((candidate) => candidate.owner === owner)
				if (entry === undefined) throw new Error(`Unattributed consumer owner: ${owner}`)
				return { own: [`src/${entry.part}.ts`], ...this.#sources }
			},
		}
	}
}
