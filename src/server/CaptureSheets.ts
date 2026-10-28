import type {
	CapturePicture,
	CapturePreflightResult,
	CaptureSheetCell,
	CaptureSheetGroup,
	CaptureSheetOptions,
	CaptureSheetPage,
	CaptureSheetRow,
	CaptureSheetsInterface,
	CaptureWriteHandler,
} from './types.js'
import type { CaptureDestination } from '@src/core'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { attempt } from '@orkestrel/contract'
import { CaptureError, describeCaptureError, isCapturePath, resolveCaptureOwner } from '@src/core'
import {
	CAPTURE_EXIT,
	CAPTURE_REPORT_LINES,
	CAPTURE_SHEET,
	CAPTURE_SHEET_FILES,
} from './constants.js'
import { CapturePreflight } from './CapturePreflight.js'
import {
	composeCapturePictures,
	encodeCapturePicture,
	normalizeSlashes,
	shrinkCapturePicture,
} from './helpers.js'

/**
 * Composes exactly the authenticated sparse state and output pairs for iteration review.
 *
 * @remarks
 * Sheets remain preflight artifacts, never assembled-portfolio acceptance. The class reads the
 * selection through `CapturePreflight`, so it judges the same population the preflight does and
 * keeps its refusals. It writes the sheets, an index of every cell, and a notes document into a new
 * directory that is contained in the workspace, has an existing parent, and lies outside every
 * selected capture directory. A frame whose image cannot be read shows as a red mark and is indexed
 * as `missing`.
 *
 * @example
 * ```ts
 * const sheets = new CaptureSheets({ reader, output: `${process.cwd()}/tmp/sheets` })
 * const exit = await sheets.execute()
 * ```
 */
export class CaptureSheets implements CaptureSheetsInterface {
	readonly #options: CaptureSheetOptions
	readonly #stdout: CaptureWriteHandler
	readonly #stderr: CaptureWriteHandler

	/**
	 * Binds a read selection and a new output directory.
	 *
	 * @param options - The explicit host, selection, and sheet destination
	 */
	constructor(options: CaptureSheetOptions) {
		this.#options = options
		this.#stdout = options.reader.stdout ?? process.stdout.write.bind(process.stdout)
		this.#stderr = options.reader.stderr ?? process.stderr.write.bind(process.stderr)
	}

