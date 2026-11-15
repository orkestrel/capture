import type { CaptureSources, CaptureViewport } from '@orkestrel/capture'

/** Names the primary portfolio directory. */
export const CONSUMER_DIRECTORY = 'tmp/captures/states'
/** Declares the producing browser viewports in host order. */
export const CONSUMER_VARIANTS: readonly CaptureViewport[] = Object.freeze([
	{ name: 'wide', width: 480, height: 320 },
	{ name: 'narrow', width: 320, height: 320 },
])
/** Names the variant whose frames the narrow stage takes first. */
export const CONSUMER_FIRST = 'narrow'
/** Declares every owner path the consumer's cases carry. */
export const CONSUMER_OWNERS: readonly string[] = Object.freeze(['pages:mail', 'pages:board'])
/** Declares the integrity input patterns. */
export const CONSUMER_INPUTS: readonly string[] = Object.freeze(['*.ts', 'src/**', 'specs/**'])
/** Declares the shared and test sources every destination reads. */
export const CONSUMER_SOURCES: Pick<CaptureSources, 'shared' | 'tests'> = Object.freeze({
	shared: Object.freeze(['src/shared.ts']),
	tests: Object.freeze(['specs/**']),
})
/** Names the exact nested case, including punctuation that a selection must quote. */
export const CONSUMER_CASE = 'mail [workspace] opens (inbox)'
/** Names the final case that persists the actual completed task results. */
export const CONSUMER_FINAL = 'closes the run'
/** Declares independently attributable product states. */
export const CONSUMER_CASES = Object.freeze([
	{ case: CONSUMER_CASE, owner: 'pages:mail', state: 'inbox', part: 'mail' },
	{
		case: 'mail [workspace] opens (inbox) extra',
		owner: 'pages:mail',
		state: 'archive',
		part: 'mail',
	},
	{ case: 'opens board', owner: 'pages:board', state: 'board', part: 'board' },
])
