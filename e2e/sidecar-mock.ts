// Sidecar contract fixture for proxy E2E; isolated from the stock ABS mock.
import fixtures from '../contract/fixtures.json' with { type: 'json' }
import { items } from './data'
import { fixtureUserForToken } from './fixture-api'

const state = {
	unavailable: false,
	unauthorized: false,
	feedComplete: false,
}
const isAdminToken = (token: string | undefined) => {
	const user = fixtureUserForToken(token)
	return user !== undefined && ['admin', 'root'].includes(user.type)
}
const analysisFixture = fixtures.analysis.episodes['episode-id']
const feedEpisode = {
	id: 'feed-only-episode',
	libraryItemId: 'podcast-1',
	guid: 'fixture-feed-guid',
	title: 'Feed-only fixture episode',
	enclosure: { url: 'https://example.test/feed-only.mp3' },
	enclosureURL: 'https://example.test/feed-only.mp3',
	publishedAt: 1893456000000,
	duration: 2100,
	podcast: { metadata: { title: 'Field Notes' } },
	get downloaded() {
		return state.feedComplete
	},
}
const result = (
	status: 'disabled' | 'complete',
	segments: { start: number; end: number }[] = [],
) => ({
	...analysisFixture,
	status,
	version: status === 'complete' ? 'fixture-v1' : null,
	sourceSha256: status === 'complete' ? analysisFixture.sourceSha256 : null,
	segments,
	adAnalysisEnabled: status === 'complete',
	applicable: true,
})
export async function handleSidecarRequest(request: Request) {
	const url = new URL(request.url)
	if (url.pathname === '/__mock/state' && request.method === 'POST') {
		const body = await request.json().catch(() => ({}))
		if (typeof body.unavailable === 'boolean')
			state.unavailable = body.unavailable
		if (typeof body.unauthorized === 'boolean')
			state.unauthorized = body.unauthorized
		if (typeof body.feedComplete === 'boolean')
			state.feedComplete = body.feedComplete
		return Response.json({ ...state })
	}
	if (url.pathname === '/__mock/state') return Response.json({ ...state })
	if (state.unavailable) return new Response('Unavailable', { status: 503 })
	const token = request.headers
		.get('authorization')
		?.match(/^Bearer ([^\s]+)$/)?.[1]
	const user = fixtureUserForToken(token) !== undefined
	if (state.unauthorized || !user)
		return Response.json({ error: 'unauthorized' }, { status: 401 })

	const path = url.pathname
	if (path === '/api/podcasts/podcast-1/ad-analysis') {
		if (request.method === 'GET') return Response.json(fixtures.consent)
		if (request.method === 'POST') {
			if (!isAdminToken(token))
				return Response.json({ error: 'forbidden' }, { status: 403 })
			const body = await request.json().catch(() => null)
			if (typeof body?.enabled !== 'boolean')
				return Response.json({ error: 'invalid_body' }, { status: 400 })
			return Response.json(body)
		}
	}
	if (path === '/api/debug/auth') {
		return isAdminToken(token)
			? Response.json({ ok: true })
			: Response.json({ error: 'forbidden' }, { status: 403 })
	}
	const jobStatus = /^\/api\/items\/([^/]+)\/analysis\/status$/.exec(path)
	if (jobStatus && request.method === 'GET') {
		if (
			!items.some((item) => item.id === jobStatus[1]) &&
			jobStatus[1] !== 'allowed-item'
		)
			return Response.json({ error: 'forbidden' }, { status: 403 })
		return Response.json(fixtures.status)
	}
	const analysis = /^\/api\/items\/([^/]+)\/analysis$/.exec(path)
	if (analysis && request.method === 'GET') {
		const [, itemId] = analysis
		const item = items.find((entry) => entry.id === itemId)
		if (itemId === 'other-item' || (!item && itemId !== 'allowed-item'))
			return Response.json({ error: 'forbidden' }, { status: 403 })
		const episodes =
			itemId === 'allowed-item'
				? { 'ep-1': result('complete', [{ start: 5, end: 10 }]) }
				: Object.fromEntries(
						item && 'episodes' in item.media
							? (item.media.episodes || []).map((episode) => [
									episode.id,
									result('disabled'),
								])
							: [],
					)
		return Response.json({ episodes })
	}
	const enqueue =
		/^\/api\/podcasts\/([^/]+)\/episode\/([^/]+)\/ad-analysis$/.exec(path)
	if (enqueue && request.method === 'POST') {
		if (!isAdminToken(token))
			return Response.json({ error: 'forbidden' }, { status: 403 })
		const body = await request.json().catch(() => null)
		if (!body || typeof body !== 'object' || Object.keys(body).length)
			return Response.json({ error: 'invalid_body' }, { status: 400 })
		if (enqueue[1] === 'other-item')
			return Response.json({ error: 'forbidden' }, { status: 403 })
		return Response.json(fixtures.enqueue, { status: 202 })
	}
	const consent = /^\/api\/podcasts\/([^/]+)\/ad-analysis$/.exec(path)
	if (consent) {
		const item = items.find((entry) => entry.id === consent[1])
		if (item?.mediaType !== 'podcast')
			return Response.json({ error: 'not_found' }, { status: 404 })
		if (request.method === 'GET') return Response.json(fixtures.consent)
		if (request.method === 'POST') {
			if (!isAdminToken(token))
				return Response.json({ error: 'forbidden' }, { status: 403 })
			const body = await request.json().catch(() => null)
			if (typeof body?.enabled !== 'boolean')
				return Response.json({ error: 'invalid_body' }, { status: 400 })
			return Response.json(body)
		}
	}
	const summary = /^\/api\/podcasts\/([^/]+)\/episode-summary$/.exec(path)
	if (summary) {
		const item = items.find((entry) => entry.id === summary[1])
		if (item?.mediaType !== 'podcast')
			return Response.json({ error: 'not_found' }, { status: 404 })
		const total =
			'episodes' in item.media ? item.media.episodes?.length || 0 : 0
		return Response.json({ ...fixtures.summary, total, unplayed: total })
	}
	const recent = /^\/api\/libraries\/([^/]+)\/recent-episodes$/.exec(path)
	if (recent) {
		const episodes: Record<string, unknown>[] = items
			.filter(
				(item) =>
					item.mediaType === 'podcast' &&
					item.libraryId === recent[1] &&
					'episodes' in item.media,
			)
			.flatMap((item) =>
				'episodes' in item.media
					? (item.media.episodes || []).map((episode) => {
							const enclosureURL =
								episode.enclosure &&
								typeof episode.enclosure === 'object' &&
								'url' in episode.enclosure
									? String(episode.enclosure.url)
									: `https://example.test/${encodeURIComponent(episode.id)}.mp3`
							return {
								...episode,
								id: episode.id,
								podcastId: item.id,
								libraryItemId: item.id,
								enclosureURL,
								guid: episode.guid || null,
								publishedAt: Date.parse(episode.pubDate || '') || null,
								downloaded:
									!episode.id.startsWith('feed-only') || state.feedComplete,
								podcast: item.media,
							}
						})
					: [],
			)
		if (recent[1] === 'podcasts') episodes.unshift(feedEpisode)
		const limit = Math.min(100, Number(url.searchParams.get('limit') || 50))
		const page = Math.max(0, Number(url.searchParams.get('page') || 0))
		return Response.json({
			episodes: episodes.slice(page * limit, page * limit + limit),
			limit,
			page,
			feedUnavailable: false,
			feedTruncated: false,
		})
	}
	return Response.json({ error: 'not_found' }, { status: 404 })
}
if (import.meta.main) {
	const server = Bun.serve({
		port: Number(process.env.PSB_MOCK_PORT || 4181),
		hostname: process.env.PSB_MOCK_HOST || '127.0.0.1',
		fetch: handleSidecarRequest,
	})
	console.log(`sidecar mock listening ${server.hostname}:${server.port}`)
	process.on('SIGTERM', () => server.stop(true))
}
