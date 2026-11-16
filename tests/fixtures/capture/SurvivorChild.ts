import { renameSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (file === undefined) throw new Error('Missing survivor ready file')
// The reader waits for the ready name, so the pid is written under a sibling name and renamed into place whole.
writeFileSync(`${file}.tmp`, String(process.pid))
renameSync(`${file}.tmp`, file)
setInterval(() => undefined, 1000)
