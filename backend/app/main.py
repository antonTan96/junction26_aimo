import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from .config import settings
from .database import engine, Base, SessionLocal
from .seed import seed_database
from .routes import tools, orders, policies, demo, agent, admin

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables and seed initial demo data
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Seed if empty or fresh
        seed_database(db)
    finally:
        db.close()
    yield

app = FastAPI(
    title="AimoGate - Zero-Trust B2B Trade & Governance Gateway",
    description="Deterministic policy firewall and protocol gateway for Valio Aimo autonomous agentic commerce.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for Next.js / React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API v1 Routers
app.include_router(tools.router, prefix=settings.API_V1_STR)
app.include_router(orders.router, prefix=settings.API_V1_STR)
app.include_router(policies.router, prefix=settings.API_V1_STR)
app.include_router(demo.router, prefix=settings.API_V1_STR)
app.include_router(agent.router, prefix=settings.API_V1_STR)
app.include_router(admin.router, prefix=settings.API_V1_STR)

@app.get("/api")
def api_status():
    return {
        "gateway": "AimoGate",
        "description": "Zero-Trust B2B Trade & Governance Gateway for Valio Aimo",
        "status": "operational",
        "version": settings.VERSION,
        "docs_url": "/docs",
        "mcp_enabled": True
    }

@app.get("/health")
def health():
    return {"status": "ok"}

# Serve frontend build if present
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../frontend/dist"))
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # Don't intercept API routes
        if full_path.startswith("api/") or full_path.startswith("docs") or full_path.startswith("openapi.json"):
            return None
        index_file = os.path.join(frontend_dist, "index.html")
        return FileResponse(index_file)

