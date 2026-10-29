import * as entry from '@src/core'
import { describe, expect, it } from 'vitest'
import { CAPTURE_CORE_VALUES } from '../../setup.js'

describe('src core entry', () => {
	it('publishes exactly the declared values and no host-bound helper', () => {
		expect(Object.keys(entry).toSorted()).toEqual(CAPTURE_CORE_VALUES.toSorted())
	})

	it('resolves every published value', () => {
		for (const name of CAPTURE_CORE_VALUES) {
			expect(Reflect.get(entry, name), `${name} resolved to undefined`).toBeDefined()
		}
	})
})
