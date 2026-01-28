"use client";

/**
 * IngestView - Ported directly from RAG WebUI with minimal changes
 *
 * Changes from original:
 * - Added "use client" directive for Next.js
 * - Changed import paths for local modules
 * - Added dark mode classes
 */

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
  WEBLOADER_INGESTOR_ID,
  CONFLUENCE_INGESTOR_ID
} from './api/index'
import { getIconForType } from './typeConfig'

export default function IngestView() {
  // Ingestion state
  const [url, setUrl] = useState('')
  const [ingestType, setIngestType] = useState<'web' | 'confluence'>('web')
  const [checkForSiteMap, setCheckForSiteMap] = useState(true)
  const [sitemapMaxUrls, setSitemapMaxUrls] = useState(2000)
  const [description, setDescription] = useState('')
  const [includeSubPages, setIncludeSubPages] = useState(false)

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
  const [isDeletingDataSource, setIsDeletingDataSource] = useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

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

  // Filter and sort dataSources by selected type
  const filteredDataSources = useMemo(() => {
    let filtered = dataSources

    if (selectedSourceType !== 'all') {
      filtered = dataSources.filter(ds => ds.source_type === selectedSourceType)
    }

    return [...filtered].sort((a, b) => {
      const typeComparison = a.source_type.localeCompare(b.source_type)
      if (typeComparison !== 0) return typeComparison
      return b.last_updated - a.last_updated
    })
  }, [dataSources, selectedSourceType])

  // Calculate pagination
  const totalPages = Math.ceil(filteredDataSources.length / itemsPerPage)
  const paginatedDataSources = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filteredDataSources.slice(startIndex, endIndex)
  }, [filteredDataSources, currentPage, itemsPerPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedSourceType])

  useEffect(() => {
    if (ingestType !== 'confluence') {
      setIncludeSubPages(false)
    }
  }, [ingestType])

  useEffect(() => {
    fetchDataSources()
    fetchIngestors()
  }, [])

  useEffect(() => {
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
        ingest_type: ingestType,
        get_child_pages: ingestType === 'confluence' ? includeSubPages : undefined,
      })
      const { datasource_id, job_id, message } = response
      alert(`✅ ${message}`)
      await fetchDataSources()
      if (datasource_id) {
        await fetchJobsForDataSource(datasource_id)
      }
      setUrl('')
      setDescription('')
    } catch (error: any) {
      console.error('Error ingesting data:', error)
      alert(`❌ Ingestion failed: ${error?.message || 'unknown error'}`)
    }
  }

  const handleDeleteDataSource = async (datasourceId: string) => {
    setIsDeletingDataSource(true)
    try {
      await deleteDataSource(datasourceId)
      fetchDataSources()
    } catch (error: any) {
      console.error('Error deleting data source:', error)
      alert(`Failed to delete data source: ${error?.message || 'unknown error'}`)
    } finally {
      setIsDeletingDataSource(false)
      setShowDeleteDataSourceConfirm(null)
    }
  }

  const handleDeleteIngestor = async (ingestorId: string) => {
    try {
      await deleteIngestor(ingestorId)
      fetchIngestors()
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
      alert(`❌ Reload failed: ${error?.message || 'unknown error'}`)
    }
  }

  const handleTerminateJob = async (datasourceId: string, jobId: string) => {
    try {
      await terminateJob(jobId)
      await pollJob(datasourceId, jobId)
      alert('⏹️ Job termination requested...')
    } catch (error: any) {
      console.error('Error terminating job:', error)
      alert(`❌ Termination failed: ${error?.message || 'unknown error'}`)
    }
  }

  return (
    <div className="p-6 overflow-auto h-full bg-background">
      {/* Ingest URL Section */}
      <section className="bg-card rounded-lg shadow-sm border border-border mb-6 p-5">
        <h3 className="mb-4 text-lg font-semibold text-foreground">Ingest URL</h3>

        {/* Ingest Type Selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-2">
            Ingest Type *
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setIngestType('web')}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                ingestType === 'web'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              Web
            </button>
            <button
              onClick={() => setIngestType('confluence')}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                ingestType === 'confluence'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              Confluence
            </button>
          </div>
        </div>

        {/* URL Input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-2">
            URL *
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="https://docs.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 px-4 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
            />
            <button
              onClick={handleIngest}
              className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md transition-colors"
            >
              Ingest
            </button>
          </div>
          {ingestType === 'web' && (
            <div className="mt-2 ml-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checkForSiteMap}
                  onChange={(e) => setCheckForSiteMap(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-muted-foreground">Check for sitemap</span>
              </label>
            </div>
          )}
          {ingestType === 'confluence' && (
            <div className="mt-2 ml-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeSubPages}
                  onChange={(e) => setIncludeSubPages(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-muted-foreground">Include child pages</span>
              </label>
            </div>
          )}
        </div>

        {/* Optional Configuration */}
        <details className="mb-4 rounded-lg bg-muted/50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">Optional Configuration</summary>
          <div className="md:col-span-2 mt-4">
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Description
              </label>
              <textarea
                placeholder="A short description, this may help agents to glance at what this source is about"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground resize-none"
                rows={2}
              />
          </div>
          <div className="grid gap-4 md:grid-cols-2 mt-3">
            {ingestType === 'web' && checkForSiteMap && (
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Sitemap Max URLs
                </label>
                <input
                  type="number"
                  min={0}
                  placeholder="2000"
                  value={sitemapMaxUrls}
                  onChange={(e) => setSitemapMaxUrls(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Maximum number of URLs to fetch from sitemap (0 = no limit)
                </p>
              </div>
            )}
          </div>
        </details>
      </section>

      {/* Data Sources Section */}
      <section className="bg-card rounded-lg shadow-sm border border-border mb-6 p-5">
        <details className="group" open>
          <summary className="cursor-pointer text-base font-semibold text-foreground hover:text-foreground/80 flex items-center justify-between mb-4">
            <span>Data Sources ({dataSources.length})</span>
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); fetchDataSources(); }}
                disabled={loadingDataSources}
                className="px-3 py-1 bg-muted hover:bg-muted/80 text-muted-foreground rounded text-sm transition-colors disabled:opacity-50"
              >
                {loadingDataSources ? 'Refreshing...' : 'Refresh'}
              </button>
              <span className="text-xs text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
            </div>
          </summary>

        {/* Filter Buttons */}
        {sourceTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setSelectedSourceType('all')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                selectedSourceType === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
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
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {type} ({count})
                </button>
              )
            })}
          </div>
        )}

        {loadingDataSources ? (
          <p className="text-muted-foreground">Loading data sources...</p>
        ) : dataSources.length === 0 ? (
          <p className="text-muted-foreground">No data sources found. Ingest a URL above to get started.</p>
        ) : filteredDataSources.length === 0 ? (
          <p className="text-muted-foreground">No data sources found for type: {selectedSourceType}</p>
        ) : (
          <div className="overflow-x-auto max-h-[720px] overflow-y-auto">
            <table className="min-w-full text-sm text-left text-muted-foreground">
              <thead className="text-xs text-foreground uppercase bg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3">Datasource ID</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Last Updated</th>
                  <th scope="col" className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDataSources.map(ds => {
                  const isExpanded = expandedRows.has(ds.datasource_id)
                  const jobs = dataSourceJobs[ds.datasource_id] || []
                  const latestJob = jobs[0]
                  const hasActiveJob = latestJob && (latestJob.status === 'in_progress' || latestJob.status === 'pending')
                  const isWebloaderDatasource = ds.ingestor_id === WEBLOADER_INGESTOR_ID
                  const isConfluenceDatasource = ds.ingestor_id === CONFLUENCE_INGESTOR_ID
                  const supportsReload = isWebloaderDatasource || isConfluenceDatasource

                  const icon = getIconForType(ds.source_type);

                  return (
                    <React.Fragment key={ds.datasource_id}>
                      <tr className="bg-card border-b border-border hover:bg-muted/50 cursor-pointer" onClick={() => toggleRow(ds.datasource_id)}>
                        <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap flex items-center gap-2" title={ds.datasource_id}>
                          <span className="text-muted-foreground font-mono text-sm select-none">
                            {isExpanded ? '−' : '+'}
                          </span>
                          {icon && <span className="text-lg">{icon}</span>}
                          <span className="max-w-xs truncate">
                            {ds.datasource_id.length > 50 ? `${ds.datasource_id.substring(0, 50)}...` : ds.datasource_id}
                          </span>
                        </td>
                        <td className="px-4 py-3">{ds.source_type}</td>
                        <td className="px-4 py-3">
                          {latestJob ? (
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              latestJob.status === 'completed' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                              latestJob.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                              latestJob.status === 'terminated' ? 'bg-destructive/20 text-destructive' :
                              latestJob.status === 'completed_with_errors' ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400' :
                              latestJob.status === 'in_progress' ? 'bg-primary/20 text-primary' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {formatStatus(latestJob.status)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">No jobs</span>
                          )}
                        </td>
                        <td className="px-4 py-3" title={new Date(ds.last_updated * 1000).toLocaleString()}>{formatRelativeTime(ds.last_updated)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReloadDataSource(ds.datasource_id); }}
                              className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-1 px-2 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={hasActiveJob || !supportsReload}
                              title={!supportsReload ? 'Reload not supported for this datasource type' : hasActiveJob ? 'Cannot reload while a job is active' : 'Reload this datasource'}
                            >
                              Reload
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowDeleteDataSourceConfirm(ds.datasource_id); }}
                              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold py-1 px-2 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={hasActiveJob}
                              title={hasActiveJob ? 'Cannot delete while a job is active' : 'Delete this datasource'}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/30">
                          <td colSpan={5} className="p-6">
                            <div className="bg-card rounded-lg p-5 shadow-sm border border-border">
                              <div className="grid grid-cols-3 gap-6 text-sm mb-6">
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Datasource ID</p>
                                  <p className="font-mono text-xs text-foreground break-all">{ds.datasource_id}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Ingestor ID</p>
                                  <p className="font-mono text-xs text-foreground break-all">{ds.ingestor_id}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Type</p>
                                  <p className="text-foreground">{ds.source_type}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Default Chunk Size</p>
                                  <p className="text-foreground">{ds.default_chunk_size}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Default Chunk Overlap</p>
                                  <p className="text-foreground">{ds.default_chunk_overlap}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Last Updated</p>
                                  <p className="text-foreground">{new Date(ds.last_updated * 1000).toLocaleString()}</p>
                                </div>
                              </div>

                              {ds.description && (
                                <div className="mb-6">
                                  <p className="text-xs font-medium text-muted-foreground mb-2">Description</p>
                                  <p className="text-sm text-foreground bg-muted/50 p-3 rounded">{ds.description}</p>
                                </div>
                              )}

                              {ds.metadata && Object.keys(ds.metadata).length > 0 && (
                                <details className="mb-6 rounded-lg bg-muted/50 p-3">
                                  <summary className="cursor-pointer text-xs font-semibold text-foreground hover:text-foreground/80">
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
                                <div className="flex items-center justify-between mb-3 pb-3 border-b border-border">
                                  <h5 className="text-sm font-semibold text-foreground">Ingestion Jobs</h5>
                                  <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{jobs.length} total</span>
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
                                        className="border border-border rounded-lg p-3 bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                                        onClick={(e) => { e.stopPropagation(); toggleJob(job.job_id); }}
                                      >
                                        {/* Job Header */}
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                              <span className="text-muted-foreground font-mono text-sm select-none">
                                                {isJobExpanded ? '−' : '+'}
                                              </span>
                                              <span className="font-mono text-xs text-muted-foreground truncate">{job.job_id}</span>
                                              <span className={`text-xs px-2 py-0.5 rounded ${
                                                job.status === 'completed' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                                                job.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                                                job.status === 'terminated' ? 'bg-destructive/20 text-destructive' :
                                                job.status === 'completed_with_errors' ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400' :
                                                job.status === 'in_progress' ? 'bg-primary/20 text-primary' :
                                                'bg-muted text-muted-foreground'
                                              }`}>
                                                {formatStatus(job.status)}
                                              </span>
                                            </div>

                                            {/* Progress Bar */}
                                            {isJobActive && job.total > 0 && (
                                              <div className="flex items-center gap-2 mt-2">
                                                <div className="flex-1 bg-muted rounded-full h-2">
                                                  <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${Math.max(0, progress)}%` }}></div>
                                                </div>
                                                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                                                  {job.progress_counter}/{job.total} ({Math.round(progress)}%)
                                                </span>
                                              </div>
                                            )}
                                            {/* Status Message */}
                                            {!isJobExpanded && (
                                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words">{job.message}</p>
                                            )}
                                          </div>

                                          {/* Terminate Button */}
                                          {isJobActive && (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleTerminateJob(ds.datasource_id, job.job_id); }}
                                              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold py-1 px-2 rounded text-xs flex-shrink-0"
                                              title="Stop this job"
                                            >
                                              Stop
                                            </button>
                                          )}
                                        </div>

                                        {/* Job Details - Collapsible */}
                                        {isJobExpanded && (
                                          <div className="mt-3 pt-3 border-t border-border space-y-2" onClick={(e) => e.stopPropagation()}>
                                            <div className="grid grid-cols-2 gap-2 text-xs text-foreground">
                                              <div><strong>Created:</strong> {new Date(job.created_at).toLocaleString()}</div>
                                              {job.completed_at && <div><strong>Completed:</strong> {new Date(job.completed_at).toLocaleString()}</div>}
                                              <div><strong>Processed:</strong> {job.progress_counter}</div>
                                              <div><strong>Failed:</strong> {job.failed_counter}</div>
                                              {job.total > 0 && <div><strong>Total:</strong> {job.total}</div>}
                                            </div>
                                            <div className="text-xs break-words text-foreground">
                                              <strong>Message:</strong> {job.message}
                                            </div>

                                              {/* Error Messages */}
                                              {job.error_msgs && job.error_msgs.length > 0 && (
                                              <details className="rounded-lg bg-destructive/10 p-2 mt-2">
                                                <summary className="cursor-pointer text-xs font-semibold text-destructive hover:text-destructive/80">
                                                  Errors ({job.error_msgs.length})
                                                </summary>
                                                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                                                  {job.error_msgs.map((error: string, index: number) => (
                                                    <div key={index} className="text-xs text-destructive bg-destructive/20 p-2 rounded border-l-2 border-destructive">
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

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredDataSources.length)} of {filteredDataSources.length} results
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                      const showPage = page === 1 ||
                                      page === totalPages ||
                                      (page >= currentPage - 1 && page <= currentPage + 1)

                      if (!showPage) {
                        if (page === currentPage - 2 || page === currentPage + 2) {
                          return <span key={page} className="px-2 text-muted-foreground">...</span>
                        }
                        return null
                      }

                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`px-3 py-1 text-sm font-medium rounded-md ${
                            currentPage === page
                              ? 'bg-primary text-primary-foreground'
                              : 'text-foreground bg-card border border-border hover:bg-muted'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    })}
                  </div>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        </details>
      </section>

      {/* Ingestors Section */}
      <section className="bg-card rounded-lg shadow-sm border border-border mb-6 p-5">
        {ingestors.length > 0 || loadingIngestors ? (
          <details className="group">
            <summary className="cursor-pointer text-base font-semibold text-foreground hover:text-foreground/80 flex items-center justify-between">
              <span>Ingestors ({ingestors.length})</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => { e.stopPropagation(); fetchIngestors(); }}
                  disabled={loadingIngestors}
                  className="px-3 py-1 bg-muted hover:bg-muted/80 text-muted-foreground rounded text-sm transition-colors disabled:opacity-50"
                >
                  {loadingIngestors ? 'Refreshing...' : 'Refresh'}
                </button>
                <span className="text-xs text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
              </div>
            </summary>
            <div className="mt-4">
              {loadingIngestors ? (
                <p className="text-muted-foreground text-xs">Loading ingestors...</p>
              ) : ingestors.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs text-left text-muted-foreground">
                    <thead className="text-xs text-foreground uppercase bg-muted">
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
                        const icon = getIconForType(ingestor.ingestor_type);

                        return (
                          <React.Fragment key={ingestor.ingestor_id}>
                            <tr className="bg-card border-b border-border hover:bg-muted/50 cursor-pointer text-xs" onClick={() => toggleIngestor(ingestor.ingestor_id)}>
                              <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap flex items-center gap-2" title={ingestor.ingestor_id}>
                                <span className="text-muted-foreground font-mono text-sm select-none">
                                  {isExpanded ? '−' : '+'}
                                </span>
                                {icon && <span className="text-base">{icon}</span>}
                                {ingestor.ingestor_name}
                              </td>
                              <td className="px-3 py-2">{ingestor.ingestor_type}</td>
                              <td className="px-3 py-2" title={ingestor.last_seen ? new Date(ingestor.last_seen * 1000).toLocaleString() : 'Never'}>
                                {ingestor.last_seen ? formatRelativeTime(ingestor.last_seen) : 'Never'}
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setShowDeleteIngestorConfirm(ingestor.ingestor_id); }}
                                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold py-1 px-2 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={isDefaultWebloader}
                                  title={isDefaultWebloader ? 'Cannot delete default webloader ingestor' : 'Delete this ingestor (metadata only)'}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-muted/30">
                                <td colSpan={4} className="p-4">
                                  <div className="bg-card rounded-lg p-4 shadow-sm border border-border">
                                    <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Ingestor ID</p>
                                        <p className="font-mono text-xs text-foreground break-all">{ingestor.ingestor_id}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Name</p>
                                        <p className="text-foreground">{ingestor.ingestor_name}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Type</p>
                                        <p className="text-foreground">{ingestor.ingestor_type}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Last Seen</p>
                                        <p className="text-foreground">
                                          {ingestor.last_seen ? new Date(ingestor.last_seen * 1000).toLocaleString() : 'Never'}
                                        </p>
                                      </div>
                                    </div>

                                    {ingestor.description && (
                                      <div className="mb-4">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                                        <p className="text-sm text-foreground bg-muted/50 p-3 rounded">{ingestor.description}</p>
                                      </div>
                                    )}

                                    {ingestor.metadata && Object.keys(ingestor.metadata).length > 0 && (
                                      <details className="rounded-lg bg-muted/50 p-3">
                                        <summary className="cursor-pointer text-xs font-semibold text-foreground hover:text-foreground/80">
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
                <p className="text-muted-foreground text-xs">No ingestors found.</p>
              )}
            </div>
          </details>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-foreground">Ingestors</h3>
              <button
                onClick={() => fetchIngestors()}
                disabled={loadingIngestors}
                className="px-3 py-1 bg-muted hover:bg-muted/80 text-muted-foreground rounded text-sm transition-colors disabled:opacity-50"
              >
                {loadingIngestors ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <p className="text-muted-foreground">No ingestors found. Ingestors are background services that process and ingest data from various sources.</p>
          </div>
        )}
      </section>

      {/* Delete Data Source Confirmation Dialog */}
      {showDeleteDataSourceConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-lg shadow-xl max-w-md w-full mx-4 border border-border">
            <h3 className="text-lg font-bold text-foreground mb-4">Delete Data Source</h3>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to delete this data source? This will permanently remove all associated documents and data. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteDataSourceConfirm(null)}
                disabled={isDeletingDataSource}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md disabled:opacity-50 disabled:cursor-not-allowed">
                Cancel
              </button>
              <button
                onClick={() => handleDeleteDataSource(showDeleteDataSourceConfirm)}
                disabled={isDeletingDataSource}
                className="px-4 py-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                {isDeletingDataSource && (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {isDeletingDataSource ? 'Deleting...' : 'Delete Data Source'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Ingestor Confirmation Dialog */}
      {showDeleteIngestorConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-lg shadow-xl max-w-md w-full mx-4 border border-border">
            <h3 className="text-lg font-bold text-foreground mb-4">Delete Ingestor</h3>
            <p className="text-muted-foreground mb-4">
              Are you sure you want to delete this ingestor?
            </p>
            <div className="bg-primary/10 border-l-4 border-primary p-3 mb-6">
              <p className="text-sm text-primary">
                <strong>Note:</strong> This will only remove the ingestor metadata. It will <strong>NOT</strong> delete any associated datasources or ingested data.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteIngestorConfirm(null)}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md">
                Cancel
              </button>
              <button
                onClick={() => handleDeleteIngestor(showDeleteIngestorConfirm)}
                className="px-4 py-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md">
                Delete Ingestor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
