FROM python:3.13-slim
WORKDIR /app
RUN pip install --no-cache-dir httpx==0.28.1
COPY authorization-model.json .
COPY seed.py .
ENTRYPOINT ["python", "/app/seed.py"]
