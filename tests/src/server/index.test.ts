import * as entry from '@src/server'
import { describe, expect, it } from 'vitest'

// The integrity engine's published values. Another lane's modules publish beside them, so this
// list is a floor: reconcile it with the other modules' lists into one exact set at the barrel.
const ENGINE_VALUES = [
	'CAPTURE_DEFAULTS',
	'CAPTURE_DISCOVERY',
	'CAPTURE_REQUESTS_FLAG',
	'CAPTURE_REGISTRY_FLAGS',
	'CAPTURE_REGISTRY_LINE',
	'CAPTURE_REGISTRY_STAGE',
	'CAPTURE_SUBCOMMANDS',
	'CAPTURE_USAGE',
	'CaptureDiscovery',
	'CaptureIntegrity',
	'CapturePreflight',
	'CaptureRegistrar',
	'CaptureSheets',
	'answerCaptureDiscovery',
	'buildCaptureDiscoveryConfig',
	'createCaptureDiscovery',
	'createCaptureRegistrar',
	'readCaptureDescription',
	'readCaptureEntry',
	'resolveCaptureRequests',
	'resolveCaptureWrapperProject',
	'readCaptureInputs',
	'readCaptureRegistryArguments',
	'readCaptureRunning',
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
		expect(ENGINE_VALUES.filter((name) => Reflect.get(entry, name) === undefined)).toEqual([])
	})

	it('publishes no loader of the wrapper, because the package imports neither Vite nor Vitest', () => {
		expect(Object.keys(entry)).not.toContain('loadCaptureProjects')
		expect(Object.keys(entry)).not.toContain('readCaptureWrapperProject')
	})
})
