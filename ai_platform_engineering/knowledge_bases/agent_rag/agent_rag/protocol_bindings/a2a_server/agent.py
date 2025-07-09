# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
from typing import List, Optional
import httpx
from bs4 import BeautifulSoup
from langchain_milvus import Milvus
from langchain_core.documents import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain.chains import RetrievalQA

# Configure logging
logger = logging.getLogger(__name__)

class RAGAgent:
    """
    RAG Agent for ingesting documentation from a URL and answering questions using RAG.
    """
    def __init__(self, milvus_uri: str, embedding_model: str = "openai"):
        """
        Initialize the RAG agent with Milvus vector store and embedding model.
        """
        logger.info(f"Initializing RAG agent with Milvus URI: {milvus_uri}")
        try:
            # Initialize components
            self.embeddings = OpenAIEmbeddings()
            self.llm = ChatOpenAI(temperature=0)
            self.text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000,
                chunk_overlap=200
            )
            
            # Initialize or get Milvus collection
            self.collection_name = "documentation"
            try:
                self.vector_store = Milvus(
                    embedding_function=self.embeddings,
                    collection_name=self.collection_name,
                    connection_args={"uri": milvus_uri}
                )
            except Exception:
                logger.warning("No existing collection found")
                self.vector_store = None
                
        except Exception as e:
            logger.error(f"Error initializing RAG agent: {str(e)}", exc_info=True)
            raise

    def ingest_url(self, url: str) -> None:
        """
        Fetch content from URL, chunk it, and store in Milvus.
        """
        logger.info(f"Ingesting content from URL: {url}")
        try:
            # Fetch content
            response = httpx.get(url)
            response.raise_for_status()
            
            # Extract text using BeautifulSoup
            soup = BeautifulSoup(response.text, 'html.parser')
            # Remove script and style elements
            for script in soup(["script", "style"]):
                script.decompose()
            text = soup.get_text(separator='\n', strip=True)
            
            # Create document
            doc = Document(page_content=text, metadata={"source": url})
            
            # Split into chunks
            chunks = self.text_splitter.split_documents([doc])
            
            # Create or update vector store
            self.vector_store = Milvus.from_documents(
                documents=chunks,
                embedding=self.embeddings,
                collection_name=self.collection_name
            )
            logger.info(f"Successfully ingested {len(chunks)} chunks from {url}")
            
        except Exception as e:
            logger.error(f"Error ingesting URL: {str(e)}", exc_info=True)
            raise

    def answer_question(self, question: str, k: int = 5) -> str:
        """
        Retrieve relevant docs from Milvus and answer the question using an LLM.
        """
        logger.info(f"Answering question: {question}")
        try:
            if not self.vector_store:
                return "No documentation has been ingested yet. Please ingest some content first."
            
            # Create QA chain
            qa_chain = RetrievalQA.from_chain_type(
                llm=self.llm,
                chain_type="stuff",
                retriever=self.vector_store.as_retriever(search_kwargs={"k": k})
            )
            
            # Get answer
            answer = qa_chain.run(question)
            logger.info(f"Generated answer: {answer}")
            return answer
            
        except Exception as e:
            logger.error(f"Error answering question: {str(e)}", exc_info=True)
            raise 