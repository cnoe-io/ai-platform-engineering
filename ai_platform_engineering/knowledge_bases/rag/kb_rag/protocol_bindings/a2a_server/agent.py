# Copyright 2025 CNOE
# SPDX-License-Identifier: apache-2.0

import logging
import os
from langchain.chains import RetrievalQA
from langchain_milvus import Milvus
from langchain_openai import AzureOpenAIEmbeddings
from pymilvus import connections, utility
from cnoe_agent_utils import LLMFactory
from langchain.prompts import PromptTemplate

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
            
            # Initialize embeddings directly
            self.embeddings = AzureOpenAIEmbeddings(
                deployment="text-embedding-3-small",
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
            self.collection_name = os.environ.get('VSTORE_COLLECTION', 'default')
            logger.info(f"Using collection '{self.collection_name}'")
            
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
            
            # Create a smart, generalized RAG prompt
            prompt_template = PromptTemplate(
                input_variables=["context", "question"],
                template="""
                You are a Retrieval-Augmented Generation (RAG) assistant. Answer the user's question using only the information provided in the retrieved context below. 
                The chucked context you might have is very unorganized, try to first organize it and then make sense of what it's saying. You must try giving a answer in the best of your ability. 
                Try to compound as many words as well but only if they relate the context of the question. Do not Hallucinate. If the URL is part of the chunked context, you must add the URL when you output.
                Do not make up answers or use outside knowledge. Be concise and accurate, and cite relevant context if possible.

                Context:
                {context}

                Question:
                {question}

                Answer:
                """
            )
            # Create QA chain with the custom prompt
            self.qa_chain = RetrievalQA.from_chain_type(
                llm=self.llm,
                chain_type="stuff",
                retriever=self.vector_store.as_retriever(search_kwargs={"k": 8}),
                chain_type_kwargs={"prompt": prompt_template}
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
            # Get relevant documents first
            retriever = self.vector_store.as_retriever(search_kwargs={"k": 8})
            relevant_docs = retriever.get_relevant_documents(question)
            
            debug_print("Retrieved RAG chunks:")
            for i, doc in enumerate(relevant_docs, 1):
                # 20 dashes, space, Chunk i, space, 20 dashes
                sep = "-" * 20
                debug_print(f"{sep} Chunk {i} {sep}", banner=False)
                debug_print(f"Content: {doc.page_content}", banner=False)
                if hasattr(doc, 'metadata') and doc.metadata:
                    debug_print(f"Metadata: {doc.metadata}", banner=False)

            
            # Get answer
            answer = self.qa_chain.invoke({"query": question})["result"]
            debug_print(f"Generated answer: {answer}")
            logger.info(f"Generated answer: {answer}")
            return answer
            
        except Exception as e:
            logger.error(f"Error answering question: {str(e)}", exc_info=True)
            raise

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain'] 