import type { CaptureCheckFrame } from '@orkestrel/capture/server'
import { appendFileSync } from 'node:fs'

/** Judges the real decoded frame and bound artifact, recording every host check invocation. */
export const CAPTURE_CHECKS = Object.freeze([
	(frame: CaptureCheckFrame): readonly string[] => {
		appendFileSync(
			'tmp/checks.jsonl',
			`${JSON.stringify({ file: frame.entry.file, record: frame.artifact?.record, width: frame.picture?.width })}\n`,
		)
		return frame.picture !== undefined &&
			frame.picture.width >= 320 &&
			frame.artifact?.text.includes(`case-ran=${frame.entry.case}`)
			? []
			: ['Consumer host check lacks frame or case coverage']
	},
])
