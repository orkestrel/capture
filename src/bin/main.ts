import { CaptureError, describeCaptureError, isCaptureError } from '@src/core'
import {
	CAPTURE_DEFAULTS,
	CAPTURE_EXIT,
	CAPTURE_SUBCOMMANDS,
	CAPTURE_USAGE,
	createCapturePreflight,
	createCaptureRegistrar,
	createCaptureRunner,
	createCaptureSheets,
	readCaptureReaderArguments,
} from '@src/server'

// The entry owns stdout and stderr: a subcommand prints its own report and this entry maps a refused
// command line to exit 64 and any other capture refusal to exit 1.
try {
	const [name, ...argv] = process.argv.slice(2)
	const root = process.cwd()
	if (name === undefined || !CAPTURE_SUBCOMMANDS.includes(name))
		throw new CaptureError(
			`${name === undefined ? 'No command given' : `Unknown command ${JSON.stringify(name.slice(0, 80))}`}.\n${CAPTURE_USAGE}`,
			{ code: 'USAGE' },
		)
	switch (name) {
		case 'journey':
		case 'frames':
		case 'stale': {
			const command = name === 'frames' ? 'capture' : name === 'stale' ? 'stale' : 'journey'
			process.exitCode = await createCaptureRunner({
				command,
				root,
				config: CAPTURE_DEFAULTS.config,
				requests: CAPTURE_DEFAULTS.requests,
				argv,
			}).execute()
			break
		}
		case 'registry': {
			process.exitCode = await createCaptureRegistrar({
				root,
				config: CAPTURE_DEFAULTS.config,
				requests: CAPTURE_DEFAULTS.requests,
				argv,
			}).execute()
			break
		}
		case 'preflight': {
			const { reader, output } = readCaptureReaderArguments(argv, root, CAPTURE_DEFAULTS)
			if (output !== undefined)
				throw new CaptureError(
					'The preflight writes no sheets, so it takes no --output; use `capture sheets <selector> --output <new directory>` to write them',
					{ code: 'USAGE' },
				)
			process.exitCode = await createCapturePreflight(reader).execute()
			break
		}
		default: {
			const { reader, output } = readCaptureReaderArguments(argv, root, CAPTURE_DEFAULTS)
			if (output === undefined)
				throw new CaptureError(
					'The sheets command requires --output <new directory>, which must not exist and must sit outside the selected capture directories',
					{ code: 'USAGE' },
				)
			process.exitCode = await createCaptureSheets({ reader, output }).execute()
		}
	}
} catch (error) {
	if (!isCaptureError(error)) throw error
	process.stderr.write(`${describeCaptureError(error)}\n`)
	process.exitCode = error.code === 'USAGE' ? CAPTURE_EXIT.usage : CAPTURE_EXIT.failed
}
