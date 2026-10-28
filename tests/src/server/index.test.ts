import * as entry from '@src/server'
import { describe, expect, it } from 'vitest'

// The integrity engine's published values. Another lane's modules publish beside them, so this
// list is a floor: reconcile it with the other modules' lists into one exact set at the barrel.
const ENGINE_VALUES = [
	'CAPTURE_DEFAULTS',
	'CAPTURE_REGISTRY_FLAGS',
	'CAPTURE_REGISTRY_LINE',
	'CAPTURE_REGISTRY_STAGE',
	'CAPTURE_SUBCOMMANDS',
	'CAPTURE_USAGE',
	'CaptureIntegrity',
	'CapturePreflight',
	'CaptureRegistrar',
	'CaptureSheets',
	'createCaptureRegistrar',
	'loadCaptureProjects',
	'readCaptureInputs',
	'readCaptureRegistryArguments',
	'readCaptureRunning',
	'readCaptureWrapperProject',
	'writeCaptureDocument',
	'buildCaptureDigest',
	'buildCaptureIntegrityOptions',
	'buildCaptureRegistry',
	'collectCaptureErrors',
	'collectCaptureFraming',
	'collectCaptureIdentical',
	'composeCapturePictures',
	'computeCaptureHash',
	'createCapturePreflight',
	'createCaptureSheets',
	'readCaptureReaderArguments',
	'readCaptureViewport',
	'computeRegistryDigest',
	'createCaptureIntegrity',
	'decodeCapturePicture',
	'encodeCaptureChunk',
	'encodeCapturePicture',
	'encodeCaptureWord',
	'inflateCaptureStream',
	'matchesCaptureSignature',
	'normalizeSlashes',
	'predictCaptureByte',
	'readCaptureChunks',
	'readFlag',
	'readFlags',
	'shrinkCapturePicture',
	'unfilterCaptureRow',
]

describe('src server entry', () => {
	it('publishes every integrity engine value', () => {
		expect(Object.keys(entry)).toEqual(expect.arrayContaining(ENGINE_VALUES))
	})

	it('resolves every integrity engine value', () => {
		for (const name of ENGINE_VALUES) {
			expect(Reflect.get(entry, name), `${name} resolved to undefined`).toBeDefined()
		}
	})
})
