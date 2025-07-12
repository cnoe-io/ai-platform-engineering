import os
import logging
import pickle
import hashlib
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chains import RetrievalQA
from langchain_community.vectorstores import Milvus
from langchain_openai import AzureChatOpenAI, OpenAIEmbeddings
from pymilvus import connections, utility

# ─── Global settings ─────────────────────────────────────────────────────────
CACHE_DIR = "rag_cache"
RAW_TEXT_DIR = "rag_raw"
MILVUS_CONN = {"host": "localhost", "port": "19530"}

os.makedirs(CACHE_DIR, exist_ok=True)
# RAW_TEXT_DIR can be used if you want to save raw directory dumps
os.makedirs(RAW_TEXT_DIR, exist_ok=True)

# Configure logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def load_texts_from_directory(directory: str) -> str:
    """Read all .txt files in a directory, concatenate into one large string."""
    logger.info(f"Loading texts from directory: {directory}")
    texts = []
    for fname in os.listdir(directory):
        if not fname.lower().endswith('.txt'):
            continue
        path = os.path.join(directory, fname)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                texts.append(f.read())
        except Exception as e:
            logger.warning(f"Failed to read {path}: {e}")
    combined = "\n".join(texts)
    logger.info(f"Loaded {len(texts)} files, total length {len(combined)} characters")
    return combined


def split_text(text: str, chunk_size: int = 1000, chunk_overlap: int = 100):
    """Turn text into overlapping chunks using LangChain's splitter."""
    logger.info("Splitting text into chunks")
    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    chunks = splitter.split_text(text)
    logger.info(f"Generated {len(chunks)} chunks")
    return chunks


def get_chunks_for_directory(directory: str, cache: bool = True):
    """
    Load and chunk text from a directory, with optional disk caching.
    Returns list of text chunks.
    """
    # Use directory path hash as cache key
    dir_hash = hashlib.sha256(directory.encode()).hexdigest()
    cache_path = os.path.join(CACHE_DIR, dir_hash + ".pkl")

    if cache and os.path.exists(cache_path):
        logger.info(f"Cache hit: loading chunks from {cache_path}")
        with open(cache_path, "rb") as f:
            chunks = pickle.load(f)
    else:
        logger.info(f"Cache miss: reading & splitting directory {directory}")
        combined_text = load_texts_from_directory(directory)
        chunks = split_text(combined_text)
        if cache:
            with open(cache_path, "wb") as f:
                pickle.dump(chunks, f)
            logger.info(f"Saved {len(chunks)} chunks to cache at {cache_path}")
    return chunks


def create_milvus_vectorstore(chunks, collection_name: str = "rag_docs") -> Milvus:
    """
    Connects to Milvus and either loads an existing collection
    or creates a new one and inserts embeddings.
    """
    logger.info(f"Connecting to Milvus at {MILVUS_CONN['host']}:{MILVUS_CONN['port']}")
    connections.connect(alias="default", **MILVUS_CONN)

    embeddings = OpenAIEmbeddings(
        deployment="text-embedding-3-small",
        chunk_size=1
    )

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


def build_rag_chain(vectorstore: Milvus) -> RetrievalQA:
    """
    Builds a RetrievalQA chain using Azure GPT-4o and the given Milvus retriever.
    """
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


def build_rag_from_directory(directory: str, collection_label: str = None):
    """
    Full pipeline: read, chunk, embed, and build QA chain for a directory of .txt files.
    """
    logger.info(f"=== Starting RAG pipeline for directory: {directory} ===")
    label = collection_label or os.path.basename(os.path.normpath(directory))
    collection_name = f"rag_{label}".replace("-", "_")

    chunks = get_chunks_for_directory(directory)
    vs = create_milvus_vectorstore(chunks, collection_name)
    chain = build_rag_chain(vs)

    logger.info(f"=== Completed RAG pipeline for directory: {directory} ===")
    return chain


if __name__ == "__main__":
    # Directory containing your .txt documents
    docs_dir = "outshift_docs"

    # Build the RAG chain
    rag_chain = build_rag_from_directory(docs_dir)

    # Example query
    query = "tell me everything about Container Registry Choices"
    logger.info(f"Running query: '{query}'")
    result = rag_chain({"query": query})

    # Print answer and number of source docs retrieved
    logger.info("Query complete. Answer:")
    print(result["result"])
    logger.info(f"Retrieved {len(result['source_documents'])} source documents")
