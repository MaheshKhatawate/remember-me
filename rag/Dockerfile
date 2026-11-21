FROM ghcr.io/astral-sh/uv:0.11.29 AS uv
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN --mount=from=uv,source=/uv,target=/usr/local/bin/uv \
    --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --link-mode copy --torch-backend cpu -r requirements.txt

COPY app ./app

ENV CHROMA_PERSIST_DIR=/data/chroma
RUN mkdir -p /data/chroma
VOLUME ["/data/chroma"]

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
