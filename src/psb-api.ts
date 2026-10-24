import { type ZodType, z } from 'zod'
import { ApiError, authHeaders, getAuthGeneration, refreshSession } from './api'

export async function psbApi<T>(
	path: string,
	schema: ZodType<T>,
	init: RequestInit = {},
): Promise<T> {
	const url = new URL(`/psb${path}`, location.origin)
	if (
		!path.startsWith('/') ||
		path.startsWith('//') ||
		path.includes('\\') ||
		path.includes('#') ||
		[...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
		/%(?:2f|5c)/i.test(path) ||
		!url.pathname.startsWith('/psb/')
	)
		throw new Error('Sidecar API path must be same-origin')
	const generation = getAuthGeneration()
	const timeout = AbortSignal.timeout(
		/^\/api\/libraries\/[^/]+\/recent-episodes$/.test(url.pathname)
			? 35000
			: 5000,
	)
	const send = () => {
		const headers = new Headers(init.headers)
		new Headers(authHeaders()).forEach((value, key) => {
			headers.set(key, value)
		})
		if (typeof init.body === 'string' && !headers.has('content-type'))
			headers.set('content-type', 'application/json')
		return fetch(`${url.pathname}${url.search}`, {
			...init,
			signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
			credentials: 'omit',
			headers,
		})
	}
	let response = await send()
	if (response.status === 401 && generation === getAuthGeneration()) {
		await refreshSession()
		if (generation !== getAuthGeneration())
			throw new ApiError('Session changed. Retry signing in.', 401)
		response = await send()
	}
	if (!response.ok)
		throw new ApiError(
			`Sidecar request failed (${response.status})`,
			response.status,
		)
	if (generation !== getAuthGeneration())
		throw new ApiError('Session changed. Retry signing in.', 401)
	const body = await response.text()
	try {
		return schema.parse(body ? JSON.parse(body) : {})
	} catch (cause) {
		throw new Error('Sidecar returned an invalid response.', { cause })
	}
}
export const sidecarEmptySchema = z.object({}).passthrough()
