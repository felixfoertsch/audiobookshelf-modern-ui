import {
	createRootRoute,
	type ErrorComponentProps,
	Link,
	Outlet,
	useNavigate,
	useRouterState,
} from '@tanstack/react-router'
import {
	ChartNoAxesColumn,
	ChevronDown,
	Download,
	Folder,
	Headphones,
	House,
	Library,
	ListMusic,
	Mic,
	Plus,
	Search,
	Settings,
	UserRound,
	Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import frontendPackage from '../../package.json'
import { getAuthGeneration, logout, useAuth } from '../api'
import { getLibraries } from '../catalog'
import {
	LibraryNameContext,
	LibraryNav,
	SearchForm,
} from '../features/catalog/browse'
import { ServerActivityObserver } from '../features/catalog/server-activity'
import { DebugToggle, RootDebug } from '../features/debug'
import { PodcastSearchModal } from '../features/podcast/PodcastSearchModal'
import { Player } from '../player'
import { Button } from '../shared/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../shared/components/ui/dropdown-menu'
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
	useSidebar,
} from '../shared/components/ui/sidebar'

function ShellSidebarTrigger() {
	const { openMobile, open, isMobile } = useSidebar()
	const trigger = useRef<HTMLButtonElement>(null)
	const wasOpen = useRef(false)
	useEffect(() => {
		if (wasOpen.current && !openMobile) trigger.current?.focus()
		wasOpen.current = openMobile
	}, [openMobile])
	return (
		<SidebarTrigger
			ref={trigger}
			className={
				!isMobile && !open ? 'fixed top-2 left-2 z-40 bg-card' : 'md:hidden'
			}
		/>
	)
}

