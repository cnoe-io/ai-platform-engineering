import os
import hashlib
import pickle
import logging
from bs4 import BeautifulSoup
import requests

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chains import RetrievalQA
from langchain_community.vectorstores import Milvus
from langchain_openai import AzureChatOpenAI, OpenAIEmbeddings
from pymilvus import connections, utility  # Milvus connection & utility APIs

from urllib.parse import urlparse

# ─── Global settings ─────────────────────────────────────────────────────────
CACHE_DIR = "rag_cache"
RAW_TEXT_DIR = "rag_raw"
MILVUS_CONN = {"host": "localhost", "port": "19530"}

os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(RAW_TEXT_DIR, exist_ok=True)

# Configure logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def scrape_text_from_url(url: str) -> str:
    """Fetch URL → raw HTML → plain text."""
    logger.info(f"Scraping URL: {url}")
    resp = requests.get(url)
    resp.raise_for_status()
    html = resp.text
    text = BeautifulSoup(html, "html.parser").get_text()
    logger.info(f"Finished scraping: extracted {len(text)} characters")
    return text

def save_raw_text(url: str, text: str):
    """Save the scraped text to a .txt file for inspection."""
    fn = hashlib.sha256(url.encode()).hexdigest() + ".txt"
    path = os.path.join(RAW_TEXT_DIR, fn)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    logger.info(f"Raw text saved to {path}")

def split_text(text: str):
    """Turn text into overlapping 500-char chunks."""
    logger.info("Splitting text into chunks")
    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    chunks = splitter.split_text(text)
    logger.info(f"Generated {len(chunks)} chunks")
    return chunks

def get_chunks_for_url(url: str, save_raw: bool = True):
    """
    Disk–cache the list of chunks for each URL, and optionally save raw text.
    Returns list of text chunks.
    """
    # compute cache path
    fn_hash = hashlib.sha256(url.encode()).hexdigest()
    cache_path = os.path.join(CACHE_DIR, fn_hash + ".pkl")

    if os.path.exists(cache_path):
        logger.info(f"Cache hit: loading chunks from {cache_path}")
        with open(cache_path, "rb") as f:
            chunks = pickle.load(f)
    else:
        logger.info(f"Cache miss: no cache at {cache_path}, scraping & splitting")
        raw = scrape_text_from_url(url)
        if save_raw:
            save_raw_text(url, raw)
        chunks = split_text(raw)
        with open(cache_path, "wb") as f:
            pickle.dump(chunks, f)
        logger.info(f"Saved {len(chunks)} chunks to cache at {cache_path}")

    return chunks

def domain_label(url: str) -> str:
    # parse out the hostname
    hostname = urlparse(url).hostname or ""
    parts = hostname.split(".")
    # if it’s foo.example.com or example.com → take the 2nd-to-last
    if len(parts) >= 2:
        return parts[-2]
    # fallback (e.g. "localhost" or weird URLs)
    return parts[0]  

def create_milvus_vectorstore(chunks, collection_name="rag_web_docs"):
    """
    If the Milvus collection exists, connect (skip embedding).
    Otherwise, create & insert.
    """
    logger.info(f"Connecting to Milvus at {MILVUS_CONN['host']}:{MILVUS_CONN['port']}")
    connections.connect(alias="default", **MILVUS_CONN)

    embeddings = OpenAIEmbeddings(
        deployment="text-embedding-3-small",
        chunk_size=1
    )

    logger.info(f"Checking for existing collection '{collection_name}' in Milvus")
    if utility.has_collection(collection_name, using="default"):
        logger.info(f"Collection '{collection_name}' found: loading existing embeddings")
        vectorstore = Milvus(
            embedding_function=embeddings,
            collection_name=collection_name,
            connection_args=MILVUS_CONN,
            drop_old=False,
        )
    else:
        logger.info(f"Collection '{collection_name}' not found: creating new and inserting embeddings")
        vectorstore = Milvus.from_texts(
            texts=chunks,
            embedding=embeddings,
            metadatas=[{"source": collection_name}] * len(chunks),
            collection_name=collection_name,
            connection_args=MILVUS_CONN,
            drop_old=False,
        )
        logger.info(f"Inserted {len(chunks)} embeddings into '{collection_name}'")

    return vectorstore

def build_rag_chain(vectorstore):
    """Builds the RAG chain with Azure GPT-4o and your Milvus retriever."""
    logger.info("Initializing Azure GPT-4o LLM")
    llm = AzureChatOpenAI(
        deployment_name="gpt-4o",
        model_name=None,
        temperature=0
    )
    logger.info("Creating retriever from vectorstore")
    retriever = vectorstore.as_retriever(search_type="similarity", search_kwargs={"k": 5})
    logger.info("Building RetrievalQA chain")
    chain = RetrievalQA.from_chain_type(
        llm=llm,
        retriever=retriever,
        return_source_documents=True
    )
    return chain

def build_rag_from_url(url: str):
    """Runs full pipeline: scrape, cache, embed, and build QA chain."""
    logger.info(f"=== Starting RAG pipeline for URL: {url} ===")
    label = domain_label(url)
    collection_name = f"rag_{label}" 
    chunks = get_chunks_for_url(url, save_raw=True)
    vs = create_milvus_vectorstore(chunks, collection_name)
    chain = build_rag_chain(vs)
    logger.info(f"=== Completed RAG pipeline for URL: {url} ===")
    return chain

if __name__ == "__main__":
    target_url = "https://www.rehanagrawal.com/inverted-pendulum"
    rag_chain = build_rag_from_url(target_url)
    query = "What do you know about the inverted pendulum?"
    logger.info(f"Running query: '{query}'")
    result = rag_chain({"query": query})
    logger.info("Query complete. Answer:")
    print(result["result"])
    logger.info(f"Retrieved {len(result['source_documents'])} source documents")
