import React, { useEffect, useMemo, useState, useCallback } from 'react'
import axios from 'axios'
import type { IngestionJob, DataSourceInfo, GraphConnectorInfo } from './Models'

const apiBase = import.meta.env.VITE_API_BASE?.toString() || ''

export default function IngestView() {
	// Ingestion state
	const [url, setUrl] = useState('')
	const [chunkSize, setChunkSize] = useState(10000)
	const [chunkOverlap, setChunkOverlap] = useState(2000)

	// DataSources state
	const [dataSources, setDataSources] = useState<DataSourceInfo[]>([])
	const [loadingDataSources, setLoadingDataSources] = useState(true)
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
	const [dataSourceJobs, setDataSourceJobs] = useState<Record<string, IngestionJob>>({})
	const [retryCounts, setRetryCounts] = useState<Record<string, number>>({})

	// GraphConnectors state
	const [graphConnectors, setGraphConnectors] = useState<GraphConnectorInfo[]>([])
	const [loadingGraphConnectors, setLoadingGraphConnectors] = useState(false)
	const [expandedGraphConnectors, setExpandedGraphConnectors] = useState<Set<string>>(new Set())

	// Confirmation dialogs state
	const [showDeleteDataSourceConfirm, setShowDeleteDataSourceConfirm] = useState<string | null>(null)
	const [showDeleteConnectorConfirm, setShowDeleteConnectorConfirm] = useState<string | null>(null)

	const api = useMemo(() => axios.create({ baseURL: apiBase || undefined }), [])

	useEffect(() => {
		fetchDataSources()
		fetchGraphConnectors()
	}, [])

	useEffect(() => {
		// Poll for active job statuses
		const interval = setInterval(() => {
			dataSources.forEach(ds => {
				if (ds.job_id) {
					const job = dataSourceJobs[ds.job_id]
					if (!job || (job.status !== 'completed' && job.status !== 'failed')) {
						pollDataSourceJob(ds.job_id)
					}
				}
			})
		}, 2000) // Poll every 2 seconds

		return () => clearInterval(interval)
	}, [dataSources, dataSourceJobs])

	useEffect(() => {
		// Handle race condition where job completes but document count is not yet updated
		dataSources.forEach(ds => {
			if (ds.job_id) {
				const job = dataSourceJobs[ds.job_id]
				const currentRetryCount = retryCounts[ds.job_id] || 0
				if (job && job.status === 'completed' && ds.total_documents === 0 && currentRetryCount < 3) {
					// If job is complete but document count is 0, there might be a delay. Fetch again.
					fetchDataSources()
					setRetryCounts(prev => ({ ...prev, [ds.job_id!]: currentRetryCount + 1 }))
				}
			}
		})
	}, [dataSourceJobs, dataSources, retryCounts]) // Reruns whenever job statuses are updated

	const pollDataSourceJob = async (jobId: string) => {
		try {
			const res = await api.get(`/v1/job/${jobId}`)
			const job = res.data as IngestionJob
			setDataSourceJobs(prevJobs => ({ ...prevJobs, [jobId]: job }))
		} catch (error) {
			console.error(`Error polling job status for ${jobId}:`, error)
		}
	}

	const fetchDataSources = async (jobIdToFind?: string) => {
		setLoadingDataSources(true)
		try {
			let attempt = 0
			const maxAttempts = 3
			const delay = 1000 // 1 second

			while (attempt < maxAttempts) {
				const response = await api.get<{ datasources: DataSourceInfo[] }>('/v1/datasources')
				const datasources = response.data.datasources
				setDataSources(datasources)

				if (jobIdToFind) {
					const sourceHasJobId = datasources.some(ds => ds.job_id === jobIdToFind)
					if (sourceHasJobId) {
						break // Found the job_id, exit loop
					} else {
						attempt++
						if (attempt < maxAttempts) {
							await new Promise(resolve => setTimeout(resolve, delay))
						} else {
							console.warn(`Could not find datasource with job_id ${jobIdToFind} after ${maxAttempts} attempts.`)
						}
					}
				} else {
					break // Not looking for a specific job, so exit
				}
			}
		} catch (error) {
			console.error('Failed to fetch data sources', error)
		} finally {
			setLoadingDataSources(false)
		}
	}

	const fetchGraphConnectors = async () => {
		setLoadingGraphConnectors(true)
		try {
			const response = await api.get<GraphConnectorInfo[]>('/v1/graph/connectors')
			setGraphConnectors(response.data)
		} catch (error) {
			console.error('Failed to fetch graph connectors', error)
		} finally {
			setLoadingGraphConnectors(false)
		}
	}

	const toggleRow = (datasourceId: string) => {
		setExpandedRows(prev => {
			const newSet = new Set(prev)
			if (newSet.has(datasourceId)) {
				newSet.delete(datasourceId)
			} else {
				newSet.add(datasourceId)
			}
			return newSet
		})
	}

	const toggleGraphConnector = (connectorId: string) => {
		setExpandedGraphConnectors(prev => {
			const newSet = new Set(prev)
			if (newSet.has(connectorId)) {
				newSet.delete(connectorId)
			} else {
				newSet.add(connectorId)
			}
			return newSet
		})
	}



	const handleIngest = async () => {
		if (!url) return
		
		try {
			const response = await api.post('/v1/datasource/ingest/url', {
				url,
				default_chunk_size: chunkSize,
				default_chunk_overlap: chunkOverlap,
			})
			const { job_id } = response.data
			fetchDataSources(job_id)
		} catch (error: any) {
			console.error('Error ingesting data:', error)
			alert(`❌ Ingestion failed: ${error?.response?.data?.detail || error?.message || 'unknown error'}`)
		}
	}

	const handleDeleteDataSource = async (datasourceId: string) => {
		try {
			await api.delete(`/v1/datasource/delete?datasource_id=${datasourceId}`)
			fetchDataSources() // Refresh the list
		} catch (error: any) {
			console.error('Error deleting data source:', error)
			alert(`Failed to delete data source: ${error?.message || 'unknown error'}`)
		}
		setShowDeleteDataSourceConfirm(null)
	}

	const handleDeleteGraphConnector = async (connectorId: string) => {
		try {
			await api.delete(`/v1/graph/connector/${connectorId}`)
			fetchGraphConnectors() // Refresh the list
		} catch (error: any) {
			console.error('Error deleting graph connector:', error)
			alert(`Failed to delete graph connector: ${error?.message || 'unknown error'}`)
		}
		setShowDeleteConnectorConfirm(null)
	}

	return (
		<div>
			{/* Ingest URL Section */}
			<section className="card mb-6 p-5">
				<h3 className="mb-4 text-lg font-semibold text-slate-900">Ingest URL</h3>
				
				{/* URL Input */}
				<div className="mb-4">
					<label className="block text-sm font-medium text-slate-700 mb-2">
						URL *
					</label>
					<div className="flex gap-2">
						<input
							type="url"
							placeholder="https://docs.example.com"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							className="input flex-1"
						/>
						<button onClick={handleIngest} className="btn">
							Ingest
						</button>
					</div>
				</div>

				{/* Optional Configuration */}
				<details className="mb-4 rounded-lg bg-slate-50 p-4">
					<summary className="cursor-pointer text-sm font-semibold text-slate-700">Optional Configuration</summary>
					<div className="grid gap-4 md:grid-cols-2 mt-3">
						<div>
							<label className="block text-sm font-medium text-slate-600 mb-1">
								Chunk Size
							</label>
							<input
								type="number"
								min={100}
								max={50000}
								placeholder="10000"
								value={chunkSize}
								onChange={(e) => setChunkSize(Number(e.target.value))}
								className="input bg-gray-50 text-gray-600"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-slate-600 mb-1">
								Chunk Overlap
							</label>
							<input
								type="number"
								min={0}
								max={5000}
								placeholder="2000"
								value={chunkOverlap}
								onChange={(e) => setChunkOverlap(Number(e.target.value))}
								className="input bg-gray-50 text-gray-600"
							/>
						</div>
					</div>
					<p className="mt-2 text-xs text-slate-500">
						Custom values will be saved for this source URL.
					</p>
				</details>
			</section>

			{/* Data Sources Section */}
			<section className="card mb-6 p-5">
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-lg font-semibold text-slate-900">Data Sources</h3>
					<button onClick={() => fetchDataSources()} disabled={loadingDataSources} className="btn-secondary">
						{loadingDataSources ? 'Refreshing...' : 'Refresh'}
					</button>
				</div>
				
				{loadingDataSources ? (
					<p className="text-slate-500">Loading data sources...</p>
				) : dataSources.filter(ds => ds.source_type !== 'graph_connector').length === 0 ? (
					<p className="text-slate-500">No data sources found. Ingest a URL above to get started.</p>
				) : (
					<div className="overflow-x-auto max-h-180 overflow-y-auto">
						<table className="min-w-full text-sm text-left text-slate-500">
							<thead className="text-xs text-slate-700 uppercase bg-slate-50">
								<tr>
									<th scope="col" className="px-4 py-3">Path</th>
									<th scope="col" className="px-4 py-3">Documents</th>
									<th scope="col" className="px-4 py-3">Last Updated</th>
									<th scope="col" className="px-4 py-3">Actions</th>
								</tr>
							</thead>
							<tbody>
								{dataSources.filter(ds => ds.source_type !== 'graph_connector').map(ds => {
									const isExpanded = expandedRows.has(ds.datasource_id)
									const job = ds.job_id ? dataSourceJobs[ds.job_id] : null
									const isIngesting = job && job.status !== 'completed' && job.status !== 'failed'
									const progress = job && job.total > 0 ? (job.completed_counter / job.total) * 100 : 0

									return (
										<React.Fragment key={ds.datasource_id}>
											<tr className="bg-white border-b hover:bg-slate-50 cursor-pointer" onClick={() => toggleRow(ds.datasource_id)}>
												<td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap" title={ds.datasource_id}>
													{ds.path}
												</td>
												<td className="px-4 py-3">{isIngesting ? '⏳' : ds.total_documents}</td>
												<td className="px-4 py-3">{new Date(ds.last_updated).toLocaleString()}</td>
												<td className="px-4 py-3">
													<button onClick={(e) => { e.stopPropagation(); setShowDeleteDataSourceConfirm(ds.datasource_id); }} className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs">Delete</button>
												</td>
											</tr>
											{isExpanded && (
												<tr className="bg-slate-50">
													<td colSpan={4} className="p-4">
														<div className="grid grid-cols-2 gap-4 text-sm">
															<div><strong>ID:</strong> <span className="font-mono text-xs">{ds.datasource_id}</span></div>
															<div><strong>Type:</strong> {ds.source_type}</div>
															<div><strong>Default Chunk Size:</strong> {ds.default_chunk_size}</div>
															<div><strong>Default Chunk Overlap:</strong> {ds.default_chunk_overlap}</div>
															<div><strong>Created:</strong> {new Date(ds.created_at).toLocaleString()}</div>
															<div><strong>Job ID:</strong> {ds.job_id}</div>
															{job && (
																<>
																	<div><strong>Documents Processed:</strong> {job.completed_counter}</div>
																	<div><strong>Documents Failed:</strong> {job.failed_counter}</div>
																</>
															)}
															{ds.description && <div className="col-span-2"><strong>Description:</strong> {ds.description}</div>}
														</div>
														<div className="mt-4">
															<h5 className="text-sm font-semibold mb-2">Ingestion Status</h5>
															{job ? (
																isIngesting ? (
																	<div className="space-y-2">
																		<div className="flex items-center gap-2">
																			<div className="w-full bg-slate-200 rounded-full h-2">
																				<div className="bg-blue-500 h-2 rounded-full" style={{ width: `${progress}%` }}></div>
																			</div>
																			<span className="text-xs font-medium text-slate-600">{Math.round(progress)}%</span>
																		</div>
																		<p className="text-xs text-slate-600">{job.message} ({job.completed_counter}/{job.total})</p>
																	</div>
																) : (
																	<p className={`text-xs ${job.status === 'failed' ? 'text-red-600' : 'text-green-600'}`}>
																		{job.status === 'failed' ? `Failed - ${job.error}` : 'Completed'}
																	</p>
																)
															) : (
																<p className="text-xs text-slate-500">Pending</p>
															)}
														</div>
													</td>
												</tr>
											)}
										</React.Fragment>
									)
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>
			



			{/* Graph Connectors Section */}
			{graphConnectors.length > 0 ? (
				<section className="card mb-6 p-5">
					<details className="group">
						<summary className="cursor-pointer text-base font-semibold text-slate-900 hover:text-slate-700 flex items-center justify-between">
							<span>Graph Connectors ({graphConnectors.length})</span>
							<span className="text-xs text-slate-500 group-open:rotate-180 transition-transform">▼</span>
						</summary>
						<div className="mt-4">
							<div className="flex items-center justify-end mb-4">
								<button onClick={() => fetchGraphConnectors()} disabled={loadingGraphConnectors} className="btn-secondary">
									{loadingGraphConnectors ? 'Refreshing...' : 'Refresh'}
								</button>
							</div>
							{loadingGraphConnectors ? (
								<p className="text-slate-500 text-xs">Loading graph connectors...</p>
							) : (
								<div className="overflow-x-auto max-h-96 overflow-y-auto">
									<table className="min-w-full text-xs text-left text-slate-500">
										<thead className="text-xs text-slate-600 uppercase bg-slate-25">
											<tr>
												<th scope="col" className="px-3 py-2">Connector</th>
												<th scope="col" className="px-3 py-2">Last Seen</th>
												<th scope="col" className="px-3 py-2">Actions</th>
											</tr>
										</thead>
										<tbody>
											{graphConnectors.map(connector => {
												const isExpanded = expandedGraphConnectors.has(connector.connector_id)

												return (
													<React.Fragment key={connector.connector_id}>
														<tr className="bg-white border-b hover:bg-slate-25 cursor-pointer text-xs" onClick={() => toggleGraphConnector(connector.connector_id)}>
															<td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap" title={connector.connector_id}>
																{connector.name}
															</td>
															<td className="px-3 py-2">{connector.last_seen ? new Date(connector.last_seen).toLocaleString() : 'Never'}</td>
															<td className="px-3 py-2">
																<button onClick={(e) => { e.stopPropagation(); setShowDeleteConnectorConfirm(connector.connector_id); }} className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs">Delete</button>
															</td>
														</tr>
														{isExpanded && (
															<tr className="bg-slate-25">
																<td colSpan={3} className="p-3">
																	<div className="grid grid-cols-2 gap-3 text-xs">
																		<div><strong>ID:</strong> <span className="font-mono text-xs">{connector.connector_id}</span></div>
																		<div><strong>Name:</strong> {connector.name}</div>
																		<div><strong>Last Seen:</strong> {connector.last_seen ? new Date(connector.last_seen).toLocaleString() : 'Never'}</div>
																		{connector.description && <div className="col-span-2"><strong>Description:</strong> {connector.description}</div>}
																	</div>
																</td>
															</tr>
														)}
													</React.Fragment>
												)
											})}
										</tbody>
									</table>
								</div>
							)}
						</div>
					</details>
				</section>
			) : !loadingGraphConnectors && (
				<section className="card mb-6 p-5">
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-base font-semibold text-slate-900">Graph Connectors</h3>
						<button onClick={() => fetchGraphConnectors()} disabled={loadingGraphConnectors} className="btn-secondary">
							{loadingGraphConnectors ? 'Refreshing...' : 'Refresh'}
						</button>
					</div>
					<p className="text-slate-500">No graph connectors found. You can import graph entities using connectors.</p>
				</section>
			)}

			{/* Delete Data Source Confirmation Dialog */}
			{showDeleteDataSourceConfirm && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
						<h3 className="text-lg font-bold text-gray-900 mb-4">Delete Data Source</h3>
						<p className="text-gray-600 mb-6">
							Are you sure you want to delete this data source? This will permanently remove all associated documents and data. This action cannot be undone.
						</p>
						<div className="flex justify-end gap-3">
							<button
								onClick={() => setShowDeleteDataSourceConfirm(null)}
								className="btn bg-gray-500 hover:bg-gray-600 text-white">
								Cancel
							</button>
							<button
								onClick={() => handleDeleteDataSource(showDeleteDataSourceConfirm)}
								className="btn bg-red-500 hover:bg-red-600 text-white">
								Delete Data Source
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Delete Graph Connector Confirmation Dialog */}
			{showDeleteConnectorConfirm && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
						<h3 className="text-lg font-bold text-gray-900 mb-4">Delete Graph Connector</h3>
						<p className="text-gray-600 mb-6">
							Are you sure you want to delete this graph connector? This will permanently remove all associated graph entities and data. This action cannot be undone.
						</p>
						<div className="flex justify-end gap-3">
							<button
								onClick={() => setShowDeleteConnectorConfirm(null)}
								className="btn bg-gray-500 hover:bg-gray-600 text-white">
								Cancel
							</button>
							<button
								onClick={() => handleDeleteGraphConnector(showDeleteConnectorConfirm)}
								className="btn bg-red-500 hover:bg-red-600 text-white">
								Delete Connector
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}