export type QueryResult = {
	document: {
		page_content?: string
		metadata?: Record<string, unknown>
	}
	score: number
}

export type QueryResponse = {
	query: string
	results: Array<QueryResult>
}

export type IngestionJob = {
	job_id: string
	status: 'pending' | 'in_progress' | 'completed' | 'completed_with_errors' | 'failed' | 'terminated'
	message: string
	processed_counter: number
	failed_counter: number
	total: number
	created_at: string
	completed_at?: string
	error?: string
	errors?: string[]
}

export type DataSourceInfo = {
	datasource_id: string
	path: string
	description: string
	source_type: string
	default_chunk_size: number
	default_chunk_overlap: number
	created_at: string
	last_updated: string
	total_documents: number
	total_chunks: number
	metadata?: Record<string, unknown>
	job_id?: string
}

export type GraphConnectorInfo = {
	connector_id: string
	connector_name: string
	connector_type: string
	description?: string
	last_seen?: string
	total_entities: number
}