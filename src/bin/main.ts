import { createCaptureCLI } from '@src/server'

process.exitCode = await createCaptureCLI().execute(process.argv.slice(2))
