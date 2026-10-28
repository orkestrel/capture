import { createServer } from 'node:net'

// A live socket holds this fixture until a test or the runner terminates its process tree.
createServer().listen(0, '127.0.0.1', () => process.stdout.write('descendant ready\n'))
