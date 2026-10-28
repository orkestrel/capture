import { realpathSync } from 'node:fs'

// Reports the process boundary a spawn establishes, then exits with the code its first argument names.
class Reporter {
	execute(): void {
		process.stdout.write(
			`${JSON.stringify({
				cwd: realpathSync(process.cwd()),
				capture: Object.entries(process.env).filter(([name]) => name.toLowerCase() === 'capture'),
			})}\n`,
		)
		process.stderr.write('reporter stderr\n')
		process.exitCode = Number(process.argv[2] ?? '0')
	}
}

new Reporter().execute()
