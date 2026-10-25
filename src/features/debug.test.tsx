import { act, cleanup, render } from '@testing-library/react'
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAuth } from '../api'
import { RootDebug } from './debug'

const debug = vi.hoisted(() => ({
	props: undefined as
		| (Record<string, unknown> & { children: React.ReactNode })
		| undefined,
	mounts: 0,
	disable: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
	useRouterState: () => '/',
}))
vi.mock('debug-overlay/client', () => ({
	Debug: (props: typeof debug.props) => {
		debug.props = props
		React.useEffect(() => {
			debug.mounts++
		}, [])
		return <>{props?.children}</>
	},

	DebugToggle: () => null,
	disableDebug: debug.disable,
}))

const admin = (id = 'admin') =>
	useAuth.getState().set({
		id,
		username: id,
		accessToken: 'secret-token',
		type: 'admin',
	})
afterEach(() => {
	cleanup()
	act(() => useAuth.getState().set(null))
	debug.props = undefined
	debug.mounts = 0
	debug.disable.mockClear()
})

it('passes admin identity and live token without remounting app on user change', () => {
	const { rerender } = render(<RootDebug>App</RootDebug>)
	act(() => admin())
	rerender(<RootDebug>App</RootDebug>)
	expect(debug.props).toMatchObject({
		apiUrl: '/debug-api',
		isAdmin: true,
		routePath: '/',
		offsetTarget: '[aria-label="Audio player"]',
	})
	const getToken = debug.props?.getToken
	if (typeof getToken !== 'function') throw new Error('missing token callback')
	expect(getToken()).toBe('secret-token')
	const mounts = debug.mounts
	act(() => admin('second-admin'))
	rerender(<RootDebug>App</RootDebug>)
	expect(debug.props?.identity).toBe('second-admin:admin')
	expect(debug.mounts).toBe(mounts)
})

it('does not enable admin integration for ordinary users and disables synchronously at logout start', () => {
	act(() =>
		useAuth.getState().set({
			id: 'listener',
			username: 'Listener',
			accessToken: 'token',
			type: 'user',
		}),
	)
	render(<RootDebug>App</RootDebug>)
	expect(debug.props?.isAdmin).toBe(false)
	act(() => window.dispatchEvent(new Event('abs:logout-start')))
	expect(debug.disable).toHaveBeenCalledOnce()
})
