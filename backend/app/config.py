import os
from pydantic import BaseModel

class Settings(BaseModel):
    PROJECT_NAME: str = "AimoGate"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Database: SQLite default, MariaDB/MySQL if DATABASE_URL is set
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./aimogate.db")
    
    # Security
    JWT_SECRET: str = os.getenv("JWT_SECRET", "aimogate-secret-key-junction-2026-supersecure")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 24
    
    # Default Demo Tenant
    DEFAULT_TENANT_ID: str = "hotel_nordic_group"
    DEFAULT_TENANT_NAME: str = "Nordic Crown Hotels"
    
    # Valio Aimo Live Backend
    VALIO_API_BASE_URL: str = os.getenv("VALIO_API_BASE_URL", "https://junction26.valioaimo.fi")
    VALIO_API_KEY: str = os.getenv("VALIO_API_KEY", os.getenv("WEB_API_KEY", "junct_tDnQn4VI_nfhELGCOEkY4vbuxm324MmYmILuokYG03Y"))

    # LLM & Verda Cloud
    VERDA_API_KEY: str = os.getenv("WEB_API_KEY", "")
    VERDA_BASE_URL: str = os.getenv("VERDA_BASE_URL", "https://inference.verda.com/v1")
    VERDA_MODEL: str = os.getenv("VERDA_MODEL", "nvidia/nemotron-3-super-120b")

settings = Settings()
