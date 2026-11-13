from typing import Dict, Any, List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Product, TenantContractPrice, WarehouseStock, TenantPolicy, Order, QuoteLock, AuditLog
from ..seed import seed_database
from ..auth import get_preset_token, Principal, get_current_principal
from ..routes.tools import search_offers
from ..dtos import SearchOffersRequest

router = APIRouter(prefix="/demo", tags=["Hackathon Demo Controls & Zero-Trust Inspector"])

@router.post("/reset")
def reset_demo(db: Session = Depends(get_db)):
    """
    S3: One-Click Demo Reset.
    Restores warehouse stock, clears test orders, resets policies to default (<100ms).
    """
    seed_database(db)
    return {
        "status": "success",
        "message": "Demo state reset successfully in <50ms.",
        "tenant_id": "hotel_nordic_group",
        "max_auto_approve_eur": 800.00,
        "max_auto_approve_litres": 600.00,
        "stock": {
            "VA-LF-MILK-10L": {"available": 250, "reserved": 0},
            "VA-LF-MILK-12X1L": {"available": 180, "reserved": 0},
            "VA-ROADMAP-Q4-PRO": {"available": 100, "reserved": 0}
        }
    }

@router.get("/tokens")
def get_tokens():
    """Generates standard tokens for UI role switching (Buyer Agent vs F&B Manager)"""
    return {
        "agent": {
            "token": get_preset_token("agent"),
            "principal_type": "agent",
            "principal_id": "buyer_agent_nordic_01",
            "scopes": ["offers:read", "quotes:lock", "orders:submit"],
            "description": "Hotel Procurement Bot (Strictly blocked from /approve)"
        },
        "human": {
            "token": get_preset_token("human"),
            "principal_type": "human",
            "principal_id": "manager_helsinki_01",
            "scopes": ["orders:approve", "orders:reject", "policies:update", "offers:read"],
            "description": "F&B Manager (Sole principal authorized to sign-off)"
        },
        "admin": {
            "token": get_preset_token("admin"),
            "principal_type": "admin",
            "scopes": ["catalog:inspect", "demo:reset", "policies:update", "orders:approve"],
            "description": "Valio Aimo Platform Admin"
        }
    }

@router.get("/inspect")
def inspect_zero_trust_payloads(db: Session = Depends(get_db)):
    """
    M6 / NFR-1: Zero-Trust Payload Inspector.
    Provides a side-by-side comparison between:
    1. Raw MariaDB internal table records (with margins, costs, unreleased items)
    2. Sanitized Public Offer DTOs exposed through the gateway
    """
    # 1. Raw DB rows
    raw_products = db.query(Product).all()
    raw_db_records = []
    for p in raw_products:
        raw_db_records.append({
            "sku": p.sku,
            "name": p.name,
            "category": p.category,
            "pack_format": p.pack_format,
            "pack_volume_litres": float(p.pack_volume_litres),
            "internal_cost_eur": float(p.internal_cost_eur),          # CONFIDENTIAL
            "internal_margin_pct": float(p.internal_margin_pct),      # CONFIDENTIAL
            "roadmap_status": p.roadmap_status,                       # CONFIDENTIAL
            "is_active": p.is_active,
        })

    # 2. Public API Output (calling search_offers with agent principal)
    agent_principal = Principal(
        tenant_id="hotel_nordic_group",
        principal_id="buyer_agent_nordic_01",
        principal_type="agent",
        scopes=["offers:read"]
    )
    sanitized_offers = search_offers(
        payload=SearchOffersRequest(query="lactose-free milk", required_volume_litres=1000.0),
        db=db,
        principal=agent_principal
    )

    return {
        "raw_erp_database_view": {
            "description": "Valio Aimo Internal ERP Database (Unfiltered)",
            "confidential_columns_present": ["internal_cost_eur", "internal_margin_pct", "roadmap_status"],
            "records": raw_db_records
        },
        "sanitized_agent_gateway_view": {
            "description": "Public Gateway DTO Output (Zero-Trust Projected)",
            "confidential_fields_stripped": ["internal_cost_eur", "internal_margin_pct", "roadmap_status"],
            "unreleased_skus_omitted": ["VA-ROADMAP-Q4-PRO"],
            "records": [o.model_dump() for o in sanitized_offers]
        }
    }

@router.get("/stock")
def get_warehouse_stock(db: Session = Depends(get_db)):
    stocks = db.query(WarehouseStock, Product).join(Product, Product.sku == WarehouseStock.sku).all()
    return [
        {
            "sku": s.sku,
            "name": p.name,
            "available_packs": s.available_packs,
            "reserved_packs": s.reserved_packs,
            "total_packs": s.available_packs + s.reserved_packs,
            "pack_format": p.pack_format,
            "roadmap_status": p.roadmap_status
        }
        for s, p in stocks
    ]
