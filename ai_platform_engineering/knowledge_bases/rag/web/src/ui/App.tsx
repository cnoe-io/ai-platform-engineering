import React, { useEffect, useMemo, useState, useCallback } from 'react'
import axios from 'axios'

type QueryResponse = {
	query: string
	results: Array<{
		page_content?: string
		metadata?: Record<string, unknown>
	}>
}

type IngestionJob = {
	job_id: string
	status: 'pending' | 'in_progress' | 'completed' | 'failed'
	progress: {
		message: string
		processed: number
		total: number
	}
	created_at: string
	completed_at?: string
	error?: string
}

type IngestResponse = {
	job_id: string
	status: string
	message: string
}

const apiBase = import.meta.env.VITE_API_BASE?.toString() || ''

export default function App() {
	const [health, setHealth] = useState<string>('unknown')
	const [healthData, setHealthData] = useState<Record<string, unknown> | null>(null)
	const [url, setUrl] = useState('')
	const [currentJob, setCurrentJob] = useState<IngestionJob | null>(null)
	const [ingestionResults, setIngestionResults] = useState<string>('')
	const [query, setQuery] = useState('')
	const [limit, setLimit] = useState(3)
	const [similarity, setSimilarity] = useState(0.7)
	const [results, setResults] = useState<QueryResponse | null>(null)
	const [loadingQuery, setLoadingQuery] = useState(false)
	const [clearing, setClearing] = useState(false)
	const baseInfo = useMemo(() => (apiBase ? `Proxy disabled -> ${apiBase}` : 'Proxy: /v1 → :9446'), [])
	const api = useMemo(() => axios.create({ baseURL: apiBase || undefined }), [])

	const pollJobStatus = useCallback(async (jobId: string) => {
		try {
			const response = await api.get<IngestionJob>(`/v1/datasource/ingest/status/${jobId}`)
			const job = response.data
			setCurrentJob(job)

			// Continue polling if job is still running
			if (job.status === 'pending' || job.status === 'in_progress') {
				setTimeout(() => pollJobStatus(jobId), 2000) // Poll every 2 seconds
			} else {
				// Job completed - set final result message
				if (job.status === 'completed') {
					setIngestionResults(`✅ Successfully processed ${job.progress.total} URL(s)`)
				} else if (job.status === 'failed') {
					setIngestionResults(`❌ Failed: ${job.error || 'Unknown error'}`)
				}
			}
		} catch (error: any) {
			console.error('Error polling job status:', error)
			setIngestionResults(`❌ Error checking status: ${error?.message || 'unknown error'}`)
			setCurrentJob(null)
		}
	}, [api])

	useEffect(() => {
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
	}, [])

	const handleIngest = async () => {
		if (!url) return
		
		// Clear previous results
		setCurrentJob(null)
		setIngestionResults('')
		
		try {
			const response = await api.post<IngestResponse>('/v1/datasource/ingest/url', { url })
			const { job_id } = response.data
			
			// Start polling for job status
			pollJobStatus(job_id)
		} catch (e: any) {
			setIngestionResults(`❌ Failed to start ingestion: ${e?.message || 'unknown error'}`)
		}
	}

	const handleQuery = async () => {
		if (!query) return
		setLoadingQuery(true)
		try {
			const { data } = await api.post<QueryResponse>('/v1/query', {
				query,
				limit,
				similarity_threshold: similarity,
			})
			setResults(data)
		} catch (e: any) {
			alert(`Query failed: ${e?.message || 'unknown error'}`)
		} finally {
			setLoadingQuery(false)
		}
	}

	const handleClear = async () => {
		setClearing(true)
		try {
			await api.post('/v1/datasource/clear_all')
			setResults(null)
			setIngestionResults('')
			alert('Cleared all data')
		} catch (e: any) {
			alert(`Failed to clear: ${e?.message || 'unknown error'}`)
		} finally {
			setClearing(false)
		}
	}

	const getProgressPercentage = () => {
		if (!currentJob?.progress || currentJob.progress.total === 0) return 0
		return Math.round((currentJob.progress.processed / currentJob.progress.total) * 100)
	}

	const isIngesting = currentJob?.status === 'pending' || currentJob?.status === 'in_progress'

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 font-[Inter,system-ui,Arial,sans-serif]">
			<header className="mb-8 flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-slate-900">KB RAG</h1>
					<p className="mt-1 text-sm text-slate-600">Backend: {baseInfo}</p>
				</div>
				<div className="badge">
					<span className={`h-2 w-2 rounded-full ${health === 'healthy' ? 'bg-emerald-500' : health === 'unreachable' ? 'bg-rose-500' : 'bg-slate-400'}`}></span>
					<span className="uppercase tracking-wide">{health}</span>
				</div>
			</header>

			<div className="grid gap-6 md:grid-cols-2">
				<section className="card p-5">
					<h3 className="mb-3 text-base font-semibold text-slate-900">Ingest URL</h3>
					<div className="flex gap-2">
						<input
							type="url"
							placeholder="https://docs.example.com"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							className="input"
						/>
						<button onClick={handleIngest} disabled={!url || isIngesting} className="btn">
							{isIngesting ? 'Processing…' : 'Ingest'}
						</button>
					</div>
					
					{/* Progress Display */}
					{isIngesting && currentJob && (
						<div className="mt-4 space-y-2">
							<div className="flex items-center justify-between text-sm">
								<span className="text-slate-600">Progress</span>
								<span className="font-medium">{getProgressPercentage()}%</span>
							</div>
							<div className="w-full bg-slate-200 rounded-full h-2">
								<div 
									className="bg-blue-500 h-2 rounded-full transition-all duration-300"
									style={{ width: `${getProgressPercentage()}%` }}
								></div>
							</div>
							<p className="text-sm text-slate-600">{currentJob.progress.message}</p>
							{currentJob.progress.total > 0 && (
								<p className="text-xs text-slate-500">
									{currentJob.progress.processed} / {currentJob.progress.total} URLs processed
								</p>
							)}
						</div>
					)}
					
					{/* Results Display */}
					{ingestionResults && (
						<div className="mt-4 p-3 rounded-lg bg-slate-50 border">
							<p className="text-sm">{ingestionResults}</p>
						</div>
					)}
					
					<p className="mt-2 text-xs text-slate-500">
						{isIngesting ? 'Processing in progress...' : 'Enter a URL to start ingestion.'}
					</p>
				</section>

				<section className="card p-5 md:col-span-1">
					<h3 className="mb-3 text-base font-semibold text-slate-900">Query</h3>
					<div className="mb-3 flex gap-2">
						<input
							type="text"
							placeholder="Ask something"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="input"
						/>
						<button onClick={handleQuery} disabled={!query || loadingQuery} className="btn">
							{loadingQuery ? 'Searching…' : 'Search'}
						</button>
					</div>
					<div className="flex items-center gap-4">
						<label className="text-sm text-slate-700">
							Limit
							<input
								type="number"
								min={1}
								max={100}
								value={limit}
								onChange={(e) => setLimit(Number(e.target.value))}
								className="ml-2 w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
							/>
						</label>
						<label className="text-sm text-slate-700">
							Similarity
							<input
								type="number"
								step={0.05}
								min={0}
								max={1}
								value={similarity}
								onChange={(e) => setSimilarity(Number(e.target.value))}
								className="ml-2 w-28 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
							/>
						</label>
						<button onClick={handleClear} disabled={clearing} className="ml-auto btn-secondary">
							{clearing ? 'Clearing…' : 'Clear All'}
						</button>
					</div>
				</section>
			</div>

			<section className="card mt-6 p-5">
				<h3 className="mb-3 text-base font-semibold text-slate-900">Results</h3>
				{!results && <div className="text-slate-500">No results yet</div>}
				{results && (
					<div>
						<div className="mb-3 text-sm text-slate-600">Query: {results.query}</div>
						<ul className="grid list-none gap-3 p-0">
							{results.results.map((r, i) => (
								<li key={i} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
									<pre className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{String(r.page_content || '')}</pre>
									{r.metadata && (
										<details className="mt-2">
											<summary className="cursor-pointer select-none text-sm text-slate-700">Metadata</summary>
											<pre className="whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(r.metadata, null, 2)}</pre>
										</details>
									)}
								</li>
							))}
						</ul>
					</div>
				)}
			</section>

			{healthData && (
				<details className="mt-6">
					<summary className="cursor-pointer select-none text-sm text-slate-700">Health payload</summary>
					<pre className="whitespace-pre-wrap rounded-md bg-slate-900/95 p-4 text-xs leading-relaxed text-slate-100 shadow-lg">{JSON.stringify(healthData, null, 2)}</pre>
				</details>
			)}
		</div>
	)
} 