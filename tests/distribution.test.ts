import {
	// These exports remain available to proofs emitted by earlier scaffold releases.
	buildDistributionCases,
	createDistributionSuite,
} from './setupDistribution.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DISTRIBUTION_SUITE = createDistributionSuite()

beforeAll(() => DISTRIBUTION_SUITE.start())

afterAll(() => DISTRIBUTION_SUITE.destroy())

describe('installed package consumer', () => {
	for (const row of buildDistributionCases(DISTRIBUTION_SUITE)) {
		it(`${row.label}`, async (context) => {
			const observation = await row.observe(context)
			expect(observation.actual).toStrictEqual(observation.expected)
		})
	}
	it('publishes no browser face this proof cannot drive [requires the registry]', (context) => {
		const faces = DISTRIBUTION_SUITE.read(context).entries.filter((entry) => entry.browsable)
		expect(faces.map((entry) => entry.subpath)).toStrictEqual([])
	})
})
