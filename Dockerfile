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

# Copy frontend source
COPY frontend/ ./

# Download self-hosted Google Fonts (not stored in git — HF rejects binary files)
RUN mkdir -p public/fonts && node -e "
const https = require('https');
const fs = require('fs');
const url = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap';
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
  let css = '';
  res.on('data', c => css += c);
  res.on('end', () => {
    const re = /url\(([^)]+)\)/g;
    let m, done = 0;
    while ((m = re.exec(css)) !== null) {
      const fontUrl = m[1];
      const fname = fontUrl.split('/').pop().split('?')[0];
      https.get(fontUrl, r => r.pipe(fs.createWriteStream('public/fonts/' + fname)).on('finish', () => {
        if (++done >= 15) console.log('Fonts downloaded');
      }));
    }
  });
});
"

# Build static assets
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

# Expose default Hugging Face Spaces port (7860)
EXPOSE 7860

# Run FastAPI backend server on port 7860
CMD ["uvicorn", "src.web_api:app", "--host", "0.0.0.0", "--port", "7860"]