export function RouteError({ error }: ErrorComponentProps) {
	return (
		<section role="alert" className="space-y-4">
			<h1 className="text-2xl font-semibold">Could not load this page</h1>
			<p>
				{error instanceof Error ? error.message : 'Unexpected server response'}
			</p>
			<Button variant="outline" onClick={() => window.location.reload()}>
				Retry
			</Button>
			<p>
				<Link to="/" className="text-primary underline">
					Libraries
				</Link>
			</p>
		</section>
	)
}
export const Route = createRootRoute({
	validateSearch: (
		search: Record<string, unknown>,
	): { addPodcast?: number } => ({
		...(Number(search.addPodcast) === 1 ? { addPodcast: 1 } : {}),
	}),
	component: Layout,
	errorComponent: ({ error, reset }) => (
		<Layout routeError={{ error, reset }} />
	),
	pendingComponent: () => <p role="status">Loading…</p>,
	notFoundComponent: () => (
		<p>
			Page not found. <Link to="/">Open libraries</Link>
		</p>
	),
})
export function Layout({
	routeError,
}: {
	routeError?: ErrorComponentProps
} = {}) {
	const [theme, setTheme] = useState(
		() => localStorage.getItem('abs-modern-theme') || 'system',
	)
	const [error, setError] = useState('')
	useEffect(() => {
		const media = window.matchMedia('(prefers-color-scheme: dark)')
		const update = () =>
			document.documentElement.classList.toggle(
				'dark',
				theme === 'dark' || (theme === 'system' && media.matches),
			)
		update()
		media.addEventListener('change', update)
		localStorage.setItem('abs-modern-theme', theme)
		return () => media.removeEventListener('change', update)
	}, [theme])
	const user = useAuth((state) => state.user)
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	})
	const query = useRouterState({
		select: (state) => state.location.search as { q?: unknown },
	})
	const addPodcast = useRouterState({
		select: (state) => state.location.search as { addPodcast?: unknown },
	})
	const routeIds = useRouterState({
		select: (state) => state.matches.map((match) => match.routeId),
	})
	const blank = routeIds.some(
		(id) => id === '/login' || id.startsWith('/share/'),
	)
	const navigate = useNavigate()
	const [libraries, setLibraries] = useState<
		Awaited<ReturnType<typeof getLibraries>>['libraries']
	>([])
	const currentLibrary =
		libraries.find((library) => pathname.split('/').includes(library.id)) ||
		libraries.find(
			(library) => library.id === localStorage.getItem('currentLibraryId'),
		) ||
		libraries[0]
	useEffect(() => {
		if (!user || blank) {
			setLibraries([])
			return
		}
		let active = true
		const generation = getAuthGeneration()
		void getLibraries()
			.then((data) => {
				if (active && generation === getAuthGeneration())
					setLibraries(data.libraries)
			})
			.catch((error: unknown) => {
				if (active && generation === getAuthGeneration())
					setError(
						error instanceof Error ? error.message : 'Could not load libraries',
					)
			})
		return () => {
			active = false
		}
	}, [user, blank])
	useEffect(() => {
		if (!user || blank) return
		let active = true
		const generation = getAuthGeneration()
		const refresh = (event: Event) => {
			const name = (event as CustomEvent<{ event?: string }>).detail?.event
			if (name && /^(library_|init|reconnect)/.test(name))
				void getLibraries()
					.then((data) => {
						if (
							active &&
							generation === getAuthGeneration() &&
							useAuth.getState().user?.id === user.id
						)
							setLibraries(data.libraries)
					})
					.catch((cause: unknown) => {
						if (active && generation === getAuthGeneration())
							setError(
								cause instanceof Error
									? cause.message
									: 'Library refresh failed',
							)
					})
		}
		window.addEventListener('abs:socket', refresh)
		return () => {
			active = false
			window.removeEventListener('abs:socket', refresh)
		}
	}, [user, blank])
	if (!user || blank)
		return (
			<main id="content" className="mx-auto max-w-6xl px-5 py-8">
				{routeError ? <RouteError {...routeError} /> : <Outlet />}
			</main>
		)
	const admin = user.type === 'admin' || user.type === 'root'
	const permissions = user.permissions as { upload?: boolean } | undefined
	return (
		<>
			<a
				href="#content"
				className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-background focus:p-4"
			>
				Skip to content
			</a>
			<RootDebug>
				<SidebarProvider>
					<Sidebar className="z-30 [&_[data-active=true]_svg]:text-sidebar-accent-foreground">
						<SidebarHeader className="gap-4 px-4 pt-6 pb-2">
							<Link to="/" className="px-2 text-lg font-semibold">
								Audiobookshelf
							</Link>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										className="w-full min-w-0 justify-between border border-muted-foreground bg-[var(--glass-tint)] text-sidebar-foreground shadow-sm backdrop-blur-xl"
									>
										<span className="truncate">
											Library: {currentLibrary?.name || 'Choose library'}
										</span>
										<ChevronDown
											aria-hidden="true"
											className="size-4 shrink-0"
										/>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="start"
									className="max-w-[calc(100vw-2rem)]"
								>
									<DropdownMenuLabel>Library</DropdownMenuLabel>
									<DropdownMenuRadioGroup
										value={currentLibrary?.id || ''}
										onValueChange={(id) => {
											localStorage.setItem('currentLibraryId', id)
											void navigate({
												to: '/library/$library',
												params: { library: id },
											})
										}}
									>
										{libraries.map((library) => (
											<DropdownMenuRadioItem
												key={library.id}
												value={library.id}
											>
												<span className="truncate">{library.name}</span>
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuContent>
							</DropdownMenu>
							{currentLibrary && (
								<div className="relative [&_label]:text-[0px] [&_input]:h-8 [&_input]:pl-8 [&_input]:text-sm [&_button]:h-8 [&_button]:px-2 [&_button]:text-xs">
									<Search
										aria-hidden="true"
										className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground"
									/>
									<SearchForm
										key={currentLibrary.id}
										library={currentLibrary.id}
										q={
											/^\/library\/[^/]+\/search\/?$/.test(pathname) &&
											typeof query.q === 'string'
												? query.q
												: ''
										}
									/>
								</div>
							)}
						</SidebarHeader>
						<SidebarContent className="[scrollbar-width:none] [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0">
							{currentLibrary && (
								<LibraryNav
									library={currentLibrary.id}
									podcast={currentLibrary.mediaType === 'podcast'}
									icons={{
										Home: <House />,
										'Latest episodes': <Headphones />,
										'Add podcast': <Plus />,
										Library: <Library />,
										series: <ListMusic />,
										authors: <Users />,
										collections: <Folder />,
										Narrators: <Mic />,
										Playlists: <ListMusic />,
										'Download queue': <Download />,
										Statistics: <ChartNoAxesColumn />,
									}}
								/>
							)}
							<nav
								aria-label="Settings and tools"
								className="mt-auto space-y-1 px-3 py-2 text-sm"
							>
								{(admin || permissions?.upload) && (
									<Link
										to="/upload"
										className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-accent"
									>
										<Plus aria-hidden="true" className="size-4" />
										Upload
									</Link>
								)}
								{admin && (
									<div className="flex items-center gap-2">
										<Link
											to="/config"
											activeOptions={{ exact: false }}
											activeProps={{ className: 'bg-accent font-medium' }}
											className="flex flex-1 items-center gap-2 rounded-md px-3 py-2 hover:bg-accent"
										>
											<Settings aria-hidden="true" className="size-4" />
											Admin settings
										</Link>
									</div>
								)}
							</nav>
						</SidebarContent>
						<SidebarFooter className="border-t p-3">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										className="w-full min-w-0 justify-start text-sidebar-foreground"
									>
										<UserRound aria-hidden="true" className="size-4 shrink-0" />
										<span className="truncate">{user.username} · Account</span>
										<ChevronDown
											aria-hidden="true"
											className="ml-auto size-4 shrink-0"
										/>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="start"
									side="top"
									className="max-w-[calc(100vw-2rem)]"
								>
									<DropdownMenuItem asChild>
										<Link to="/account">User settings</Link>
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuLabel>Theme</DropdownMenuLabel>
									<DropdownMenuRadioGroup
										aria-label="Theme"
										value={theme}
										onValueChange={setTheme}
									>
										<DropdownMenuRadioItem value="system">
											System
										</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="light">
											Light
										</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="dark">
											Dark
										</DropdownMenuRadioItem>
									</DropdownMenuRadioGroup>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onSelect={() =>
											void logout().catch((error: unknown) =>
												setError(
													error instanceof Error
														? error.message
														: 'Logout failed',
												),
											)
										}
									>
										Log out
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</SidebarFooter>
					</Sidebar>
					<ServerActivityObserver />
					<SidebarInset className="min-w-0 md:peer-data-[state=collapsed]:[--sidebar-width:0px]">
						<header className="flex items-center gap-2 border-b px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:contents">
							<ShellSidebarTrigger />
							<DebugToggle />
							<span className="truncate text-sm font-medium md:hidden">
								{currentLibrary?.name || 'Audiobookshelf'}
							</span>
						</header>
						<div
							id="content"
							className="w-full min-w-0 min-h-[60vh] px-6 py-8 pb-80 [--shelf-sidebar:0px] [scrollbar-width:none] md:[--shelf-sidebar:var(--sidebar-width)] [--shelf-gutter:1.5rem] sm:[--shelf-gutter:2rem] sm:px-8 [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0"
						>
							{error && (
								<p role="alert" className="text-destructive">
									{error}
								</p>
							)}
							<LibraryNameContext.Provider value={currentLibrary?.name || ''}>
								{routeError ? <RouteError {...routeError} /> : <Outlet />}
								{addPodcast.addPodcast === 1 &&
									currentLibrary?.mediaType === 'podcast' && (
										<PodcastSearchModal libraryId={currentLibrary.id} />
									)}
							</LibraryNameContext.Provider>
						</div>
						<Player />
					</SidebarInset>
				</SidebarProvider>
				<footer className="px-5 pb-80 text-center text-xs text-muted-foreground">
					Audiobookshelf · Modern frontend {frontendPackage.version} · Original
					timeline · No offline media cache
				</footer>
			</RootDebug>
		</>
	)
}
