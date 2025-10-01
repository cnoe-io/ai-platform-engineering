# This file contains metadata storage class for the RAG server
import datetime
import json
from typing import Optional, List
import redis.asyncio as redis
from common.models.rag import DataSourceInfo, DocumentInfo, GraphConnectorInfo

class MetadataStorage:
    """
    Metadata storage class for the RAG server.
    """
    def __init__(self, redis_client: redis.Redis):
        self.redis_client = redis_client

    async def setup(self):
        """Initialize the metadata storage"""
        # Ping the redis server to check if it is ready
        await self.redis_client.ping()
    
    async def store_datasource_info(self, source_info: DataSourceInfo, ttl: int = 0):
        """Store datasource information in Redis"""
        if ttl > 0:
            await self.redis_client.setex(
                f"rag/datasource:{source_info.datasource_id}",
                ttl,
                json.dumps(source_info.model_dump(), default=str)
            )
        else:
            await self.redis_client.set(
                f"rag/datasource:{source_info.datasource_id}",
                json.dumps(source_info.model_dump(), default=str)
            )

    async def get_datasource_info(self, datasource_id: str) -> Optional[DataSourceInfo]:
        """Retrieve datasource information from Redis"""
        source_data = await self.redis_client.get(f"rag/datasource:{datasource_id}")
        if source_data:
            data = json.loads(source_data)
            data['created_at'] = datetime.datetime.fromisoformat(data['created_at'])
            data['last_updated'] = datetime.datetime.fromisoformat(data['last_updated'])
            return DataSourceInfo(**data)
        return None
    


    async def fetch_all_datasource_ids(self) -> List[str]:
        """List all stored datasource IDs"""
        keys = await self.redis_client.keys("rag/datasource:*")
        return [key.replace("rag/datasource:", "") for key in keys]

    async def fetch_all_datasource_info(self) -> List[DataSourceInfo]:
        """List all stored datasource information"""
        keys = await self.redis_client.keys("rag/datasource:*")
        return [DataSourceInfo(**json.loads(await self.redis_client.get(key))) for key in keys]
    
    # Graph connector management methods
    async def store_graphconnector_info(self, connector_info: GraphConnectorInfo, ttl: int = 0):
        """Store graph connector information in Redis"""
        if ttl > 0:
            await self.redis_client.setex(
                f"graph_rag/graphconnector:{connector_info.connector_id}",
                ttl,
                json.dumps(connector_info.model_dump(), default=str)
            )
        else:
            await self.redis_client.set(
                f"graph_rag/graphconnector:{connector_info.connector_id}",
                json.dumps(connector_info.model_dump(), default=str)
            )

    async def get_graphconnector_info(self, connector_id: str) -> Optional[GraphConnectorInfo]:
        """Retrieve graph connector information from Redis"""
        connector_data = await self.redis_client.get(f"graph_rag/graphconnector:{connector_id}")
        if connector_data:
            data = json.loads(connector_data)
            if data.get('last_seen'):
                data['last_seen'] = datetime.datetime.fromisoformat(data['last_seen'])
            return GraphConnectorInfo(**data)
        return None

    async def fetch_all_graphconnector_ids(self) -> List[str]:
        """List all stored graph connector IDs"""
        keys = await self.redis_client.keys("graph_rag/graphconnector:*")
        return [key.replace("graph_rag/graphconnector:", "") for key in keys]

    async def fetch_all_graphconnector_info(self) -> List[GraphConnectorInfo]:
        """List all stored graph connector information"""
        keys = await self.redis_client.keys("graph_rag/graphconnector:*")
        result = []
        for key in keys:
            connector_data = await self.redis_client.get(key)
            if connector_data:
                data = json.loads(connector_data)
                if data.get('last_seen'):
                    data['last_seen'] = datetime.datetime.fromisoformat(data['last_seen'])
                result.append(GraphConnectorInfo(**data))
        return result

    async def delete_graphconnector_info(self, connector_id: str):
        """Delete graph connector information from Redis"""
        await self.redis_client.delete(f"graph_rag/graphconnector:{connector_id}")
    
    # Redis helper functions for document management
    async def store_document_info(self, document_info: DocumentInfo):
        """Store document information in Redis"""
        await self.redis_client.set(
            f"rag/document:{document_info.document_id}",
            json.dumps(document_info.model_dump(), default=str)
        )
        # Add to source's document list
        await self.redis_client.sadd(f"rag/datasource_documents:{document_info.datasource_id}", document_info.document_id) # type: ignore

    async def get_document_info(self, document_id: str) -> Optional[DocumentInfo]:
        """Retrieve document information from Redis"""
        document_data = await self.redis_client.get(f"rag/document:{document_id}")
        if document_data:
            data = json.loads(document_data)
            data['created_at'] = datetime.datetime.fromisoformat(data['created_at'])
            return DocumentInfo(**data)
        return None

    # Redis helper functions for statistics
    async def update_source_stats(self, datasource_id: str):
        """Update source statistics (document and chunk counts)"""
        source_info = await self.get_datasource_info(datasource_id)
        total_documents = 0
        if source_info:
            # Count documents
            document_ids = await self.redis_client.smembers(f"rag/datasource_documents:{datasource_id}") # type: ignore
            total_documents = len(document_ids)
            
            # Update source info
            source_info.total_documents = total_documents
            source_info.last_updated = datetime.datetime.now(datetime.timezone.utc)
        
            await self.store_datasource_info(source_info)

    # Redis cleanup functions
    async def delete_datasource_info(self, datasource_id: str):
        """Clear all data for a specific source"""
        keys = []
        keys.extend(await self.redis_client.keys(f"rag/datasource:{datasource_id}*"))
        keys.extend(await self.redis_client.keys(f"rag/datasource_documents:{datasource_id}*"))
        keys.extend(await self.redis_client.keys(f"rag/document:{datasource_id}*"))
        if keys:
            await self.redis_client.delete(*keys)

    async def clear_all_data(self):
        """Clear all Redis data"""
        datasource_keys = await self.redis_client.keys("rag/datasource:*")
        document_keys = await self.redis_client.keys("rag/document:*")
        relation_keys = await self.redis_client.keys("rag/datasource_documents:*")
        graphconnector_keys = await self.redis_client.keys("graph_rag/graphconnector:*")
        
        all_keys = datasource_keys + document_keys + relation_keys + graphconnector_keys
        if all_keys:
            await self.redis_client.delete(*all_keys)
