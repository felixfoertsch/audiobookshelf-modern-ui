const ABS_URL = 'http://audiobookshelf:80'
const MAX_AUTH_BYTES = 16 * 1024 * 1024

export async function isAdmin(request: Request): Promise<boolean> {
	const authorization = request.headers.get('authorization') ?? ''
	if (!authorization.startsWith('Bearer ') || authorization.length > 8192)
		return false
	const token = authorization.slice(7).trim()
	if (!token) return false
	let response: Response
	try {
		response = await fetch(new URL('/api/me', ABS_URL), {
			headers: { Authorization: `Bearer ${token}` },
			redirect: 'error',
			signal: AbortSignal.timeout(5000),
		})
	} catch {
		return false
	}
	if (!response.ok || !response.body) return false
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			size += value.byteLength
			if (size > MAX_AUTH_BYTES) {
				await reader.cancel()
				return false
			}
			chunks.push(value)
		}
	} catch {
		return false
	} finally {
		reader.releaseLock()
	}
	try {
		const user = JSON.parse(Buffer.concat(chunks).toString()) as {
			type?: unknown
			isActive?: unknown
		}
		if (
			user.isActive !== true ||
			(user.type !== 'admin' && user.type !== 'root')
		)
			return false
		const payload = JSON.parse(
			Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
		) as { type?: unknown }
		return payload.type === 'access'
	} catch {
		return false
	}
}
