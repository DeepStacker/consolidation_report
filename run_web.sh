#!/bin/bash

# Port definitions
BACKEND_PORT=8000
FRONTEND_PORT=5173

echo "================================================================================"
echo "LAUNCHING WEB-BASED CONSOLIDATION PIPELINE"
echo "================================================================================"
echo ""

# Function to kill child processes on exit
cleanup() {
    echo ""
    echo "Stopping servers..."
    kill $(jobs -p) 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM

# 1. Start FastAPI Backend
echo "[1/2] Starting FastAPI backend server on port $BACKEND_PORT..."
python3 -m uvicorn src.web_api:app --host 127.0.0.1 --port $BACKEND_PORT &

# Wait for backend to be ready
sleep 1.5

# 2. Start Vite Frontend Dev Server
echo "[2/2] Starting Vite React frontend server on port $FRONTEND_PORT..."
cd frontend
npm run dev -- --port $FRONTEND_PORT &

echo ""
echo "================================================================================"
echo "🎯 App is active! Open http://localhost:$FRONTEND_PORT in your web browser."
echo "Press Ctrl+C to stop both servers."
echo "================================================================================"
echo ""

# Keep shell open
wait
