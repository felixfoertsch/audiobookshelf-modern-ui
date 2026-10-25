// Synthetic server only. No ABS connection or production writes.

import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { createDebugServer } from 'debug-overlay/server'
import { z } from 'zod'
import { items, libraries, playable } from './data'
import {
	authSessions,
	browserUser,
	downloadedFeedUsers,
	fixtureApi,
	fixtureFeedEpisode,
	fixturePasswords,
	fixtureUserForToken,
	fixtureUsers,
	loginPayload,
	onFixtureUserUpdated,
} from './fixture-api'
import { readerFixtureResponse } from './reader-preview'
import { realRecords } from './real-media/load'
import { handleSidecarRequest } from './sidecar-mock'

const dist = process.env.FIXTURE_DIST_PATH
	? new URL(`file://${process.env.FIXTURE_DIST_PATH.replace(/\/$/, '')}/`)
	: new URL('../dist/', import.meta.url)
const mediaRoot = new URL('./media/', import.meta.url)
const catalog = items
const downloadQueues = new Map<
	string,
	{ queue: unknown[]; currentDownload: unknown }
>()
const socketPeers = new Map<FixtureSocket, string>()
const socketAuthCounts = new Map<string, number>()
const heldSocketUsers = new Set<string>()
const cookies = new Map<string, (typeof fixtureUsers)[number]>()
const initialized = process.env.FIXTURE_UNINITIALIZED !== '1'
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
	Response.json(data, { status, headers })
const sessions = new Map<
	string,
	{
		userId: string
		itemId: string
		episodeId: string | null
		duration: number
		audioTracks: { index: number; key: string }[]
	}
>()
const observations: {
	sessionId: string
	action: string
	itemId: string
	episodeId: string | null
	currentTime?: number
	timeListened?: number
}[] = []
type FixtureShare = {
	id: string
	slug: string
	mediaItemId: string
	mediaItemType: 'book'
	expiresAt: number | null
	isDownloadable: boolean
	createdAt: number
	updatedAt: number
}
const shares: FixtureShare[] = [
	'public-book',
	'public-book-no-download',
	'expired',
].map((slug) => ({
	id: crypto.randomUUID(),
	slug,
	mediaItemId: 'book-1',
	mediaItemType: 'book',
	expiresAt: slug === 'expired' ? 1 : null,
	isDownloadable: slug === 'public-book',
	createdAt: Date.now(),
	updatedAt: Date.now(),
}))
const shareSessions = new Map<
	string,
	{ shareId: string; currentTime: number }
>()
let nextSession = 0
async function fileResponse(
	request: Request,
	file: ReturnType<typeof Bun.file>,
	mime?: string,
) {
	if (!(await file.exists()))
		return new Response('Unavailable synthetic file', { status: 404 })
	const size = file.size
	const headers = new Headers({
		'accept-ranges': 'bytes',
		'content-type': mime || file.type,
		'content-length': String(size),
	})
	const range = request.headers.get('range')
	if (!range)
		return new Response(request.method === 'HEAD' ? null : file, { headers })
	const match = /^bytes=(\d*)-(\d*)$/.exec(range)
	if (!match || (!match[1] && !match[2]))
		return new Response(null, {
			status: 416,
			headers: { 'content-range': `bytes */${size}` },
		})
	const start = match[1]
		? Number(match[1])
		: Math.max(0, size - Number(match[2]))
	const end =
		match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
	if (start >= size || end < start)
		return new Response(null, {
			status: 416,
			headers: { 'content-range': `bytes */${size}` },
		})
	headers.set('content-range', `bytes ${start}-${end}/${size}`)
	headers.set('content-length', String(end - start + 1))
	return new Response(
		request.method === 'HEAD' ? null : file.slice(start, end + 1),
		{ status: 206, headers },
	)
}
const debugServer = createDebugServer({
	dbPath: ':memory:',
	authorize: async (request) => {
		const token = request.headers.get('authorization')?.replace(/^Bearer /, '')
		const user = fixtureUserForToken(token)
		if (!user || !['admin', 'root'].includes(user.type) || !user.isActive)
			return false
		try {
			return (
				JSON.parse(
					Buffer.from(token?.split('.')[1] ?? '', 'base64url').toString(),
				).type === 'access'
			)
		} catch {
			return false
		}
	},
	routes: async () => [
		'/',
		'/account',
		'/config',
		'/upload',
		'/debug/issues',
		...libraries.flatMap((library) =>
			catalog
				.filter((item) => item.libraryId === library.id)
				.map((item) => `/item/${encodeURIComponent(item.id)}`),
		),
	],
})

