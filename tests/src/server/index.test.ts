import * as entry from '@src/server'
import { describe, expect, it } from 'vitest'
import { CAPTURE_SERVER_VALUES } from '../../setupServer.js'

// The integrity engine's published values. Another lane's modules publish beside them, so this
// list is a floor: reconcile it with the other modules' lists into one exact set at the barrel.

describe('src server entry', () => {
	it('publishes every integrity engine value', () => {
		expect(Object.keys(entry)).toEqual(expect.arrayContaining(CAPTURE_SERVER_VALUES))
	})

	it('resolves every integrity engine value', () => {
		expect(CAPTURE_SERVER_VALUES.filter((name) => Reflect.get(entry, name) === undefined)).toEqual(
			[],
		)
	})

	it('publishes no loader of the wrapper, because the package imports neither Vite nor Vitest', () => {
		expect(Object.keys(entry)).not.toContain('loadCaptureProjects')
		expect(Object.keys(entry)).not.toContain('readCaptureWrapperProject')
	})
})
