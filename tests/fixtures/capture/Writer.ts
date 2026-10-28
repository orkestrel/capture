import { readFileSync } from 'node:fs'
import { parseJSON } from '@orkestrel/contract'
import { isFixtureWrite, writeFixtureOutputs } from '../../setupServer.ts'

// A plain Node process runs this file, so its imports name the module with its extension and reach
// no Vite alias. The parent owns the private input; the engine's inputs stay unknown until guarded.
const input: unknown = parseJSON(readFileSync(process.argv[2] ?? '', 'utf8'))
if (!isFixtureWrite(input)) throw new Error('Invalid private fixture transport')
writeFixtureOutputs(input)
