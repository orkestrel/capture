import { writeFileSync } from 'node:fs'

const file = process.argv[2]
if (file === undefined) throw new Error('Missing survivor ready file')
writeFileSync(file, String(process.pid))
setInterval(() => undefined, 1000)