async function handleRequest(request: Request) {
	const url = new URL(request.url)
	const path = url.pathname
	if (path.startsWith('/debug-api/')) {
		url.pathname = path.slice('/debug-api'.length) || '/'
		return debugServer.fetch(new Request(url, request))
	}
	if (path.startsWith('/psb/')) {
		url.pathname = path.slice(4)
		return handleSidecarRequest(new Request(url, request))
	}
	if (path === '/health') return new Response('ok')
	if (path === '/__fixture/observations') return json(observations)
	if (
		(path === '/status' && request.method !== 'GET') ||
		(path === '/login' &&
			request.method !== 'POST' &&
			!(
				request.method === 'GET' &&
				request.headers.get('accept')?.includes('text/html')
			))
	)
		return new Response('Method not allowed', {
			status: 405,
			headers: { allow: path === '/status' ? 'GET' : 'POST' },
		})
	if (path === '/status')
		return json({
			isInit: initialized,
			language: 'en-us',
			authFormData: { username: '', password: '' },
			authMethods: ['local'],
			serverVersion: 'synthetic',
		})
	if (path === '/init') return new Response('Not found', { status: 404 })
	if (path === '/login' && request.method === 'POST') {
		if (!initialized) return json({ error: 'Fixture not initialized' }, 403)
		const input = z
			.object({ username: z.string(), password: z.string() })
			.safeParse(await request.json().catch(() => null))
		const user = input.success
			? fixtureUsers.find((user) => user.username === input.data.username)
			: undefined
		if (
			!user ||
			!input.success ||
			fixturePasswords.get(user.id) !== input.data.password
		)
			return json({ error: 'Invalid credentials' }, 401)
		const cookie = crypto.randomUUID()
		cookies.set(cookie, user)
		authSessions.set(cookie, {
			id: cookie,
			userId: user.id,
			cookie,
			createdAt: Date.now(),
		})
		const oldestCookie = cookies.keys().next().value
		if (cookies.size > 100 && oldestCookie) cookies.delete(oldestCookie)
		return json(loginPayload(user), 200, {
			'set-cookie': `fixture_session=${cookie}; Path=/; HttpOnly; SameSite=Lax`,
		})
	}
	const cookie = request.headers
		.get('cookie')
		?.split(';')
		.map((value) => value.trim())
		.find((value) => value.startsWith('fixture_session='))
		?.slice('fixture_session='.length)
	const cookieUser =
		cookie && authSessions.has(cookie) ? cookies.get(cookie) : undefined
	if (path === '/auth/refresh')
		return cookieUser ? json(loginPayload(cookieUser)) : json({}, 401)
	if (path === '/logout' && cookie) {
		if (url.searchParams.get('allDevices') === '1' && cookieUser)
			for (const [id, session] of authSessions) {
				if (session.userId === cookieUser.id) {
					authSessions.delete(id)
					cookies.delete(id)
				}
			}
		cookies.delete(cookie)
		authSessions.delete(cookie)
	}
	if (path === '/logout')
		return json({ redirect_url: null }, 200, {
			'set-cookie':
				'fixture_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
		})
	const token =
		request.headers.get('authorization')?.replace(/^Bearer /, '') ||
		url.searchParams.get('token')
	const user = fixtureUserForToken(token)
	if (path === '/__fixture/socket' && user) {
		if (request.method === 'GET')
			return json({
				authCount: socketAuthCounts.get(user.id) || 0,
				connections: [...socketPeers.values()].filter((id) => id === user.id)
					.length,
			})
		const input = z
			.object({
				action: z.enum(['disconnect', 'reconnect', 'event', 'queue', 'title']),
				event: z.string().optional(),
				payload: z.unknown().optional(),
				title: z.string().optional(),
			})
			.parse(await request.json())
		if (input.action === 'disconnect') {
			heldSocketUsers.add(user.id)
			for (const [socket, id] of socketPeers)
				if (id === user.id) socket.conn.close()
		}
		if (input.action === 'reconnect') heldSocketUsers.delete(user.id)
		if (input.action === 'title' && input.title) {
			const item = catalog.find((item) => item.id === 'podcast-1')
			if (!item) throw new Error('Missing reconnect fixture item')
			item.media.metadata.title = input.title
		}
		if (input.action === 'queue')
			downloadQueues.set(
				user.id,
				z
					.object({ queue: z.array(z.unknown()), currentDownload: z.unknown() })
					.parse(input.payload),
			)
		if (input.event)
			for (const io of socketServers)
				io.to(user.id).emit(input.event, input.payload)
		return json({ ok: true })
	}
	if (path === '/api/libraries/podcasts/episode-downloads' && user)
		return ['admin', 'root'].includes(user.type)
			? json(
					downloadQueues.get(user.id) || { queue: [], currentDownload: null },
				)
			: json({ error: 'Forbidden' }, 403)
	if (
		path === '/api/podcasts/podcast-1/download-episodes' &&
		request.method === 'POST' &&
		user
	) {
		if (!['admin', 'root'].includes(user.type)) return json({}, 403)
		const input = await request.clone().json()
		if (Array.isArray(input) && input[0]?.guid === fixtureFeedEpisode.guid) {
			const download = {
				...fixtureFeedEpisode,
				url: fixtureFeedEpisode.enclosure.url,
				startedAt: Date.now(),
			}
			downloadQueues.set(user.id, { queue: [], currentDownload: download })
			for (const io of socketServers)
				io.to(user.id).emit('episode_download_started', download)
			return new Response('OK')
		}
	}
	if (
		path === '/__fixture/feed-complete' &&
		request.method === 'DELETE' &&
		user
	) {
		downloadedFeedUsers.delete(user.id)
		return json({ ok: true })
	}
	if (
		path === '/__fixture/feed-complete' &&
		request.method === 'POST' &&
		user
	) {
		downloadedFeedUsers.add(user.id)
		downloadQueues.set(user.id, { queue: [], currentDownload: null })
		for (const io of socketServers)
			io.to(user.id).emit('episode_download_finished', {
				...fixtureFeedEpisode,
				failed: false,
			})
		return json({ ok: true })
	}
	const isCover = /^\/api\/items\/[^/]+\/cover$/.test(path)
	if (path.startsWith('/api/') && !user && !(isCover && cookieUser))
		return json({}, 401)
	if (path.startsWith('/api/') && user) {
		const result = await fixtureApi(request, path, url, user)
		if (result) return result
	}
	const shareCreate = path === '/api/share/mediaitem'
	const shareDelete = /^\/api\/share\/mediaitem\/([^/]+)$/.exec(path)
	if (shareCreate || shareDelete) {
		if (!user || !['admin', 'root'].includes(user.type))
			return json({ error: 'Forbidden' }, 403)
		if (shareDelete && request.method === 'DELETE') {
			const index = shares.findIndex((s) => s.id === shareDelete[1])
			if (index < 0) return new Response('Not found', { status: 404 })
			const [removed] = shares.splice(index, 1)
			for (const [id, session] of shareSessions)
				if (session.shareId === removed.id) shareSessions.delete(id)
			return new Response(null, { status: 204 })
		}
		if (!shareCreate || request.method !== 'POST')
			return new Response('Method not allowed', { status: 405 })
		const input = z
			.object({
				slug: z
					.string()
					.trim()
					.regex(/^[a-z0-9-]+$/),
				expiresAt: z.number().nonnegative(),
				mediaItemType: z.literal('book'),
				mediaItemId: z.string(),
				isDownloadable: z.boolean(),
			})
			.strict()
			.safeParse(await request.json().catch(() => null))
		if (!input.success) return json({ error: 'Invalid share' }, 400)
		if (
			!items.some(
				(i) => i.mediaType === 'book' && i.media.id === input.data.mediaItemId,
			)
		)
			return new Response('Media item not found', { status: 404 })
		if (
			shares.some(
				(s) =>
					s.slug === input.data.slug ||
					s.mediaItemId === input.data.mediaItemId,
			)
		)
			return new Response('Item or slug already shared', { status: 409 })
		const share: FixtureShare = {
			...input.data,
			expiresAt: input.data.expiresAt || null,
			id: crypto.randomUUID(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}
		shares.push(share)
		return json(share, 201)
	}
	const publicShare =
		/^\/public\/share\/([^/]+)(?:\/(cover|track\/([^/]+)|progress|download))?$/.exec(
			path,
		)
	if (publicShare) {
		const share = shares.find(
			(s) =>
				s.slug === publicShare[1] && (!s.expiresAt || s.expiresAt > Date.now()),
		)
		if (!share) return new Response('Share not found', { status: 404 })
		const item = items.find(
			(i) => i.mediaType === 'book' && i.media.id === share.mediaItemId,
		)
		if (!item) return new Response('Media not found', { status: 404 })
		const shareCookie = request.headers
			.get('cookie')
			?.split(';')
			.map((s) => s.trim())
			.find((s) => s.startsWith('share_session_id='))
			?.slice('share_session_id='.length)
		let session = shareCookie ? shareSessions.get(shareCookie) : undefined
		const audioTracks =
			'tracks' in item.media
				? item.media.tracks.map((track) => ({
						...track,
						contentUrl: `/public/share/${share.slug}/track/${track.index}`,
					}))
				: []
		const duration = audioTracks.reduce((n, t) => n + t.duration, 0)
		if (!publicShare[2]) {
			if (request.method !== 'GET')
				return new Response('Method not allowed', { status: 405 })
			const id =
				session?.shareId === share.id && shareCookie
					? shareCookie
					: crypto.randomUUID()
			if (session?.shareId !== share.id) {
				session = { shareId: share.id, currentTime: 0 }
				shareSessions.set(id, session)
			}
			return json(
				{
					...share,
					playbackSession: {
						id,
						libraryItemId: item.id,
						mediaType: 'book',
						mediaMetadata: item.media.metadata,
						displayTitle: item.media.metadata.title,
						currentTime: session.currentTime,
						duration,
						audioTracks,
						chapters: 'chapters' in item.media ? item.media.chapters : [],
						playMethod: 0,
						coverPath: item.media.coverPath,
					},
				},
				200,
				{
					'set-cookie': `share_session_id=${id}; Path=/; HttpOnly; SameSite=Lax`,
				},
			)
		}
		if (!session || session.shareId !== share.id)
			return new Response('Share session not found', { status: 404 })
		if (publicShare[2] === 'progress') {
			if (request.method !== 'PATCH')
				return new Response('Method not allowed', { status: 405 })
			const input = z
				.object({ currentTime: z.number().nonnegative() })
				.strict()
				.safeParse(await request.json().catch(() => null))
			if (!input.success)
				return new Response('Invalid current time', { status: 400 })
			session.currentTime = Math.min(input.data.currentTime, duration)
			return new Response(null, { status: 204 })
		}
		if (request.method !== 'GET' && request.method !== 'HEAD')
			return new Response('Method not allowed', { status: 405 })
		if (publicShare[2] === 'cover')
			return fileResponse(
				request,
				Bun.file(new URL(`covers/${item.id}.svg`, mediaRoot)),
			)
		if (publicShare[2] === 'download' && !share.isDownloadable)
			return new Response('Download is not allowed for this item', {
				status: 403,
			})
		if (publicShare[2] === 'download' && audioTracks.length !== 1)
			return new Response('Offline multi-file archive download unsupported', {
				status: 501,
			})
		const track = audioTracks.find(
			(t) => t.index === (publicShare[3] ? Number(publicShare[3]) : 1),
		)
		const key = track?.index === 1 ? item.id : `${item.id}-ep-${track?.index}`
		const audio = track ? playable[key] : undefined
		if (!audio) return new Response('Track not found', { status: 404 })
		let file = Bun.file(new URL(audio.file, mediaRoot))
		if (!(await file.exists()))
			file = Bun.file(new URL(audio.fallbackFile, mediaRoot))
		return fileResponse(request, file, audio.mimeType)
	}
	if (path === '/api/libraries') return json({ libraries })
	if (path === '/api/libraries/forbidden/items') return json({}, 403)
	const library = /^\/api\/libraries\/([^/]+)\/(items|search)$/.exec(path)
	if (library) {
		const results = catalog
			.filter((item) => item.libraryId === library[1])
			.filter(
				(item) =>
					!url.searchParams.get('q') ||
					(item.media.metadata.title || '')
						.toLowerCase()
						.includes((url.searchParams.get('q') || '').toLowerCase()),
			)
		if (library[2] === 'search')
			return json({
				[libraries.find((l) => l.id === library[1])?.mediaType || 'podcast']:
					results.map((libraryItem) => ({ libraryItem })),
			})
		const page = Number(url.searchParams.get('page') || 0)
		return json({
			results: results.slice(page * 48, page * 48 + 48),
			total: results.length,
		})
	}
	const ebook = /^\/api\/items\/([^/]+)\/ebook$/.exec(path)
	if (ebook && request.method !== 'GET')
		return new Response('Method not allowed', { status: 405 })
	if (ebook && request.method === 'GET')
		return (
			(await readerFixtureResponse(ebook[1])) ||
			new Response('Ebook not found', { status: 404 })
		)
	const detail = /^\/api\/items\/([^/]+)$/.exec(path)
	if (detail) {
		const item = catalog.find((item) => item.id === detail[1])
		return item ? json(item) : json({ error: 'Item not found' }, 404)
	}
	const cover = /^\/api\/items\/([^/]+)\/cover$/.exec(path)
	if (cover)
		return fileResponse(
			request,
			Bun.file(
				new URL(
					realRecords.find((record) => record.id === cover[1])?.cover ||
						`covers/${cover[1].startsWith('read-') || cover[1] === 'book-boundaries' ? 'book-1' : cover[1]}.svg`,
					mediaRoot,
				),
			),
		)
	const play = /^\/api\/items\/([^/]+)\/play(?:\/([^/]+))?$/.exec(path)
	if (play) {
		const item = catalog.find((item) => item.id === play[1])
		const episodeId = play[2] ?? null
		const key = episodeId || play[1]
		const audio = playable[key]
		if (!item || !audio)
			return json(
				{
					error:
						'Synthetic metadata only: audio file unavailable. Choose first Field Notes episode or The Glass Orchard.',
				},
				404,
			)
		const syntheticTracks =
			item.id === 'book-boundaries' && 'tracks' in item.media
				? item.media.tracks
				: null
		const bookRecord = realRecords.find(
			(record) => record.id === item.id && record.kind === 'book',
		)
		const duration = syntheticTracks
			? syntheticTracks.reduce((n, track) => n + track.duration, 0)
			: bookRecord
				? bookRecord.tracks.reduce((n, track) => n + track.duration, 0)
				: audio.duration
		const id = `fixture-session-${++nextSession}`
		if (!user) return json({}, 401)
		sessions.set(id, {
			userId: user.id,
			itemId: item.id,
			episodeId,
			duration,
			audioTracks: syntheticTracks
				? syntheticTracks.map((track, index) => ({
						index: track.index,
						key: `boundary-${index + 1}`,
					}))
				: bookRecord
					? bookRecord.tracks.map((track, index) => ({
							index: index + 1,
							key: index === 0 ? item.id : track.id,
						}))
					: [{ index: 1, key }],
		})
		// Fresh session is authoritative, not cached page candidates.
		return json({
			id,
			episodeId,
			libraryItemId: item.id,
			displayTitle:
				'episodes' in item.media
					? item.media.episodes.find((episode) => episode.id === episodeId)
							?.title
					: item.media.metadata.title,
			displayAuthor:
				'author' in item.media.metadata
					? item.media.metadata.author
					: undefined,
			coverPath: item.media.coverPath,
			chapters: 'chapters' in item.media ? item.media.chapters : [],
			currentTime: 0,
			duration,
			audioTracks: syntheticTracks
				? syntheticTracks.map((track, index) => ({
						index: track.index,
						contentUrl: `/public/session/${id}/track/${index + 1}?source=boundary-${index + 1}`,
						mimeType: 'audio/wav',
						duration: track.duration,
						startOffset: track.startOffset,
					}))
				: bookRecord
					? bookRecord.tracks.map((track, index, tracks) => ({
							index: index + 1,
							contentUrl: `/public/session/${id}/track/${index + 1}`,
							mimeType: 'audio/mpeg',
							duration: track.duration,
							startOffset: tracks
								.slice(0, index)
								.reduce((n, t) => n + t.duration, 0),
						}))
					: [
							{
								index: 1,
								contentUrl: `/media/${encodeURIComponent(key)}`,
								mimeType: audio.mimeType,
								duration,
								startOffset: 0,
							},
						],
			libraryItem: item,
			playMethod: 0,
		})
	}
	const sync = /^\/api\/session\/([^/]+)\/(sync|close)$/.exec(path)
	if (sync) {
		const session = sessions.get(sync[1])
		if (!session) return json({}, 404)
		if (session.userId !== user?.id) return json({ error: 'Forbidden' }, 403)
		const data = await request.text()
		let decoded: unknown = {}
		try {
			decoded = data ? JSON.parse(data) : {}
		} catch {
			return json({ error: 'Invalid session sync JSON' }, 400)
		}
		const parsed = z
			.object({
				currentTime: z.number().nonnegative().optional(),
				timeListened: z.number().nonnegative().optional(),
			})
			.safeParse(decoded)
		if (!parsed.success) return json({ error: 'Invalid session sync' }, 400)
		const payload = parsed.data
		if (observations.length >= 500) observations.shift()
		observations.push({
			sessionId: sync[1],
			action: sync[2],
			...session,
			...payload,
		})
		if (sync[2] === 'close') sessions.delete(sync[1])
		return new Response('OK')
	}
	const sessionTrack = /^\/public\/session\/([^/]+)\/track\/([^/]+)$/.exec(path)
	if (sessionTrack) {
		if (!['GET', 'HEAD'].includes(request.method))
			return new Response('Method not allowed', {
				status: 405,
				headers: { allow: 'GET, HEAD' },
			})
		if (
			!/^\d+$/.test(sessionTrack[2]) ||
			!Number.isSafeInteger(Number(sessionTrack[2]))
		)
			return new Response('Invalid track index', { status: 400 })
		const session = sessions.get(sessionTrack[1])
		const index = Number(sessionTrack[2])
		const track =
			session?.audioTracks.find((track) => track.index === index) ??
			(session?.episodeId && index === 0 ? session.audioTracks[0] : undefined)
		const audio = track && playable[track.key]
		if (!audio) return new Response('Missing', { status: 404 })
		let file = Bun.file(new URL(audio.file, mediaRoot))
		if (
			!(await file.exists()) &&
			'fallbackFile' in audio &&
			typeof audio.fallbackFile === 'string'
		)
			file = Bun.file(new URL(audio.fallbackFile, mediaRoot))
		return fileResponse(request, file, audio.mimeType)
	}
	const media = /^\/media\/([^/]+)$/.exec(path)
	if (media) {
		const audio = playable[decodeURIComponent(media[1])]
		if (!audio) return new Response('Missing', { status: 404 })
		let file = Bun.file(new URL(audio.file, mediaRoot))
		if (
			!(await file.exists()) &&
			'fallbackFile' in audio &&
			typeof audio.fallbackFile === 'string'
		)
			file = Bun.file(new URL(audio.fallbackFile, mediaRoot))
		return fileResponse(request, file, audio.mimeType)
	}
	if (path === '/manifest.webmanifest' || path.startsWith('/icons/')) {
		if (request.method !== 'GET' && request.method !== 'HEAD')
			return new Response('Method not allowed', { status: 405 })
		const asset =
			path === '/manifest.webmanifest' ? 'manifest.webmanifest' : path.slice(1)
		return fileResponse(request, Bun.file(new URL(asset, dist)))
	}
	if (path.startsWith('/assets/'))
		return fileResponse(
			request,
			Bun.file(new URL(`assets/${path.slice('/assets/'.length)}`, dist)),
		)
	if (path.startsWith('/e2e/media/')) {
		const relative = path.slice('/e2e/media/'.length)
		if (relative.split('/').some((part) => part === '..' || part === ''))
			return new Response('Invalid fixture asset path', { status: 400 })
		return fileResponse(request, Bun.file(new URL(relative, mediaRoot)))
	}
	if (
		request.method === 'GET' &&
		request.headers.get('accept')?.includes('text/html')
	) {
		let html = await Bun.file(new URL('index.html', dist)).text()
		html = html.replace(
			'<head>',
			`<head><script>window.__ABS_WEB_CONFIG__=${JSON.stringify({ basePath: '', apiBasePath: '' })}</script>`,
		)
		return new Response(html, {
			headers: { 'content-type': 'text/html', 'cache-control': 'no-store' },
		})
	}
	return new Response('Not found', { status: 404 })
}

const server = createServer(async (incoming, outgoing) => {
	try {
		const method = incoming.method || 'GET'
		const headers = new Headers()
		for (const [name, value] of Object.entries(incoming.headers)) {
			if (Array.isArray(value))
				for (const entry of value) headers.append(name, entry)
			else if (value !== undefined) headers.set(name, value)
		}
		const request = new Request(
			`http://127.0.0.1:${process.env.FIXTURE_PORT || 4179}${incoming.url || '/'}`,
			{
				method,
				headers,
				...(method === 'GET' || method === 'HEAD'
					? {}
					: {
							body: new ReadableStream<Uint8Array>({
								async start(controller) {
									try {
										let size = 0
										for await (const chunk of incoming) {
											size += chunk.length
											if (size > 51_000_000)
												throw new Error('Request body too large')
											controller.enqueue(chunk)
										}
										controller.close()
									} catch (error) {
										controller.error(error)
									}
								},
							}),
						}),
			},
		)
		const response = await handleRequest(request)
		outgoing.writeHead(response.status, {
			...Object.fromEntries(response.headers),
			...(response.headers.getSetCookie().length
				? { 'set-cookie': response.headers.getSetCookie() }
				: {}),
		})
		if (!response.body || method === 'HEAD') outgoing.end()
		else {
			const reader = response.body.getReader()
			try {
				while (true) {
					const chunk = await reader.read()
					if (chunk.done) break
					if (!outgoing.write(chunk.value)) await once(outgoing, 'drain')
				}
				outgoing.end()
			} finally {
				await reader.cancel()
			}
		}
	} catch (error) {
		if (!outgoing.headersSent) {
			outgoing.writeHead(500, { 'content-type': 'text/plain' })
			outgoing.end('Local fixture request failed')
		} else outgoing.destroy(error instanceof Error ? error : undefined)
	}
})
// Optional local comparison adapter; portable web-only CI has no backend packages.
// Narrow structural contract describes only installed Socket.IO consumer surface.
interface FixtureSocket {
	conn: { close(): void }
	on(event: 'disconnect', listener: () => void): void
	on(event: 'auth', listener: (token: unknown) => void): void
	join(room: string): void
	leave(room: string): void
	emit(event: string, payload: unknown): void
}
interface FixtureSocketServer {
	on(event: 'connection', listener: (socket: FixtureSocket) => void): void
	to(room: string): { emit(event: string, payload: unknown): void }
	disconnectSockets(close: boolean): void
}
type SocketConstructor = new (
	server: ReturnType<typeof createServer>,
	options: {
		path: string
		serveClient: boolean
		transports: string[]
		destroyUpgrade: boolean
	},
) => FixtureSocketServer
let SocketServer: SocketConstructor | undefined
if (process.env.FIXTURE_SOCKET === '1') {
	const require = createRequire(import.meta.url)
	let packageExports: unknown
	try {
		packageExports = require('socket.io')
	} catch {
		throw new Error('FIXTURE_SOCKET=1 requires the socket.io dependency.')
	}
	const exportsSchema = z.object({
		Server: z.custom<SocketConstructor>((value) => typeof value === 'function'),
	})
	SocketServer = exportsSchema.parse(
		typeof packageExports === 'function'
			? { Server: Reflect.get(packageExports, 'Server') }
			: packageExports,
	).Server
}
const socketServers = (SocketServer ? ['/socket.io'] : []).map((path) => {
	if (!SocketServer) throw new Error('Socket.IO comparison constructor missing')
	const io = new SocketServer(server, {
		path,
		serveClient: false,
		transports: ['websocket'],
		destroyUpgrade: false,
	})
	io.on('connection', (socket) => {
		let authenticatedUserId: string | undefined
		socket.on('disconnect', () => socketPeers.delete(socket))
		socket.on('auth', (token: unknown) => {
			if (authenticatedUserId) socket.leave(authenticatedUserId)
			authenticatedUserId = undefined
			const user = fixtureUserForToken(token)
			if (!user) {
				socket.leave('authenticated')
				socket.emit('auth_failed', { message: 'Invalid token' })
				return
			}
			if (heldSocketUsers.has(user.id)) {
				socket.conn.close()
				return
			}
			socketPeers.set(socket, user.id)
			socketAuthCounts.set(user.id, (socketAuthCounts.get(user.id) || 0) + 1)
			socket.join('authenticated')
			socket.join(user.id)
			authenticatedUserId = user.id
			socket.emit('init', {
				userId: user.id,
				username: user.username,
				...(user.type !== 'user'
					? {
							usersOnline: [
								{
									id: user.id,
									username: user.username,
									type: user.type,
									connections: 1,
								},
							],
						}
					: {}),
			})
		})
	})
	return io
})
onFixtureUserUpdated((user) => {
	for (const io of socketServers)
		io.to(user.id).emit('user_updated', browserUser(user))
})
server.listen(
	Number(process.env.FIXTURE_PORT || 4179),
	process.env.FIXTURE_HOST || '127.0.0.1',
)
function shutdown() {
	debugServer.close()
	for (const io of socketServers) io.disconnectSockets(true)
	server.close(() => {
		process.exit(0)
	})
	server.closeAllConnections()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
