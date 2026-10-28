import { describe, test, inject, expect } from 'vitest'
import { ConsumerJourney } from './ConsumerJourney.js'
import { CONSUMER_CASE } from './constants.js'

const journey = new ConsumerJourney()
const variant = inject('consumer').variant

describe('mail [workspace]', () => {
	test(
		'opens (inbox)',
		{
			tags: ['owner:pages', 'owner:pages:mail', 'pages', 'pages:mail'],
			meta: { owner: 'pages:mail', variant, states: ['inbox'], consumer: CONSUMER_CASE },
		},
		async (context) => {
			expect((await journey.observe(context, CONSUMER_CASE)).isConnected).toBe(true)
		},
	)
	test(
		'opens (inbox) extra',
		{
			tags: ['owner:pages', 'owner:pages:mail', 'pages', 'pages:mail'],
			meta: {
				owner: 'pages:mail',
				variant,
				states: ['archive'],
				consumer: 'mail [workspace] opens (inbox) extra',
			},
		},
		async (context) => {
			expect(
				(await journey.observe(context, 'mail [workspace] opens (inbox) extra')).isConnected,
			).toBe(true)
		},
	)
})
test(
	'opens board',
	{
		tags: ['owner:pages', 'owner:pages:board', 'pages', 'pages:board'],
		meta: { owner: 'pages:board', variant, states: ['board'], consumer: 'opens board' },
	},
	async (context) => {
		expect((await journey.observe(context, 'opens board')).isConnected).toBe(true)
	},
)
test(
	'closes the run',
	{
		tags: [
			'owner:pages',
			'owner:pages:mail',
			'owner:pages:board',
			'pages',
			'pages:mail',
			'pages:board',
		],
	},
	async () => {
		expect((await journey.finish()).length).toBeGreaterThan(0)
	},
)
