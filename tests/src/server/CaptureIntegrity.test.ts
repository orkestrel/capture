import { execFileSync } from 'node:child_process'
import {
	existsSync,
	linkSync,
	readdirSync,
	renameSync,
	rmSync,
	symlinkSync,
	utimesSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { parseJSON } from '@orkestrel/contract'
import { executeSync } from '@orkestrel/process/server'
import { createScratch, supportsDirectoryLinks, supportsFileLinks } from '@orkestrel/test/server'
import {
	isCaptureError,
	isCaptureLookupJournal,
	isCaptureManifest,
	isCaptureRegistry,
	isCaptureRun,
} from '@src/core'
import { CaptureIntegrity, computeCaptureHash, computeRegistryDigest } from '@src/server'
import { describe, expect, it } from 'vitest'
import { IntegrityFixture } from '../../fixtures/capture/IntegrityFixture.js'
import { REFUSED_PATHS, readThrown } from '../../setup.js'
import {
	BOARD,
	COLLECTION_MEMBERS,
	COLLECTION_POPULATIONS,
	FILES,
	FIXTURE_FAULTS,
	FIXTURE_FAULT_MESSAGES,
	FIXTURE_TIMEOUT,
	MAIL,
	MAIL_IMAGE,
	PNG,
	PRODUCT_INPUTS,
	READ_REFUSALS,
	STALE_CHANGES,
	VARIANTS,
	readFixtureManifest,
} from '../../setupServer.js'

// A host that cannot link a file cannot build the hard-link alias the duplicate-image case needs;
// supportsFileLinks creates one link and reads the file through it.
const LINKED = supportsFileLinks()

const MAIL_LIGHT = { selector: 'pages:mail', variants: ['light-390'] }

// Directory junction support is probed independently of file-link privileges.
it.runIf(supportsDirectoryLinks())(
	'refuses a bounded input behind an outside directory junction before a stage runs',
	async () => {
		const fixture = new IntegrityFixture()
		const outside = createScratch({ prefix: 'capture-input-junction-' })
		try {
			fixture.seed()
			outside.write('source.ts', 'outside the workspace')
			symlinkSync(outside.path, resolve(fixture.root, 'src/linked'), 'junction')
			const stage = fixture.stage()
			const engine = new CaptureIntegrity({ ...fixture.options, inputs: ['src/linked/source.ts'] })
			await expect(
				engine.stamp({
					...stage,
					projects: stage.projects.map((project) => ({
						...project,
						inputs: ['src/linked/source.ts'],
					})),
				}),
			).rejects.toMatchObject({ code: 'CONTAINMENT' })
			expect(existsSync(resolve(fixture.root, stage.report))).toBe(false)
			expect(outside.read('source.ts')).toBe('outside the workspace')
		} finally {
			fixture.destroy()
			outside.destroy()
		}
	},
)

describe('CaptureIntegrity changed Git selection', { timeout: FIXTURE_TIMEOUT }, () => {
	it('H1s caps actual Git stderr with an omitted-character count', () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			fixture.write('.git/config', `[core]\nrepositoryformatversion = ${'invalid'.repeat(1000)}\n`)
			const failure = readThrown(() => fixture.engine.changed('HEAD'))
			expect(failure).toMatchObject({ code: 'HOST' })
			expect(failure instanceof Error ? failure.message : '').toContain('Git read failed')
			expect(failure instanceof Error ? failure.message : '').toContain('more characters')
			expect(failure instanceof Error ? failure.message.length : Infinity).toBeLessThan(2000)
		} finally {
			fixture.destroy()
		}
	})
	it('H1s gives selection refusals bounded declared candidates', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			for (const selection of [
				{ selector: 'pages:mail', variants: [] },
				{ selector: 'pages:mail', variants: ['unknown-variant'] },
				{ selector: 'pages:mail', variants: ['light-390'], state: 'missing-state' },
				{ selector: 'pages:mail', variants: ['light-390'], portfolio: 'missing-portfolio' },
			]) {
				const failure: unknown = await fixture.engine
					.read(selection)
					.catch((error: unknown) => error)
				expect(failure instanceof Error ? failure.message : '').toContain('valid candidates:')
				expect(failure instanceof Error ? failure.message : '').toContain('received')
				expect(failure instanceof Error ? failure.message : '').not.toContain(
					'valid candidates: []',
				)
			}
		} finally {
			fixture.destroy()
		}
	})
	it('keeps Unicode names intact through bounded NUL-separated Git output', () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			fixture.write('src/mail/café view.ts', '// unicode path\n')
			expect(fixture.engine.changed('HEAD').changes).toEqual([
				{ path: 'src/mail/café view.ts', classification: 'own', owners: ['pages:mail'] },
			])
		} finally {
			fixture.destroy()
		}
	})

	it('classifies tracked, deleted, renamed, untracked, shared, test, and outside paths without losing spaces', () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			renameSync(
				resolve(fixture.root, 'src/mail/view.ts'),
				resolve(fixture.root, 'src/mail/renamed view.ts'),
			)
			rmSync(resolve(fixture.root, 'src/board/view.ts'))
			fixture.write('src/mail/untracked view.ts', '// added\n')
			fixture.write('src/shared/theme.ts', '// changed\n')
			fixture.write('behavior/journeys.ts', '// changed\n')
			fixture.write('outside.ts', '// changed\n')
			execFileSync('git', ['add', '-A'], { cwd: fixture.root, windowsHide: true })
			fixture.write('src/mail/still untracked.ts', '// not staged\n')
			const plan = fixture.engine.changed('HEAD')
			expect(
				plan.changes
					.filter((change) => change.classification === 'own')
					.map((change) => change.path),
			).toEqual([
				'src/board/view.ts',
				'src/mail/renamed view.ts',
				'src/mail/still untracked.ts',
				'src/mail/untracked view.ts',
				'src/mail/view.ts',
			])
			expect(
				plan.changes
					.filter((change) => change.classification === 'shared')
					.map((change) => change.path),
			).toEqual(['behavior/journeys.ts', 'src/shared/theme.ts'])
			expect(plan.changes.filter((change) => change.classification === 'outside')).toEqual([
				{ path: 'outside.ts', classification: 'outside', owners: [] },
			])
			expect(plan.owners).toEqual(['examples:board', 'examples:files', 'pages:mail'])
			expect(plan.changes.find((change) => change.path === 'src/shared/theme.ts')?.owners).toEqual(
				plan.owners,
			)
		} finally {
			fixture.destroy()
		}
	})

	it('includes commits after an ancestor ref and working changes while HEAD reads only uncommitted work', () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			execFileSync('git', ['branch', 'baseline'], { cwd: fixture.root, windowsHide: true })
			fixture.write('src/mail/view.ts', '// committed after baseline\n')
			execFileSync('git', ['add', 'src/mail/view.ts'], { cwd: fixture.root, windowsHide: true })
			execFileSync(
				'git',
				[
					'-c',
					'user.name=Fixture',
					'-c',
					'user.email=fixture@example.invalid',
					'commit',
					'--quiet',
					'--no-gpg-sign',
					'-m',
					'owned change',
				],
				{ cwd: fixture.root, windowsHide: true },
			)
			fixture.write('src/board/view.ts', '// working change\n')
			expect(fixture.engine.changed('baseline').changes.map((change) => change.path)).toEqual([
				'src/board/view.ts',
				'src/mail/view.ts',
			])
			expect(fixture.engine.changed('HEAD').changes.map((change) => change.path)).toEqual([
				'src/board/view.ts',
			])
		} finally {
			fixture.destroy()
		}
	})

	it('reduces a selected descendant covered by a selected ancestor from accepted receipts', () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed({ population: 'nested' })
			fixture.write('src/mail/view.ts', '// changed\n')
			const plan = fixture.engine.changed('HEAD')
			expect(plan.changes).toEqual([
				{
					path: 'src/mail/view.ts',
					classification: 'own',
					owners: ['pages:mail', 'pages:mail:inbox'],
				},
			])
			expect(plan.owners).toEqual(['pages:mail'])
		} finally {
			fixture.destroy()
		}
	})

	it('requires an accepted registry, preserves Git ref failures, and reports an unchanged tree', () => {
		const fixture = new IntegrityFixture()
		try {
			expect(() => fixture.engine.changed('HEAD')).toThrow(
				'Missing accepted registry; run the explicit complete-registry refresh',
			)
			fixture.seed()
			expect(fixture.engine.changed('HEAD')).toEqual({ changes: [], owners: [] })
			const error = readThrown(() => fixture.engine.changed('missing-ref'))
			expect(isCaptureError(error) ? error.code : undefined).toBe('HOST')
			expect(String(error)).toContain('fatal:')
			const diagnostic = executeSync(
				{
					file: 'git',
					arguments: ['rev-parse', '--verify', '--end-of-options', 'missing-ref^{commit}'],
				},
				{ workspace: fixture.root, strict: false },
			)
			expect(diagnostic.failed).toBe(true)
			expect(diagnostic.stderr.trim()).not.toBe('')
			expect(String(error)).toContain(diagnostic.stderr.trim())
		} finally {
			fixture.destroy()
		}
	})
})

