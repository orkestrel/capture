import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

// A non-Veneer consumer: variant names in an order unlike any browser matrix, a first-stage variant
// that is not first, a closing case whose name carries regular-expression punctuation, two scopes
// with their own owners, and one standalone portfolio. Only `node:` modules load here, so the
// runner's in-process read needs no installed package beside the scratch workspace.
const VARIANTS = ['wide', 'compact', 'phone']
const OWNERS = ['app', 'app:mail', 'app:board', 'tools', 'tools:search']
const CLOSING = 'closes [all] (states) + writes a.b*'
const root = process.env.CAPTURE_FIXTURE_ROOT ?? process.cwd()
const style = process.env.CAPTURE_FIXTURE_NAME

export default {
	test: {
		projects: VARIANTS.map((variant) => () => ({
			test: {
				name:
					style === 'labeled'
						? { label: `bench:${variant}`, color: 'green' }
						: style === 'unsupported'
							? { label: 42 }
							: `bench:${variant}`,
				tags: [
					...OWNERS.map((owner) => `owner:${owner}`),
					'app',
					'app:mail',
					'app:board',
					'tools',
					'tools:search',
				].map((name) => ({ name })),
				provide: {
					variant,
					variants: VARIANTS.map((name) => ({ name })),
					directory: resolve(root, 'out/frames'),
					record: `out/frames/runs/direct-${randomUUID()}/${variant}.json`,
					inputs: ['lib/**', 'specs/**', 'fixture with spaces.config.ts'],
					closing:
						process.env.CAPTURE_FIXTURE_DISAGREE === variant ? 'closes another run' : CLOSING,
					first: 'compact',
					portfolios: [
						{ portfolio: 'frames', directory: 'out/frames', scoped: true },
						{ portfolio: 'extras', directory: 'out/extras', scoped: false },
					],
					standalone: [{ portfolio: 'gallery', directory: 'out/gallery', scoped: false }],
				},
			},
		})),
	},
}
