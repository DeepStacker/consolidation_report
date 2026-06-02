# ==============================================================================
# HUGGING FACE SPACES DOCKERFILE
# Multi-stage build compiling React frontend and serving via FastAPI Python server
# ==============================================================================

# --- Stage 1: Build the React Frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Install node dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy frontend source and build static assets
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Build FastAPI Python Server ---
FROM python:3.10-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and client schemas
COPY src/ ./src/
COPY config/ ./config/

# Copy compiled static frontend assets from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Download self-hosted Google Fonts (not stored in git — HF rejects binary files)
RUN mkdir -p frontend/dist/fonts
COPY scripts/download_fonts.py /tmp/download_fonts.py
RUN python3 /tmp/download_fonts.py && rm /tmp/download_fonts.py

# Expose default Hugging Face Spaces port (7860)
EXPOSE 7860

# Run FastAPI backend server on port 7860
CMD ["uvicorn", "src.web_api:app", "--host", "0.0.0.0", "--port", "7860"]
