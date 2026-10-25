import { Link, useRouterState } from '@tanstack/react-router'
import { Debug, DebugToggle, disableDebug } from 'debug-overlay/client'
import { type ReactNode, useEffect } from 'react'
import { useAuth } from '../api'
import 'debug-overlay/styles.css'

const identity = () => {
	const user = useAuth.getState().user
	return user && ['admin', 'root'].includes(String(user.type))
		? `${user.id}:${user.type}`
		: ''
}
const getToken = () => useAuth.getState().user?.accessToken ?? ''
const modernBase = () =>
	(window.__ABS_WEB_CONFIG__?.basePath || '').replace(/\/$/, '')
const renderLink = (path: string, label: string): ReactNode => (
	<Link to={path}>{label}</Link>
)

export function RootDebug({ children }: { children: ReactNode }) {
	const user = useAuth((state) => state.user)
	const routePath = useRouterState({
		select: (state) => state.location.pathname,
	})
	useEffect(() => {
		const logout = () => disableDebug()
		window.addEventListener('abs:logout-start', logout)
		return () => window.removeEventListener('abs:logout-start', logout)
	}, [])
	return (
		<Debug
			identity={identity()}
			apiUrl={`${modernBase()}/debug-api`}
			isAdmin={!!user && ['admin', 'root'].includes(String(user.type))}
			getToken={getToken}
			routePath={routePath}
			renderLink={renderLink}
			offsetTarget='[aria-label="Audio player"]'
		>
			{children}
		</Debug>
	)
}

export { DebugToggle }
