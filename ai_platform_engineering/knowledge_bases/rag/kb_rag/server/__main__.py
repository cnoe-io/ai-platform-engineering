import uvicorn

if __name__ == "__main__":
    # Assuming your `app` variable is in a module named `app.py`
    uvicorn.run("kb_rag.server.rag_api:app", host="0.0.0.0", port=9446, log_level="debug")