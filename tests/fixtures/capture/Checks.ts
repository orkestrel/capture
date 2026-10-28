import type { CaptureCheckFrame } from '@src/server'

// The reader loads this module with a dynamic import of its file URL under a plain Node process, so
// it carries type imports only and reaches no Vite alias at run time.

/** Names the finding the viewport rule reports for a frame whose height differs from the fixture's. */
export const TALL_FINDING = 'Frame is not viewport sized'

/** Names the finding the scoped rule reports for a frame judged by a scoped journey artifact. */
export const SCOPED_FINDING = 'Frame judged by a scoped artifact'

/**
 * Reads a frame against a pixel rule: a decoded frame must be as tall as the fixture's viewport.
 *
 * @param frame - The judged frame
 * @returns One finding per tall frame, none when the picture is unreadable or the right height
 */
export function readViewportFrame(frame: CaptureCheckFrame): readonly string[] {
	return frame.picture !== undefined && frame.picture.height !== 128
		? [`${TALL_FINDING}: ${frame.entry.file}`]
		: []
}

/**
 * Reads a frame against an artifact rule: a covering journey artifact must declare complete coverage.
 *
 * @param frame - The judged frame
 * @returns One finding per frame whose artifact is scoped, none when no artifact covers the frame
 */
export function readScopedFrame(frame: CaptureCheckFrame): readonly string[] {
	return frame.artifact !== undefined && !frame.artifact.text.includes('coverage=complete')
		? [`${SCOPED_FINDING}: ${frame.entry.file}`]
		: []
}

/** Reports an incomplete decoded RGB buffer passed to a host pixel check. */
export function readPixelFrame(frame: CaptureCheckFrame): readonly string[] {
	return frame.picture !== undefined &&
		frame.picture.pixels.length !== frame.picture.width * frame.picture.height * 3
		? ['missing decoded pixels']
		: []
}

/** Lists the host's frame readers, which the reader loads through its `checks` option. */
export const CAPTURE_CHECKS = [readViewportFrame, readScopedFrame, readPixelFrame]
