"use client";

/**
 * IngestView - Data Sources Management
 *
 * Redesigned with:
 * - shadcn/ui components (Button, Input, Badge)
 * - Framer Motion animations
 * - Modern styling consistent with SearchView and UseCasesGallery
 * - Information-dense layout with metrics placeholders
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { formatDistanceToNow } from 'date-fns'
import { 
  Database, 
  RefreshCw, 
  ChevronDown, 
  ChevronRight,
  Trash2,
  RotateCcw,
  StopCircle,
  Activity,
  Server,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Link as LinkIcon,
  Settings,
  X,
  Plus,
  Search
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
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
import { getIconForType, ingestTypeConfigs, isIngestTypeAvailable } from './typeConfig'
import { useRagPermissions, Permission } from '@/hooks/useRagPermissions'
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// Animation variants
const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
}

const expandCollapse = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 }
}

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.05
    }
  }
}

const slideUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 }
}

// Helper component to render icon (either emoji or SVG image)
const IconRenderer = ({ icon, className = "w-5 h-5" }: { icon: string; className?: string }) => {
  const isEmoji = !icon.startsWith('/')
  
  if (isEmoji) {
    return <span className="text-lg">{icon}</span>
  }
  
  return (
    <img 
      src={icon} 
      alt="" 
      className={className}
      style={{ display: 'inline-block' }}
    />
  )
}

// Status badge component with consistent styling
const StatusBadge = ({ status }: { status: string }) => {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'completed':
        return { 
          className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
          icon: <CheckCircle2 className="h-3 w-3" />
        }
      case 'failed':
      case 'terminated':
        return { 
          className: 'bg-destructive/20 text-destructive border-destructive/30',
          icon: <AlertCircle className="h-3 w-3" />
        }
      case 'completed_with_errors':
        return { 
          className: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
          icon: <AlertCircle className="h-3 w-3" />
        }
      case 'in_progress':
        return { 
          className: 'bg-primary/20 text-primary border-primary/30',
          icon: <Loader2 className="h-3 w-3 animate-spin" />
        }
      case 'pending':
        return { 
          className: 'bg-muted text-muted-foreground border-border',
          icon: <Clock className="h-3 w-3" />
        }
      default:
        return { 
          className: 'bg-muted text-muted-foreground border-border',
          icon: null
        }
    }
  }

  const config = getStatusConfig(status)
  const formatStatus = (status: string): string => {
    return status
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
      config.className
    )}>
      {config.icon}
      {formatStatus(status)}
    </span>
  )
}

// Progress bar component with gradient
const ProgressBar = ({ progress, total, current }: { progress: number; total: number; current: number }) => {
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <motion.div 
          className="h-full rounded-full gradient-primary-br"
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap tabular-nums">
        {current}/{total} ({Math.round(progress)}%)
      </span>
    </div>
  )
}

export default function IngestView() {
  const { hasPermission } = useRagPermissions()
  
  // Ingestion state
  const [url, setUrl] = useState('')
  const [ingestType, setIngestType] = useState<string>('web')
  const [checkForSiteMap, setCheckForSiteMap] = useState(true)
  const [sitemapMaxUrls, setSitemapMaxUrls] = useState(2000)
  const [description, setDescription] = useState('')
  const [includeSubPages, setIncludeSubPages] = useState(false)
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)

  // DataSources state
  const [dataSources, setDataSources] = useState<DataSourceInfo[]>([])
  const [loadingDataSources, setLoadingDataSources] = useState(true)
  const [refreshingDataSources, setRefreshingDataSources] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [dataSourceJobs, setDataSourceJobs] = useState<Record<string, IngestionJob[]>>({})
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set())
  const [selectedSourceType, setSelectedSourceType] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Ingestors state
  const [ingestors, setIngestors] = useState<IngestorInfo[]>([])
  const [loadingIngestors, setLoadingIngestors] = useState(false)
  const [refreshingIngestors, setRefreshingIngestors] = useState(false)
  const [expandedIngestors, setExpandedIngestors] = useState<Set<string>>(new Set())
  const [showIngestors, setShowIngestors] = useState(false)

  // Confirmation dialogs state
  const [showDeleteDataSourceConfirm, setShowDeleteDataSourceConfirm] = useState<string | null>(null)
  const [showDeleteIngestorConfirm, setShowDeleteIngestorConfirm] = useState<string | null>(null)
  const [showReIngestConfirm, setShowReIngestConfirm] = useState<string | null>(null)
  const [isDeletingDataSource, setIsDeletingDataSource] = useState(false)
  const [isReIngesting, setIsReIngesting] = useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Utility function to format timestamps as relative time
  const formatRelativeTime = (timestamp: number): string => {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true })
  }

  // Calculate stats
  const stats = useMemo(() => {
    const activeJobs = Object.values(dataSourceJobs).flat().filter(
      job => job.status === 'in_progress' || job.status === 'pending'
    ).length
    return {
      totalDataSources: dataSources.length,
      activeJobs,
      totalIngestors: ingestors.length
    }
  }, [dataSources, dataSourceJobs, ingestors])

  // Get unique source types from dataSources
  const sourceTypes = useMemo(() => {
    const types = new Set(dataSources.map(ds => ds.source_type))
    return Array.from(types).sort()
  }, [dataSources])

  // Filter and sort dataSources by selected type and search query
  const filteredDataSources = useMemo(() => {
    let filtered = dataSources

    // Filter by source type
    if (selectedSourceType !== 'all') {
      filtered = filtered.filter(ds => ds.source_type === selectedSourceType)
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(ds => 
        ds.datasource_id.toLowerCase().includes(query) ||
        ds.source_type.toLowerCase().includes(query) ||
        ds.description?.toLowerCase().includes(query) ||
        ds.ingestor_id.toLowerCase().includes(query)
      )
    }

    return [...filtered].sort((a, b) => {
      const typeComparison = a.source_type.localeCompare(b.source_type)
      if (typeComparison !== 0) return typeComparison
      return b.last_updated - a.last_updated
    })
  }, [dataSources, selectedSourceType, searchQuery])

  // Calculate pagination
  const totalPages = Math.ceil(filteredDataSources.length / itemsPerPage)
  const paginatedDataSources = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filteredDataSources.slice(startIndex, endIndex)
  }, [filteredDataSources, currentPage, itemsPerPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedSourceType, searchQuery])

  useEffect(() => {
    if (ingestType !== 'confluence') {
      setIncludeSubPages(false)
    }
  }, [ingestType])

  useEffect(() => {
    fetchDataSources()
    fetchIngestors()
  }, [])

  // Effect to auto-select first available ingest type when ingestors load
  useEffect(() => {
    if (ingestors.length > 0) {
      const isCurrentTypeAvailable = isIngestTypeAvailable(ingestType, ingestors)
      
      if (!isCurrentTypeAvailable) {
        const availableType = Object.keys(ingestTypeConfigs).find(type =>
          isIngestTypeAvailable(type, ingestors)
        )
        if (availableType) {
          setIngestType(availableType)
        }
      }
    }
  }, [ingestors, ingestType])

  // Track previously seen datasource IDs to avoid refetching jobs on refresh
  const previousDataSourceIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const fetchJobsForNewDataSources = async () => {
      const currentIds = new Set(dataSources.map(ds => ds.datasource_id))
      const newDataSources = dataSources.filter(ds => !previousDataSourceIds.current.has(ds.datasource_id))
      
      previousDataSourceIds.current = currentIds
      
      for (const ds of newDataSources) {
        await fetchJobsForDataSource(ds.datasource_id)
      }
    }
    if (dataSources.length > 0) {
      fetchJobsForNewDataSources()
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
    const isRefresh = dataSources.length > 0
    if (isRefresh) {
      setRefreshingDataSources(true)
    } else {
      setLoadingDataSources(true)
    }
    try {
      const response = await getDataSources()
      const datasources = response.datasources
      setDataSources(datasources)
    } catch (error) {
      console.error('Failed to fetch data sources', error)
    } finally {
      setLoadingDataSources(false)
      setRefreshingDataSources(false)
    }
  }

  const fetchIngestors = async () => {
    const isRefresh = ingestors.length > 0
    if (isRefresh) {
      setRefreshingIngestors(true)
    } else {
      setLoadingIngestors(true)
    }
    try {
      const ingestorList = await getIngestors()
      setIngestors(ingestorList)
    } catch (error) {
      console.error('Failed to fetch ingestors', error)
    } finally {
      setLoadingIngestors(false)
      setRefreshingIngestors(false)
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
    setIsReIngesting(true)
    try {
      await reloadDataSource(datasourceId)
      await fetchDataSources()
      await fetchJobsForDataSource(datasourceId)
    } catch (error: any) {
      console.error('Error re-ingesting data source:', error)
      alert(`❌ Re-ingest failed: ${error?.message || 'unknown error'}`)
    } finally {
      setIsReIngesting(false)
      setShowReIngestConfirm(null)
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
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Compact Header with Gradient and Stats */}
      <div className="relative overflow-hidden border-b border-border shrink-0">
        {/* Gradient Background */}
        <div 
          className="absolute inset-0" 
          style={{
            background: `linear-gradient(to bottom right, color-mix(in srgb, var(--gradient-from) 15%, transparent) 0%, color-mix(in srgb, var(--gradient-to) 8%, transparent) 50%, transparent 100%)`
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />

        <div className="relative px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg gradient-primary-br shadow-md shadow-primary/20">
                <Database className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold gradient-text">Data Sources</h1>
                <p className="text-muted-foreground text-xs">
                  Ingest and manage your knowledge base sources
                </p>
              </div>
            </div>

            {/* Stats Row */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/50 border border-border/50">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{stats.totalDataSources}</span>
                <span className="text-xs text-muted-foreground">Sources</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/50 border border-border/50">
                <Activity className={cn("h-4 w-4", stats.activeJobs > 0 ? "text-primary animate-pulse" : "text-muted-foreground")} />
                <span className="text-sm font-medium">{stats.activeJobs}</span>
                <span className="text-xs text-muted-foreground">Active</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/50 border border-border/50">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{stats.totalIngestors}</span>
                <span className="text-xs text-muted-foreground">Ingestors</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {/* Ingest URL Section */}
          <motion.section 
            className="bg-card rounded-xl shadow-sm border border-border p-5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Plus className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold text-foreground">Ingest URL</h3>
            </div>

            {/* Ingest Type Selection - Pill Style */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Source Type
              </label>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(ingestTypeConfigs).map(([type, config]) => {
                  const isAvailable = isIngestTypeAvailable(type, ingestors)
                  return (
                    <Button
                      key={type}
                      onClick={() => isAvailable && setIngestType(type)}
                      disabled={!isAvailable}
                      variant={ingestType === type ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "rounded-full transition-all",
                        ingestType === type && "shadow-sm",
                        !isAvailable && "opacity-50 cursor-not-allowed"
                      )}
                      title={!isAvailable ? `No ${config.requiredIngestorType} ingestor available` : `Ingest as ${config.label}`}
                    >
                      {config.icon && (
                        <span className="mr-1">
                          <IconRenderer icon={config.icon} className="w-3.5 h-3.5" />
                        </span>
                      )}
                      {config.label}
                    </Button>
                  )
                })}
              </div>
              {ingestors.length === 0 && !loadingIngestors && (
                <p className="text-xs text-orange-400 mt-2 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  No ingestors detected. Please ensure ingestor services are running.
                </p>
              )}
            </div>

            {/* URL Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                URL
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="url"
                    placeholder="https://docs.example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="pl-10"
                    onKeyDown={(e) => e.key === 'Enter' && handleIngest()}
                  />
                </div>
                <Button
                  onClick={handleIngest}
                  disabled={!url || !hasPermission(Permission.INGEST)}
                  title={!hasPermission(Permission.INGEST) ? 'Insufficient permissions to ingest data' : 'Ingest this URL'}
                >
                  Ingest
                </Button>
              </div>
              
              {/* Quick options */}
              {ingestType === 'web' && (
                <label className="flex items-center gap-2 mt-2 ml-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkForSiteMap}
                    onChange={(e) => setCheckForSiteMap(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                  <span className="text-sm text-muted-foreground">Check for sitemap</span>
                </label>
              )}
              {ingestType === 'confluence' && (
                <label className="flex items-center gap-2 mt-2 ml-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeSubPages}
                    onChange={(e) => setIncludeSubPages(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                  <span className="text-sm text-muted-foreground">Include child pages</span>
                </label>
              )}
            </div>

            {/* Advanced Options - Animated Collapsible */}
            <div>
              <button
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings className="h-4 w-4" />
                <span>Advanced Options</span>
                <motion.div
                  animate={{ rotate: showAdvancedOptions ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="h-4 w-4" />
                </motion.div>
              </button>

              <AnimatePresence>
                {showAdvancedOptions && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 p-4 rounded-lg bg-muted/50 border border-border/50 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">
                          Description
                        </label>
                        <textarea
                          placeholder="A short description to help agents understand this source"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground text-sm resize-none"
                          rows={2}
                        />
                      </div>
                      {ingestType === 'web' && checkForSiteMap && (
                        <div>
                          <label className="block text-sm font-medium text-muted-foreground mb-1">
                            Sitemap Max URLs
                          </label>
                          <Input
                            type="number"
                            min={0}
                            placeholder="2000"
                            value={sitemapMaxUrls}
                            onChange={(e) => setSitemapMaxUrls(Number(e.target.value))}
                            className="w-48"
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            Maximum URLs to fetch from sitemap (0 = no limit)
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.section>

          {/* Data Sources Section */}
          <motion.section 
            className="bg-card rounded-xl shadow-sm border border-border"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            {/* Section Header */}
            <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-semibold text-foreground">Data Sources</h3>
                <Badge variant="secondary" className="text-xs">
                  {filteredDataSources.length} {selectedSourceType !== 'all' || searchQuery ? `of ${dataSources.length}` : ''}
                </Badge>
              </div>
              
              {/* Search Input and Refresh Button - Right Aligned */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search data sources..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-8 h-9 w-64"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchDataSources}
                  disabled={loadingDataSources || refreshingDataSources}
                  className="gap-2"
                >
                  <RefreshCw className={cn("h-4 w-4", refreshingDataSources && "animate-spin")} />
                  {refreshingDataSources ? 'Refreshing...' : 'Refresh'}
                </Button>
              </div>
            </div>

            {/* Filter Pills */}
            {sourceTypes.length > 0 && (
              <div className="px-5 py-3 border-b border-border/50 flex flex-wrap gap-2">
                <Button
                  variant={selectedSourceType === 'all' ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedSourceType('all')}
                  className="rounded-full h-7 text-xs"
                >
                  All ({dataSources.length})
                </Button>
                {sourceTypes.map(type => {
                  const count = dataSources.filter(ds => ds.source_type === type).length
                  const icon = getIconForType(type)
                  return (
                    <Button
                      key={type}
                      variant={selectedSourceType === type ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setSelectedSourceType(type)}
                      className="rounded-full h-7 text-xs gap-1.5"
                    >
                      {icon && <IconRenderer icon={icon} className="w-3.5 h-3.5" />}
                      {type} ({count})
                    </Button>
                  )
                })}
              </div>
            )}

            {/* Data Sources List */}
            <div className="p-5">
              {loadingDataSources && dataSources.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mb-3" />
                  <p>Loading data sources...</p>
                </div>
              ) : dataSources.length === 0 ? (
                // Empty State
                <motion.div 
                  className="flex flex-col items-center justify-center py-12 text-center"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <div className="p-4 rounded-2xl gradient-primary-br shadow-lg shadow-primary/20 mb-4">
                    <Database className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No data sources yet</h3>
                  <p className="text-muted-foreground text-sm max-w-sm mb-4">
                    Ingest a URL above to start building your knowledge base
                  </p>
                </motion.div>
              ) : filteredDataSources.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No data sources found for type: {selectedSourceType}
                </p>
              ) : (
                <div className="space-y-2">
                  <div>
                    {paginatedDataSources.map((ds, index) => {
                      const isExpanded = expandedRows.has(ds.datasource_id)
                      const jobs = dataSourceJobs[ds.datasource_id] || []
                      const latestJob = jobs[0]
                      const hasActiveJob = latestJob && (latestJob.status === 'in_progress' || latestJob.status === 'pending')
                      const isWebloaderDatasource = ds.ingestor_id === WEBLOADER_INGESTOR_ID
                      const isConfluenceDatasource = ds.ingestor_id === CONFLUENCE_INGESTOR_ID
                      const supportsReload = isWebloaderDatasource || isConfluenceDatasource
                      const icon = getIconForType(ds.source_type)

                      return (
                        <motion.div
                          key={ds.datasource_id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.03 }}
                          className={cn(
                            "border border-border rounded-lg overflow-hidden transition-all duration-200",
                            isExpanded ? "ring-1 ring-primary/20 shadow-sm" : "hover:border-border/80"
                          )}
                        >
                          {/* Row Header */}
                          <div 
                            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                            onClick={() => toggleRow(ds.datasource_id)}
                          >
                            <motion.div
                              animate={{ rotate: isExpanded ? 90 : 0 }}
                              transition={{ duration: 0.2 }}
                            >
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </motion.div>
                            
                            {icon && <IconRenderer icon={icon} className="w-5 h-5" />}
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm truncate max-w-md" title={ds.datasource_id}>
                                  {ds.datasource_id.length > 60 ? `${ds.datasource_id.substring(0, 60)}...` : ds.datasource_id}
                                </span>
                                <Badge variant="secondary" className="text-[10px] shrink-0">
                                  {ds.source_type}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Updated {formatRelativeTime(ds.last_updated)}
                              </p>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              {latestJob ? (
                                <StatusBadge status={latestJob.status} />
                              ) : (
                                <span className="text-xs text-muted-foreground">No jobs</span>
                              )}

                              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setShowReIngestConfirm(ds.datasource_id)}
                                  disabled={hasActiveJob || !supportsReload || !hasPermission(Permission.INGEST)}
                                  className="h-7 w-7 p-0"
                                  title={!hasPermission(Permission.INGEST) ? 'Insufficient permissions' : !supportsReload ? 'Re-ingest not supported' : hasActiveJob ? 'Job in progress' : 'Re-ingest'}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setShowDeleteDataSourceConfirm(ds.datasource_id)}
                                  disabled={hasActiveJob || !hasPermission(Permission.DELETE)}
                                  className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
                                  title={!hasPermission(Permission.DELETE) ? 'Insufficient permissions' : hasActiveJob ? 'Job in progress' : 'Delete'}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>

                          {/* Expanded Content */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="overflow-hidden"
                              >
                                <div className="px-4 py-4 bg-muted/20 border-t border-border space-y-4">
                                  {/* Metadata Grid */}
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-1">Datasource ID</p>
                                      <p className="font-mono text-xs text-foreground break-all">{ds.datasource_id}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-1">Ingestor ID</p>
                                      <p className="font-mono text-xs text-foreground break-all">{ds.ingestor_id}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-1">Chunk Size</p>
                                      <p className="text-foreground">{ds.default_chunk_size}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-1">Chunk Overlap</p>
                                      <p className="text-foreground">{ds.default_chunk_overlap}</p>
                                    </div>
                                  </div>

                                  {/* Metrics Placeholder */}
                                  <div className="p-3 rounded-lg border border-dashed border-border/50 bg-muted/30">
                                    <p className="text-xs text-muted-foreground text-center">
                                      Metrics will be displayed here
                                    </p>
                                  </div>

                                  {ds.description && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                                      <p className="text-sm text-foreground bg-muted/50 p-3 rounded-lg">{ds.description}</p>
                                    </div>
                                  )}

                                  {ds.metadata && Object.keys(ds.metadata).length > 0 && (
                                    <details className="rounded-lg bg-muted/50 border border-border/50">
                                      <summary className="cursor-pointer text-xs font-medium text-foreground px-3 py-2 hover:bg-muted/50">
                                        Metadata ({Object.keys(ds.metadata).length} fields)
                                      </summary>
                                      <div className="px-3 pb-3">
                                        <SyntaxHighlighter
                                          language="json"
                                          style={vscDarkPlus}
                                          customStyle={{
                                            margin: 0,
                                            borderRadius: '0.5rem',
                                            fontSize: '0.75rem',
                                            maxHeight: '300px'
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
                                      <div className="flex items-center justify-between mb-3">
                                        <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                                          <Activity className="h-4 w-4" />
                                          Ingestion Jobs
                                        </h5>
                                        <Badge variant="secondary" className="text-xs">
                                          {jobs.length} total
                                        </Badge>
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
                                              className="border border-border rounded-lg bg-card overflow-hidden"
                                            >
                                              <div 
                                                className="p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                                                onClick={(e) => { e.stopPropagation(); toggleJob(job.job_id); }}
                                              >
                                                <div className="flex items-center justify-between gap-2">
                                                  <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                      <motion.div
                                                        animate={{ rotate: isJobExpanded ? 90 : 0 }}
                                                        transition={{ duration: 0.2 }}
                                                      >
                                                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                                      </motion.div>
                                                      <span className="font-mono text-xs text-muted-foreground truncate">
                                                        {job.job_id}
                                                      </span>
                                                      <StatusBadge status={job.status} />
                                                    </div>

                                                    {isJobActive && job.total > 0 && (
                                                      <ProgressBar 
                                                        progress={progress} 
                                                        total={job.total} 
                                                        current={job.progress_counter} 
                                                      />
                                                    )}

                                                    {!isJobExpanded && (
                                                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                                                        {job.message}
                                                      </p>
                                                    )}
                                                  </div>

                                                  {isJobActive && (
                                                    <Button
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={(e) => { e.stopPropagation(); handleTerminateJob(ds.datasource_id, job.job_id); }}
                                                      disabled={!hasPermission(Permission.INGEST)}
                                                      className="h-7 px-2 hover:bg-destructive/10 hover:text-destructive"
                                                    >
                                                      <StopCircle className="h-3.5 w-3.5 mr-1" />
                                                      Stop
                                                    </Button>
                                                  )}
                                                </div>
                                              </div>

                                              <AnimatePresence>
                                                {isJobExpanded && (
                                                  <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: "auto", opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.15 }}
                                                    className="overflow-hidden"
                                                  >
                                                    <div className="px-3 pb-3 pt-2 border-t border-border space-y-2" onClick={(e) => e.stopPropagation()}>
                                                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                                        <div>
                                                          <span className="font-medium text-muted-foreground">Created:</span>
                                                          <p className="text-foreground">{new Date(job.created_at).toLocaleString()}</p>
                                                        </div>
                                                        {job.completed_at && (
                                                          <div>
                                                            <span className="font-medium text-muted-foreground">Completed:</span>
                                                            <p className="text-foreground">{new Date(job.completed_at).toLocaleString()}</p>
                                                          </div>
                                                        )}
                                                        <div>
                                                          <span className="font-medium text-muted-foreground">Processed:</span>
                                                          <p className="text-foreground">{job.progress_counter}</p>
                                                        </div>
                                                        <div>
                                                          <span className="font-medium text-muted-foreground">Failed:</span>
                                                          <p className={job.failed_counter > 0 ? "text-destructive" : "text-foreground"}>
                                                            {job.failed_counter}
                                                          </p>
                                                        </div>
                                                      </div>
                                                      
                                                      <div className="text-xs">
                                                        <span className="font-medium text-muted-foreground">Message:</span>
                                                        <p className="text-foreground mt-0.5">{job.message}</p>
                                                      </div>

                                                      {job.error_msgs && job.error_msgs.length > 0 && (
                                                        <details className="rounded-lg bg-destructive/10 border border-destructive/20">
                                                          <summary className="cursor-pointer text-xs font-medium text-destructive px-2 py-1.5 hover:bg-destructive/20">
                                                            Errors ({job.error_msgs.length})
                                                          </summary>
                                                          <div className="px-2 pb-2 space-y-1 max-h-32 overflow-y-auto">
                                                            {job.error_msgs.map((error: string, index: number) => (
                                                              <div key={index} className="text-xs text-destructive bg-destructive/20 p-2 rounded border-l-2 border-destructive">
                                                                {error}
                                                              </div>
                                                            ))}
                                                          </div>
                                                        </details>
                                                      )}
                                                    </div>
                                                  </motion.div>
                                                )}
                                              </AnimatePresence>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )
                    })}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
                      <p className="text-sm text-muted-foreground">
                        Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredDataSources.length)} of {filteredDataSources.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter(page => page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1))
                          .map((page, idx, arr) => (
                            <React.Fragment key={page}>
                              {idx > 0 && arr[idx - 1] !== page - 1 && (
                                <span className="px-2 text-muted-foreground">...</span>
                              )}
                              <Button
                                variant={currentPage === page ? "default" : "outline"}
                                size="sm"
                                onClick={() => setCurrentPage(page)}
                                className="w-8 h-8 p-0"
                              >
                                {page}
                              </Button>
                            </React.Fragment>
                          ))
                        }
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={currentPage === totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.section>

          {/* Ingestors Section */}
          <motion.section 
            className="bg-card rounded-xl shadow-sm border border-border"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <button
              onClick={() => setShowIngestors(!showIngestors)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Server className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-base font-semibold text-foreground">Ingestors</h3>
                <Badge variant="secondary" className="text-xs">
                  {ingestors.length}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); fetchIngestors(); }}
                  disabled={loadingIngestors || refreshingIngestors}
                  className="gap-2"
                >
                  <RefreshCw className={cn("h-4 w-4", refreshingIngestors && "animate-spin")} />
                </Button>
                <motion.div
                  animate={{ rotate: showIngestors ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </motion.div>
              </div>
            </button>

            <AnimatePresence>
              {showIngestors && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 border-t border-border pt-4">
                    {loadingIngestors && ingestors.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        Loading ingestors...
                      </div>
                    ) : ingestors.length === 0 ? (
                      <p className="text-muted-foreground text-center py-8">
                        No ingestors found. Ingestors are background services that process and ingest data.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {ingestors.map((ingestor, index) => {
                          const isExpanded = expandedIngestors.has(ingestor.ingestor_id)
                          const isDefaultWebloader = ingestor.ingestor_id === WEBLOADER_INGESTOR_ID
                          const icon = getIconForType(ingestor.ingestor_type)

                          return (
                            <motion.div
                              key={ingestor.ingestor_id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.03 }}
                              className="border border-border rounded-lg overflow-hidden"
                            >
                              <div 
                                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                                onClick={() => toggleIngestor(ingestor.ingestor_id)}
                              >
                                <motion.div
                                  animate={{ rotate: isExpanded ? 90 : 0 }}
                                  transition={{ duration: 0.2 }}
                                >
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </motion.div>
                                
                                {icon && <IconRenderer icon={icon} className="w-4 h-4" />}
                                
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{ingestor.ingestor_name}</span>
                                    <Badge variant="secondary" className="text-[10px]">
                                      {ingestor.ingestor_type}
                                    </Badge>
                                    {isDefaultWebloader && (
                                      <Badge variant="outline" className="text-[10px]">
                                        Default
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Last seen: {ingestor.last_seen ? formatRelativeTime(ingestor.last_seen) : 'Never'}
                                  </p>
                                </div>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => { e.stopPropagation(); setShowDeleteIngestorConfirm(ingestor.ingestor_id); }}
                                  disabled={isDefaultWebloader || !hasPermission(Permission.DELETE)}
                                  className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
                                  title={isDefaultWebloader ? 'Cannot delete default webloader' : 'Delete ingestor'}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>

                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="px-4 py-4 bg-muted/20 border-t border-border space-y-3">
                                      <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Ingestor ID</p>
                                          <p className="font-mono text-xs text-foreground break-all">{ingestor.ingestor_id}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Last Seen</p>
                                          <p className="text-foreground text-sm">
                                            {ingestor.last_seen ? new Date(ingestor.last_seen * 1000).toLocaleString() : 'Never'}
                                          </p>
                                        </div>
                                      </div>

                                      {ingestor.description && (
                                        <div>
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                                          <p className="text-sm text-foreground bg-muted/50 p-3 rounded-lg">{ingestor.description}</p>
                                        </div>
                                      )}

                                      {ingestor.metadata && Object.keys(ingestor.metadata).length > 0 && (
                                        <details className="rounded-lg bg-muted/50 border border-border/50">
                                          <summary className="cursor-pointer text-xs font-medium text-foreground px-3 py-2 hover:bg-muted/50">
                                            Metadata ({Object.keys(ingestor.metadata).length} fields)
                                          </summary>
                                          <div className="px-3 pb-3">
                                            <SyntaxHighlighter
                                              language="json"
                                              style={vscDarkPlus}
                                              customStyle={{
                                                margin: 0,
                                                borderRadius: '0.5rem',
                                                fontSize: '0.75rem',
                                                maxHeight: '200px'
                                              }}
                                            >
                                              {JSON.stringify(ingestor.metadata, null, 2)}
                                            </SyntaxHighlighter>
                                          </div>
                                        </details>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        </div>
      </ScrollArea>

      {/* Delete Data Source Confirmation Dialog */}
      <AnimatePresence>
        {showDeleteDataSourceConfirm && (
          <motion.div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDeleteDataSourceConfirm(null)}
          >
            <motion.div 
              className="bg-card p-6 rounded-xl shadow-2xl max-w-md w-full mx-4 border border-border"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <Trash2 className="h-5 w-5 text-destructive" />
                </div>
                <h3 className="text-lg font-bold text-foreground">Delete Data Source</h3>
              </div>
              <p className="text-muted-foreground mb-6">
                Are you sure you want to delete this data source? This will permanently remove all associated documents and data. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  variant="ghost"
                  onClick={() => setShowDeleteDataSourceConfirm(null)}
                  disabled={isDeletingDataSource}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDeleteDataSource(showDeleteDataSourceConfirm)}
                  disabled={isDeletingDataSource}
                >
                  {isDeletingDataSource && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {isDeletingDataSource ? 'Deleting...' : 'Delete Data Source'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Re-ingest Confirmation Dialog */}
      <AnimatePresence>
        {showReIngestConfirm && (
          <motion.div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowReIngestConfirm(null)}
          >
            <motion.div 
              className="bg-card p-6 rounded-xl shadow-2xl max-w-md w-full mx-4 border border-border"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-primary/10">
                  <RotateCcw className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-foreground">Re-ingest Data Source</h3>
              </div>
              <p className="text-muted-foreground mb-6">
                This will re-fetch and re-process all content from this data source. Existing documents will be updated with fresh content.
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  variant="ghost"
                  onClick={() => setShowReIngestConfirm(null)}
                  disabled={isReIngesting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => handleReloadDataSource(showReIngestConfirm)}
                  disabled={isReIngesting}
                >
                  {isReIngesting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {isReIngesting ? 'Re-ingesting...' : 'Re-ingest'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Ingestor Confirmation Dialog */}
      <AnimatePresence>
        {showDeleteIngestorConfirm && (
          <motion.div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDeleteIngestorConfirm(null)}
          >
            <motion.div 
              className="bg-card p-6 rounded-xl shadow-2xl max-w-md w-full mx-4 border border-border"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <Trash2 className="h-5 w-5 text-destructive" />
                </div>
                <h3 className="text-lg font-bold text-foreground">Delete Ingestor</h3>
              </div>
              <p className="text-muted-foreground mb-4">
                Are you sure you want to delete this ingestor?
              </p>
              <div className="bg-primary/10 border-l-4 border-primary p-3 mb-6 rounded-r-lg">
                <p className="text-sm text-primary">
                  <strong>Note:</strong> This will only remove the ingestor metadata. It will <strong>NOT</strong> delete any associated datasources or ingested data.
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <Button
                  variant="ghost"
                  onClick={() => setShowDeleteIngestorConfirm(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDeleteIngestor(showDeleteIngestorConfirm)}
                >
                  Delete Ingestor
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