function readJSON(fixture: IntegrityFixture, file: string): unknown {
	return parseJSON(fixture.read(file).toString('utf8'))
}

async function readStatuses(
	fixture: IntegrityFixture,
	selection: { readonly selector: string; readonly variants: readonly string[] },
): Promise<readonly string[]> {
	return (await fixture.engine.check(selection)).entries.map((entry) => entry.status)
}

describe(
	'CaptureIntegrity real filesystem and producer protocol',
	{ timeout: FIXTURE_TIMEOUT },
	() => {
		it('commits current images with exact provenance and measured selected populations from an unmanifested workspace', async () => {
			const fixture = new IntegrityFixture()
			try {
				fixture.seed()
				expect(readFixtureManifest(fixture.root)).toBeUndefined()
				fixture.write('dirty note.txt', 'present before execution\n')
				const result = await fixture.capture()
				const check = await fixture.engine.check({
					selector: 'all',
					variants: ['light-390', 'light-320'],
				})
				expect(
					check.entries.map((entry) => [entry.state, entry.variant, entry.status]).toSorted(),
				).toEqual(
					[
						['mail-screen', 'light-390', 'current'],
						['mail-reader', 'light-390', 'current'],
						['mail-quotes', 'light-390', 'current'],
						['board-screen', 'light-390', 'current'],
						['files-reading', 'light-320', 'current'],
					].toSorted(),
				)
				expect(result.entries.every((entry) => entry.dirty.includes('dirty note.txt'))).toBe(true)
				expect(result.entries.every((entry) => /^[a-f0-9]{40}$/u.test(entry.commit))).toBe(true)
				expect(result.entries[0]?.own).toEqual({
					'src/mail/view.ts': fixture.hashes()['src/mail/view.ts'],
				})
				expect(result.entries[0]?.shared.files).toEqual({
					'src/shared/theme.ts': fixture.hashes()['src/shared/theme.ts'],
				})
				expect(result.entries[0]?.tests).toEqual({
					'behavior/journeys.ts': fixture.hashes()['behavior/journeys.ts'],
					'fixture with spaces.config.ts': fixture.hashes()['fixture with spaces.config.ts'],
				})
				expect(result.duration).toBeGreaterThanOrEqual(0)
				expect(check.duration).toBeGreaterThanOrEqual(0)
				expect(check.warnings).toEqual([])
			} finally {
				fixture.destroy()
			}
		})

		it.each(STALE_CHANGES)(
			'classifies $change beside a current control',
			async ({ change, status }) => {
				const fixture = await IntegrityFixture.current()
				try {
					expect(await readStatuses(fixture, MAIL_LIGHT)).toEqual(['current', 'current', 'current'])
					if (change === 'missing') rmSync(resolve(fixture.root, MAIL_IMAGE))
					if (change === 'image-bytes')
						fixture.write(MAIL_IMAGE, Buffer.concat([PNG, Buffer.from('changed')]))
					if (change === 'image-time')
						utimesSync(resolve(fixture.root, MAIL_IMAGE), new Date(), new Date(Date.now() + 2000))
					if (change === 'own-bytes') fixture.write('src/mail/view.ts', '// own drift\n')
					if (change === 'own-add') fixture.write('src/mail/new.ts', '// own added\n')
					if (change === 'own-remove') rmSync(resolve(fixture.root, 'src/mail/view.ts'))
					if (change === 'shared-bytes') fixture.write('src/shared/theme.ts', '// shared drift\n')
					if (change === 'shared-add') fixture.write('src/shared/new.ts', '// shared added\n')
					if (change === 'shared-remove') rmSync(resolve(fixture.root, 'src/shared/theme.ts'))
					if (change === 'unstamped' || change === 'obsolete-owner') {
						const manifest = readJSON(fixture, fixture.options.manifest)
						if (!isCaptureManifest(manifest)) throw new Error('Missing baseline manifest')
						fixture.write(
							fixture.options.manifest,
							JSON.stringify({
								...manifest,
								entries: Object.fromEntries(
									Object.entries(manifest.entries).flatMap(([key, entry]) =>
										key !== 'pages/mail-screen--light-390.png'
											? [[key, entry]]
											: change === 'unstamped'
												? []
												: [[key, { ...entry, part: 'obsolete' }]],
									),
								),
							}),
						)
					}
					const after = await fixture.engine.check(MAIL_LIGHT)
					expect(after.entries.find((entry) => entry.state === 'mail-screen')?.status).toBe(status)
					expect(
						after.entries.find((entry) => entry.state === 'mail-screen')?.reasons.length,
					).toBeGreaterThan(0)
					const control = await fixture.engine.check({
						selector: 'examples:board',
						variants: ['light-390'],
					})
					expect(control.entries.map((entry) => entry.status)).toEqual([
						change.startsWith('shared-') ? 'stale-shared' : 'current',
					])
				} finally {
					fixture.destroy()
				}
			},
		)

		it('retains all mismatch reasons and applies duplicate before orphan, missing, unstamped and stale sources', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				expect(
					(await fixture.engine.check(MAIL_LIGHT)).entries.every(
						(entry) => entry.status === 'current',
					),
				).toBe(true)
				fixture.seed({ duplicate: true })
				rmSync(resolve(fixture.root, MAIL_IMAGE))
				fixture.write('src/mail/view.ts', '// changed own\n')
				fixture.write('src/shared/theme.ts', '// changed shared\n')
				const result = await fixture.engine.check(MAIL_LIGHT)
				const entries = result.entries.filter((entry) => entry.state === 'mail-screen')
				expect(entries).toHaveLength(2)
				expect(entries.every((entry) => entry.status === 'duplicate')).toBe(true)
				expect(entries[0]?.reasons).toEqual(
					expect.arrayContaining([
						'Repeated registry identity',
						'Required image is absent',
						'Shared source patterns, membership, or hashes changed',
						'Own source patterns, membership, or hashes changed',
					]),
				)
				// Untouched siblings keep their own class, so a repeat marks only its own identity.
				expect(result.entries.find((entry) => entry.state === 'mail-reader')?.status).toBe(
					'stale-shared',
				)
				expect(
					await readStatuses(fixture, { selector: 'examples:board', variants: ['light-390'] }),
				).toEqual(['stale-shared'])
			} finally {
				fixture.destroy()
			}
		})

		it('reports renamed, flat legacy and unknown PNGs as orphans without moving or deleting them', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				expect(
					(await fixture.engine.check({ selector: 'all', variants: ['light-390'] })).entries.every(
						(entry) => entry.status === 'current',
					),
				).toBe(true)
				const renamed = 'tmp/captures/states/mail-screen--light-390.png'
				renameSync(resolve(fixture.root, MAIL_IMAGE), resolve(fixture.root, renamed))
				fixture.write('tmp/captures/states/vue-home--light-390.png', PNG)
				fixture.write('tmp/captures/states/unknown--light-390.png', PNG)
				const result = await fixture.engine.check({ selector: 'all', variants: ['light-390'] })
				expect(
					result.entries
						.filter((entry) => entry.status === 'orphan')
						.map((entry) => entry.file)
						.toSorted(),
				).toEqual(
					[
						renamed,
						'tmp/captures/states/unknown--light-390.png',
						'tmp/captures/states/vue-home--light-390.png',
					].toSorted(),
				)
				expect(result.entries.find((entry) => entry.file === MAIL_IMAGE)?.status).toBe('missing')
				expect(result.entries.find((entry) => entry.state === 'board-screen')?.status).toBe(
					'current',
				)
				const scoped = await fixture.engine.check(MAIL_LIGHT)
				expect(
					scoped.entries.filter((entry) => entry.status === 'orphan').map((entry) => entry.file),
				).toEqual([renamed])
				expect(fixture.read(renamed)).toEqual(PNG)
			} finally {
				fixture.destroy()
			}
		})

		it.skipIf(!LINKED)(
			'detects actual hard-link aliases as duplicate physical images',
			async () => {
				const fixture = await IntegrityFixture.current()
				try {
					expect(
						(await fixture.engine.check(MAIL_LIGHT)).entries.every(
							(entry) => entry.status === 'current',
						),
					).toBe(true)
					const stage = fixture.stage()
					linkSync(
						resolve(fixture.root, MAIL_IMAGE),
						resolve(fixture.root, 'tmp/captures/states/mail-screen--light-390.png'),
					)
					const result = await fixture.engine.check(MAIL_LIGHT)
					expect(result.entries.find((entry) => entry.file === MAIL_IMAGE)?.status).toBe(
						'duplicate',
					)
					expect(result.entries.find((entry) => entry.state === 'mail-reader')?.status).toBe(
						'current',
					)
					expect(
						await readStatuses(fixture, { selector: 'examples:board', variants: ['light-390'] }),
					).toEqual(['current'])
					const manifest = fixture.read('tmp/captures/states/manifest.json')
					await expect(fixture.engine.stamp(stage)).rejects.toThrow(
						'Duplicate physical capture output',
					)
					expect(fixture.read('tmp/captures/states/manifest.json')).toEqual(manifest)
					rmSync(resolve(fixture.root, 'tmp/captures/states/mail-screen--light-390.png'))
					await fixture.capture()
					expect(
						(await fixture.engine.check(MAIL_LIGHT)).entries.every(
							(entry) => entry.status === 'current',
						),
					).toBe(true)
				} finally {
					fixture.destroy()
				}
			},
		)

		it('warns on behavioral bytes and membership, keeps pixels current, and invalidates state lookup', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				const lookup = { selector: 'pages:mail', state: 'mail-screen', variants: ['light-390'] }
				expect((await fixture.engine.lookup(lookup)).case).toBe(MAIL)
				fixture.write('behavior/journeys.ts', '// body changed\n')
				fixture.write('behavior/new.ts', '// added dependency\n')
				const result = await fixture.engine.check(MAIL_LIGHT)
				expect(result.entries.every((entry) => entry.status === 'current')).toBe(true)
				expect(result.warnings).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							files: ['behavior/journeys.ts', 'behavior/new.ts'],
							cases: [MAIL],
						}),
					]),
				)
				await expect(fixture.engine.lookup(lookup)).rejects.toThrow(
					'Refresh explicitly with: capture journey pages:mail --variant light-390',
				)
				const registry = fixture.read(fixture.options.registry)
				const manifest = readFixtureManifest(fixture.root)
				await fixture.capture({ command: 'journey', selector: 'pages:mail' })
				expect(readFixtureManifest(fixture.root)).toBe(manifest)
				expect(fixture.read(fixture.options.registry)).toEqual(registry)
				expect((await fixture.engine.lookup(lookup)).case).toBe(MAIL)
			} finally {
				fixture.destroy()
			}
		})

		it('names the exact case in the lookup refresh command with its quotes preserved', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				fixture.write('behavior/journeys.ts', '// body changed\n')
				await expect(
					fixture.engine.lookup({
						selector: 'pages:mail',
						state: 'mail-screen',
						case: MAIL,
						variants: ['light-390'],
					}),
				).rejects.toThrow(
					`capture journey pages:mail --variant light-390 --case ${JSON.stringify(MAIL)}. Registry declaration changes require the complete-registry refresh: capture registry.`,
				)
			} finally {
				fixture.destroy()
			}
		})

		it('projects a singleton after explicit lookup and leaves sibling image stamps and full observations intact', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				const before = parseJSON(readFixtureManifest(fixture.root) ?? '')
				if (!isCaptureManifest(before)) throw new Error('Missing baseline manifest')
				const result = await fixture.capture({
					selector: 'pages:mail',
					state: 'mail-screen',
					case: MAIL,
				})
				expect(result.entries.map((entry) => entry.state)).toEqual(['mail-screen'])
				const after = parseJSON(readFixtureManifest(fixture.root) ?? '')
				if (!isCaptureManifest(after)) throw new Error('Missing singleton manifest')
				expect(after.entries['pages/mail-reader--light-390.png']).toEqual(
					before.entries['pages/mail-reader--light-390.png'],
				)
				expect(after.entries['examples/board-screen--light-390.png']).toEqual(
					before.entries['examples/board-screen--light-390.png'],
				)
				const run = readJSON(fixture, result.projects[0]?.record.file ?? '')
				if (!isCaptureRun(run)) throw new Error('Missing singleton record')
				expect(run.observed).toEqual(['mail-screen', 'mail-reader'])
				expect(run.declarations.map((entry) => entry.case)).toContain(BOARD)
				expect(run.complete).toBe(false)
			} finally {
				fixture.destroy()
			}
		})

		it('requires state selector, case and producing variant agreement without executing a repair', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				const before = readFixtureManifest(fixture.root)
				await expect(
					fixture.engine.lookup({
						selector: 'examples:board',
						state: 'mail-screen',
						variants: ['light-390'],
					}),
				).rejects.toThrow('outside selector/case')
				await expect(
					fixture.engine.lookup({
						selector: 'pages:mail',
						case: BOARD,
						state: 'mail-screen',
						variants: ['light-390'],
					}),
				).rejects.toThrow('outside selector/case')
				await expect(
					fixture.engine.lookup({
						selector: 'pages:mail',
						state: 'mail-screen',
						variants: ['dark-390'],
					}),
				).rejects.toThrow('Missing or stale state lookup')
				await expect(
					fixture.engine.lookup({
						selector: 'pages:mail',
						state: 'mail-screen',
						variants: ['light-320'],
					}),
				).rejects.toThrow('Unknown or unattested selected variant')
				expect(readFixtureManifest(fixture.root)).toBe(before)
				const resolved = await fixture.engine.lookup({
					selector: 'examples:files',
					state: 'files-reading',
					variants: ['light-390'],
				})
				expect(resolved.entries).toMatchObject([
					{
						variant: 'light-320',
						project: 'journey:light-390',
						portfolio: 'files-focused',
						case: FILES,
					},
				])
				await expect(
					fixture.engine.check({ selector: 'unknown', variants: ['light-390'] }),
				).rejects.toThrow('selector: received')
				// An omitted variant list derives from the selector, so an unknown selector is named as one.
				await expect(fixture.engine.check({ selector: 'pages:absent' })).rejects.toThrow(
					'selector: received "pages:absent"',
				)
			} finally {
				fixture.destroy()
			}
		})

		it('keeps a separate raw Vue registry and reports its valid PNG as unstamped', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				const browser = fixture.read(fixture.options.registry)
				fixture.seed({ vue: true, variants: ['light-390'] })
				const vue = new CaptureIntegrity({
					...fixture.options,
					directory: 'tmp/captures/vue',
					registry: 'tmp/captures/vue/registry.json',
					manifest: 'tmp/captures/vue/manifest.json',
					lookups: 'tmp/captures/vue/lookups.json',
					portfolios: [{ portfolio: 'vue', directory: 'tmp/captures/vue', scoped: false }],
				})
				const result = await vue.check({ selector: 'vue', variants: ['light-390'] })
				expect(result.entries).toMatchObject([
					{
						state: 'vue-home',
						status: 'unstamped',
						file: 'tmp/captures/vue/vue-home--light-390.png',
					},
				])
				await expect(
					fixture.engine.check({ selector: 'vue', variants: ['light-390'] }),
				).rejects.toThrow('selector: received')
				expect(fixture.read(fixture.options.registry)).toEqual(browser)
				expect(
					(await fixture.engine.check(MAIL_LIGHT)).entries.every(
						(entry) => entry.status === 'current',
					),
				).toBe(true)
			} finally {
				fixture.destroy()
			}
		})
	},
)

