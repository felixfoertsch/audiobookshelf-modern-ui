// Offline development adapter. Unsupported native APIs return 404, never pretend success.
import { z } from 'zod'
import { items, libraries, realItems } from './data'
import { realRecords } from './real-media/load'

const json = (data: unknown, status = 200) => Response.json(data, { status })
const ok = () => new Response('OK')
let emitUserUpdated: (user: FixtureUser) => void = () => {}
export function onFixtureUserUpdated(listener: (user: FixtureUser) => void) {
	emitUserUpdated = listener
}
export const fixtureFeedEpisode = {
	id: 'feed-only-episode',
	libraryItemId: 'podcast-1',
	title: 'Feed-only fixture episode',
	guid: 'fixture-feed-guid',
	enclosure: { url: 'https://example.test/feed-only.mp3', type: 'audio/mpeg' },
	publishedAt: 1893456000000,
	duration: 2100,
	downloaded: false,
}
export const downloadedFeedUsers = new Set<string>()
const now = Date.now()
const progress = new Map<string, Record<string, unknown>>()
const bookmarks: {
	userId: string
	libraryItemId: string
	time: number
	title: string
	createdAt: number
}[] = []
const fixtureAccessTokens = Object.fromEntries(
	['listener', 'admin', 'root', 'guest'].map((username) => [
		username,
		`fixture-${username === 'listener' ? '' : `${username}-`}access`,
	]),
)
const fixtureToken = (username: string) =>
	`fixture.${Buffer.from(
		JSON.stringify({ type: 'access', sub: `fixture-${username}` }),
	).toString('base64url')}.signature`

export const fixtureUsers = ['listener', 'admin', 'root', 'guest'].map(
	(username) => ({
		id: `fixture-${username}`,
		username,
		type: username === 'listener' ? 'user' : username,
		accessToken: fixtureToken(username),
		token: fixtureToken(username),
		email: null,
		isActive: true,
		isLocked: false,
		createdAt: now,
		lastSeen: now,
		settings: {
			orderBy: 'media.metadata.title',
			orderDesc: false,
			filterBy: 'all',
			playbackRate: 1,
			bookshelfCoverSize: 120,
			jumpForwardAmount: 10,
			jumpBackwardAmount: 10,
		},
		permissions: {
			download: true,
			update: username === 'admin' || username === 'root',
			delete: username === 'admin' || username === 'root',
			upload: username === 'admin' || username === 'root',
			accessAllLibraries: true,
			accessAllTags: true,
			accessExplicitContent: true,
		},
		librariesAccessible: [],
		itemTagsSelected: [],
		seriesHideFromContinueListening: [] as string[],
		hasOpenIDLink: false,
	}),
)
export function fixtureUserForToken(token: unknown) {
	return fixtureUsers.find(
		(user) =>
			user.accessToken === token ||
			fixtureAccessTokens[user.username] === token,
	)
}
export const fixturePasswords = new Map(
	fixtureUsers.map((user) => [user.id, 'password']),
)
const ereaderDevices = new Map<
	string,
	{
		name: string
		email: string
		availabilityOption: 'specificUsers'
		users: string[]
	}[]
>()
export const authSessions = new Map<
	string,
	{ id: string; userId: string; cookie: string; createdAt: number }
