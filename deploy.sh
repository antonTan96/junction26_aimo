#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "      Deploying AimoGate & Buyer Procurement Stack         "
echo "=========================================================="

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# 1. Load keys if present
if [ -f "$ROOT_DIR/keys.sh" ]; then
    echo "[1/4] Loading credentials from keys.sh..."
    source "$ROOT_DIR/keys.sh"
fi

# 2. Build Frontend
echo "[2/4] Building Frontend bundle..."
cd "$ROOT_DIR/frontend"
npm install --silent
npm run build

# 3. Setup Python Backend Environment
echo "[3/4] Preparing Python Environment..."
cd "$ROOT_DIR"
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install --quiet -r <(cat << 'EOF'
fastapi==0.162.5
uvicorn==0.54.0
pydantic==2.14.3
sqlalchemy==2.0.57
pyjwt==2.15.1
httpx==0.28.1
pytest==9.2.0
python-multipart==0.0.32
cryptography==50.0.2
mcp==2.3.0
EOF
)

# 4. Run Pytest Suite to Verify Integrity
echo "[4/4] Running Verification Test Suite..."
PYTHONPATH=. pytest backend/tests/ -v

echo ""
echo "=========================================================="
echo "Deployment Ready!"
echo "• Wholesaler Tower (Port 8000): python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"
echo "• Buyer Portal (Port 3000):     cd frontend && npx vite --host 0.0.0.0 --port 3000"
echo "=========================================================="
