# Copyright 2025 CNOE
# SPDX-License-Identifier: apache-2.0

import logging
import os
from langchain.chains import RetrievalQA
from langchain_milvus import Milvus
from langchain_openai import AzureOpenAIEmbeddings
from pymilvus import connections
from cnoe_agent_utils import LLMFactory
from langchain.prompts import PromptTemplate
from langchain_core.retrievers import BaseRetriever
from langchain_core.documents import Document
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from typing import List
from sentence_transformers import CrossEncoder
import numpy as np

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

class RerankingRetriever(BaseRetriever):
    """
    Custom retriever that adds reranking functionality to improve document relevance.
    """
    
    def __init__(self, vector_store: Milvus, reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2", 
                 initial_k: int = 10, final_k: int = 3):
        """
        Initialize the reranking retriever.
        
        Args:
            vector_store: The Milvus vector store
            reranker_model: HuggingFace cross-encoder model for reranking
            initial_k: Number of documents to retrieve initially
            final_k: Number of documents to return after reranking
        """
        super().__init__()
        self._vector_store = vector_store
        self._initial_k = initial_k
        self._final_k = final_k
        self._reranker_model = reranker_model
        
        # Initialize reranker model
        try:
            self._reranker = CrossEncoder(reranker_model)
            logger.info(f"Initialized reranker with model: {reranker_model}")
        except Exception as e:
            logger.warning(f"Failed to load reranker model {reranker_model}: {e}. Falling back to no reranking.")
            self._reranker = None
    
    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> List[Document]:
        """
        Retrieve and rerank documents based on query relevance.
        """
        debug_print(f"Retrieving documents for query: {query}")
        
        # Get initial set of documents
        base_retriever = self._vector_store.as_retriever(search_kwargs={"k": self._initial_k})
        initial_docs = base_retriever.invoke(query)
        
        debug_print(f"Retrieved {len(initial_docs)} initial documents")
        
        if not initial_docs:
            debug_print("No documents retrieved from vector store")
            return []
        
        if self._reranker is None:
            debug_print("No reranker available, returning top documents")
            return initial_docs[:self._final_k]
        
        # Prepare query-document pairs for reranking
        query_doc_pairs = [(query, doc.page_content) for doc in initial_docs]
        
        try:
            # Get reranking scores
            scores = self._reranker.predict(query_doc_pairs)
            
            # Convert to numpy array for easier handling
            if not isinstance(scores, np.ndarray):
                scores = np.array(scores)
            
            debug_print(f"Reranking scores: {scores.tolist()}")
            
            # Sort documents by reranking scores (higher is better)
            doc_score_pairs = list(zip(initial_docs, scores))
            doc_score_pairs.sort(key=lambda x: x[1], reverse=True)
            
            # Log the reranking results
            for i, (doc, score) in enumerate(doc_score_pairs[:self._final_k]):
                debug_print(f"Rank {i+1}: Score {score:.4f}, Source: {doc.metadata.get('source', 'Unknown')}", banner=False)
            
            # Return top final_k reranked documents
            reranked_docs = [doc for doc, _ in doc_score_pairs[:self._final_k]]
            
            debug_print(f"Returning {len(reranked_docs)} reranked documents")
            return reranked_docs
            
        except Exception as e:
            logger.error(f"Error during reranking: {e}. Falling back to original retrieval.")
            return initial_docs[:self._final_k]

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
            # Parse host and port from URI
            logger.info(f"DEBUG: Milvus URI: {milvus_uri}")
            # parsed = urlparse(milvus_uri)
            self.milvus_conn = {
                "uri": milvus_uri
            }
            logger.info(f"DEBUG: Milvus Connection: {self.milvus_conn}")
            
            # Initialize LLM using LLMFactory
            llm_factory = LLMFactory()
            self.llm = llm_factory.get_llm()
            
            # Initialize embeddings with configurable model
            embeddings_deployment = os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-large")
            self.embeddings = AzureOpenAIEmbeddings(
                deployment=embeddings_deployment,
                chunk_size=1
            )
            
            # Connect to Milvus
            if 'host' in self.milvus_conn and 'port' in self.milvus_conn:
                debug_print(f"Connecting to Milvus at {self.milvus_conn['host']}:{self.milvus_conn['port']}")
            elif 'uri' in self.milvus_conn:
                debug_print(f"Connecting to Milvus at {self.milvus_conn['uri']}")
            else:
                debug_print(f"Connecting to Milvus with connection args: {self.milvus_conn}")
            connections.connect(alias="default", **self.milvus_conn)
            
            # Get collection name from environment (must be set)
            self.collection_name = os.environ.get('VSTORE_COLLECTION', 'rag_unified')
            logger.info(f"Using collection '{self.collection_name}'")
            
            # Reranking configuration
            self.enable_reranking = os.getenv("ENABLE_RERANKING", "false").lower() == "true"
            self.reranker_model = "cross-encoder/ms-marco-MiniLM-L-6-v2"
            self.initial_k = int(os.getenv("INITIAL_RETRIEVAL_K", "10"))
            self.final_k = int(os.getenv("FINAL_RETRIEVAL_K", "3"))
            
            debug_print(f"Reranking enabled: {self.enable_reranking}")
            debug_print(f"Reranker model: {self.reranker_model}")
            debug_print(f"Initial K: {self.initial_k}, Final K: {self.final_k}")
            
            # Check if collection exists with retry mechanism
            # max_retries = int(os.environ.get('MILVUS_MAX_RETRIES', '10'))
            # retry_delay = int(os.environ.get('MILVUS_RETRY_DELAY', '10'))  # seconds
            # collection_exists = False
            
            # for attempt in range(1, max_retries + 1):
            #     try:
            #         debug_print(f"Attempting to connect to collection '{self.collection_name}' (attempt {attempt}/{max_retries})")
            #         logger.info(f"Checking collection existence - attempt {attempt}/{max_retries}")
                    
            #         if utility.has_collection(self.collection_name, using="default"):
            #             collection_exists = True
            #             debug_print(f"Successfully found collection '{self.collection_name}' on attempt {attempt}")
            #             logger.info(f"Collection '{self.collection_name}' found on attempt {attempt}")
            #             break
            #         else:
            #             if attempt < max_retries:
            #                 debug_print(f"Collection '{self.collection_name}' not found. Waiting {retry_delay} seconds before retry...")
            #                 logger.info(f"Collection '{self.collection_name}' not found. Retrying in {retry_delay} seconds...")
            #                 time.sleep(retry_delay)
            #             else:
            #                 debug_print(f"Collection '{self.collection_name}' not found after {max_retries} attempts")
            #                 logger.error(f"Collection '{self.collection_name}' not found after {max_retries} attempts")
                            
            #     except Exception as e:
            #         if attempt < max_retries:
            #             debug_print(f"Error checking collection on attempt {attempt}: {str(e)}. Retrying in {retry_delay} seconds...")
            #             logger.warning(f"Error checking collection on attempt {attempt}: {str(e)}. Retrying...")
            #             time.sleep(retry_delay)
            #         else:
            #             debug_print(f"Failed to check collection after {max_retries} attempts: {str(e)}")
            #             logger.error(f"Failed to check collection after {max_retries} attempts: {str(e)}")
            #             raise
            
            # if not collection_exists:
            #     error_msg = f"Collection '{self.collection_name}' does not exist after {max_retries} attempts. Please ensure the vector store is properly initialized."
            #     logger.error(error_msg)
            #     raise ValueError(error_msg)
            

            # Create a smart, generalized RAG prompt
            self.prompt_template = PromptTemplate(
                input_variables=["context", "question"],
                template="""
                You are a Retrieval-Augmented Generation (RAG) assistant. Answer the user's question using only the information provided in the retrieved Documents below. 
                The chucked documents you might have is very unorganized, try to first organize it and then make sense of what it's saying. You must try giving a answer in the best of your ability. 
                Try to compound as many words as well but only if they relate the documents of the question. Do not make things up, always use relevant documents.
                Always include the source of the document in the answer (if available).
                Do not make up answers or use outside knowledge. Be concise and accurate, and cite relevant sources.


                Documents:
                {context}

                Question:
                {question}

                Answer:
                """
            )

            # Initialize these when needed
            self.qa_chain = None
            self.vector_store = None
            self.reranking_retriever = None
            
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

            if self.vector_store is None:
                # Initialize vector store
                self.vector_store = Milvus(
                    embedding_function=self.embeddings,
                    collection_name=self.collection_name,
                    connection_args=self.milvus_conn,
                    drop_old=False,
                )
            
            if self.qa_chain is None:
                # Initialize retriever based on reranking configuration
                if self.enable_reranking:
                    debug_print("Using reranking retriever")
                    self.reranking_retriever = RerankingRetriever(
                        vector_store=self.vector_store,
                        reranker_model=self.reranker_model,
                        initial_k=self.initial_k,
                        final_k=self.final_k
                    )
                    retriever = self.reranking_retriever
                else:
                    debug_print("Using standard retriever")
                    retriever = self.vector_store.as_retriever(search_kwargs={"k": self.final_k})
                
                # Initialize QA chain 
                self.qa_chain = RetrievalQA.from_chain_type(
                    llm=self.llm,
                    chain_type="stuff",
                    retriever=retriever,
                    # chain_type_kwargs={"prompt": prompt_template, "document_prompt":PromptTemplate.from_template("{page_content} {metadata}")},
                    chain_type_kwargs={"prompt": self.prompt_template},
                    return_source_documents=True,
                    verbose=True,
                )

            debug_print(f"Successfully connected to collection '{self.collection_name}'")
            logger.info(f"Successfully connected to collection '{self.collection_name}'")

            # Get answer
            result = self.qa_chain.invoke({"query": question})
            answer = result["result"]
            sources = result["source_documents"]
            
            # Add reranking info to debug output
            if self.enable_reranking and self.reranking_retriever and self.reranking_retriever._reranker:
                debug_print(f"Answer generated using reranked documents (model: {self.reranker_model})", banner=False)
            else:
                debug_print("Answer generated using standard retrieval (no reranking)", banner=False)
            
            for source in sources:
                debug_print(f"Source: {source.metadata.get('source', 'No source found')}", banner=False)
                answer += f"\nSource: {source.metadata.get('source', 'No source found')}"
            debug_print(f"Generated answer: {answer}")
            logger.info(f"Generated answer: {answer}")
            return answer
            
        except Exception as e:
            logger.error(f"Error answering question: {str(e)}", exc_info=True)
            raise

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain'] 