import type { CaptureRequest, CaptureRun } from '@orkestrel/capture'

declare module 'vitest' {
	interface TaskMeta {
		readonly owner?: string
		readonly variant?: string
		readonly states?: readonly string[]
		readonly consumer?: string
	}
	interface ProvidedContext {
		readonly consumer: {
			readonly request: CaptureRequest
			readonly variant: string
			readonly capture: boolean
		}
	}
}

declare module 'vitest/browser' {
	interface BrowserCommands {
		readonly persistConsumer: (run: CaptureRun) => Promise<void>
	}
}
