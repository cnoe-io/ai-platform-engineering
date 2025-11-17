import json
import time
import traceback
from common import utils
from langchain_core.documents import Document
from common.models.rag import DocumentChunkMetadata, DocumentMetadata
from typing import List, Optional, Tuple
from common.models.graph import Entity
from langchain_milvus import Milvus
from common.graph_db.base import GraphDB
from common.job_manager import JobManager
from common.constants import INGESTOR_ID_KEY, DATASOURCE_ID_KEY, LAST_UPDATED_KEY, FRESH_UNTIL_KEY

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter


class DocumentProcessor:
    def __init__(self, vstore: Milvus, job_manager: JobManager, graph_rag_enabled: bool, data_graph_db: Optional[GraphDB] = None):
        self.vstore = vstore
        self.data_graph_db = data_graph_db
        self.graph_rag_enabled = graph_rag_enabled
        self.job_manager = job_manager
        self.logger = utils.get_logger("DocumentProcessor")


    @staticmethod
    def graph_document_type(entity_type: str) -> str:
        return f"graph:{entity_type}"

    @staticmethod
    def graph_document_id(entity_type: str, entity_pk: str) -> str:
        return f"graph:{entity_type}:{entity_pk}"
    
    @staticmethod
    def parse_graph_entity_from_document_id(document_id: str) -> Tuple[str, str]:
        """
        Parse entity_type and entity_pk from a graph document ID of the form "graph:entity_type:entity_pk"
        """
        parts = document_id.split(":")
        if len(parts) < 3 or parts[0] != "graph":
            raise ValueError(f"Invalid graph document ID format: {document_id}")
        entity_type = parts[1]
        entity_pk = ":".join(parts[2:])  # In case entity_pk contains ':'
        return entity_type, entity_pk

    def _parse_document_metadata(self, doc: Document) -> DocumentMetadata:
        """
        Parse document metadata from Document.metadata dict into DocumentMetadata model.
        """
        try:
            return DocumentMetadata.model_validate(doc.metadata)
        except Exception as e:
            self.logger.error(f"Failed to parse document metadata: {e}")
            raise ValueError(f"Invalid document metadata: {e}")

    def _parse_graph_entity(self, doc: Document) -> Entity:
        """
        Parse document page_content into a graph Entity if it's a graph entity document.
        """
        try:
            # Use Pydantic's model_validate_json to parse JSON string directly into Entity
            entity = Entity.model_validate_json(doc.page_content)
            return entity
        except Exception as e:
            self.logger.error(f"Failed to parse graph entity from document: {e}")
            raise ValueError(f"Invalid graph entity document: {e}")

    def _chunk_document(self, doc: Document, document_metadata: DocumentMetadata, 
                       chunk_size: int, chunk_overlap: int) -> List[Document]:
        """
        Chunk a document if it exceeds chunk_size, otherwise return as single chunk.
        If chunk_size is 0, skip chunking entirely.
        """
        content = doc.page_content
        if not content:
            self.logger.warning("Empty content, returning empty chunks")
            return []

        chunks = []
        
        # Check if document needs chunking
        if len(content) > chunk_size and chunk_size > 0:
            self.logger.debug(f"Document exceeds chunk size ({len(content)} > {chunk_size}), splitting into chunks")
            
            # Create document-specific text splitter
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                length_function=len,
                separators=["\n\n", "\n", ". ", "? ", "! ", " ", ""]
            )
            
            doc_chunks = text_splitter.split_documents([doc])
            self.logger.debug(f"Split document into {len(doc_chunks)} chunks for: {document_metadata.document_id}")

            for i, chunk_doc in enumerate(doc_chunks):
                
                # Compute chunk id and add the metadata from document, as well as chunk-specific info
                chunk_id = f"{document_metadata.document_id}_chunk_{i}"
                chunk_metadata = DocumentChunkMetadata(
                    id=chunk_id,
                    document_id=document_metadata.document_id,
                    datasource_id=document_metadata.datasource_id,
                    ingestor_id=document_metadata.ingestor_id,
                    title=document_metadata.title,
                    description=document_metadata.description,
                    is_graph_entity=document_metadata.is_graph_entity,
                    document_type=document_metadata.document_type,
                    document_ingested_at=document_metadata.document_ingested_at,
                    fresh_until=document_metadata.fresh_until,
                    metadata=document_metadata.metadata,
                    chunk_index=i,
                    total_chunks=len(doc_chunks),
                )
                
                chunk_doc.metadata = chunk_metadata.model_dump()
                chunks.append(chunk_doc)
        else:

            if chunk_size == 0:
                self.logger.debug(f"Chunk size is 0, skipping chunking for: {document_metadata.document_id}")
            else:
                self.logger.debug(f"Document is smaller than chunk size, processing as single chunk: {document_metadata.document_id}")
            
            # Compute chunk id and add the metadata from document, as well as chunk-specific info
            chunk_id = f"{document_metadata.document_id}_chunk_0"
            chunk_metadata = DocumentChunkMetadata(
                id=chunk_id,
                document_id=document_metadata.document_id,
                datasource_id=document_metadata.datasource_id,
                ingestor_id=document_metadata.ingestor_id,
                title=document_metadata.title,
                description=document_metadata.description,
                is_graph_entity=document_metadata.is_graph_entity,
                document_type=document_metadata.document_type,
                document_ingested_at=document_metadata.document_ingested_at,
                fresh_until=document_metadata.fresh_until,
                metadata=document_metadata.metadata,
                chunk_index=0,
                total_chunks=1,
            )
            
            doc.metadata = chunk_metadata.model_dump()
            chunks.append(doc)
        
        return chunks

    async def ingest_documents(self, ingestor_id: str, datasource_id: str, job_id: str, 
                              documents: List[Document], fresh_until: int, chunk_size: int, chunk_overlap: int):
        """
        Process documents, splitting into chunks if necessary, and handle both regular documents and graph entities.
        
        Args:
            ingestor_id: ID of the ingestor ingesting the documents
            datasource_id: ID of the datasource ingesting the documents
            job_id: ID of the ingestion job
            documents: List of documents to ingest
            fresh_until: Timestamp until which this data is considered fresh (epoch seconds)
            chunk_size: Maximum size for document chunks
            chunk_overlap: Overlap between chunks
        """
        if not documents:
            self.logger.warning("No documents provided for ingestion")
            return

        self.logger.info(f"Starting ingestion of {len(documents)} documents")
        
        # Step 1: Process each document and collect chunks and graph entities
        all_chunks = []
        all_chunk_ids = []
        graph_entities_by_type = {}  # Dict[entity_type, List[Entity]]
        
        for doc in documents:
            try:
                # Step 1a: Parse document metadata
                document_metadata = self._parse_document_metadata(doc)

                # Override metadata fields - this is to ensure correct association (even if doc.metadata has different values)
                document_metadata.ingestor_id = ingestor_id
                document_metadata.datasource_id = datasource_id
                document_metadata.fresh_until = fresh_until
                document_metadata.document_ingested_at = int(time.time())

                # Step 1b: Check if it's a graph entity and parse if needed - and add metadata fields
                if self.graph_rag_enabled and document_metadata.is_graph_entity:
                    try:
                        entity = self._parse_graph_entity(doc)
                        entity_type = entity.entity_type

                        # Add document metadata fields to entity properties
                        entity.all_properties.update({
                            INGESTOR_ID_KEY: ingestor_id,
                            DATASOURCE_ID_KEY: datasource_id,
                            LAST_UPDATED_KEY: document_metadata.document_ingested_at,
                            FRESH_UNTIL_KEY: fresh_until
                        })
                        if entity_type not in graph_entities_by_type:
                            graph_entities_by_type[entity_type] = []
                        graph_entities_by_type[entity_type].append(entity)
                        
                        self.logger.debug(f"Parsed graph entity of type {entity_type}: {entity.generate_primary_key()}")
                    except Exception as e:
                        error_msg = f"Failed to parse graph entity: {e}"
                        self.logger.error(f"{error_msg}, skipping")
                        self.logger.error(traceback.format_exc())
                        await self.job_manager.add_error_msg(job_id, error_msg)
                        continue
                    
                    # Override document metadata for graph entity
                    document_metadata.document_id = self.graph_document_id(entity.entity_type, entity.generate_primary_key())
                    document_metadata.document_type = self.graph_document_type(entity.entity_type)
                
                else:
                    # adding this debug log to clarify processing of regular documents when graph RAG is disabled but document is a graph entity
                    if not self.graph_rag_enabled and document_metadata.is_graph_entity:
                        self.logger.debug(f"Document marked as graph entity but graph RAG is disabled, treating as regular document: {document_metadata.document_id}")

                # Step 2: Chunk the document (regardless of whether it's a graph entity)
                chunks = self._chunk_document(doc, document_metadata, chunk_size, chunk_overlap)
                
                for chunk in chunks:
                    chunk_metadata = DocumentChunkMetadata.model_validate(chunk.metadata)
                    all_chunks.append(chunk)
                    all_chunk_ids.append(chunk_metadata.id)
                
            except Exception as e:
                error_msg = f"Failed to parse and process document: {e}"
                self.logger.error(f"{error_msg}, skipping")
                self.logger.error(traceback.format_exc())
                await self.job_manager.add_error_msg(job_id, error_msg)
                continue
        
        # Step 3: Add all document chunks to vector database
        if all_chunks:
            self.logger.info(f"Adding {len(all_chunks)} document chunks to vector database")
            try:
                await self.vstore.aadd_documents(all_chunks, ids=all_chunk_ids)
                self.logger.info(f"Successfully added {len(all_chunks)} chunks to vector database")
            except Exception as e:
                error_msg = f"Failed to add chunks to vector database: {e}"
                self.logger.error(error_msg)
                self.logger.error(traceback.format_exc())
                await self.job_manager.add_error_msg(job_id, error_msg)
                raise
        
        # Step 4: Add graph entities to graph database by type
        if graph_entities_by_type and self.data_graph_db:
            self.logger.info(f"Adding graph entities to graph database: {list(graph_entities_by_type.keys())}")
            
            for entity_type, entities in graph_entities_by_type.items():
                try:
                    await self.data_graph_db.update_entity(
                        entity_type=entity_type,
                        entities=entities,
                    )
                    self.logger.info(f"Successfully added {len(entities)} entities of type {entity_type} to graph database")
                except Exception as e:
                    error_msg = f"Failed to add entities of type {entity_type} to graph database: {e}"
                    self.logger.error(error_msg)
                    self.logger.error(traceback.format_exc())
                    await self.job_manager.add_error_msg(job_id, error_msg)
                    # Continue with other entity types even if one fails
                    continue
        
        self.logger.info(f"Completed ingestion: {len(all_chunks)} chunks, {sum(len(entities) for entities in graph_entities_by_type.values())} graph entities")
