import { createFileRoute } from '@tanstack/react-router'
import { DebugPage } from 'debug-overlay/client'

export const Route = createFileRoute('/debug/issues')({
	component: DebugPage,
})
