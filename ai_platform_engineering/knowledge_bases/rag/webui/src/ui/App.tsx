import React, { useState, useMemo, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import logo from '../assets/logo.svg'
import IngestView from './IngestView'
import SearchView from './SearchView'
import GraphView from './GraphView'
import { getHealthStatus } from '../api'

const apiBase = import.meta.env.VITE_API_BASE?.toString() || ''

type TabType = 'ingest' | 'search' | 'graph'

export default function App() {
	const navigate = useNavigate()
	const location = useLocation()
	
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

	const baseInfo = useMemo(() => (apiBase ? `Proxy disabled -> ${apiBase}` : 'Proxy: /v1 → :9446'), [])

	// Update active tab when URL changes
	useEffect(() => {
		const newTab = getTabFromPath(location.pathname)
		setActiveTab(newTab)
	}, [location.pathname])

	useEffect(() => {
		const checkHealth = async () => {
			try {
				const data = await getHealthStatus()
				setHealth('healthy')
				setHealthData(data)
				
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
	}, [activeTab, navigate])

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
			<div className="flex-shrink-0 mx-auto max-w-7xl w-full px-4 py-4">
				<header className="mb-4 flex items-center justify-between">
				<div className="flex items-center gap-4">
					<img src={logo} alt="Logo" className="h-10" />
					<div>
						<h1 className="text-2xl font-semibold tracking-tight text-slate-900"><b>CAIPE RAG</b></h1>
						<p className="mt-1 text-sm text-slate-600">Backend: {baseInfo}</p>
					</div>
				</div>
				<button 
					onClick={() => setShowHealthPayload(!showHealthPayload)}
					className="badge hover:shadow-md transition-shadow cursor-pointer"
					title="Click to view health payload">
					<span className={`h-2 w-2 rounded-full ${health === 'healthy' ? 'bg-emerald-500' : health === 'unreachable' ? 'bg-rose-500' : 'bg-slate-400'}`}></span>
					<span className="uppercase tracking-wide">{health}</span>
				</button>
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