describe('CaptureIntegrity atomic stage refusals', { timeout: FIXTURE_TIMEOUT }, () => {
	it.each(FIXTURE_FAULTS)(
		'preserves exact prior manifest bytes for %s after a passing stage control',
		async (fault) => {
			const fixture = await IntegrityFixture.current()
			try {
				expect(
					(await fixture.engine.check(MAIL_LIGHT)).entries.every(
						(entry) => entry.status === 'current',
					),
				).toBe(true)
				const before = readFixtureManifest(fixture.root)
				await expect(fixture.capture({ fault })).rejects.toThrow(FIXTURE_FAULT_MESSAGES[fault])
				expect(readFixtureManifest(fixture.root)).toBe(before)
			} finally {
				fixture.destroy()
			}
		},
	)

	it('validates every rest sibling before committing and retains the successful narrow stage', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const before = readFixtureManifest(fixture.root)
			await expect(
				fixture.capture({ variants: ['dark-390', 'light-1280'], fault: 'missing-record' }),
			).rejects.toThrow('Missing or stale execution output')
			expect(readFixtureManifest(fixture.root)).toBe(before)
			expect(
				(await fixture.engine.check(MAIL_LIGHT)).entries.every(
					(entry) => entry.status === 'current',
				),
			).toBe(true)
			expect(
				(
					await fixture.engine.check({ selector: 'pages:mail', variants: ['dark-390'] })
				).entries.every((entry) => entry.status === 'unstamped'),
			).toBe(true)
			await fixture.capture({ variants: ['dark-390', 'light-1280'] })
			expect(
				(
					await fixture.engine.check({
						selector: 'pages:mail',
						variants: ['dark-390', 'light-1280'],
					})
				).entries.every((entry) => entry.status === 'current'),
			).toBe(true)
		} finally {
			fixture.destroy()
		}
	})

	it('checks the abort signal after a real successful child and preserves prior manifest bytes', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const controller = new AbortController()
			const stage = fixture.stage({ signal: controller.signal })
			const before = readFixtureManifest(fixture.root)
			await expect(
				fixture.engine.stamp({
					...stage,
					execute: async () => {
						const outcome = await stage.execute()
						controller.abort(new Error('Fixture interruption before publication'))
						return outcome
					},
				}),
			).rejects.toThrow('Fixture interruption before publication')
			expect(readFixtureManifest(fixture.root)).toBe(before)
			expect(
				readdirSync(resolve(fixture.root, 'tmp/captures/states')).filter((name) =>
					name.endsWith('.tmp'),
				),
			).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('requires the empty final record for an inapplicable selected project and publishes no empty transaction', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const before = readFixtureManifest(fixture.root)
			const result = await fixture.capture({ selector: 'examples:files', variants: ['dark-390'] })
			expect(result.entries).toEqual([])
			expect(result.projects).toMatchObject([{ variant: 'dark-390', passed: [] }])
			expect(readFixtureManifest(fixture.root)).toBe(before)
			await expect(
				fixture.capture({
					selector: 'examples:files',
					variants: ['dark-390'],
					fault: 'missing-record',
				}),
			).rejects.toThrow('Missing or stale execution output')
			expect(readFixtureManifest(fixture.root)).toBe(before)
		} finally {
			fixture.destroy()
		}
	})

	it('attests full desktop collection from current phone inputs and refuses an unattested variant after input drift', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed({ variants: ['light-390', 'dark-390'] })
			const registry = fixture.read(fixture.options.registry)
			const result = await fixture.capture({ selector: 'examples:files', variants: ['dark-1280'] })
			expect(result.entries).toMatchObject([
				{ file: 'tmp/captures/files-focused/files-reading--dark-320.png', variant: 'dark-320' },
			])
			expect(
				(
					await fixture.engine.lookup({
						selector: 'examples:files',
						state: 'files-reading',
						variants: ['dark-1280'],
					})
				).case,
			).toBe(FILES)
			expect(fixture.read(fixture.options.registry)).toEqual(registry)
			const before = readFixtureManifest(fixture.root)
			fixture.write('behavior/journeys.ts', '// changed before first desktop collection\n')
			await expect(
				fixture.capture({ command: 'journey', selector: 'pages:mail', variants: ['light-1280'] }),
			).rejects.toThrow('Unattested producing variant')
			expect(readFixtureManifest(fixture.root)).toBe(before)
		} finally {
			fixture.destroy()
		}
	})

	it('refuses attribution outside the predeclared input population even when the registry and record agree', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const registry = readJSON(fixture, fixture.options.registry)
			if (!isCaptureRegistry(registry)) throw new Error('Missing complete registry')
			const entries = registry.entries.map((entry) => ({
				...entry,
				sources: { ...entry.sources, own: ['outside.ts'] },
			}))
			const receipts = registry.receipts.map((receipt) => ({
				...receipt,
				registry: receipt.registry.map((entry) => ({
					...entry,
					sources: { ...entry.sources, own: ['outside.ts'] },
				})),
			}))
			const next = { ...registry, entries, receipts }
			fixture.write(
				fixture.options.registry,
				JSON.stringify({ ...next, digest: computeRegistryDigest(next) }),
			)
			const before = readFixtureManifest(fixture.root)
			await expect(fixture.capture({ fault: 'outside' })).rejects.toThrow(
				'Attribution outside the predeclared host population',
			)
			expect(readFixtureManifest(fixture.root)).toBe(before)
		} finally {
			fixture.destroy()
		}
	})

	it('publishes journey lookup separately without changing any image entry or PNG bytes', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const before = readFixtureManifest(fixture.root)
			const image = fixture.read(MAIL_IMAGE)
			const result = await fixture.capture({ command: 'journey', selector: 'pages:mail' })
			expect(result.entries).toEqual([])
			expect(result.lookups.some((entry) => entry.case === MAIL)).toBe(true)
			expect(readFixtureManifest(fixture.root)).toBe(before)
			expect(fixture.read(MAIL_IMAGE)).toEqual(image)
			expect(existsSync(resolve(fixture.root, fixture.options.lookups))).toBe(true)
			expect(
				(await fixture.engine.check(MAIL_LIGHT)).entries.every(
					(entry) => entry.status === 'current',
				),
			).toBe(true)
		} finally {
			fixture.destroy()
		}
	})

	it('retires an older journey journal after capture merges newer input hashes', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const lookup = { selector: 'pages:mail', state: 'mail-screen', variants: ['light-390'] }
			await fixture.capture({ command: 'journey', selector: 'pages:mail' })
			const journal = fixture.read(fixture.options.lookups)
			fixture.write('behavior/journeys.ts', '// changed after journey lookup\n')
			await expect(fixture.engine.lookup(lookup)).rejects.toThrow('Missing or stale state lookup')
			await fixture.capture({ selector: 'pages:mail' })
			expect(fixture.read(fixture.options.lookups)).toEqual(journal)
			expect((await fixture.engine.lookup(lookup)).case).toBe(MAIL)
		} finally {
			fixture.destroy()
		}
	})

	it('publishes one lookup input map across producing variants and resolves every passing state', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			const result = await fixture.capture({ command: 'journey', variants: VARIANTS })
			const journal = readJSON(fixture, fixture.options.lookups)
			if (!isCaptureLookupJournal(journal)) throw new Error('Missing lookup journal')
			expect(Object.values(journal.inputs)).toEqual([fixture.hashes()])
			expect(journal.lookups).toHaveLength(result.lookups.length)
			expect(result.lookups.length).toBeGreaterThan(1)
			for (const lookup of result.lookups) {
				for (const state of lookup.states) {
					const resolved = await fixture.engine.lookup({
						selector: lookup.owner,
						state,
						variants: [lookup.variant],
					})
					expect(resolved.case).toBe(lookup.case)
					expect(resolved.lookups).toContainEqual(lookup)
				}
			}
		} finally {
			fixture.destroy()
		}
	})

	it.each([
		['unknown inputs', 'Lookup names an unknown inputs digest:'],
		['altered inputs', 'Lookup input digest differs from its map:'],
		['duplicate lookup', 'Duplicate incoming lookup identities'],
		['changed run', 'Lookup run record is missing or changed:'],
		['unauthorized run', 'Lookup has no authorized runner record'],
		['wrong owner', 'Lookup differs from its passing declaration'],
		['wrong states', 'Lookup differs from its passing declaration'],
		['wrong variant', 'Lookup differs from its passing declaration'],
		['missing case', 'Lookup differs from its passing declaration'],
	])('refuses %s in a compact journal and preserves published evidence', async (fault, message) => {
		const fixture = await IntegrityFixture.current()
		try {
			await fixture.capture({ command: 'journey', selector: 'pages:mail' })
			const lookup = { ...MAIL_LIGHT, state: 'mail-screen' }
			expect((await fixture.engine.lookup(lookup)).case).toBe(MAIL)
			const journal = readJSON(fixture, fixture.options.lookups)
			if (!isCaptureLookupJournal(journal)) throw new Error('Missing lookup journal')
			if (fault === 'unauthorized run') {
				for (const file of new Set(journal.lookups.map((entry) => entry.run.file)))
					fixture.write(`${file}.foreign`, fixture.read(file))
			}
			const altered = {
				...journal,
				inputs:
					fault === 'unknown inputs'
						? {}
						: fault === 'altered inputs'
							? Object.fromEntries(Object.keys(journal.inputs).map((digest) => [digest, {}]))
							: journal.inputs,
				lookups:
					fault === 'duplicate lookup'
						? [...journal.lookups, ...journal.lookups]
						: journal.lookups.map((entry) => ({
								...entry,
								...(fault === 'changed run'
									? { run: { ...entry.run, digest: '0'.repeat(64) } }
									: {}),
								...(fault === 'unauthorized run'
									? { run: { ...entry.run, file: `${entry.run.file}.foreign` } }
									: {}),
								...(fault === 'wrong owner' ? { owner: 'pages:absent' } : {}),
								...(fault === 'wrong states' ? { states: ['absent'] } : {}),
								...(fault === 'wrong variant' ? { variant: 'absent' } : {}),
								...(fault === 'missing case' ? { case: `${entry.case} absent` } : {}),
							})),
			}
			fixture.write(fixture.options.lookups, JSON.stringify(altered))
			const manifest = readFixtureManifest(fixture.root)
			const bytes = fixture.read(fixture.options.lookups)
			await expect(fixture.engine.lookup(lookup)).rejects.toThrow(message)
			await expect(fixture.capture({ command: 'journey' })).rejects.toThrow(message)
			expect(readFixtureManifest(fixture.root)).toBe(manifest)
			expect(fixture.read(fixture.options.lookups)).toEqual(bytes)
		} finally {
			fixture.destroy()
		}
	})

	it.each(COLLECTION_POPULATIONS)(
		'refuses %s lookup declarations that disagree with the registry despite matching run and report bytes',
		async (population) => {
			const fixture = new IntegrityFixture()
			try {
				fixture.seed()
				const stage = fixture.stage({ command: 'journey' })
				await fixture.engine.stamp(stage)
				const journal = readJSON(fixture, fixture.options.lookups)
				if (!isCaptureLookupJournal(journal)) throw new Error('Missing lookup journal')
				const outcome = fixture.execute({
					request: stage.request,
					variants: stage.request.variants,
					capture: false,
					report: stage.report,
					records: Object.fromEntries(
						stage.projects.map((project) => [project.variant, project.record]),
					),
					population,
				})
				expect(outcome).toEqual({ code: 0, signal: null })
				fixture.write(
					fixture.options.lookups,
					JSON.stringify({
						...journal,
						lookups: journal.lookups.map((entry) => ({
							...entry,
							run: { ...entry.run, digest: computeCaptureHash(fixture.read(entry.run.file)) },
						})),
					}),
				)
				await expect(
					fixture.engine.lookup({ ...MAIL_LIGHT, state: 'mail-screen' }),
				).rejects.toThrow('Lookup declarations disagree with the accepted registry')
			} finally {
				fixture.destroy()
			}
		},
	)

	it('keeps test-only complete-registry refresh distinct from pixel currency and refreshes lookup explicitly', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const lookup = { selector: 'pages:mail', state: 'mail-screen', variants: ['light-390'] }
			const manifest = readFixtureManifest(fixture.root)
			const registry = fixture.read(fixture.options.registry)
			fixture.write('behavior/journeys.ts', '// body-only revision before complete refresh\n')
			fixture.seed()
			expect(fixture.read(fixture.options.registry)).not.toEqual(registry)
			const result = await fixture.engine.check(MAIL_LIGHT)
			expect(result.entries.every((entry) => entry.status === 'current')).toBe(true)
			expect(result.warnings.length).toBeGreaterThan(0)
			await expect(fixture.engine.lookup(lookup)).rejects.toThrow('Missing or stale state lookup')
			await fixture.capture({ command: 'journey', selector: 'pages:mail' })
			expect((await fixture.engine.lookup(lookup)).case).toBe(MAIL)
			expect(readFixtureManifest(fixture.root)).toBe(manifest)
		} finally {
			fixture.destroy()
		}
	})

	it('never rewrites complete anchors during scoped refresh', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const before = fixture.read(fixture.options.registry)
			fixture.write('behavior/journeys.ts', '// changed body\n')
			await fixture.capture({ command: 'journey', selector: 'pages:mail' })
			expect(fixture.read(fixture.options.registry)).toEqual(before)
			const registry = parseJSON(before.toString('utf8'))
			if (!isCaptureRegistry(registry)) throw new Error('Missing registry')
			expect(registry.receipts[0]?.inputs['behavior/journeys.ts']).not.toBe(
				fixture.hashes()['behavior/journeys.ts'],
			)
		} finally {
			fixture.destroy()
		}
	})
})

