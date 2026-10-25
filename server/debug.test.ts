import { afterEach, expect, it, mock } from 'bun:test'
import { createDebugServer } from 'debug-overlay/server'
import { isAdmin } from './auth'
import { libraryRoutes } from './routes'

const token = (type = 'access') =>
	`header.${Buffer.from(JSON.stringify({ type })).toString('base64url')}.signature`
const oldFetch = globalThis.fetch
afterEach(() => {
	globalThis.fetch = oldFetch
})
const request = (auth: string, origin = 'https://podcast.foertsch.family') =>
	new Request('http://podcast-sponsorblock:3001/notes/item/id', {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${auth}`,
			Origin: origin,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ note: 'investigate' }),
	})

it('persists admin note through createDebugServer with external Origin', async () => {
	const oldFetch = globalThis.fetch
	globalThis.fetch = mock(async () =>
		Response.json({ type: 'admin', isActive: true }),
	) as unknown as typeof fetch
	const app = createDebugServer({ dbPath: ':memory:', authorize: isAdmin })
	try {
		const response = await app.fetch(request(token()))
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true })
		const readback = await app.request(
			'http://podcast-sponsorblock:3001/notes/item/id',
			{ headers: { Authorization: `Bearer ${token()}` } },
		)
		expect(await readback.json()).toMatchObject({
			routePath: '/item/id',
			note: 'investigate',
		})
	} finally {
		app.close()
		globalThis.fetch = oldFetch
	}
})

it('rejects user, inactive, malformed and API-key credentials; fails closed when ABS unavailable', async () => {
	const oldFetch = globalThis.fetch
	const app = createDebugServer({ dbPath: ':memory:', authorize: isAdmin })
	try {
		for (const [auth, body] of [
			[token(), { type: 'user', isActive: true }],
			[token(), { type: 'admin', isActive: false }],
			['bad-token', { type: 'admin', isActive: true }],
			[token('apiKey'), { type: 'admin', isActive: true }],
		] as const) {
			globalThis.fetch = mock(async () =>
				Response.json(body),
			) as unknown as typeof fetch
			const response = await app.fetch(request(auth))
			expect(response.status).toBe(401)
		}
		globalThis.fetch = mock(
			async () => new Response('', { status: 503 }),
		) as unknown as typeof fetch
		expect((await app.fetch(request(token()))).status).toBe(401)
		globalThis.fetch = mock(async () => {
			throw new Error('offline')
		}) as unknown as typeof fetch
		expect((await app.fetch(request(token()))).status).toBe(401)
	} finally {
		app.close()
		globalThis.fetch = oldFetch
	}
})

it('allows root and admin, with external Origin independent of internal host', async () => {
	const oldFetch = globalThis.fetch
	for (const type of ['root', 'admin']) {
		globalThis.fetch = mock(async () =>
			Response.json({ type, isActive: true }),
		) as unknown as typeof fetch
		expect(await isAdmin(request(token()))).toBe(true)
	}
	globalThis.fetch = mock(async () =>
		Response.json({ type: 'admin', isActive: true }),
	) as unknown as typeof fetch
	expect(await isAdmin(request(token(), 'https://untrusted.example'))).toBe(
		true,
	)
	globalThis.fetch = oldFetch
})

it('inventories static routes and paginates library items without item endpoint calls', async () => {
	const oldFetch = globalThis.fetch
	const calls: string[] = []
	globalThis.fetch = mock(async (input) => {
		const url = new URL(String(input))
		calls.push(url.pathname)
		if (url.pathname === '/api/libraries')
			return Response.json({
				libraries: [{ id: 'lib', name: 'Library', mediaType: 'book' }],
			})
		if (url.pathname === '/api/libraries/lib/items') {
			const page = Number(url.searchParams.get('page'))
			return Response.json({
				results:
					page === 0
						? Array.from({ length: 100 }, (_, i) => ({ id: `id${i}` }))
						: [{ id: 'last' }],
				total: 101,
			})
		}
		throw new Error(`unexpected request ${url.pathname}`)
	}) as unknown as typeof fetch
	try {
		const paths = await libraryRoutes('token')
		expect(paths.slice(0, 5)).toEqual([
			'/',
			'/account',
			'/config',
			'/upload',
			'/debug/issues',
		])
		expect(paths).toContain('/library/lib')
		expect(paths).toContain('/item/last')
		expect(calls).toEqual([
			'/api/libraries',
			'/api/libraries/lib/items',
			'/api/libraries/lib/items',
		])
		expect(calls.some((path) => path === '/api/items/id0')).toBe(false)
	} finally {
		globalThis.fetch = oldFetch
	}
})
