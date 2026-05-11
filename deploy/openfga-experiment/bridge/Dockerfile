FROM python:3.13-slim

WORKDIR /app
RUN groupadd -g 1001 appuser && useradd -u 1001 -g 1001 -M -s /usr/sbin/nologin appuser
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .

EXPOSE 9100
USER 1001:1001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9100"]