describe('CaptureIntegrity pass-scoped file readings', { timeout: FIXTURE_TIMEOUT }, () => {
	it('hashes each shared source once before execution, once in the record pass and once in the final check', async () => {
		const fixture = new IntegrityFixture()
		try {
			const shared = [
				'src/shared/theme.ts',
				...Array.from({ length: 10 }, (_, index) => `src/shared/part-${index}.ts`),
			]
			for (const file of shared.slice(1)) fixture.write(file, `// ${file}\n`)
			// An anchor outside the staged variants lets every staged variant attest through unchanged inputs.
			fixture.seed({ variants: ['light-320'] })
			const log: string[] = []
			const engine = new CaptureIntegrity({
				...fixture.options,
				hash: (bytes) => {
					const digest = computeCaptureHash(bytes)
					log.push(digest)
					return digest
				},
			})
			const stage = fixture.stage({ variants: VARIANTS, population: 'changed' })
			const result = await engine.stamp({
				...stage,
				execute: async () => {
					log.push('execute')
					return stage.execute()
				},
			})
			expect(result.entries).toHaveLength(22)
			expect(result.entries.map((entry) => Object.keys(entry.shared.files).toSorted())).toEqual(
				result.entries.map(() => shared.toSorted()),
			)
			const boundary = log.indexOf('execute')
			expect(
				shared.map((file) => {
					const digest = computeCaptureHash(fixture.read(file))
					return [log.slice(0, boundary), log.slice(boundary + 1)].map(
						(hashes) => hashes.filter((entry) => entry === digest).length,
					)
				}),
			).toEqual(shared.map(() => [1, 2]))
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a shared source changed after the record pass read it and before the final check', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const file = 'src/shared/theme.ts'
			const original = computeCaptureHash(fixture.read(file))
			const log: string[] = []
			const engine = new CaptureIntegrity({
				...fixture.options,
				hash: (bytes) => {
					const digest = computeCaptureHash(bytes)
					log.push(digest)
					// The edit lands after the record pass's first reading of the source.
					if (
						digest === original &&
						log.includes('execute') &&
						log.slice(log.indexOf('execute')).filter((entry) => entry === original).length === 1
					)
						fixture.write(file, '// changed between passes\n')
					return digest
				},
			})
			const stage = fixture.stage()
			const before = readFixtureManifest(fixture.root)
			await expect(
				engine.stamp({
					...stage,
					execute: async () => {
						log.push('execute')
						return stage.execute()
					},
				}),
			).rejects.toThrow(`Attributed inputs or membership changed during execution: ${MAIL_IMAGE}`)
			expect(readFixtureManifest(fixture.root)).toBe(before)
			const after = log.slice(log.indexOf('execute') + 1)
			const image = computeCaptureHash(PNG)
			expect(after.filter((entry) => entry === original)).toHaveLength(1)
			// The record pass finished its image readings before the final check read the edited source.
			expect(after.indexOf(original)).toBeLessThan(after.indexOf(image))
			expect(after.indexOf(image)).toBeLessThan(
				after.indexOf(computeCaptureHash(fixture.read(file))),
			)
		} finally {
			fixture.destroy()
		}
	})

	it('refuses an unattributed bounded input changed after the record pass read it and before the final check', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			// The file matches the bounded inputs but no destination's attribution, so no stable check reads it.
			const file = 'src/extra.ts'
			fixture.write(file, '// bounded but unattributed\n')
			const original = computeCaptureHash(fixture.read(file))
			const log: string[] = []
			const engine = new CaptureIntegrity({
				...fixture.options,
				hash: (bytes) => {
					const digest = computeCaptureHash(bytes)
					log.push(digest)
					if (
						digest === original &&
						log.includes('execute') &&
						log.slice(log.indexOf('execute')).filter((entry) => entry === original).length === 1
					)
						fixture.write(file, '// changed between passes\n')
					return digest
				},
			})
			const stage = fixture.stage()
			const before = readFixtureManifest(fixture.root)
			await expect(
				engine.stamp({
					...stage,
					execute: async () => {
						log.push('execute')
						return stage.execute()
					},
				}),
			).rejects.toThrow('Bounded host inputs or membership changed during execution')
			expect(readFixtureManifest(fixture.root)).toBe(before)
			expect(log.slice(0, log.indexOf('execute'))).toContain(original)
			const after = log.slice(log.indexOf('execute') + 1)
			expect(after.filter((entry) => entry === original)).toHaveLength(1)
			expect(after).toContain(computeCaptureHash(fixture.read(file)))
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a staged image changed after the record pass read it and before commit', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const image = computeCaptureHash(PNG)
			const log: string[] = []
			const engine = new CaptureIntegrity({
				...fixture.options,
				hash: (bytes) => {
					const digest = computeCaptureHash(bytes)
					log.push(digest)
					// The appended byte keeps the PNG signature, so only the stage-output check can refuse it.
					if (
						digest === image &&
						log.includes('execute') &&
						log.slice(log.indexOf('execute')).filter((entry) => entry === image).length === 1
					)
						fixture.write(MAIL_IMAGE, Buffer.concat([PNG, Buffer.from([0])]))
					return digest
				},
			})
			// A singleton stage emits one image, so the first image reading after execution is this file's.
			const stage = fixture.stage({ selector: 'pages:mail', state: 'mail-screen', case: MAIL })
			const before = readFixtureManifest(fixture.root)
			await expect(
				engine.stamp({
					...stage,
					execute: async () => {
						log.push('execute')
						return stage.execute()
					},
				}),
			).rejects.toThrow('Stage output changed before commit')
			expect(readFixtureManifest(fixture.root)).toBe(before)
			const after = log.slice(log.indexOf('execute') + 1)
			expect(after.filter((entry) => entry === image)).toHaveLength(1)
			expect(after).toContain(computeCaptureHash(fixture.read(MAIL_IMAGE)))
		} finally {
			fixture.destroy()
		}
	})

	it('refuses a declaration input changed after a read measured it', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const file = 'behavior/journeys.ts'
			const original = computeCaptureHash(fixture.read(file))
			const log: string[] = []
			const engine = new CaptureIntegrity({
				...fixture.options,
				hash: (bytes) => {
					const digest = computeCaptureHash(bytes)
					log.push(digest)
					if (digest === original && log.filter((entry) => entry === original).length === 1)
						fixture.write(file, '// changed during the read\n')
					return digest
				},
			})
			await expect(engine.read(MAIL_LIGHT)).rejects.toThrow(
				'Declaration inputs changed during the read',
			)
			expect(log.filter((entry) => entry === original)).toHaveLength(1)
			expect(log).toContain(computeCaptureHash(fixture.read(file)))
		} finally {
			fixture.destroy()
		}
	})
})

