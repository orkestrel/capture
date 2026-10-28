import type { CaptureDestination, CaptureEntry } from '@orkestrel/capture'
import type { TestContext } from 'vitest'
import { inject } from 'vitest'
import { page, server } from 'vitest/browser'
import { CONSUMER_CASES, CONSUMER_DIRECTORY } from './constants.js'

/** Owns the real browser tasks whose final results become consumer evidence. */
export class ConsumerJourney {
	readonly #context = inject('consumer')
	readonly #tasks: Array<TestContext['task']> = []
	readonly #emitted: CaptureDestination[] = []

	async observe(context: TestContext, name: string): Promise<HTMLCanvasElement> {
		const destination = this.#destinations().find((entry) => entry.case === name)
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
							this.#context.variant.length * 17) %
						256,
			),
		)
		drawing.putImageData(pixels, 0, 0)
		document.body.replaceChildren(canvas)
		if (
			this.#context.capture &&
			(this.#context.request.state === undefined ||
				this.#context.request.state === destination.state)
		) {
			await page.screenshot({ path: `../${destination.file}` })
			this.#emitted.push(destination)
		}
		this.#tasks.push(context.task)
		return canvas
	}

	async finish(): Promise<readonly string[]> {
		const { request, variant } = this.#context
		const passed = this.#tasks.filter((task) => task.result?.state === 'pass')
		const entries: readonly CaptureEntry[] = this.#emitted.map((entry) => {
			const duration = this.#tasks.find((task) => task.meta.consumer === entry.case)?.result
				?.duration
			if (duration === undefined) throw new Error('Vitest supplied no completed case duration')
			return { ...entry, duration }
		})
		await server.commands.persistConsumer({
			version: 1,
			identity: { id: request.id, stage: request.stage, pid: request.pid, config: request.config },
			request,
			variant,
			time: new Date().toISOString(),
			complete: passed.length === CONSUMER_CASES.length,
			reference: false,
			declarations: CONSUMER_CASES.map((entry) => ({
				case: entry.case,
				owner: entry.owner,
				variant,
				eligible: true,
				states: [entry.state],
			})),
			registry: this.#destinations(),
			passed: passed.map((task) => String(task.meta.consumer)),
			observed: passed.flatMap((task) =>
				CONSUMER_CASES.filter((entry) => entry.case === task.meta.consumer).map(
					(entry) => entry.state,
				),
			),
			entries,
		})
		return passed.map((task) => String(task.meta.consumer))
	}

	#destinations(): readonly CaptureDestination[] {
		return CONSUMER_CASES.map((entry) => ({
			portfolio: 'states',
			state: entry.state,
			scope: 'pages',
			part: entry.part,
			variant: this.#context.variant,
			project: `journey:${this.#context.variant}`,
			file: `${CONSUMER_DIRECTORY}/pages/${entry.state}--${this.#context.variant}.png`,
			case: entry.case,
			sources: { own: [`src/${entry.part}.ts`], shared: ['src/shared.ts'], tests: ['specs/**'] },
		}))
	}
}
