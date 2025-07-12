# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import os
from langchain.chains import RetrievalQA
from langchain_milvus import Milvus
from langchain_openai import OpenAIEmbeddings
from pymilvus import connections, utility
from cnoe_agent_utils import LLMFactory

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def debug_print(message: str, banner: bool = True):
    if os.getenv("A2A_SERVER_DEBUG", "false").lower() == "true":
        if banner:
            print("=" * 80)
        print(f"DEBUG: {message}")
        if banner:
            print("=" * 80)

class RAGAgent:
    """
    RAG Agent for answering questions using a predefined Milvus collection.
    """
    def __init__(self, milvus_uri: str):
        """
        Initialize the RAG agent with Milvus vector store.
        """
        debug_print(f"Initializing RAG agent with Milvus URI: {milvus_uri}")
        logger.info(f"Initializing RAG agent with Milvus URI: {milvus_uri}")
        try:
            # Check for OpenAI API key
            openai_api_key = os.getenv('OPENAI_API_KEY')
            if not openai_api_key:
                raise ValueError("OPENAI_API_KEY environment variable is not set")
            
            # Parse host and port from URI
            from urllib.parse import urlparse
            parsed = urlparse(milvus_uri)
            self.milvus_conn = {
                "host": parsed.hostname or "localhost",
                "port": str(parsed.port or 19530)
            }
            
            # Initialize LLM using LLMFactory
            llm_factory = LLMFactory()
            self.llm = llm_factory.get_llm()
            
            # Initialize embeddings directly
            self.embeddings = OpenAIEmbeddings(
                api_key=openai_api_key,
                deployment="text-embedding-3-small",
                chunk_size=1
            )
            
            # Connect to Milvus
            debug_print(f"Connecting to Milvus at {self.milvus_conn['host']}:{self.milvus_conn['port']}")
            connections.connect(alias="default", **self.milvus_conn)
            
            # Get collection name from environment
            vectorstore_name = os.getenv('VECTORSTORE_NAME', 'outshift_docs')
            self.collection_name = f"rag_{vectorstore_name}"
            
            # Check if collection exists
            if not utility.has_collection(self.collection_name, using="default"):
                error_msg = f"Collection '{self.collection_name}' does not exist. Please ensure the vector store is properly initialized."
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            # Initialize vector store
            self.vector_store = Milvus(
                embedding_function=self.embeddings,
                collection_name=self.collection_name,
                connection_args=self.milvus_conn,
                drop_old=False,
            )
            debug_print(f"Successfully connected to collection '{self.collection_name}'")
            logger.info(f"Successfully connected to collection '{self.collection_name}'")
            
            # Create QA chain
            self.qa_chain = RetrievalQA.from_chain_type(
                llm=self.llm,
                chain_type="stuff",
                retriever=self.vector_store.as_retriever(search_kwargs={"k": 5})
            )
            
        except Exception as e:
            logger.error(f"Error initializing RAG agent: {str(e)}", exc_info=True)
            raise

    def answer_question(self, question: str) -> str:
        """
        Retrieve relevant docs and answer the question using an LLM.
        """
        if not isinstance(question, str):
            error_msg = f"Question must be a string, got {type(question)}"
            logger.error(error_msg)
            raise TypeError(error_msg)
            
        debug_print(f"Answering question: {question}")
        logger.info(f"Answering question: {question}")
        try:
            # Get answer
            answer = self.qa_chain.invoke({"query": question})["result"]
            debug_print(f"Generated answer: {answer}")
            logger.info(f"Generated answer: {answer}")
            return answer
            
        except Exception as e:
            logger.error(f"Error answering question: {str(e)}", exc_info=True)
            raise

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain'] 