import datetime
from typing import List, Optional
import jwt
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from .config import settings

security = HTTPBearer(auto_error=False)

class Principal(BaseModel):
    tenant_id: str
    principal_id: str
    principal_type: str  # 'agent', 'human', 'admin'
    scopes: List[str]

def create_access_token(
    tenant_id: str,
    principal_id: str,
    principal_type: str,
    scopes: List[str],
    expires_delta: Optional[datetime.timedelta] = None
) -> str:
    if expires_delta:
        expire = datetime.datetime.utcnow() + expires_delta
    else:
        expire = datetime.datetime.utcnow() + datetime.timedelta(hours=settings.JWT_EXPIRY_HOURS)
    
    to_encode = {
        "sub": principal_id,
        "tenant_id": tenant_id,
        "principal_type": principal_type,
        "scopes": scopes,
        "exp": expire,
        "iat": datetime.datetime.utcnow(),
    }
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def get_preset_token(role: str, tenant_id: str = settings.DEFAULT_TENANT_ID) -> str:
    """Helper to generate preset tokens for testing and demo control plane"""
    if role == "agent":
        return create_access_token(
            tenant_id=tenant_id,
            principal_id="buyer_agent_nordic_01",
            principal_type="agent",
            scopes=["offers:read", "quotes:lock", "orders:submit"]
        )
    elif role == "human":
        return create_access_token(
            tenant_id=tenant_id,
            principal_id="manager_helsinki_01",
            principal_type="human",
            scopes=["orders:approve", "orders:reject", "policies:update", "offers:read"]
        )
    elif role == "admin":
        return create_access_token(
            tenant_id=tenant_id,
            principal_id="valio_aimo_admin",
            principal_type="admin",
            scopes=["catalog:inspect", "demo:reset", "policies:update", "orders:approve"]
        )
    raise ValueError(f"Unknown role: {role}")

def get_current_principal(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security)
) -> Principal:
    if not credentials:
        # For convenience in tests or direct API calls when header is omitted, default to tenant agent
        # But when a token is passed, validate strictly
        return Principal(
            tenant_id=settings.DEFAULT_TENANT_ID,
            principal_id="buyer_agent_default",
            principal_type="agent",
            scopes=["offers:read", "quotes:lock", "orders:submit"]
        )
    
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        tenant_id: str = payload.get("tenant_id")
        principal_id: str = payload.get("sub")
        principal_type: str = payload.get("principal_type")
        scopes: List[str] = payload.get("scopes", [])
        
        if not principal_id or not principal_type:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token claims",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return Principal(
            tenant_id=tenant_id,
            principal_id=principal_id,
            principal_type=principal_type,
            scopes=scopes
        )
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification failed: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

def require_principal(allowed_types: List[str], required_scopes: Optional[List[str]] = None):
    def dependency(principal: Principal = Depends(get_current_principal)):
        if principal.principal_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: principal_type '{principal.principal_type}' is not authorized. Required: {allowed_types}"
            )
        if required_scopes:
            for s in required_scopes:
                if s not in principal.scopes:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Access denied: missing required scope '{s}'"
                    )
        return principal
    return dependency