describe(
	'CaptureIntegrity serialized and physical containment',
	{ timeout: FIXTURE_TIMEOUT },
	() => {
		it.each(REFUSED_PATHS)('refuses %j before opening a path', (path) => {
			const fixture = new IntegrityFixture()
			try {
				expect(() => new CaptureIntegrity({ ...fixture.options, manifest: path })).toThrow(
					'Invalid serialized path',
				)
			} finally {
				fixture.destroy()
			}
		})

		it('checks the physical record independently of request identity before spawning', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				const before = readFixtureManifest(fixture.root)
				const stage = fixture.stage()
				const calls: string[] = []
				await expect(
					fixture.engine.stamp({
						...stage,
						projects: stage.projects.map((project) => ({ ...project, record: 'tmp/foreign.json' })),
						execute: async () => {
							calls.push('executed')
							return stage.execute()
						},
					}),
				).rejects.toThrow('record path differs')
				expect(calls).toEqual([])
				expect(readFixtureManifest(fixture.root)).toBe(before)
			} finally {
				fixture.destroy()
			}
		})

		it('refuses a real directory symlink or junction escape at the nearest existing parent', () => {
			const fixture = new IntegrityFixture()
			const outside = createScratch({ prefix: 'outside-' })
			try {
				outside.write('sentinel.txt', 'unchanged\n')
				symlinkSync(outside.path, resolve(fixture.root, 'link'), 'junction')
				expect(fixture.read('link/sentinel.txt').toString('utf8')).toBe('unchanged\n')
				expect(
					() => new CaptureIntegrity({ ...fixture.options, manifest: 'link/new/manifest.json' }),
				).toThrow('outside integrity root')
				expect(outside.read('sentinel.txt')).toBe('unchanged\n')
				expect(outside.has('new/manifest.json')).toBe(false)
			} finally {
				fixture.destroy()
				outside.destroy()
			}
		})

		it('refuses capture redirection into a source directory even inside the workspace', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				expect(
					(await fixture.engine.check(MAIL_LIGHT)).entries.every(
						(entry) => entry.status === 'current',
					),
				).toBe(true)
				const before = readFixtureManifest(fixture.root)
				renameSync(
					resolve(fixture.root, 'tmp/captures/states/pages'),
					resolve(fixture.root, 'tmp/captures/states/retained-pages'),
				)
				symlinkSync(
					resolve(fixture.root, 'src/mail'),
					resolve(fixture.root, 'tmp/captures/states/pages'),
					'junction',
				)
				await expect(fixture.engine.check(MAIL_LIGHT)).rejects.toThrow(
					'outside authorized capture root',
				)
				expect(fixture.read('src/mail/view.ts').toString('utf8')).toBe('// src/mail/view.ts\n')
				expect(existsSync(resolve(fixture.root, 'src/mail/mail-screen--light-390.png'))).toBe(false)
				expect(readFixtureManifest(fixture.root)).toBe(before)
			} finally {
				fixture.destroy()
			}
		})

		it('refuses case-colliding manifest keys whatever the host folds', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				const value = readJSON(fixture, fixture.options.manifest)
				if (!isCaptureManifest(value)) throw new Error('Missing baseline manifest')
				const stamp = value.entries['pages/mail-screen--light-390.png']
				if (stamp === undefined) throw new Error('Missing baseline stamp')
				fixture.write(
					fixture.options.manifest,
					JSON.stringify({
						...value,
						entries: {
							...value.entries,
							'Pages/mail-screen--light-390.png': { ...stamp, scope: 'Pages' },
						},
					}),
				)
				await expect(fixture.engine.check(MAIL_LIGHT)).rejects.toThrow('Duplicate manifest keys')
			} finally {
				fixture.destroy()
			}
		})

		it('refuses invalid inherited schema and altered raw receipts without publishing', async () => {
			const fixture = await IntegrityFixture.current()
			try {
				const original = fixture.read(fixture.options.manifest)
				fixture.write(fixture.options.manifest, '{}\n')
				await expect(fixture.capture()).rejects.toThrow('Invalid inherited manifest schema')
				expect(fixture.read(fixture.options.manifest).toString('utf8')).toBe('{}\n')
				fixture.write(fixture.options.manifest, original)
				const receipt = fixture.imports[0]?.receipt
				if (receipt === undefined) throw new Error('Missing original complete receipt')
				fixture.write(receipt.report.file, '{}')
				await expect(fixture.capture()).rejects.toThrow('report changed')
				expect(fixture.read(fixture.options.manifest)).toEqual(original)
			} finally {
				fixture.destroy()
			}
		})

		it('refuses a relative integrity root, an empty input population, and an unknown primary root', () => {
			const fixture = new IntegrityFixture()
			try {
				expect(() => new CaptureIntegrity({ ...fixture.options, root: 'relative' })).toThrow(
					'Integrity root must be absolute',
				)
				expect(() => new CaptureIntegrity({ ...fixture.options, inputs: [] })).toThrow(
					'Invalid bounded host inputs',
				)
				expect(() => new CaptureIntegrity({ ...fixture.options, portfolios: [] })).toThrow(
					'Missing host portfolio roots',
				)
				expect(
					() =>
						new CaptureIntegrity({
							...fixture.options,
							directory: 'tmp/captures/elsewhere',
							registry: 'tmp/captures/elsewhere/registry.json',
							manifest: 'tmp/captures/elsewhere/manifest.json',
							lookups: 'tmp/captures/elsewhere/lookups.json',
						}),
				).toThrow('Primary run directory has no authorized portfolio root')
				expect(
					() =>
						new CaptureIntegrity({
							...fixture.options,
							portfolios: [
								{ portfolio: 'states', directory: 'tmp/captures/states', scoped: true },
								{ portfolio: 'States', directory: 'tmp/captures/other', scoped: true },
							],
						}),
				).toThrow('Duplicate portfolio identities')
				expect(
					() =>
						new CaptureIntegrity({
							...fixture.options,
							portfolios: [{ portfolio: 'a/b', directory: 'tmp/captures/states', scoped: true }],
						}),
				).toThrow('Invalid portfolio identity')
			} finally {
				fixture.destroy()
			}
		})
	},
)

