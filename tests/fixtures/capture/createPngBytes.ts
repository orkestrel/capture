import { deflateSync } from 'node:zlib'
import { CAPTURE_PNG_SIGNATURE } from '@src/core'
import { encodeCaptureChunk, encodeCaptureWord } from '@src/server'

/**
 * Assembles a PNG file from scanlines the caller filtered itself, so a proof controls every byte.
 *
 * @param options - The header fields and the scanlines. Each row opens with its filter byte.
 * `depth` defaults to 8, `color` to 2 (RGB), `interlace` to 0, and `split` to one IDAT chunk.
 * @returns The PNG bytes
 */
export function createPngBytes(options: {
	readonly width: number
	readonly height: number
	readonly rows: readonly (readonly number[])[]
	readonly depth?: number
	readonly color?: number
	readonly interlace?: number
	readonly split?: boolean
}): Buffer {
	const compressed = deflateSync(Buffer.from(options.rows.flat()))
	const middle = options.split === true ? Math.floor(compressed.length / 2) : compressed.length
	return Buffer.concat([
		Buffer.from(CAPTURE_PNG_SIGNATURE),
		encodeCaptureChunk(
			'IHDR',
			Buffer.concat([
				encodeCaptureWord(options.width),
				encodeCaptureWord(options.height),
				Buffer.from([options.depth ?? 8, options.color ?? 2, 0, 0, options.interlace ?? 0]),
			]),
		),
		encodeCaptureChunk('IDAT', compressed.subarray(0, middle)),
		...(options.split === true ? [encodeCaptureChunk('IDAT', compressed.subarray(middle))] : []),
		encodeCaptureChunk('IEND', Buffer.alloc(0)),
	])
}
