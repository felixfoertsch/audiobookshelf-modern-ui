import { createDebugServer } from 'debug-overlay/server'
import { isAdmin } from './auth'
import { libraryRoutes } from './routes'

const PORT = Number(process.env.DEBUG_PORT ?? 3001)
const DB_PATH = process.env.DEBUG_DB_PATH ?? '/appdata/debug-overlay.sqlite'

const routes = async (request: Request) => {
	const authorization = request.headers.get('authorization') ?? ''
	return libraryRoutes(authorization.slice(7).trim())
}
export const app = createDebugServer({
	dbPath: DB_PATH,
	authorize: isAdmin,
	routes,
})
export const server = Bun.serve({
	hostname: '127.0.0.1',
	port: PORT,
	fetch: app.fetch,
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		server.stop()
		app.close()
	})
}
