import * as entry from '@src/core'
import { describe, expect, it } from 'vitest'

const VALUES = [
	'CAPTURE_ERROR_BRAND',
	'CAPTURE_ERROR_CODES',
	'CAPTURE_LOOKUPS_FILE',
	'CAPTURE_MANIFEST_FILE',
	'CAPTURE_PNG_SIGNATURE',
	'CAPTURE_REGISTRY_FILE',
	'CAPTURE_REQUEST_PREFIX',
	'CAPTURE_STATUS_PRECEDENCE',
	'CAPTURE_VERSION',
	'CaptureError',
	'collectCaptureChanges',
	'collectCaptureDuplicates',
	'describeCaptureDeclaration',
	'describeCaptureDestination',
	'describeCaptureError',
	'describeCaptureIdentity',
	'describeCaptureRequest',
	'isCaptureArtifact',
	'isCaptureBox',
	'isCaptureCollection',
	'isCaptureDeclaration',
	'isCaptureDestination',
	'isCaptureDigest',
	'isCaptureEntry',
	'isCaptureError',
	'isCaptureGeometry',
	'isCaptureHash',
	'isCaptureHashes',
	'isCaptureIdentity',
	'isCaptureLookup',
	'isCaptureLookupJournal',
	'isCaptureManifest',
	'isCapturePath',
	'isCapturePattern',
	'isCaptureReceipt',
	'isCaptureRegistry',
	'isCaptureRequest',
	'isCaptureRun',
	'isCaptureSegment',
	'isCaptureSelector',
	'isCaptureSources',
	'isCaptureStamp',
	'isCaptureStoredManifest',
	'matchesCaptureMembers',
	'matchesCaptureSelector',
	'readCaptureDirty',
	'readCaptureReport',
	'requireCaptureUnique',
	'resolveCaptureKey',
	'resolveCaptureOwner',
	'resolveCaptureStatus',
	'resolveLookupKey',
	'validateCaptureReceipt',
	'validateCaptureRun',
]

describe('src core entry', () => {
	it('publishes exactly the declared values and no host-bound helper', () => {
		expect(Object.keys(entry).toSorted()).toEqual(VALUES.toSorted())
	})

	it('resolves every published value', () => {
		for (const name of VALUES) {
			expect(Reflect.get(entry, name), `${name} resolved to undefined`).toBeDefined()
		}
	})
})
