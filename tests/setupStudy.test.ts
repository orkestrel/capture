import { expect, it } from 'vitest'
import { readConsumerReport } from './setupStudy.js'

it('reads one named consumer report through LF and CRLF output', () => {
	for (const ending of ['\n', '\r\n'])
		expect(
			readConsumerReport(['child output', 'READER {"issues":[]}', ''].join(ending), 'READER'),
		).toEqual({ issues: [] })
})

it('refuses missing, malformed, and non-record consumer reports', () => {
	for (const text of ['', 'READER {', 'READER []', 'OTHER {}'])
		expect(() => readConsumerReport(text, 'READER')).toThrow('Missing READER report')
})