describe('CaptureIntegrity refusal conditions', { timeout: FIXTURE_TIMEOUT }, () => {
	it('classifies each refusal under its condition and keeps the failure recognizable', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			await expect(
				fixture.engine.check({ selector: 'unknown', variants: ['light-390'] }),
			).rejects.toMatchObject({ code: 'USAGE' })
			await expect(fixture.capture({ fault: 'failed-child' })).rejects.toMatchObject({
				code: 'STAGE',
			})
			await expect(fixture.capture({ fault: 'identity' })).rejects.toMatchObject({
				code: 'EVIDENCE',
			})
			await expect(fixture.capture({ fault: 'identity' })).rejects.toSatisfy(isCaptureError)
			const quiet = new IntegrityFixture()
			try {
				await expect(quiet.engine.read(MAIL_LIGHT)).rejects.toMatchObject({ code: 'EVIDENCE' })
				expect(
					readThrown(() => new CaptureIntegrity({ ...quiet.options, manifest: '../escape.json' })),
				).toMatchObject({ code: 'CONTAINMENT' })
				expect(
					readThrown(() => new CaptureIntegrity({ ...quiet.options, inputs: [] })),
				).toMatchObject({ code: 'HOST' })
			} finally {
				quiet.destroy()
			}
		} finally {
			fixture.destroy()
		}
	})

	it('keeps the original refusal as the cause of a read or lookup refusal', async () => {
		const fixture = await IntegrityFixture.current()
		try {
			const failure: unknown = await fixture.engine
				.lookup({ selector: 'examples:board', state: 'mail-screen', variants: ['light-390'] })
				.catch((error: unknown) => error)
			expect(isCaptureError(failure) && failure.code).toBe('SELECTION')
			expect(isCaptureError(failure) && isCaptureError(failure.cause)).toBe(true)
		} finally {
			fixture.destroy()
		}
	})
})

