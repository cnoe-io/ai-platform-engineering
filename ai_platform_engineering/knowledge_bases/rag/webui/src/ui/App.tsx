import React, { useState, useMemo, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import logo from '../assets/logo.svg'
import IngestView from './IngestView'
import SearchView from './SearchView'
import GraphView from './GraphView'
import UserProfile from './UserProfile'
import { getHealthStatus } from '../api'
import { useUser } from '../contexts/UserContext'

const apiBase = import.meta.env.VITE_API_BASE?.toString() || ''

type TabType = 'ingest' | 'search' | 'graph'

export default function App() {
	const navigate = useNavigate()
	const location = useLocation()
	const { userInfo, isLoading: isLoadingUser, isUnauthenticated, refreshUserInfo } = useUser()
	
	// Determine active tab from URL path
	const getTabFromPath = (pathname: string): TabType => {
		if (pathname === '/search') return 'search'
		if (pathname === '/graph') return 'graph'
		return 'ingest' // default
	}
	
	const [activeTab, setActiveTab] = useState<TabType>(getTabFromPath(location.pathname))
	const [health, setHealth] = useState<string>('unknown')
	const [healthData, setHealthData] = useState<Record<string, unknown> | null>(null)
	const [showHealthPayload, setShowHealthPayload] = useState(false)
	const [graphRagEnabled, setGraphRagEnabled] = useState<boolean>(true)
	const [exploreEntityData, setExploreEntityData] = useState<{entityType: string, primaryKey: string} | null>(null)
	const [hasRefreshedUserInfo, setHasRefreshedUserInfo] = useState(false)
	const [minimumLoadingTime, setMinimumLoadingTime] = useState(true) // Ensure banner shows for at least 1 second

	const baseInfo = useMemo(() => (apiBase ? `Proxy disabled -> ${apiBase}` : 'Proxy: /v1 → :9446'), [])

	// Check if app is fully loaded (both user info and server health)
	const isAppLoading = isLoadingUser || health === 'unknown' || minimumLoadingTime

	// Ensure minimum loading time of 1 second to prevent flash
	useEffect(() => {
		const timer = setTimeout(() => {
			setMinimumLoadingTime(false)
		}, 1000)
		return () => clearTimeout(timer)
	}, [])

	// Update active tab when URL changes
	useEffect(() => {
		const newTab = getTabFromPath(location.pathname)
		setActiveTab(newTab)
	}, [location.pathname])

	useEffect(() => {
		const checkHealth = async () => {
			try {
				const data = await getHealthStatus()
				const wasUnknown = health === 'unknown'
				setHealth('healthy')
				setHealthData(data)
				
				// If this is the first successful health check and we don't have user info yet,
				// refresh user info (helps with OAuth2 redirect scenarios)
				if (wasUnknown && !userInfo && !hasRefreshedUserInfo && !isUnauthenticated) {
					console.log('Server is healthy, refreshing user info after OAuth2 redirect')
					setHasRefreshedUserInfo(true)
					// Add a small delay to give OAuth2 proxy time to set headers
					setTimeout(() => {
						refreshUserInfo()
					}, 500)
				}
				
				// Check graph RAG configuration
				const { config } = data
				const graphRagEnabled = config?.graph_rag_enabled ?? true
				setGraphRagEnabled(graphRagEnabled)
				
				// If graph RAG is disabled and user is on graph tab, redirect to search
				if (!graphRagEnabled && activeTab === 'graph') {
					navigate('/search', { replace: true })
				}
			} catch (err) {
				console.warn('Health check failed', err)
				setHealth('unreachable')
			}
		}

		checkHealth() // Initial check
		const intervalId = setInterval(checkHealth, 10000) // Poll every 10 seconds

		return () => {
			clearInterval(intervalId)
		}
	}, [activeTab, navigate, health, userInfo, hasRefreshedUserInfo, isUnauthenticated, refreshUserInfo])

	const handleTabChange = (tab: TabType) => {
		const path = tab === 'ingest' ? '/' : `/${tab}`
		navigate(path)
	}

	const handleExploreEntity = (entityType: string, primaryKey: string) => {
		setExploreEntityData({ entityType, primaryKey })
		navigate('/graph') // Switch to graph view
	}

	const handleExploreComplete = () => {
		setExploreEntityData(null)
	}

	return (
		<div className="h-full flex flex-col font-[Inter,system-ui,Arial,sans-serif]">
			{/* Loading Banner */}
			{isAppLoading && (
				<div className="bg-blue-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
					<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
					<span>Loading application...</span>
				</div>
			)}

			{/* Unauthenticated Banner (401) */}
			{!isAppLoading && isUnauthenticated && (
				<div className="bg-amber-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
					<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 0h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
					</svg>
					<span>Signed out - Please </span>
					<a href="/oauth2/start?rd=/" className="underline font-semibold hover:text-amber-100">
						log in again
					</a>
				</div>
			)}

			{/* Server Unreachable Banner */}
			{!isAppLoading && !isUnauthenticated && health === 'unreachable' && (
				<div className="bg-red-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
					<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
					<span>Server is not reachable - Retrying...</span>
				</div>
			)}

			<div className="flex-shrink-0 mx-auto max-w-7xl w-full px-4 py-4">
				<header className="mb-4 flex items-center justify-between">
				<div className="flex items-center gap-4">
					<img src={logo} alt="Logo" className="h-10" />
					<div>
						<h1 className="text-2xl font-semibold tracking-tight text-slate-900"><b>CAIPE RAG</b></h1>
						<p className="mt-1 text-sm text-slate-600">Backend: {baseInfo}</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<button 
						onClick={() => setShowHealthPayload(!showHealthPayload)}
						className="badge hover:shadow-md transition-shadow cursor-pointer"
						title="Click to view health payload">
						<span className={`h-2 w-2 rounded-full ${health === 'healthy' ? 'bg-emerald-500' : health === 'unreachable' ? 'bg-rose-500' : 'bg-slate-400'}`}></span>
						<span className="uppercase tracking-wide">{health}</span>
					</button>
					<UserProfile />
				</div>
			</header>

			<div className="mb-2 border-b border-slate-200">
				<nav className="-mb-px flex gap-4" aria-label="Tabs">
					<button
						onClick={() => handleTabChange('ingest')}
						className={`shrink-0 border-b-2 px-1 pb-2 text-sm font-medium ${
							activeTab === 'ingest'
								? 'border-brand-500 text-brand-600'
								: 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
						}`}>
						🗃️ Ingest
					</button>
					<button
						onClick={() => handleTabChange('search')}
						className={`shrink-0 border-b-2 px-1 pb-2 text-sm font-medium ${
							activeTab === 'search'
								? 'border-brand-500 text-brand-600'
								: 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
						}`}>
						🔍 Search
					</button>
					<button
						onClick={graphRagEnabled ? () => handleTabChange('graph') : undefined}
						disabled={!graphRagEnabled}
						className={`shrink-0 border-b-2 px-1 pb-2 text-sm font-medium ${
							!graphRagEnabled
								? 'border-transparent text-slate-400 cursor-not-allowed'
								: activeTab === 'graph'
								? 'border-brand-500 text-brand-600'
								: 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
						}`}
						title={!graphRagEnabled ? 'Graph RAG is disabled' : ''}>
						✳ Graph
					</button>
				</nav>
			</div>
			</div>

			<div className="flex-1 min-h-0 mx-auto max-w-7xl w-full px-4">
				{activeTab === 'ingest' && <IngestView />}
				{activeTab === 'search' && <SearchView onExploreEntity={handleExploreEntity} />}
				{activeTab === 'graph' && (
					<GraphView
						exploreEntityData={exploreEntityData}
						onExploreComplete={handleExploreComplete}
					/>
				)}
			</div>

			{/* Health Payload Modal */}
			{showHealthPayload && healthData && (
				<div 
					className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
					onClick={() => setShowHealthPayload(false)}>
					<div 
						className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-auto"
						onClick={(e) => e.stopPropagation()}>
						<div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
							<h3 className="text-lg font-semibold text-slate-900">Health Payload</h3>
							<button
								onClick={() => setShowHealthPayload(false)}
								className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
								title="Close">
								×
							</button>
						</div>
						<div className="p-6">
							<pre className="whitespace-pre-wrap rounded-md bg-slate-900/95 p-4 text-xs leading-relaxed text-slate-100 shadow-lg">
								{JSON.stringify(healthData, null, 2)}
							</pre>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}