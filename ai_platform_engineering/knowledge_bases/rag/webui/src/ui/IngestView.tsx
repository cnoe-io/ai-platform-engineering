import React, { useEffect, useMemo, useState, useCallback } from 'react'
import type { IngestionJob, DataSourceInfo, GraphConnectorInfo } from './Models'
import { 
	getDataSources, 
	getGraphConnectors, 
	getJobStatus, 
	ingestUrl, 
	deleteDataSource, 
	deleteGraphConnector, 
	reloadDataSource, 
	terminateJob 
} from '../api'

export default function IngestView() {
	// Ingestion state
	const [url, setUrl] = useState('')
	const [chunkSize, setChunkSize] = useState(10000)
	const [chunkOverlap, setChunkOverlap] = useState(2000)
	const [checkForSiteMap, setCheckForSiteMap] = useState(true)
	const [sitemapMaxUrls, setSitemapMaxUrls] = useState(2000)
	const [description, setDescription] = useState('')

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
			const job = await getJobStatus(jobId)
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
				const response = await getDataSources()
				const datasources = response.datasources
				setDataSources(datasources)

				if (jobIdToFind) {
					const sourceHasJobId = datasources.some((ds: DataSourceInfo) => ds.job_id === jobIdToFind)
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
			const connectors = await getGraphConnectors()
			setGraphConnectors(connectors)
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
			const response = await ingestUrl({
				url,
				default_chunk_size: chunkSize,
				default_chunk_overlap: chunkOverlap,
				check_for_site_map: checkForSiteMap,
				sitemap_max_urls: sitemapMaxUrls,
				description: description,
			})
			const { job_id } = response
			fetchDataSources(job_id)
			// Clear the form after successful ingestion
			setUrl('')
			setDescription('')
		} catch (error: any) {
			console.error('Error ingesting data:', error)
			alert(`❌ Ingestion failed: ${error?.response?.data?.detail || error?.message || 'unknown error'}`)
		}
	}

	const handleDeleteDataSource = async (datasourceId: string) => {
		try {
			await deleteDataSource(datasourceId)
			fetchDataSources() // Refresh the list
		} catch (error: any) {
			console.error('Error deleting data source:', error)
			alert(`Failed to delete data source: ${error?.message || 'unknown error'}`)
		}
		setShowDeleteDataSourceConfirm(null)
	}

	const handleDeleteGraphConnector = async (connectorId: string) => {
		try {
			await deleteGraphConnector(connectorId)
			fetchGraphConnectors() // Refresh the list
		} catch (error: any) {
			console.error('Error deleting graph connector:', error)
			alert(`Failed to delete graph connector: ${error?.message || 'unknown error'}`)
		}
		setShowDeleteConnectorConfirm(null)
	}

	const handleReloadDataSource = async (datasourceId: string) => {
		try {
			const response = await reloadDataSource(datasourceId)
			const { job_id } = response
			fetchDataSources(job_id)
			alert('🔄 Datasource submitted for reloading...')
		} catch (error: any) {
			console.error('Error reloading data source:', error)
			alert(`❌ Reload failed: ${error?.response?.data?.detail || error?.message || 'unknown error'}`)
		}
	}

	const handleTerminateJob = async (jobId: string) => {
		try {
			await terminateJob(jobId)
			pollDataSourceJob(jobId) // Immediately check the job status
			alert('⏹️ Job termination requested...')
		} catch (error: any) {
			console.error('Error terminating job:', error)
			alert(`❌ Termination failed: ${error?.response?.data?.detail || error?.message || 'unknown error'}`)
		}
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
						<button onClick={handleIngest} className="btn bg-brand-gradient hover:bg-brand-gradient-hover active:bg-brand-gradient-active text-white">
							Ingest
						</button>
					</div>
					<div className="mt-2 ml-2">
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={checkForSiteMap}
								onChange={(e) => setCheckForSiteMap(e.target.checked)}
								className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
							/>
							<span className="text-sm text-slate-600">Check for sitemap</span>
						</label>
					</div>
				</div>

				{/* Optional Configuration */}
				<details className="mb-4 rounded-lg bg-slate-50 p-4">
					<summary className="cursor-pointer text-sm font-semibold text-slate-700">Optional Configuration</summary>
					<div className="md:col-span-2">
							<label className="block text-sm font-medium text-slate-600 mb-1">
								Description
							</label>
							<textarea
								placeholder="A short description, this may help agents to glance at what this source is about"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								className="input bg-gray-50 text-gray-600 resize-none"
								rows={2}
							/>
					</div>
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
						{checkForSiteMap && (
							<div>
								<label className="block text-sm font-medium text-slate-600 mb-1">
									Sitemap Max URLs
								</label>
								<input
									type="number"
									min={0}
									placeholder="2000"
									value={sitemapMaxUrls}
									onChange={(e) => setSitemapMaxUrls(Number(e.target.value))}
									className="input bg-gray-50 text-gray-600"
								/>
								<p className="mt-1 text-xs text-slate-500">
									Maximum number of URLs to fetch from sitemap (0 = no limit)
								</p>
							</div>
						)}
						
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
									const jobFetched = !ds.job_id || job // No job ID means no job, or job has been fetched
									const isIngesting = job && job.status !== 'completed' && job.status !== 'completed_with_errors' && job.status !== 'failed' && job.status !== 'terminated'
									const progress = job && job.total > 0 ? (job.processed_counter / job.total) * 100 : 0

									return (
										<React.Fragment key={ds.datasource_id}>
											<tr className="bg-white border-b hover:bg-slate-100 cursor-pointer" onClick={() => toggleRow(ds.datasource_id)}>
												<td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap flex items-center gap-2" title={ds.datasource_id}>
													<span className="text-slate-400 font-mono text-sm select-none">
														{isExpanded ? '−' : '+'}
													</span>
													{ds.path}
												</td>
												<td className="px-4 py-3">{isIngesting ? '⏳' : ds.total_documents}</td>
												<td className="px-4 py-3">{new Date(ds.last_updated).toLocaleString()}</td>
												<td className="px-4 py-3">
													{jobFetched ? (
														<div className="flex gap-2">
															<button 
																onClick={(e) => { e.stopPropagation(); handleReloadDataSource(ds.datasource_id); }} 
																className="bg-orange-500 hover:bg-orange-700 text-white font-bold py-1 px-2 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
																disabled={isIngesting || false}
															>
																Reload
															</button>
															<button 
																onClick={(e) => { e.stopPropagation(); setShowDeleteDataSourceConfirm(ds.datasource_id); }} 
																className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
																disabled={isIngesting || false}
															>
																Delete
															</button>
														</div>
													) : (
														<div className="flex gap-2">
															<span className="text-xs text-slate-400">Loading...</span>
														</div>
													)}
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
																	<div><strong>Documents Processed:</strong> {job.processed_counter}</div>
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
																			<button
																				onClick={(e) => { e.stopPropagation(); handleTerminateJob(job.job_id); }}
																				className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs"
																				title="Stop this job"
																			>
																				Stop
																			</button>
																		</div>
																		<p className="text-xs text-slate-600">{job.message} ({job.processed_counter}/{job.total})</p>
																	</div>
																) : (
																	<p className={`text-xs ${
																		job.status === 'failed' ? 'text-red-600' : 
																		job.status === 'terminated' ? 'text-red-600' :
																		job.status === 'completed_with_errors' ? 'text-orange-600' : 
																		'text-green-600'
																	}`}>
																		{job.status === 'failed' ? `Failed${job.message ? ` - ${job.message}` : ''}` :
																		 job.status === 'completed_with_errors' ? `Completed with errors${job.message ? ` - ${job.message}` : ''}` :
																		 job.status === 'terminated' ? `Terminated${job.message ? ` - ${job.message}` : ''}` :
																		 'Completed'}
																	</p>
																)
															) : (
																<p className="text-xs text-slate-500">Pending</p>
															)}
														</div>
														{job && job.errors && job.errors.length > 0 && (
															<div className="mt-4">
																<details className="rounded-lg bg-red-50 p-3">
																	<summary className="cursor-pointer text-sm font-semibold text-red-700 hover:text-red-800">
																		Errors ({job.errors.length})
																	</summary>
																	<div className="mt-2 space-y-1">
																		{job.errors.map((error: string, index: number) => (
																			<div key={index} className="text-xs text-red-600 bg-red-100 p-2 rounded border-l-2 border-red-300">
																				{error}
																			</div>
																		))}
																	</div>
																</details>
															</div>
														)}
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
			<section className="card mb-6 p-5">
				{graphConnectors.length > 0 || loadingGraphConnectors ? (
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
							) : graphConnectors.length > 0 ? (
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
														<tr className="bg-white border-b hover:bg-slate-100 cursor-pointer text-xs" onClick={() => toggleGraphConnector(connector.connector_id)}>
															<td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap flex items-center gap-2" title={connector.connector_id}>
																<span className="text-slate-400 font-mono text-sm select-none">
																	{isExpanded ? '−' : '+'}
																</span>
																🔌 {connector.connector_id}
															</td>
															<td className="px-3 py-2">{connector.last_seen ? new Date(connector.last_seen).toLocaleString() : 'Never'}</td>
															<td className="px-3 py-2">
																<button onClick={(e) => { e.stopPropagation(); setShowDeleteConnectorConfirm(connector.connector_id); }} className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs">Delete</button>
															</td>
														</tr>
														{isExpanded && (
															<tr className="bg-slate-50">
																<td colSpan={3} className="p-3">
																	<div className="grid grid-cols-2 gap-3 text-xs">
																		<div><strong>ID:</strong> <span className="font-mono text-xs">{connector.connector_id}</span></div>
																		<div><strong>Name:</strong> {connector.connector_id}</div>
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
							) : (
								<p className="text-slate-500 text-xs">No graph connectors found.</p>
							)}
						</div>
					</details>
				) : (
					<div>
						<div className="flex items-center justify-between mb-3">
							<h3 className="text-base font-semibold text-slate-900">Graph Connectors</h3>
							<button onClick={() => fetchGraphConnectors()} disabled={loadingGraphConnectors} className="btn-secondary">
								{loadingGraphConnectors ? 'Refreshing...' : 'Refresh'}
							</button>
						</div>
						<p className="text-slate-500">No graph connectors found. You can import graph entities using connectors.</p>
					</div>
				)}
			</section>

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