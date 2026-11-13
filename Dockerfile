# Multi-stage Dockerfile for AimoGate Stack

# Stage 1: Build React/Tailwind Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Python Backend Runtime
FROM python:3.10-slim AS runner
WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/app/ /app/backend/app/
COPY valio_aimo_junction26_product_data.json /app/
COPY openapi.json /app/
COPY keys.sh /app/

# Install python packages directly
RUN pip install --no-cache-dir \
    fastapi==0.162.5 \
    uvicorn==0.54.0 \
    pydantic==2.14.3 \
    sqlalchemy==2.0.57 \
    pyjwt==2.15.1 \
    httpx==0.28.1 \
    pytest==9.2.0 \
    python-multipart==0.0.32 \
    cryptography==50.0.2 \
    mcp==2.3.0

# Copy built frontend assets from Stage 1 into backend static serving directory
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV PORT=8000
ENV HOST=0.0.0.0

EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
