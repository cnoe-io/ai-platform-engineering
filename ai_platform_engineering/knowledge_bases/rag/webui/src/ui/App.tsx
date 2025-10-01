import React, { useState, useMemo, useEffect } from 'react'
import axios from 'axios'
import logo from '../assets/logo.svg'
import IngestView from './IngestView'
import ExploreView from './ExploreView'

const apiBase = import.meta.env.VITE_API_BASE?.toString() || ''

export default function App() {
	const [activeTab, setActiveTab] = useState('ingest')
	const [health, setHealth] = useState<string>('unknown')
	const [healthData, setHealthData] = useState<Record<string, unknown> | null>(null)

	const baseInfo = useMemo(() => (apiBase ? `Proxy disabled -> ${apiBase}` : 'Proxy: /v1 → :9446'), [])
	const api = useMemo(() => axios.create({ baseURL: apiBase || undefined }), [])

	useEffect(() => {
		const checkHealth = () => {
			api
				.get('/healthz')
				.then((res) => {
					setHealth('healthy')
					setHealthData(res.data)
				})
				.catch((err) => {
					console.warn('Health check failed', err)
					setHealth('unreachable')
				})
		}

		checkHealth() // Initial check
		const intervalId = setInterval(checkHealth, 10000) // Poll every 10 seconds

		return () => {
			clearInterval(intervalId)
		}
	}, [api])

	return (
		<div className="mx-auto max-w-7xl px-4 py-8 font-[Inter,system-ui,Arial,sans-serif]">
			<header className="mb-8 flex items-center justify-between">
				<div className="flex items-center gap-4">
					<img src={logo} alt="Logo" className="h-10" />
					<div>
						<h1 className="text-2xl font-semibold tracking-tight text-slate-900"><b>CAIPE ingest</b></h1>
						<p className="mt-1 text-sm text-slate-600">Backend: {baseInfo}</p>
					</div>
				</div>
				<div className="badge">
					<span className={`h-2 w-2 rounded-full ${health === 'healthy' ? 'bg-emerald-500' : health === 'unreachable' ? 'bg-rose-500' : 'bg-slate-400'}`}></span>
					<span className="uppercase tracking-wide">{health}</span>
				</div>
			</header>

			<div className="mb-6 border-b border-slate-200">
				<nav className="-mb-px flex gap-6" aria-label="Tabs">
					<button
						onClick={() => setActiveTab('ingest')}
						className={`shrink-0 border-b-2 px-1 pb-4 text-lg font-medium ${
							activeTab === 'ingest'
								? 'border-sky-500 text-sky-600'
								: 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
						}`}>
						🗃️ Ingest
					</button>
					<button
						onClick={() => setActiveTab('explore')}
						className={`shrink-0 border-b-2 px-1 pb-4 text-lg font-medium ${
							activeTab === 'explore'
								? 'border-sky-500 text-sky-600'
								: 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
						}`}>
						🔍︎ Explore
					</button>
				</nav>
			</div>

			{activeTab === 'ingest' && <IngestView />}
			{activeTab === 'explore' && <ExploreView />}

			{healthData && (
				<details className="mt-6">
					<summary className="cursor-pointer select-none text-sm text-slate-700">Health payload</summary>
					<pre className="whitespace-pre-wrap rounded-md bg-slate-900/95 p-4 text-xs leading-relaxed text-slate-100 shadow-lg">{JSON.stringify(healthData, null, 2)}</pre>
				</details>
			)}
		</div>
	)
}