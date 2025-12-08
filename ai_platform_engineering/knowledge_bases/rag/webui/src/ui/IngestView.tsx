import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { formatDistanceToNow } from 'date-fns'
import type { IngestionJob, DataSourceInfo, IngestorInfo } from './Models'
import { 
  getDataSources, 
  getIngestors, 
  getJobStatus, 
  getJobsByDataSource,
  ingestUrl, 
  deleteDataSource, 
  deleteIngestor,
  reloadDataSource, 
  terminateJob,
  WEBLOADER_INGESTOR_ID
} from '../api'

export default function IngestView() {
  // Ingestion state
  const [url, setUrl] = useState('')
  const [checkForSiteMap, setCheckForSiteMap] = useState(true)
  const [sitemapMaxUrls, setSitemapMaxUrls] = useState(2000)
  const [description, setDescription] = useState('')

  // DataSources state
  const [dataSources, setDataSources] = useState<DataSourceInfo[]>([])
  const [loadingDataSources, setLoadingDataSources] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [dataSourceJobs, setDataSourceJobs] = useState<Record<string, IngestionJob[]>>({})
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set())
  const [selectedSourceType, setSelectedSourceType] = useState<string>('all')

  // Ingestors state
  const [ingestors, setIngestors] = useState<IngestorInfo[]>([])
  const [loadingIngestors, setLoadingIngestors] = useState(false)
  const [expandedIngestors, setExpandedIngestors] = useState<Set<string>>(new Set())

  // Confirmation dialogs state
  const [showDeleteDataSourceConfirm, setShowDeleteDataSourceConfirm] = useState<string | null>(null)
  const [showDeleteIngestorConfirm, setShowDeleteIngestorConfirm] = useState<string | null>(null)

  // Utility function to format status strings
  const formatStatus = (status: string): string => {
    return status
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  // Utility function to format timestamps as relative time
  const formatRelativeTime = (timestamp: number): string => {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true })
  }

  // Get unique source types from dataSources
  const sourceTypes = useMemo(() => {
    const types = new Set(dataSources.map(ds => ds.source_type))
    return Array.from(types).sort()
  }, [dataSources])

  // Filter dataSources by selected type
  const filteredDataSources = useMemo(() => {
    if (selectedSourceType === 'all') {
      return dataSources
    }
    return dataSources.filter(ds => ds.source_type === selectedSourceType)
  }, [dataSources, selectedSourceType])


  useEffect(() => {
    fetchDataSources()
    fetchIngestors()
  }, [])

  useEffect(() => {
    // Fetch jobs for each datasource
    const fetchAllJobs = async () => {
      for (const ds of dataSources) {
        await fetchJobsForDataSource(ds.datasource_id)
      }
    }
    if (dataSources.length > 0) {
      fetchAllJobs()
    }
  }, [dataSources])

  useEffect(() => {
    // Poll for active job statuses every 2 seconds
    const interval = setInterval(() => {
      Object.entries(dataSourceJobs).forEach(([datasourceId, jobs]) => {
        jobs.forEach(job => {
          if (job.status === 'in_progress' || job.status === 'pending') {
            pollJob(datasourceId, job.job_id)
          }
        })
      })
    }, 2000)

    return () => clearInterval(interval)
  }, [dataSourceJobs])

  const fetchJobsForDataSource = async (datasourceId: string) => {
    try {
      const jobs = await getJobsByDataSource(datasourceId)
      // Sort by created_at descending (most recent first)
      const sortedJobs = jobs.sort((a, b) => {
        const timeA = new Date(a.created_at).getTime()
        const timeB = new Date(b.created_at).getTime()
        return timeB - timeA
      })
      setDataSourceJobs(prev => ({ ...prev, [datasourceId]: sortedJobs }))
    } catch (error) {
      console.error(`Failed to fetch jobs for datasource ${datasourceId}:`, error)
    }
  }

  const pollJob = async (datasourceId: string, jobId: string) => {
    try {
      const job = await getJobStatus(jobId)
      setDataSourceJobs(prev => {
        const jobs = prev[datasourceId] || []
        const updatedJobs = jobs.map(j => j.job_id === jobId ? job : j)
        return { ...prev, [datasourceId]: updatedJobs }
      })
    } catch (error) {
      console.error(`Error polling job status for ${jobId}:`, error)
    }
  }

  const fetchDataSources = async () => {
    setLoadingDataSources(true)
    try {
      const response = await getDataSources()
      const datasources = response.datasources
      setDataSources(datasources)
    } catch (error) {
      console.error('Failed to fetch data sources', error)
    } finally {
      setLoadingDataSources(false)
    }
  }

  const fetchIngestors = async () => {
    setLoadingIngestors(true)
    try {
      const ingestorList = await getIngestors()
      setIngestors(ingestorList)
    } catch (error) {
      console.error('Failed to fetch ingestors', error)
    } finally {
      setLoadingIngestors(false)
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

  const toggleJob = (jobId: string) => {
    setExpandedJobs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(jobId)) {
        newSet.delete(jobId)
      } else {
        newSet.add(jobId)
      }
      return newSet
    })
  }

  const toggleIngestor = (ingestorId: string) => {
    setExpandedIngestors(prev => {
      const newSet = new Set(prev)
      if (newSet.has(ingestorId)) {
        newSet.delete(ingestorId)
      } else {
        newSet.add(ingestorId)
      }
      return newSet
    })
  }

  const handleIngest = async () => {
    if (!url) return
    
    try {
      const response = await ingestUrl({
        url,
        check_for_sitemaps: checkForSiteMap,
        sitemap_max_urls: sitemapMaxUrls,
        description: description,
      })
      const { datasource_id, job_id, message } = response
      alert(`✅ ${message}`)
      await fetchDataSources()
      await fetchJobsForDataSource(datasource_id)
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

  const handleDeleteIngestor = async (ingestorId: string) => {
    try {
      await deleteIngestor(ingestorId)
      fetchIngestors() // Refresh the list
      alert('✅ Ingestor deleted successfully')
    } catch (error: any) {
      console.error('Error deleting ingestor:', error)
      alert(`❌ Failed to delete ingestor: ${error?.message || 'unknown error'}`)
    }
    setShowDeleteIngestorConfirm(null)
  }



  const handleReloadDataSource = async (datasourceId: string) => {
    try {
      const response = await reloadDataSource(datasourceId)
      const { message } = response
      alert(`🔄 ${message}`)
      await fetchDataSources()
      await fetchJobsForDataSource(datasourceId)
    } catch (error: any) {
      console.error('Error reloading data source:', error)
      alert(`❌ Reload failed: ${error?.response?.data?.detail || error?.message || 'unknown error'}`)
    }
  }

  const handleTerminateJob = async (datasourceId: string, jobId: string) => {
    try {
      await terminateJob(jobId)
      await pollJob(datasourceId, jobId) // Immediately check the job status
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
        </details>
      </section>

      {/* Data Sources Section */}
      <section className="card mb-6 p-5">
        <details className="group" open>
          <summary className="cursor-pointer text-base font-semibold text-slate-900 hover:text-slate-700 flex items-center justify-between mb-4">
            <span>Data Sources ({dataSources.length})</span>
            <div className="flex items-center gap-3">
              <button onClick={(e) => { e.stopPropagation(); fetchDataSources(); }} disabled={loadingDataSources} className="btn-secondary">
                {loadingDataSources ? 'Refreshing...' : 'Refresh'}
              </button>
              <span className="text-xs text-slate-500 group-open:rotate-180 transition-transform">▼</span>
            </div>
          </summary>
        
        {/* Filter Buttons */}
        {sourceTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setSelectedSourceType('all')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                selectedSourceType === 'all'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All ({dataSources.length})
            </button>
            {sourceTypes.map(type => {
              const count = dataSources.filter(ds => ds.source_type === type).length
              return (
                <button
                  key={type}
                  onClick={() => setSelectedSourceType(type)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    selectedSourceType === type
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {type} ({count})
                </button>
              )
            })}
          </div>
        )}
        
        {loadingDataSources ? (
          <p className="text-slate-500">Loading data sources...</p>
        ) : dataSources.length === 0 ? (
          <p className="text-slate-500">No data sources found. Ingest a URL above to get started.</p>
        ) : filteredDataSources.length === 0 ? (
          <p className="text-slate-500">No data sources found for type: {selectedSourceType}</p>
        ) : (
          <div className="overflow-x-auto max-h-180 overflow-y-auto">
            <table className="min-w-full text-sm text-left text-slate-500">
              <thead className="text-xs text-slate-700 uppercase bg-slate-50">
                <tr>
                  <th scope="col" className="px-4 py-3">Datasource ID</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Last Updated</th>
                  <th scope="col" className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDataSources.map(ds => {
                  const isExpanded = expandedRows.has(ds.datasource_id)
                  const jobs = dataSourceJobs[ds.datasource_id] || []
                  const latestJob = jobs[0] // Jobs are sorted by created_at descending
                  const hasActiveJob = latestJob && (latestJob.status === 'in_progress' || latestJob.status === 'pending')
                  const isWebloaderDatasource = ds.ingestor_id === WEBLOADER_INGESTOR_ID

                  return (
                    <React.Fragment key={ds.datasource_id}>
                      <tr className="bg-white border-b hover:bg-slate-100 cursor-pointer" onClick={() => toggleRow(ds.datasource_id)}>
                        <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap flex items-center gap-2" title={ds.datasource_id}>
                          <span className="text-slate-400 font-mono text-sm select-none">
                            {isExpanded ? '−' : '+'}
                          </span>
                          <span className="max-w-xs truncate">
                            {ds.datasource_id.length > 50 ? `${ds.datasource_id.substring(0, 50)}...` : ds.datasource_id}
                          </span>
                        </td>
                        <td className="px-4 py-3">{ds.source_type}</td>
                        <td className="px-4 py-3">
                          {latestJob ? (
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              latestJob.status === 'completed' ? 'bg-green-100 text-green-700' :
                              latestJob.status === 'failed' ? 'bg-red-100 text-red-700' :
                              latestJob.status === 'terminated' ? 'bg-red-100 text-red-700' :
                              latestJob.status === 'completed_with_errors' ? 'bg-orange-100 text-orange-700' :
                              latestJob.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {formatStatus(latestJob.status)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">No jobs</span>
                          )}
                        </td>
                        <td className="px-4 py-3" title={new Date(ds.last_updated * 1000).toLocaleString()}>{formatRelativeTime(ds.last_updated)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleReloadDataSource(ds.datasource_id); }} 
                              className="bg-orange-500 hover:bg-orange-700 text-white font-bold py-1 px-2 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={hasActiveJob || !isWebloaderDatasource}
                              title={!isWebloaderDatasource ? 'Only Web Ingestor supports Reload' : hasActiveJob ? 'Cannot reload while a job is active' : 'Reload this datasource'}
                            >
                              Reload
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); setShowDeleteDataSourceConfirm(ds.datasource_id); }} 
                              className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={hasActiveJob}
                              title={hasActiveJob ? 'Cannot delete while a job is active' : 'Delete this datasource'}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={5} className="p-6">
                            <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
                              <div className="grid grid-cols-3 gap-6 text-sm mb-6">
                                <div>
                                  <p className="text-xs font-medium text-slate-500 mb-1">Datasource ID</p>
                                  <p className="font-mono text-xs text-slate-900 break-all">{ds.datasource_id}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-500 mb-1">Ingestor ID</p>
                                  <p className="font-mono text-xs text-slate-900 break-all">{ds.ingestor_id}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-500 mb-1">Type</p>
                                  <p className="text-slate-900">{ds.source_type}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-500 mb-1">Default Chunk Size</p>
                                  <p className="text-slate-900">{ds.default_chunk_size}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-500 mb-1">Default Chunk Overlap</p>
                                  <p className="text-slate-900">{ds.default_chunk_overlap}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-500 mb-1">Last Updated</p>
                                  <p className="text-slate-900">{new Date(ds.last_updated * 1000).toLocaleString()}</p>
                                </div>
                              </div>
                              
                              {ds.description && (
                                <div className="mb-6">
                                  <p className="text-xs font-medium text-slate-500 mb-2">Description</p>
                                  <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded">{ds.description}</p>
                                </div>
                              )}
                              
                              {ds.metadata && Object.keys(ds.metadata).length > 0 && (
                                <details className="mb-6 rounded-lg bg-slate-50 p-3">
                                  <summary className="cursor-pointer text-xs font-semibold text-slate-700 hover:text-slate-900">
                                    Metadata ({Object.keys(ds.metadata).length} {Object.keys(ds.metadata).length === 1 ? 'field' : 'fields'})
                                  </summary>
                                  <div className="mt-2">
                                    <SyntaxHighlighter 
                                      language="json" 
                                      style={vscDarkPlus}
                                      customStyle={{
                                        margin: 0,
                                        borderRadius: '0.375rem',
                                        fontSize: '0.75rem',
                                        maxHeight: '400px'
                                      }}
                                    >
                                      {JSON.stringify(ds.metadata, null, 2)}
                                    </SyntaxHighlighter>
                                  </div>
                                </details>
                              )}

                            {/* Jobs Section */}
                            {jobs.length > 0 && (
                              <div>
                                <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-200">
                                  <h5 className="text-sm font-semibold text-slate-900">Ingestion Jobs</h5>
                                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">{jobs.length} total</span>
                                </div>
                                <div className="space-y-2">
                                  {jobs.map((job) => {
                                    const isJobExpanded = expandedJobs.has(job.job_id)
                                    const isJobActive = job.status === 'in_progress' || job.status === 'pending'
                                    const progress = (job.total > 0 && job.progress_counter >= 0) 
                                      ? Math.min(100, (job.progress_counter / job.total) * 100) 
                                      : 0

                                    return (
                                      <div 
                                        key={job.job_id} 
                                        className="border border-slate-200 rounded-lg p-3 bg-white hover:bg-slate-50 cursor-pointer transition-colors"
                                        onClick={(e) => { e.stopPropagation(); toggleJob(job.job_id); }}
                                      >
                                        {/* Job Header - Always Visible */}
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                              <span className="text-slate-400 font-mono text-sm select-none">
                                                {isJobExpanded ? '−' : '+'}
                                              </span>
                                              <span className="font-mono text-xs text-slate-600 truncate">{job.job_id}</span>
                                              <span className={`text-xs px-2 py-0.5 rounded ${
                                                job.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                job.status === 'failed' ? 'bg-red-100 text-red-700' :
                                                job.status === 'terminated' ? 'bg-red-100 text-red-700' :
                                                job.status === 'completed_with_errors' ? 'bg-orange-100 text-orange-700' :
                                                job.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                                                'bg-gray-100 text-gray-700'
                                              }`}>
                                                {formatStatus(job.status)}
                                              </span>
                                            </div>
                                            
                                            {/* Progress Bar */}
                                            {isJobActive && job.total > 0 && (
                                              <div className="flex items-center gap-2 mt-2">
                                                <div className="flex-1 bg-slate-200 rounded-full h-2">
                                                  <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${Math.max(0, progress)}%` }}></div>
                                                </div>
                                                <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                                                  {job.progress_counter}/{job.total} ({Math.round(progress)}%)
                                                </span>
                                              </div>
                                            )}                                            
                                            {/* Status Message */}
                                            {!isJobExpanded && (
                                              <p className="text-xs text-slate-500 mt-1 line-clamp-2 break-words">{job.message}</p>
                                            )}
                                          </div>

                                          {/* Terminate Button */}
                                          {isJobActive && (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleTerminateJob(ds.datasource_id, job.job_id); }}
                                              className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs flex-shrink-0"
                                              title="Stop this job"
                                            >
                                              Stop
                                            </button>
                                          )}
                                        </div>

                                        {/* Job Details - Collapsible */}
                                        {isJobExpanded && (
                                          <div className="mt-3 pt-3 border-t border-slate-200 space-y-2" onClick={(e) => e.stopPropagation()}>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                              <div><strong>Created:</strong> {new Date(job.created_at).toLocaleString()}</div>
                                              {job.completed_at && <div><strong>Completed:</strong> {new Date(job.completed_at).toLocaleString()}</div>}
                                              <div><strong>Processed:</strong> {job.progress_counter}</div>
                                              <div><strong>Failed:</strong> {job.failed_counter}</div>
                                              {job.total > 0 && <div><strong>Total:</strong> {job.total}</div>}
                                            </div>
                                            <div className="text-xs break-words">
                                              <strong>Message:</strong> {job.message}
                                            </div>

                                              {/* Error Messages */}
                                              {job.error_msgs && job.error_msgs.length > 0 && (
                                              <details className="rounded-lg bg-red-50 p-2 mt-2">
                                                <summary className="cursor-pointer text-xs font-semibold text-red-700 hover:text-red-800">
                                                  Errors ({job.error_msgs.length})
                                                </summary>
                                                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                                                  {job.error_msgs.map((error: string, index: number) => (
                                                    <div key={index} className="text-xs text-red-600 bg-red-100 p-2 rounded border-l-2 border-red-300">
                                                      {error}
                                                    </div>
                                                  ))}
                                                </div>
                                              </details>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
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
        </details>
      </section>
      
      {/* Ingestors Section */}
      <section className="card mb-6 p-5">
        {ingestors.length > 0 || loadingIngestors ? (
          <details className="group">
            <summary className="cursor-pointer text-base font-semibold text-slate-900 hover:text-slate-700 flex items-center justify-between">
              <span>Ingestors ({ingestors.length})</span>
              <div className="flex items-center gap-3">
                <button onClick={(e) => { e.stopPropagation(); fetchIngestors(); }} disabled={loadingIngestors} className="btn-secondary">
                  {loadingIngestors ? 'Refreshing...' : 'Refresh'}
                </button>
                <span className="text-xs text-slate-500 group-open:rotate-180 transition-transform">▼</span>
              </div>
            </summary>
            <div className="mt-4">
              {loadingIngestors ? (
                <p className="text-slate-500 text-xs">Loading ingestors...</p>
              ) : ingestors.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs text-left text-slate-500">
                    <thead className="text-xs text-slate-600 uppercase bg-slate-25">
                      <tr>
                        <th scope="col" className="px-3 py-2">Ingestor</th>
                        <th scope="col" className="px-3 py-2">Type</th>
                        <th scope="col" className="px-3 py-2">Last Seen</th>
                        <th scope="col" className="px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ingestors.map(ingestor => {
                        const isExpanded = expandedIngestors.has(ingestor.ingestor_id)
                        const isDefaultWebloader = ingestor.ingestor_id === WEBLOADER_INGESTOR_ID

                        return (
                          <React.Fragment key={ingestor.ingestor_id}>
                            <tr className="bg-white border-b hover:bg-slate-100 cursor-pointer text-xs" onClick={() => toggleIngestor(ingestor.ingestor_id)}>
                              <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap flex items-center gap-2" title={ingestor.ingestor_id}>
                                <span className="text-slate-400 font-mono text-sm select-none">
                                  {isExpanded ? '−' : '+'}
                                </span>
                                {ingestor.ingestor_name}
                              </td>
                              <td className="px-3 py-2">{ingestor.ingestor_type}</td>
                              <td className="px-3 py-2" title={ingestor.last_seen ? new Date(ingestor.last_seen * 1000).toLocaleString() : 'Never'}>{ingestor.last_seen ? formatRelativeTime(ingestor.last_seen) : 'Never'}</td>
                              <td className="px-3 py-2">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setShowDeleteIngestorConfirm(ingestor.ingestor_id); }} 
                                  className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={isDefaultWebloader}
                                  title={isDefaultWebloader ? 'Cannot delete default webloader ingestor' : 'Delete this ingestor (metadata only)'}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-slate-50">
                                <td colSpan={4} className="p-4">
                                  <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
                                    <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                                      <div>
                                        <p className="text-xs font-medium text-slate-500 mb-1">Ingestor ID</p>
                                        <p className="font-mono text-xs text-slate-900 break-all">{ingestor.ingestor_id}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-medium text-slate-500 mb-1">Name</p>
                                        <p className="text-slate-900">{ingestor.ingestor_name}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-medium text-slate-500 mb-1">Type</p>
                                        <p className="text-slate-900">{ingestor.ingestor_type}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-medium text-slate-500 mb-1">Last Seen</p>
                                        <p className="text-slate-900">{ingestor.last_seen ? new Date(ingestor.last_seen * 1000).toLocaleString() : 'Never'}</p>
                                      </div>
                                    </div>
                                    
                                    {ingestor.description && (
                                      <div className="mb-4">
                                        <p className="text-xs font-medium text-slate-500 mb-1">Description</p>
                                        <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded">{ingestor.description}</p>
                                      </div>
                                    )}
                                    
                                    {ingestor.metadata && Object.keys(ingestor.metadata).length > 0 && (
                                      <details className="rounded-lg bg-slate-50 p-3">
                                        <summary className="cursor-pointer text-xs font-semibold text-slate-700 hover:text-slate-900">
                                          Metadata ({Object.keys(ingestor.metadata).length} {Object.keys(ingestor.metadata).length === 1 ? 'field' : 'fields'})
                                        </summary>
                                        <div className="mt-2">
                                          <SyntaxHighlighter 
                                            language="json" 
                                            style={vscDarkPlus}
                                            customStyle={{
                                              margin: 0,
                                              borderRadius: '0.375rem',
                                              fontSize: '0.75rem',
                                              maxHeight: '300px'
                                            }}
                                          >
                                            {JSON.stringify(ingestor.metadata, null, 2)}
                                          </SyntaxHighlighter>
                                        </div>
                                      </details>
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
              ) : (
                <p className="text-slate-500 text-xs">No ingestors found.</p>
              )}
            </div>
          </details>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-slate-900">Ingestors</h3>
              <button onClick={() => fetchIngestors()} disabled={loadingIngestors} className="btn-secondary">
                {loadingIngestors ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <p className="text-slate-500">No ingestors found. Ingestors are background services that process and ingest data from various sources.</p>
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

      {/* Delete Ingestor Confirmation Dialog */}
      {showDeleteIngestorConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Delete Ingestor</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete this ingestor?
            </p>
            <div className="bg-blue-50 border-l-4 border-blue-400 p-3 mb-6">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> This will only remove the ingestor metadata. It will <strong>NOT</strong> delete any associated datasources or ingested data.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteIngestorConfirm(null)}
                className="btn bg-gray-500 hover:bg-gray-600 text-white">
                Cancel
              </button>
              <button
                onClick={() => handleDeleteIngestor(showDeleteIngestorConfirm)}
                className="btn bg-red-500 hover:bg-red-600 text-white">
                Delete Ingestor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}