>()
export type FixtureUser = (typeof fixtureUsers)[number]
export const browserUser = (user: FixtureUser) => ({
	...user,
	mediaProgress: [...progress.values()].filter((p) => p.userId === user.id),
	bookmarks: bookmarks
		.filter((b) => b.userId === user.id)
		.map(({ userId: _userId, ...bookmark }) => bookmark),
})
export const loginPayload = (user: FixtureUser) => ({
	user: browserUser(user),
	userDefaultLibraryId: 'podcasts',
	serverSettings: {
		language: 'en-us',
		chromecastEnabled: false,
		sortingIgnorePrefix: true,
		version: '2.29.0',
		storeCoverWithItem: false,
		storeMetadataWithItem: false,
		sortingPrefixes: ['the', 'a'],
		scannerParseSubtitle: false,
		scannerFindCovers: true,
		scannerCoverProvider: 'openlibrary',
		scannerPreferMatchedMetadata: false,
		scannerDisableWatcher: false,
		allowIframe: false,
		homeBookshelfView: 0,
		bookshelfView: 0,
		dateFormat: 'yyyy-MM-dd',
		timeFormat: 'HH:mm',
		allowedOrigins: [],
	},
	ereaderDevices: ereaderDevices.get(user.id) || [],
	Source: 'local-fixture',
})
const list = (results: unknown[], url: URL) => ({
	results,
	total: results.length,
	limit: Number(url.searchParams.get('limit') || 0),
	page: Number(url.searchParams.get('page') || 0),
	sortBy: url.searchParams.get('sort') || undefined,
	sortDesc: url.searchParams.get('desc') === '1',
	filterBy: url.searchParams.get('filter') || undefined,
	minified: url.searchParams.get('minified') === '1',
	include: url.searchParams.get('include') || '',
})
const books = items.filter((i) => i.mediaType === 'book')
const authors = [
	...new Map(
		books.flatMap((i) =>
			'authors' in i.media.metadata
				? i.media.metadata.authors.map((a) => [
						a.id,
						{
							...a,
							description: '',
							imagePath: null,
							addedAt: now,
							updatedAt: now,
							numBooks: books.filter(
								(b) =>
									'authors' in b.media.metadata &&
									b.media.metadata.authors.some((v) => v.id === a.id),
							).length,
						},
					])
				: [],
		),
	).values(),
]
type Collection = {
	id: string
	libraryId: string
	name: string
	description: string | null
	books: typeof items
	createdAt: number
	lastUpdate: number
}
type PlaylistItem = {
	libraryItemId: string
	libraryItem: (typeof items)[number]
	episodeId?: string
	episode?: unknown
}
type Playlist = {
	id: string
	libraryId: string
	userId: string
	name: string
	description: string | null
	items: PlaylistItem[]
	createdAt: number
	lastUpdate: number
}
const collections: Collection[] = [
	{
		id: 'collection-1',
		libraryId: 'books',
		name: 'Weekend Reading',
		description: 'Local preview collection',
		books: books.slice(0, 2),
		createdAt: now,
		lastUpdate: now,
	},
]
const playlists: Playlist[] = [
	{
		id: 'playlist-1',
		libraryId: 'books',
		userId: 'fixture-listener',
		name: 'Evening Queue',
		description: 'Local preview playlist',
		items: books
			.slice(0, 2)
			.map((libraryItem) => ({ libraryItemId: libraryItem.id, libraryItem })),
		createdAt: now,
		lastUpdate: now,
	},
]
const stringArray = z.array(z.string())
const named = z.object({
	name: z.string().trim().min(1),
	description: z.string().nullable().optional(),
	libraryId: z.string(),
})
const playlistInput = z.object({
	libraryItemId: z.string(),
	episodeId: z.string().optional(),
})
function expandPlaylist(
	input: z.infer<typeof playlistInput>,
): PlaylistItem | undefined {
	const libraryItem = items.find((i) => i.id === input.libraryItemId)
	if (!libraryItem) return
	const episode =
		'episodes' in libraryItem.media
			? libraryItem.media.episodes.find((e) => e.id === input.episodeId)
			: undefined
	if (libraryItem.mediaType === 'podcast' && !episode) return
	return { ...input, libraryItem, ...(episode ? { episode } : {}) }
}
export async function fixtureApi(
	request: Request,
	path: string,
	url: URL,
	user: FixtureUser,
): Promise<Response | undefined> {
	const method = request.method
	const admin = user.type === 'admin' || user.type === 'root'
	const body = async () => {
		try {
			return await request.json()
		} catch {
			return null
		}
	}
	if (path === '/api/authorize' && method === 'POST')
		return json(loginPayload(user))
	if (path === '/api/search/providers' && method === 'GET')
		return json({
			providers: {
				booksCovers: [{ text: 'Open Library', value: 'openlibrary' }],
			},
		})
	if (path === '/api/me') return json(browserUser(user))
	if (path === '/api/me/password') {
		if (method !== 'PATCH')
			return new Response('Method not allowed', { status: 405 })
		if (user.type === 'guest') return json({ error: 'Forbidden' }, 403)
		const input = z
			.object({
				password: z.string(),
				newPassword: user.type === 'root' ? z.string() : z.string().min(1),
			})
			.strict()
			.safeParse(await body())
		if (!input.success || fixturePasswords.get(user.id) !== input.data.password)
			return json({ error: 'Invalid current or new password' }, 400)
		fixturePasswords.set(user.id, input.data.newPassword)
		for (const [id, session] of authSessions)
			if (session.userId === user.id) authSessions.delete(id)
		return ok()
	}
	if (path === '/api/me/ereader-devices') {
		if (method !== 'POST')
			return new Response('Method not allowed', { status: 405 })
		if (user.type === 'guest') return json({ error: 'Forbidden' }, 403)
		const input = z
			.object({
				ereaderDevices: z
					.array(
						z.object({
							name: z.string().min(1),
							email: z.string().email(),
							availabilityOption: z.literal('specificUsers'),
							users: z.array(z.literal(user.id)).length(1),
						}),
					)
					.max(20),
			})
			.strict()
			.safeParse(await body())
		if (
			!input.success ||
			new Set(input.data.ereaderDevices.map((d) => d.name)).size !==
				input.data.ereaderDevices.length
		)
			return json({ error: 'Invalid ereaderDevices' }, 400)
		ereaderDevices.set(user.id, input.data.ereaderDevices)
		return json(input.data)
	}
	if (path === '/api/me/sessions' && method !== 'GET')
		return new Response('Method not allowed', { status: 405 })
	if (path === '/api/me/sessions' && method === 'GET') {
		const pagination = z
			.object({
				page: z.coerce.number().int().nonnegative(),
				itemsPerPage: z.coerce.number().int().min(1).max(100),
			})
			.safeParse({
				page: url.searchParams.get('page') || 0,
				itemsPerPage: url.searchParams.get('itemsPerPage') || 10,
			})
		if (!pagination.success) return json({ error: 'Invalid pagination' }, 400)
		const { page, itemsPerPage } = pagination.data
		const sessions =
			user.type === 'guest'
				? []
				: [...authSessions.values()]
						.filter((s) => s.userId === user.id)
						.map((s) => ({
							id: s.id,
							ipAddress: '127.0.0.1',
							userAgent: 'Local fixture',
							deviceInfo: null,
							createdAt: s.createdAt,
							updatedAt: null,
							current:
								request.headers
									.get('cookie')
									?.includes(`fixture_session=${s.cookie}`) || false,
						}))
		return json({
			sessions: sessions.slice(page * itemsPerPage, (page + 1) * itemsPerPage),
			total: sessions.length,
			numPages: Math.ceil(sessions.length / itemsPerPage),
			page,
			itemsPerPage,
		})
	}
	const authSession = /^\/api\/me\/sessions\/([^/]+)$/.exec(path)
	if (authSession && method !== 'DELETE')
		return new Response('Method not allowed', { status: 405 })
	if (authSession && method === 'DELETE') {
		if (user.type === 'guest') return json({ error: 'Forbidden' }, 403)
		if (!z.uuid().safeParse(authSession[1]).success)
			return json({ error: 'Invalid session ID' }, 400)
		if (authSessions.get(authSession[1])?.userId !== user.id)
			return json({ error: 'Session not found' }, 404)
		authSessions.delete(authSession[1])
		return ok()
	}
	if (path === '/api/items/batch/get') {
		if (method !== 'POST')
			return new Response('Method not allowed', { status: 405 })
		const input = z
			.object({ libraryItemIds: z.array(z.string()).min(1).max(50) })
			.strict()
			.safeParse(await body())
		if (!input.success) return json({ error: 'Invalid payload' }, 403)
		const selected = items.filter((item) =>
			input.data.libraryItemIds.includes(item.id),
		)
		if (selected.length !== new Set(input.data.libraryItemIds).size)
			return json({ error: 'Item not found' }, 404)
		return json({ libraryItems: selected })
	}
	if (path === '/api/items/batch/update') {
		if (method !== 'POST')
			return new Response('Method not allowed', { status: 405 })
		if (!admin) return json({ error: 'Forbidden' }, 403)
		const input = z
			.array(
				z
					.object({
						id: z.string(),
						mediaPayload: z
							.object({
								metadata: z.record(z.string(), z.unknown()).optional(),
								tags: z.array(z.string()).optional(),
							})
							.strict(),
					})
					.strict(),
			)
			.min(1)
			.max(50)
			.safeParse(await body())
		if (
			!input.success ||
			new Set(input.data.map((p) => p.id)).size !== input.data.length
		)
			return json({ error: 'Invalid updates' }, 400)
		if (input.data.some((p) => !items.some((item) => item.id === p.id)))
			return json({ error: 'Item not found' }, 404)
		for (const update of input.data) {
			const item = items.find((i) => i.id === update.id)
			if (!item) throw new Error('Validated item missing')
			if (update.mediaPayload.metadata)
				Object.assign(item.media.metadata, update.mediaPayload.metadata)
			if (update.mediaPayload.tags) item.media.tags = update.mediaPayload.tags
		}
		return json({ success: true, updates: input.data.length })
	}
	if (path === '/api/filesystem/pathexists') {
		if (method !== 'POST')
			return new Response('Method not allowed', { status: 405 })
		if (!admin) return json({ error: 'Forbidden' }, 403)
		const input = z
			.object({ directory: z.string().min(1), folderPath: z.string().min(1) })
			.strict()
			.safeParse(await body())
		if (!input.success || input.data.directory.includes('..'))
			return json({ error: 'Invalid request body' }, 400)
		const folder = libraries
			.flatMap((l) => l.folders)
			.find((f) => f.path === input.data.folderPath)
		if (!folder) return json({ error: 'Folder not found' }, 404)
		return json({
			exists: items.some(
				(i) => i.path === `${folder.path}/${input.data.directory}`,
			),
		})
	}
	if (path === '/api/upload') {
		if (method !== 'POST')
			return new Response('Method not allowed', { status: 405 })
		if (!admin) return json({ error: 'Forbidden' }, 403)
		let form: FormData
		try {
			form = await request.formData()
		} catch {
			return json({ error: 'Invalid multipart body' }, 400)
		}
		const input = z
			.object({
				title: z.string().trim().min(1),
				library: z.string(),
				folder: z.string(),
				author: z.string().optional(),
				series: z.string().optional(),
			})
			.safeParse(
				Object.fromEntries(
					[...form.entries()].filter(([, value]) => typeof value === 'string'),
				),
			)
		const files: File[] = []
		form.forEach((value) => {
			if (typeof value !== 'string') files.push(value)
		})
		if (
			!input.success ||
			!files.length ||
			files.length > 5 ||
			files.some((f) => f.size > 10_000_000 || !f.name.endsWith('.txt'))
		)
			return json(
				{ error: 'Offline upload accepts bounded test .txt files only' },
				400,
			)
		const library = libraries.find((l) => l.id === input.data.library)
		const folder = library?.folders.find((f) => f.id === input.data.folder)
		if (!library || !folder)
			return json({ error: 'Library or folder not found' }, 404)
		const base = books[0]
		const uploaded = structuredClone(base)
		uploaded.id = `upload-${crypto.randomUUID()}`
		uploaded.libraryId = library.id
		uploaded.path = `${folder.path}/${input.data.title}`
		Object.assign(uploaded.media.metadata, {
			title: input.data.title,
			authorName: input.data.author || '',
			description: 'Explicit local fixture upload; no disk write.',
		})
		items.push(uploaded)
		return ok()
	}
	if (path === '/api/tasks')
		return json({
			tasks: [],
			...(url.searchParams.get('include')?.includes('queue')
				? { queuedTaskData: { embedMetadata: [] } }
				: {}),
		})
	const library =
		/^\/api\/libraries\/([^/]+)(?:\/(personalized|filterdata|authors|narrators|series|collections|playlists|downloadqueue))?$/.exec(
			path,
		)
	if (library) {
		const lib = libraries.find((l) => l.id === library[1])
		if (!lib) return json({ error: 'Library not found' }, 404)
		const subset = items.filter((i) => i.libraryId === lib.id)
		if (!library[2])
			return json(
				url.searchParams.get('include')?.split(',').includes('filterdata')
					? {
							library: lib,
							filterdata: {
								authors: lib.mediaType === 'book' ? authors : [],
								genres: ['Fiction', 'Science', 'Philosophy'],
								tags: ['synthetic', 'fixture', 'local-real-media'],
								series: [],
								narrators: ['Elian Brooks', 'Ramona Deininger-Schnabel'],
								publishers: ['Synthetic Press', 'LibriVox'],
								publishedDecades: ['2020'],
								languages: ['en', 'de'],
								numIssues: 0,
								loadedAt: now,
							},
							issues: 0,
							numUserPlaylists: playlists.filter(
								(p) => p.libraryId === lib.id && p.userId === user.id,
							).length,
						}
					: lib,
			)
		if (library[2] === 'personalized') {
			const inProgress = subset.filter((item) => {
				const record = progress.get(`${user.id}:${item.id}:`)
				return (
					record &&
					record.isFinished !== true &&
					typeof record.currentTime === 'number' &&
					record.currentTime > 0 &&
					!record.hideFromContinueListening
				)
			})
			const shelves = [
				{
					id: 'recently-added',
					label: 'Recently Added',
					labelStringKey: 'LabelRecentlyAdded',
					type: lib.mediaType,
					entities: subset,
					total: subset.length,
				},
			]
			if (lib.mediaType === 'podcast') {
				const newest = subset
					.flatMap((item) =>
						('episodes' in item.media ? item.media.episodes : []).map(
							(episode) => ({
								...item,
								_type: 'episode',
								recentEpisode: episode,
							}),
						),
					)
					.sort(
						(a, b) =>
							(b.recentEpisode.publishedAt || 0) -
							(a.recentEpisode.publishedAt || 0),
					)
				shelves.push({
					id: 'newest-episodes',
					label: 'Newest Episodes',
					labelStringKey: 'LabelNewestEpisodes',
					type: 'episode',
					entities: newest.slice(0, 8),
					total: newest.length,
				})
			}
			if (inProgress.length)
				shelves.unshift({
					id: 'continue-listening',
					label: 'Continue Listening',
					labelStringKey: 'LabelContinueListening',
					type: 'book',
					entities: inProgress.map((item) => ({
						...item,
						userMediaProgress: progress.get(`${user.id}:${item.id}:`),
					})),
					total: inProgress.length,
				})
			if (lib.mediaType === 'book') {
				const continued = subset
					.filter((candidate) => {
						if (!('series' in candidate.media.metadata)) return false
						return candidate.media.metadata.series.some(
							(series) =>
								!user.seriesHideFromContinueListening.includes(series.id) &&
								subset.some(
									(previous) =>
										previous.id !== candidate.id &&
										progress.get(`${user.id}:${previous.id}:`)?.isFinished ===
											true &&
										'series' in previous.media.metadata &&
										previous.media.metadata.series.some(
											(entry) =>
												entry.id === series.id &&
												Number(entry.sequence) < Number(series.sequence),
										),
								),
						)
					})
					.slice(0, 1)
				if (continued.length)
					shelves.push({
						id: 'continue-series',
						label: 'Continue Series',
						labelStringKey: 'LabelContinueSeries',
						type: 'book',
						entities: continued,
						total: continued.length,
					})
			}
			return json(shelves)
		}
		if (library[2] === 'filterdata')
			return json({
				authors: lib.mediaType === 'book' ? authors : [],
				genres: ['Fiction', 'Science', 'Philosophy'],
				tags: ['synthetic', 'fixture', 'local-real-media'],
				series: [],
				narrators: ['Elian Brooks', 'Ramona Deininger-Schnabel'],
				languages: ['en', 'de'],
				publishers: ['Synthetic Press', 'LibriVox'],
			})
		if (library[2] === 'authors')
			return json(
				url.searchParams.has('limit') ? list(authors, url) : { authors },
			)
		if (library[2] === 'narrators')
			return json({
				narrators: ['Elian Brooks', 'Ramona Deininger-Schnabel'].map(
					(name) => ({
						id: encodeURIComponent(Buffer.from(name).toString('base64')),
						name,
						numBooks: books.filter(
							(b) =>
								'narrators' in b.media.metadata &&
								b.media.metadata.narrators.includes(name),
						).length,
					}),
				),
			})
		if (library[2] === 'series')
			return json(
				list(
					[
						...new Map(
							books.flatMap((b) =>
								'series' in b.media.metadata
									? b.media.metadata.series.map((s) => [
											s.id,
											{
												...s,
												libraryId: lib.id,
												books: books.filter(
													(book) =>
														'series' in book.media.metadata &&
														book.media.metadata.series.some(
															(v) => v.id === s.id,
														),
												),
											},
										])
									: [],
							),
						).values(),
					],
					url,
				),
			)
		if (library[2] === 'collections')
			return json(
				list(
					collections.filter((c) => c.libraryId === lib.id),
					url,
				),
			)
		if (library[2] === 'playlists')
			return json(
				list(
					playlists.filter(
						(p) => p.libraryId === lib.id && p.userId === user.id,
					),
					url,
				),
			)
		if (library[2] === 'downloadqueue')
			return json({ currentDownload: null, queue: [] })
	}
	const author = /^\/api\/authors\/([^/]+)$/.exec(path)
	if (author) {
		const value = authors.find((a) => a.id === author[1])
		return value
			? json({
					...value,
					libraryItems: books.filter(
						(b) =>
							'authors' in b.media.metadata &&
							b.media.metadata.authors.some((a) => a.id === value.id),
					),
				})
			: json({ error: 'Author not found' }, 404)
	}
	if (path === '/api/me/progress')
		return json({
			mediaProgress: [...progress.values()].filter((p) => p.userId === user.id),
		})
	const seriesDetail = /^\/api\/libraries\/([^/]+)\/series\/([^/]+)$/.exec(path)
	if (seriesDetail && method === 'GET') {
		const match = books
			.flatMap((item) =>
				'series' in item.media.metadata ? item.media.metadata.series : [],
			)
			.find((series) => series.id === decodeURIComponent(seriesDetail[2]))
		if (!match) return json({ error: 'Series not found' }, 404)
		return json({ id: match.id, name: match.name })
	}
	const seriesContinue =
		/^\/api\/me\/series\/([^/]+)\/(remove-from|readd-to)-continue-listening$/.exec(
			path,
		)
	if (seriesContinue && method === 'GET') {
		const id = decodeURIComponent(seriesContinue[1])
		const hidden = new Set(user.seriesHideFromContinueListening)
		if (seriesContinue[2] === 'remove-from') hidden.add(id)
		else hidden.delete(id)
		user.seriesHideFromContinueListening = [...hidden]
		emitUserUpdated(user)
		return json(browserUser(user))
	}
	const mp = /^\/api\/me\/progress\/([^/]+)(?:\/([^/]+))?$/.exec(path)
	if (mp) {
		if (method === 'DELETE') {
			const entry = [...progress.entries()].find(
				([, value]) =>
					value.id === decodeURIComponent(mp[1]) && value.userId === user.id,
			)
			if (!entry) return json({ error: 'Progress not found' }, 404)
			progress.delete(entry[0])
			emitUserUpdated(user)
			return ok()
		}
		if (method === 'GET' && mp[2] === 'remove-from-continue-listening') {
			const entry = [...progress.entries()].find(
				([, record]) =>
					record.id === decodeURIComponent(mp[1]) && record.userId === user.id,
			)
			if (!entry) return json({ error: 'Progress not found' }, 404)
			progress.set(entry[0], { ...entry[1], hideFromContinueListening: true })
			emitUserUpdated(user)
			return json(browserUser(user))
		}
		if (!items.some((i) => i.id === mp[1]))
			return json({ error: 'Item not found' }, 404)
		const key = `${user.id}:${mp[1]}:${mp[2] || ''}`
		if (method === 'PATCH') {
			const input = z
				.object({
					currentTime: z.number().nonnegative().optional(),
					duration: z.number().nonnegative().optional(),
					ebookLocation: z.string().nullable().optional(),
					ebookProgress: z.number().min(0).max(1).optional(),
					isFinished: z.boolean().optional(),
					progress: z.number().min(0).max(1).optional(),
				})
				.safeParse(await body())
			if (!input.success) return json({ error: 'Invalid progress' }, 400)
			progress.set(key, {
				id: key,
				userId: user.id,
				libraryItemId: mp[1],
				episodeId: mp[2] || null,
				mediaItemId: mp[2] || mp[1],
				mediaItemType: mp[2] ? 'podcastEpisode' : 'book',
				duration: 0,
				progress: 0,
				currentTime: 0,
				isFinished: false,
				ebookLocation: null,
				ebookProgress: 0,
				finishedAt: null,
				...progress.get(key),
				...input.data,
				...(input.data.isFinished === false && progress.get(key)?.isFinished
					? { currentTime: 0, progress: 0 }
					: {}),
				lastUpdate: Date.now(),
				startedAt: now,
				hideFromContinueListening: false,
			})
			emitUserUpdated(user)
			return ok()
		}
		return progress.has(key)
			? json(progress.get(key))
			: json({ error: 'Progress not found' }, 404)
	}
	const bmList = /^\/api\/me\/bookmarks(?:\/([^/]+))?$/.exec(path)
	if (bmList)
		return json({
			bookmarks: bookmarks.filter(
				(b) =>
					b.userId === user.id && (!bmList[1] || b.libraryItemId === bmList[1]),
			),
		})
	const bm = /^\/api\/me\/item\/([^/]+)\/bookmark(?:\/([^/]+))?$/.exec(path)
	if (bm) {
		if (!items.some((i) => i.id === bm[1]))
			return json({ error: 'Item not found' }, 404)
		if (method === 'DELETE') {
			const index = bookmarks.findIndex(
				(b) =>
					b.userId === user.id &&
					b.libraryItemId === bm[1] &&
					b.time === Number(bm[2]),
			)
			if (index < 0) return json({ error: 'Bookmark not found' }, 404)
			bookmarks.splice(index, 1)
			return ok()
		}
		const input = z
			.object({ time: z.number().nonnegative(), title: z.string().min(1) })
			.safeParse(await body())
		if (!input.success) return json({ error: 'Invalid bookmark' }, 400)
		const existing = bookmarks.find(
			(b) =>
				b.userId === user.id &&
				b.libraryItemId === bm[1] &&
				b.time === input.data.time,
		)
		if (method === 'PATCH' && !existing)
			return json({ error: 'Bookmark not found' }, 404)
		const bookmark = existing || {
			userId: user.id,
			libraryItemId: bm[1],
			...input.data,
			createdAt: Date.now(),
		}
		Object.assign(bookmark, input.data)
		if (!existing) bookmarks.push(bookmark)
		emitUserUpdated(user)
		const { userId: _userId, ...response } = bookmark
		return json(response)
	}
	const playlistDetail = /^\/api\/playlists\/([^/]+)$/.exec(path)
	if (playlistDetail) {
		const playlist = playlists.find(
			(candidate) =>
				candidate.id === playlistDetail[1] && candidate.userId === user.id,
		)
		if (!playlist) return json({ error: 'Not found' }, 404)
		if (method === 'PATCH') {
			const input = z
				.object({
					name: z.string().optional(),
					description: z.string().nullable().optional(),
					items: z.array(playlistInput).optional(),
				})
				.safeParse(await body())
			if (!input.success) return json({ error: 'Invalid update' }, 400)
			if (input.data.items) {
				const expanded = input.data.items.map(expandPlaylist)
				if (expanded.some((item) => !item))
					return json({ error: 'Invalid playlist items' }, 400)
				playlist.items = expanded.filter((item) => item !== undefined)
			}
			Object.assign(playlist, {
				...(input.data.name === undefined ? {} : { name: input.data.name }),
				...(input.data.description === undefined
					? {}
					: { description: input.data.description }),
			})
		}
		if (method === 'DELETE') {
			playlists.splice(playlists.indexOf(playlist), 1)
			return ok()
		}
		return json(playlist)
	}
	const entity =
		/^\/api\/(collections|playlists)(?:\/([^/]+))?(?:\/(book|item|batch\/add|batch\/remove)(?:\/([^/]+)(?:\/([^/]+))?)?)?$/.exec(
			path,
		)
	if (entity) {
		const isCollection = entity[1] === 'collections'
		if (isCollection && method !== 'GET' && !admin)
			return json({ error: 'Forbidden' }, 403)
		if (!entity[2]) {
			if (method === 'GET')
				return json(
					isCollection
						? { collections }
						: { playlists: playlists.filter((p) => p.userId === user.id) },
				)
			const raw = await body()
			const input = named.safeParse(raw)
			if (
				!input.success ||
				!libraries.some((l) => l.id === input.data.libraryId)
			)
				return json({ error: 'Invalid collection or playlist' }, 400)
			const stamp = {
				...input.data,
				description: input.data.description || null,
				id: `fixture-${entity[1]}-${Date.now()}`,
				createdAt: Date.now(),
				lastUpdate: Date.now(),
			}
			if (isCollection) {
				const ids = z.object({ books: stringArray.optional() }).safeParse(raw)
				if (!ids.success) return json({ error: 'Invalid books' }, 400)
				const selected = (ids.data.books || []).map((id) =>
					books.find((b) => b.id === id && b.libraryId === stamp.libraryId),
				)
				if (selected.some((b) => !b))
					return json({ error: 'Invalid books' }, 400)
				const result = {
					...stamp,
					books: selected.filter((b) => b !== undefined),
				}
				collections.push(result)
				return json(result)
			}
			const inputs = z
				.object({ items: z.array(playlistInput).optional() })
				.safeParse(raw)
			if (!inputs.success) return json({ error: 'Invalid playlist items' }, 400)
			const expanded = (inputs.data.items || []).map(expandPlaylist)
			if (
				expanded.some((i) => !i || i.libraryItem.libraryId !== stamp.libraryId)
			)
				return json({ error: 'Invalid playlist items' }, 400)
			const result = {
				...stamp,
				userId: user.id,
				items: expanded.filter((i) => i !== undefined),
			}
			playlists.push(result)
			return json(result)
		}
		const collection = isCollection
			? collections.find((c) => c.id === entity[2])
			: undefined
		const playlist = !isCollection
			? playlists.find((p) => p.id === entity[2] && p.userId === user.id)
			: undefined
		const value = collection || playlist
		if (!value) return json({ error: 'Not found' }, 404)
		if (!entity[3]) {
			if (method === 'DELETE') {
				if (collection) collections.splice(collections.indexOf(collection), 1)
				if (playlist) playlists.splice(playlists.indexOf(playlist), 1)
				return ok()
			}
			if (method === 'PATCH') {
				const input = z
					.object({
						name: z.string().trim().min(1).optional(),
						description: z.string().nullable().optional(),
					})
					.safeParse(await body())
				if (!input.success) return json({ error: 'Invalid update' }, 400)
				Object.assign(value, input.data, { lastUpdate: Date.now() })
			}
			return json(value)
		}
		if (collection && entity[3] === 'book') {
			if (method === 'DELETE')
				collection.books = collection.books.filter((b) => b.id !== entity[4])
			else {
				const input = z.object({ id: z.string() }).safeParse(await body())
				const book = input.success
					? books.find(
							(b) =>
								b.id === input.data.id && b.libraryId === collection.libraryId,
						)
					: undefined
				if (!book) return json({ error: 'Invalid book' }, 400)
				if (!collection.books.some((b) => b.id === book.id))
					collection.books.push(book)
			}
			return json(collection)
		}
		if (playlist && entity[3] === 'item') {
			if (method === 'DELETE')
				playlist.items = playlist.items.filter(
					(i) =>
						!(
							i.libraryItemId === entity[4] &&
							(!entity[5] || i.episodeId === entity[5])
						),
				)
			else {
				const input = playlistInput.safeParse(await body())
				const item = input.success ? expandPlaylist(input.data) : undefined
				if (!item || item.libraryItem.libraryId !== playlist.libraryId)
					return json({ error: 'Invalid item' }, 400)
				playlist.items.push(item)
			}
			return json(playlist)
		}
		return json({ error: 'Unsupported offline batch operation' }, 501)
	}
	const recentEpisodes = /^\/api\/libraries\/([^/]+)\/recent-episodes$/.exec(
		path,
	)
	if (recentEpisodes && method === 'GET') {
		const episodes = items
			.filter(
				(item) =>
					item.libraryId === recentEpisodes[1] && item.mediaType === 'podcast',
			)
			.flatMap((item) =>
				('episodes' in item.media ? item.media.episodes : []).map(
					(episode) => ({
						...episode,
						libraryItemId: item.id,
						podcast: { metadata: item.media.metadata },
					}),
				),
			)
			.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
		if (
			url.searchParams.get('includeFeed') === '1' &&
			recentEpisodes[1] === 'podcasts'
		) {
			const podcast = items.find((i) => i.id === 'podcast-1')
			if (podcast)
				return json({
					episodes: [
						{
							...fixtureFeedEpisode,
							downloaded: downloadedFeedUsers.has(user.id),
							podcast: podcast.media,
						},
						...episodes.map((e) => ({ ...e, downloaded: true })),
					],
					limit: 50,
					page: 0,
				})
		}
		return json({ episodes, limit: 50, page: 0 })
	}
	const episodeSummary = /^\/api\/podcasts\/([^/]+)\/episode-summary$/.exec(
		path,
	)
	if (episodeSummary && method === 'GET') {
		const item = items.find((entry) => entry.id === episodeSummary[1])
		if (item?.mediaType !== 'podcast') return json({ error: 'Not found' }, 404)
		return json({ total: 120, unplayed: 117, source: 'feed' })
	}
	if (path === '/api/search/podcast' && method === 'GET') {
		return json([
			{
				id: 'search-show',
				title: 'Search show',
				artistId: null,
				artistName: 'Fixture publisher',
				feedUrl: 'https://example.test/search-show.xml',
				cover: null,
			},
		])
	}
	if (path === '/api/podcasts/feed' && method === 'POST') {
		if (!admin) return json({ error: 'Forbidden' }, 403)
		const input = z
			.object({ rssFeed: z.string().url() })
			.safeParse(await body())
		if (!input.success) return json({ error: 'Invalid rssFeed' }, 400)
		if (input.data.rssFeed === 'https://example.test/search-show.xml')
			return json({
				podcast: {
					metadata: { title: 'Search show', feedUrl: input.data.rssFeed },
					episodes: [],
				},
			})
		const record = realRecords.find(
			(r) => r.kind === 'podcast' && r.feedUrl === input.data.rssFeed,
		)
		if (!record)
			return json(
				{
					error:
						'Feed unavailable in offline fixture; only cached requested feeds supported',
				},
				422,
			)
		return json({
			podcast: {
				metadata: {
					title: record.title,
					author: record.author,
					description: record.description,
					feedUrl: record.feedUrl,
					image: `/e2e/media/${record.cover}`,
					language: record.language,
				},
				episodes: record.tracks.map((t) => ({
					title: t.title,
					guid: t.guid,
					pubDate: t.pubDate,
					enclosure: t.enclosure,
					durationSeconds: t.duration,
				})),
			},
		})
	}
	if (path === '/api/podcasts' && method === 'POST') {
		if (!admin) return json({ error: 'Forbidden' }, 403)
		const input = z
			.object({
				libraryId: z.literal('podcasts'),
				folderId: z.literal('podcasts-folder'),
				path: z.string().startsWith('/local-preview/podcasts/'),
				media: z.object({ metadata: z.object({ feedUrl: z.string().url() }) }),
			})
			.safeParse(await body())
		if (!input.success)
			return json({ error: 'Invalid offline subscription payload' }, 400)
		const existing = items.find(
			(i) =>
				i.mediaType === 'podcast' &&
				'feedUrl' in i.media.metadata &&
				i.media.metadata.feedUrl === input.data.media.metadata.feedUrl,
		)
		if (existing) return json({ error: 'Podcast already exists' }, 400)
		const cached = realItems.find(
			(i) =>
				i.mediaType === 'podcast' &&
				'feedUrl' in i.media.metadata &&
				i.media.metadata.feedUrl === input.data.media.metadata.feedUrl,
		)
		if (!cached)
			return json(
				{ error: 'Only cached requested feeds supported offline' },
				422,
			)
		items.push(cached)
		return json(cached)
	}
	const unsubscribe = /^\/api\/items\/([^/]+)$/.exec(path)
	if (unsubscribe && method === 'DELETE') {
		if (!admin) return json({ error: 'Forbidden' }, 403)
		const index = items.findIndex((i) => i.id === unsubscribe[1])
		if (index < 0) return json({ error: 'Item not found' }, 404)
		if (
			!items[index].id.startsWith('real-') ||
			items[index].mediaType !== 'podcast'
		)
			return json(
				{
					error: 'Offline adapter only removes cached subscription membership',
				},
				422,
			)
		items.splice(index, 1)
		return ok()
	}
	const podcast =
		/^\/api\/podcasts\/([^/]+)\/(downloads|clear-queue|checknew|download-episodes)$/.exec(
			path,
		)
	if (podcast) {
		const item = items.find(
			(i) => i.id === podcast[1] && i.mediaType === 'podcast',
		)
		if (!item) return json({ error: 'Podcast not found' }, 404)
		if (podcast[2] === 'downloads') return json({ downloads: [] })
		if (!admin) return json({ error: 'Forbidden' }, 403)
		if (podcast[2] === 'clear-queue') return ok()
		if (podcast[2] === 'checknew') return json({ episodes: [] })
		const input = z
			.array(z.object({ enclosure: z.object({ url: z.string().url() }) }))
			.min(1)
			.safeParse(await body())
		if (!input.success) return json({ error: 'Invalid episodes' }, 400)
		const record = realRecords.find((r) => r.id === item.id)
		if (
			!record ||
			input.data.some(
				(e) => !record.tracks.some((t) => t.enclosure.url === e.enclosure.url),
			)
		)
			return json({ error: 'Audio not cached; live download unsupported' }, 422)
		return ok()
	}
	return undefined
}
