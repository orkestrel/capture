import type { CaptureViewport } from '@orkestrel/capture'

/** Names the consumer wrapper relative to its workspace. */
export const CONSUMER_CONFIG = 'journey.config.ts'
/** Names the primary portfolio directory. */
export const CONSUMER_DIRECTORY = 'tmp/captures/states'
/** Declares the producing browser viewports in host order. */
export const CONSUMER_VARIANTS: readonly CaptureViewport[] = Object.freeze([
	{ name: 'wide', width: 480, height: 320 },
	{ name: 'narrow', width: 320, height: 320 },
])
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
