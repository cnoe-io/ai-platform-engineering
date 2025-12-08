export type QueryResult = {
	document: {
		page_content?: string
		metadata?: Record<string, unknown>
	}
	score: number
}

export type IngestionJob = {
	job_id: string
	status: 'pending' | 'in_progress' | 'completed' | 'completed_with_errors' | 'failed' | 'terminated'
	message: string
	progress_counter: number
	failed_counter: number
	total: number
	created_at: string
	completed_at?: string
	error_msgs?: string[]
}

export type IngestorInfo = {
	ingestor_id: string
	ingestor_type: string
	ingestor_name: string
	description?: string
	last_seen?: number
	metadata?: Record<string, unknown>
}

export type DataSourceInfo = {
	datasource_id: string
	ingestor_id: string
	description: string
	source_type: string
	default_chunk_size: number
	default_chunk_overlap: number
	last_updated: number
	metadata?: Record<string, unknown>
}