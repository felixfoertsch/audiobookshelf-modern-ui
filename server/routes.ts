import { z } from 'zod'

const ABS_URL = 'http://audiobookshelf:80'
const librariesSchema = z.object({
	libraries: z.array(z.object({ id: z.string().min(1) })),
})
const pageSchema = z.object({
	results: z.array(z.object({ id: z.string().min(1) })),
	total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_PAGES = 100
const PAGE_SIZE = 100

export async function libraryRoutes(token: string): Promise<string[]> {
	const headers = { Authorization: `Bearer ${token}` }
	const libraries = await getJson(new URL('/api/libraries', ABS_URL), headers)
	const parsedLibraries = librariesSchema.safeParse(libraries)
	if (!parsedLibraries.success) throw new Error('invalid library response')
	const paths = new Set<string>([
		'/',
		'/account',
		'/config',
		'/upload',
		'/debug/issues',
	])
	for (const { id } of parsedLibraries.data.libraries) {
		paths.add(`/library/${encodeURIComponent(id)}`)
		for (let page = 0; page < MAX_PAGES; page++) {
			const url = new URL(
				`/api/libraries/${encodeURIComponent(id)}/items`,
				ABS_URL,
			)
			url.searchParams.set('limit', String(PAGE_SIZE))
			url.searchParams.set('page', String(page))
			const result = await getJson(url, headers)
			const parsedPage = pageSchema.safeParse(result)
			if (!parsedPage.success) throw new Error('invalid item page')
			for (const item of parsedPage.data.results)
				paths.add(`/item/${encodeURIComponent(item.id)}`)
			if ((page + 1) * PAGE_SIZE >= parsedPage.data.total) break
			if (page === MAX_PAGES - 1) throw new Error('item page limit exceeded')
		}
	}
	return [...paths]
}

async function getJson(url: URL, headers: HeadersInit): Promise<unknown> {
	const response = await fetch(url, {
		headers,
		redirect: 'error',
		signal: AbortSignal.timeout(5000),
	})
	if (!response.ok || !response.body)
		throw new Error('stable inventory unavailable')
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			size += value.byteLength
			if (size > MAX_RESPONSE_BYTES) {
				await reader.cancel()
				throw new Error('stable inventory response limit')
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString()) as unknown
	} catch {
		throw new Error('invalid stable inventory JSON')
	}
}