	/**
	 * Reads selected physical images, writes complete indexed sheets, and retains all refusals.
	 *
	 * @returns Exit 0 for current selected images without preflight defects, 1 for any defect, or 64 for refused usage, including an output directory that is not new, contained, and outside the selected capture directories
	 *
	 * @example
	 * ```ts
	 * const exit = await sheets.execute() // 0
	 * ```
	 */
	async execute(): Promise<number> {
		try {
			const { reader } = this.#options
			const result = await new CapturePreflight(reader).check()
			const output = this.#output(result)
			const groups = this.#groups(result)
			const rows = this.#pages(groups, CAPTURE_SHEET.pairs).map((pair): CaptureSheetRow => ({
				groups: pair,
				picture: composeCapturePictures(
					pair.map((entry) => entry.picture),
					false,
					CAPTURE_SHEET.gap,
				),
			}))
			const sheets = this.#pages(rows, CAPTURE_SHEET.rows).map((page, index): CaptureSheetPage => ({
				file: `${CAPTURE_SHEET_FILES.prefix}${String(index + 1).padStart(CAPTURE_SHEET_FILES.digits, '0')}.png`,
				rows: page,
				picture: composeCapturePictures(
					page.map((row) => row.picture),
					true,
					CAPTURE_SHEET.gap,
				),
			}))
			mkdirSync(output)
			for (const sheet of sheets)
				writeFileSync(resolve(output, sheet.file), encodeCapturePicture(sheet.picture))
			const index = {
				selection: result.selection,
				freshness: result.freshness,
				mixed: result.mixed,
				issues: result.issues,
				acceptance: false,
				sheets: sheets.map((sheet) => ({
					file: sheet.file,
					width: sheet.picture.width,
					height: sheet.picture.height,
					rows: sheet.rows.map((row) =>
						row.groups.map((group) => ({
							identity: group.identity,
							cells: group.cells.map(({ picture, ...cell }) => ({
								...cell,
								displayed: { width: picture.width, height: picture.height },
							})),
						})),
					),
				})),
			}
			writeFileSync(
				resolve(output, CAPTURE_SHEET_FILES.data),
				`${JSON.stringify(index, undefined, 2)}\n`,
			)
			writeFileSync(
				resolve(output, CAPTURE_SHEET_FILES.notes),
				`${this.#notes(result, sheets, output).join('\n')}\n`,
			)
			this.#stdout(`${CAPTURE_REPORT_LINES.sheets} ${JSON.stringify(index)}\n`)
			return result.issues.length > 0 ||
				result.freshness.entries.some((entry) => entry.status !== 'current')
				? CAPTURE_EXIT.failed
				: CAPTURE_EXIT.passed
		} catch (error) {
			this.#stderr(`${describeCaptureError(error)}\n`)
			return CAPTURE_EXIT.usage
		}
	}

	// Refuses an output directory that exists, escapes the workspace, or overlaps a selected capture directory.
	#output(result: CapturePreflightResult): string {
		const { root } = this.#options.reader
		const output = resolve(this.#options.output)
		const local = normalizeSlashes(relative(root, output))
		const parent = attempt(() =>
			normalizeSlashes(relative(realpathSync(root), realpathSync(dirname(output)))),
		)
		if (
			!isCapturePath(local) ||
			!parent.success ||
			(parent.value !== '' && !isCapturePath(parent.value)) ||
			result.selection.entries.some((entry) =>
				local.startsWith(`${normalizeSlashes(dirname(entry.file))}/`),
			) ||
			existsSync(output)
		)
			throw new CaptureError(
				'Contact sheets require a new contained directory outside selected capture directories with an existing parent',
				{ code: 'CONTAINMENT' },
			)
		return output
	}

	// Gathers the selected destinations by portfolio, owner, and state, each as a row of shrunk cells.
	#groups(result: CapturePreflightResult): readonly CaptureSheetGroup[] {
		const identities = [...new Set(result.selection.entries.map((entry) => this.#identity(entry)))]
		return identities.map((identity): CaptureSheetGroup => {
			const cells = result.selection.entries
				.filter((entry) => this.#identity(entry) === identity)
				.map((entry): CaptureSheetCell => {
					const image = result.images.find((candidate) => candidate.entry.file === entry.file)
					const factor =
						image === undefined
							? 1
							: Math.max(1, Math.ceil(image.picture.width / CAPTURE_SHEET.cell))
					const picture: CapturePicture =
						image === undefined
							? {
									width: CAPTURE_SHEET.mark.width,
									height: CAPTURE_SHEET.mark.height,
									pixels: Uint8Array.from(
										{ length: CAPTURE_SHEET.mark.width * CAPTURE_SHEET.mark.height * 3 },
										(_, index) =>
											index % 3 === 0 ? CAPTURE_SHEET.mark.present : CAPTURE_SHEET.mark.absent,
									),
								}
							: shrinkCapturePicture(image.picture, factor, CAPTURE_SHEET.limit)
					return {
						entry,
						picture,
						source:
							image === undefined
								? undefined
								: { width: image.picture.width, height: image.picture.height, bytes: image.size },
						factor,
						clipped:
							image !== undefined &&
							Math.floor(image.picture.height / factor) > CAPTURE_SHEET.limit,
						freshness: result.freshness.entries.find((candidate) => candidate.file === entry.file),
					}
				})
			return {
				identity,
				cells,
				picture: composeCapturePictures(
					cells.map((cell) => cell.picture),
					false,
				),
			}
		})
	}

	// Names the portfolio, owner, and state a cell row holds, independent of its variants.
	#identity(entry: CaptureDestination): string {
		return JSON.stringify([entry.portfolio, resolveCaptureOwner(entry), entry.state])
	}

	// Splits a list into consecutive runs of at most `size` members.
	#pages<T>(items: readonly T[], size: number): ReadonlyArray<readonly T[]> {
		return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
			items.slice(index * size, index * size + size),
		)
	}

	// Writes the notes document: the mixed observations, then each sheet with its cells described.
	#notes(
		result: CapturePreflightResult,
		sheets: readonly CaptureSheetPage[],
		output: string,
	): readonly string[] {
		return [
			'# Contact sheets',
			'',
			'Iteration evidence only. Assembled-portfolio acceptance remains withheld.',
			'',
			'## Mixed observations',
			'',
			...(result.mixed.length === 0
				? ['No mixed geometry reported for this selection.']
				: result.mixed.map((observation) => `- ${observation}`)),
			'',
			...sheets.flatMap((sheet) => [
				`## ${sheet.file}`,
				'',
				`![${sheet.file}](${sheet.file})`,
				'',
				...sheet.rows.flatMap((row) =>
					row.groups.flatMap((group) =>
						group.cells.map((cell) => {
							const link = normalizeSlashes(
								relative(output, resolve(this.#options.reader.root, cell.entry.file)),
							)
							const source =
								cell.source === undefined
									? 'unreadable'
									: `${String(cell.source.width)} x ${String(cell.source.height)}`
							return `- ${cell.entry.portfolio} / ${resolveCaptureOwner(cell.entry)} / ${cell.entry.state} / ${cell.entry.variant}: [${cell.entry.file}](${link}); producer ${cell.entry.project}; ${cell.freshness?.status ?? 'missing'}; source ${source}; displayed ${String(cell.picture.width)} x ${String(cell.picture.height)}${cell.clipped ? '; clipped' : ''}`
						}),
					),
				),
				'',
			]),
		]
	}
}