describe('CaptureIntegrity registry reading', { timeout: FIXTURE_TIMEOUT }, () => {
	it('reads complete declarations without PNGs or passing lookups and discovers actual sparse output variants', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			const before = fixture.read(fixture.options.registry)
			const result = await fixture.engine.read({ selector: 'examples:files' })
			expect(result.entries.map((entry) => [entry.variant, entry.project, entry.file])).toEqual([
				['dark-320', 'journey:dark-1280', 'tmp/captures/files-focused/files-reading--dark-320.png'],
				[
					'light-320',
					'journey:light-390',
					'tmp/captures/files-focused/files-reading--light-320.png',
				],
			])
			expect(readFixtureManifest(fixture.root)).toBeUndefined()
			expect(existsSync(resolve(fixture.root, fixture.options.lookups))).toBe(false)
			expect(fixture.read(fixture.options.registry)).toEqual(before)
			expect(
				(await fixture.engine.check(MAIL_LIGHT)).entries.every(
					(entry) => entry.status === 'missing',
				),
			).toBe(true)
		} finally {
			fixture.destroy()
		}
	})

	it('revalidates a body-only edit by full collection for only its actually executed variant without promoting unpassed cases to lookups', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			const anchor = fixture.read(fixture.options.registry)
			fixture.write('behavior/journeys.ts', '// same declarations, changed body\n')
			await expect(
				fixture.engine.read({ selector: 'examples:board', variants: ['light-390'] }),
			).rejects.toThrow('No current full-collection evidence')
			const result = await fixture.capture({
				command: 'journey',
				selector: 'pages:mail',
				case: MAIL,
			})
			expect(result.lookups.map((entry) => entry.case)).toEqual([MAIL])
			expect(
				(
					await fixture.engine.read({ selector: 'examples:board', variants: ['light-390'] })
				).entries.map((entry) => entry.state),
			).toEqual(['board-screen'])
			await expect(
				fixture.engine.lookup({
					selector: 'examples:board',
					variants: ['light-390'],
					state: 'board-screen',
				}),
			).rejects.toThrow('Missing or stale state lookup')
			await expect(
				fixture.engine.read({ selector: 'examples:board', variants: ['dark-390'] }),
			).rejects.toThrow('No current full-collection evidence')
			expect(fixture.read(fixture.options.registry)).toEqual(anchor)
			expect(readFixtureManifest(fixture.root)).toBeUndefined()
		} finally {
			fixture.destroy()
		}
	})

	it.each(PRODUCT_INPUTS)(
		'keeps pixel stale reasons after %s changes while declaration reads require a fresh collection',
		async (file) => {
			const fixture = await IntegrityFixture.current()
			try {
				fixture.write(file, '// changed product bytes\n')
				const status = file.includes('/shared/') ? 'stale-shared' : 'stale-own'
				expect(
					(await fixture.engine.check(MAIL_LIGHT)).entries.every(
						(entry) => entry.status === status,
					),
				).toBe(true)
				await expect(fixture.engine.read(MAIL_LIGHT)).rejects.toThrow(
					'No current full-collection evidence',
				)
				const manifest = readFixtureManifest(fixture.root)
				await fixture.capture({ command: 'journey', selector: 'pages:mail' })
				expect((await fixture.engine.read(MAIL_LIGHT)).entries).toHaveLength(3)
				expect(
					(await fixture.engine.check(MAIL_LIGHT)).entries.every(
						(entry) => entry.status === status,
					),
				).toBe(true)
				expect(readFixtureManifest(fixture.root)).toBe(manifest)
			} finally {
				fixture.destroy()
			}
		},
	)

	it('tracks both added and removed bounded input members and refuses a stale collection after the next edit', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			fixture.write('behavior/added.ts', '// membership addition\n')
			await expect(fixture.engine.read(MAIL_LIGHT)).rejects.toThrow(
				'No current full-collection evidence',
			)
			await fixture.capture({ command: 'journey', selector: 'pages:mail' })
			expect((await fixture.engine.read(MAIL_LIGHT)).entries).toHaveLength(3)
			rmSync(resolve(fixture.root, 'behavior/journeys.ts'))
			await expect(fixture.engine.read(MAIL_LIGHT)).rejects.toThrow(
				'No current full-collection evidence',
			)
			await fixture.capture({ command: 'journey', selector: 'pages:mail' })
			expect((await fixture.engine.read(MAIL_LIGHT)).entries).toHaveLength(3)
			fixture.write('behavior/added.ts', '// another edit\n')
			await expect(fixture.engine.read(MAIL_LIGHT)).rejects.toThrow(
				'No current full-collection evidence',
			)
		} finally {
			fixture.destroy()
		}
	})

	it('persists a zero-passing full collection in the existing journey journal without images or manifest replacement', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			const anchor = fixture.read(fixture.options.registry)
			fixture.write('behavior/journeys.ts', '// changed body\n')
			const result = await fixture.capture({
				command: 'journey',
				selector: 'examples:files',
				variants: ['dark-390'],
			})
			expect(result.projects.map((project) => project.passed)).toEqual([[]])
			expect(result.lookups).toEqual([])
			expect(result.entries).toEqual([])
			const journal = readJSON(fixture, fixture.options.lookups)
			if (!isCaptureLookupJournal(journal)) throw new Error('Missing collection journal')
			expect(journal.lookups).toEqual([])
			expect(journal.collections).toHaveLength(1)
			expect(
				(
					await fixture.engine.read({ selector: 'examples:board', variants: ['dark-390'] })
				).entries.map((entry) => entry.state),
			).toEqual(['board-screen'])
			expect(fixture.read(fixture.options.registry)).toEqual(anchor)
			expect(readFixtureManifest(fixture.root)).toBeUndefined()
			expect(existsSync(resolve(fixture.root, 'tmp/captures/states/examples'))).toBe(false)
		} finally {
			fixture.destroy()
		}
	})

	it.each(COLLECTION_POPULATIONS)(
		'refuses a real %s full collection while preserving the complete anchor and journal',
		async (population) => {
			const fixture = new IntegrityFixture()
			try {
				fixture.seed()
				await fixture.capture({ command: 'journey', selector: 'examples:board' })
				const anchor = fixture.read(fixture.options.registry)
				const journal = fixture.read(fixture.options.lookups)
				fixture.write('behavior/journeys.ts', '// edited collection producer\n')
				await expect(
					fixture.capture({ command: 'journey', selector: 'examples:board', population }),
				).rejects.toThrow('Collected registry declarations changed')
				expect(fixture.read(fixture.options.registry)).toEqual(anchor)
				expect(fixture.read(fixture.options.lookups)).toEqual(journal)
				await expect(
					fixture.engine.read({ selector: 'examples:board', variants: ['light-390'] }),
				).rejects.toThrow('No current full-collection evidence')
			} finally {
				fixture.destroy()
			}
		},
	)

	it.each(COLLECTION_MEMBERS)(
		'pins exact %s bytes even when the collection has no passing lookup',
		async (member) => {
			const fixture = new IntegrityFixture()
			try {
				fixture.seed()
				fixture.write('behavior/journeys.ts', '// body edit\n')
				await fixture.capture({
					command: 'journey',
					selector: 'examples:files',
					variants: ['dark-390'],
				})
				const dark = { selector: 'pages:mail', variants: ['dark-390'] }
				expect((await fixture.engine.read(dark)).entries).toHaveLength(3)
				const journal = readJSON(fixture, fixture.options.lookups)
				if (!isCaptureLookupJournal(journal)) throw new Error('Missing collection journal')
				const receipt = journal.collections?.[0]
				if (receipt === undefined) throw new Error('Missing collection receipt')
				const original = fixture.read(receipt[member].file)
				fixture.write(receipt[member].file, `${original.toString('utf8')}\n`)
				await expect(fixture.engine.read(dark)).rejects.toThrow(
					'Collection record or report bytes changed',
				)
				fixture.write(receipt[member].file, original)
				expect((await fixture.engine.read(dark)).entries).toHaveLength(3)
			} finally {
				fixture.destroy()
			}
		},
	)

	it.each(COLLECTION_POPULATIONS)(
		'refuses %s authenticated collection declarations at read time independently of producer publication checks',
		async (population) => {
			const fixture = new IntegrityFixture()
			try {
				fixture.seed()
				const stage = fixture.stage({
					command: 'journey',
					selector: 'examples:files',
					variants: ['dark-390'],
				})
				await fixture.engine.stamp(stage)
				const journal = readJSON(fixture, fixture.options.lookups)
				if (!isCaptureLookupJournal(journal)) throw new Error('Missing collection journal')
				const receipt = journal.collections?.[0]
				if (receipt === undefined) throw new Error('Missing collection receipt')
				const outcome = fixture.execute({
					request: stage.request,
					variants: stage.request.variants,
					capture: false,
					report: stage.report,
					records: Object.fromEntries(
						stage.projects.map((project) => [project.variant, project.record]),
					),
					population,
				})
				expect(outcome).toEqual({ code: 0, signal: null })
				fixture.write(
					fixture.options.lookups,
					JSON.stringify({
						...journal,
						collections: [
							{
								...receipt,
								run: {
									file: receipt.run.file,
									digest: computeCaptureHash(fixture.read(receipt.run.file)),
								},
								report: {
									file: receipt.report.file,
									digest: computeCaptureHash(fixture.read(receipt.report.file)),
								},
							},
						],
					}),
				)
				await expect(
					fixture.engine.read({ selector: 'pages:mail', variants: ['dark-390'] }),
				).rejects.toThrow('Collection declarations differ from the complete anchor')
			} finally {
				fixture.destroy()
			}
		},
	)

	it('does not infer collection receipts from historical lookups', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed()
			fixture.write('behavior/journeys.ts', '// body edit\n')
			await fixture.capture({ command: 'journey', selector: 'pages:mail' })
			expect((await fixture.engine.read(MAIL_LIGHT)).entries).toHaveLength(3)
			const journal = readJSON(fixture, fixture.options.lookups)
			if (!isCaptureLookupJournal(journal)) throw new Error('Missing lookup journal')
			fixture.write(
				fixture.options.lookups,
				JSON.stringify({
					version: journal.version,
					inputs: journal.inputs,
					lookups: journal.lookups,
					...(journal.manifest === undefined ? {} : { manifest: journal.manifest }),
				}),
			)
			await expect(fixture.engine.read(MAIL_LIGHT)).rejects.toThrow(
				'No current full-collection evidence',
			)
		} finally {
			fixture.destroy()
		}
	})

	it('admits a desktop collection only after that actual producer runs and retains its anchor lineage across a body edit', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed({ variants: ['light-390', 'dark-390'] })
			const desktop = { selector: 'examples:files', variants: ['dark-320'] }
			await expect(fixture.engine.read(desktop)).rejects.toThrow(
				'Unknown or unattested selected variant',
			)
			await fixture.capture({
				command: 'journey',
				selector: 'examples:files',
				variants: ['dark-1280'],
			})
			expect((await fixture.engine.read(desktop)).entries.map((entry) => entry.project)).toEqual([
				'journey:dark-1280',
			])
			fixture.write('behavior/journeys.ts', '// desktop body edit\n')
			await expect(fixture.engine.read(desktop)).rejects.toThrow(
				'No current full-collection evidence',
			)
			await fixture.capture({ command: 'journey', selector: 'pages:mail', variants: ['dark-1280'] })
			expect((await fixture.engine.read(desktop)).entries.map((entry) => entry.project)).toEqual([
				'journey:dark-1280',
			])
		} finally {
			fixture.destroy()
		}
	})

	it.each(READ_REFUSALS)(
		'refuses an unknown or empty read without creating evidence: $reason',
		async ({ selection, reason }) => {
			const fixture = new IntegrityFixture()
			try {
				fixture.seed()
				const registry = fixture.read(fixture.options.registry)
				await expect(fixture.engine.read(selection)).rejects.toThrow(reason)
				expect(fixture.read(fixture.options.registry)).toEqual(registry)
				expect(readFixtureManifest(fixture.root)).toBeUndefined()
				expect(existsSync(resolve(fixture.root, fixture.options.lookups))).toBe(false)
			} finally {
				fixture.destroy()
			}
		},
	)

	it('retains an empty-passing non-anchor lineage with only its origin and latest collection', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed({ variants: ['light-390', 'dark-390'] })
			await fixture.capture({
				command: 'journey',
				selector: 'examples:files',
				variants: ['light-1280'],
			})
			for (const body of ['// first body edit\n', '// second body edit\n']) {
				fixture.write('behavior/journeys.ts', body)
				await fixture.capture({
					command: 'journey',
					selector: 'examples:files',
					variants: ['light-1280'],
				})
				expect(
					(await fixture.engine.read({ selector: 'pages:mail', variants: ['light-1280'] })).entries,
				).toHaveLength(3)
			}
			const journal = readJSON(fixture, fixture.options.lookups)
			if (!isCaptureLookupJournal(journal)) throw new Error('Missing collection journal')
			expect(journal.lookups).toEqual([])
			expect(journal.collections).toHaveLength(2)
			expect(readFixtureManifest(fixture.root)).toBeUndefined()
		} finally {
			fixture.destroy()
		}
	})

	it('reads separate Vue declarations while preserving unstamped direct images and refusing browser selections', async () => {
		const fixture = new IntegrityFixture()
		try {
			fixture.seed({ vue: true, variants: ['light-390'] })
			const vue = new CaptureIntegrity({
				...fixture.options,
				directory: 'tmp/captures/vue',
				registry: 'tmp/captures/vue/registry.json',
				manifest: 'tmp/captures/vue/manifest.json',
				lookups: 'tmp/captures/vue/lookups.json',
				portfolios: [{ portfolio: 'vue', directory: 'tmp/captures/vue', scoped: false }],
			})
			expect(
				(await vue.read({ selector: 'vue', portfolio: 'vue' })).entries.map((entry) => entry.file),
			).toEqual(['tmp/captures/vue/vue-home--light-390.png'])
			expect(
				(
					await vue.check({ selector: 'vue', portfolio: 'vue', variants: ['light-390'] })
				).entries.map((entry) => entry.status),
			).toEqual(['unstamped'])
			await expect(vue.read({ selector: 'pages:mail' })).rejects.toThrow(
				'Prepare the explicit complete-registry refresh',
			)
		} finally {
			fixture.destroy()
		}
	})
})
