import type { CaptureProvided, CaptureRun } from '@orkestrel/capture'

declare module 'vitest' {
	interface TaskMeta {
		readonly owner?: string
		readonly variant?: string
		readonly states?: readonly string[]
	}
	interface ProvidedContext extends CaptureProvided {
		readonly variant: string
	}
}

declare module 'vitest/browser' {
	interface BrowserCommands {
		readonly persistConsumer: (record: string, run: CaptureRun) => Promise<void>
		readonly readCaptureFrames: () => Promise<readonly string[]>
	}
}
