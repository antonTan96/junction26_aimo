import datetime
from sqlalchemy.orm import Session
from .models import (
    Product,
    TenantContractPrice,
    WarehouseStock,
    TenantPolicy,
    QuoteLock,
    Order,
    AuditLog,
)
from .database import Base, engine

def init_db():
    Base.metadata.create_all(bind=engine)

def seed_database(db: Session):
    # Ensure tables exist
    Base.metadata.create_all(bind=engine)
    # Clear existing data
    db.query(AuditLog).delete()
    db.query(Order).delete()
    db.query(QuoteLock).delete()
    db.query(WarehouseStock).delete()
    db.query(TenantContractPrice).delete()
    db.query(Product).delete()
    db.query(TenantPolicy).delete()
    db.commit()

    # 1. Tenant Policy: Nordic Crown Hotels
    policy = TenantPolicy(
        tenant_id="hotel_nordic_group",
        tenant_name="Nordic Crown Hotels",
        max_auto_approve_eur=800.00,
        max_auto_approve_litres=600.00,
        allowed_categories=["dairy", "plant-based"],
    )
    db.add(policy)

    # 2. Products
    products = [
        Product(
            sku="VA-LF-MILK-10L",
            name="Valio Eila® Lactose-Free Semi-Skimmed Milk",
            category="dairy",
            dietary_tags=["lactose-free"],
            pack_format="10L Bag-in-Box",
            pack_volume_litres=10.0,
            min_lead_time_hours=24,
            is_active=True,
            internal_cost_eur=9.62,
            internal_margin_pct=18.5,
            roadmap_status="LIVE",
        ),
        Product(
            sku="VA-LF-MILK-12X1L",
            name="Valio Eila® Lactose-Free Milk UHT",
            category="dairy",
            dietary_tags=["lactose-free"],
            pack_format="12x1L Carton",
            pack_volume_litres=12.0,
            min_lead_time_hours=24,
            is_active=True,
            internal_cost_eur=12.23,
            internal_margin_pct=21.0,
            roadmap_status="LIVE",
        ),
        Product(
            sku="VA-ROADMAP-Q4-PRO",
            name="Valio Next-Gen Barista Protein Milk (Q4 Preview)",
            category="dairy",
            dietary_tags=["lactose-free", "high-protein"],
            pack_format="10L Bag-in-Box",
            pack_volume_litres=10.0,
            min_lead_time_hours=24,
            is_active=True,
            internal_cost_eur=10.08,
            internal_margin_pct=28.0,
            roadmap_status="UNRELEASED",
        ),
    ]
    for p in products:
        db.add(p)

    # 3. Tenant Contract Prices
    contract_prices = [
        TenantContractPrice(
            tenant_id="hotel_nordic_group",
            sku="VA-LF-MILK-10L",
            contract_pack_price_eur=11.80,
        ),
        TenantContractPrice(
            tenant_id="hotel_nordic_group",
            sku="VA-LF-MILK-12X1L",
            contract_pack_price_eur=15.48,
        ),
        TenantContractPrice(
            tenant_id="hotel_nordic_group",
            sku="VA-ROADMAP-Q4-PRO",
            contract_pack_price_eur=14.00,
        ),
    ]
    for cp in contract_prices:
        db.add(cp)

    # 4. Warehouse Stock
    stocks = [
        WarehouseStock(
            sku="VA-LF-MILK-10L",
            available_packs=250,
            reserved_packs=0,
        ),
        WarehouseStock(
            sku="VA-LF-MILK-12X1L",
            available_packs=180,
            reserved_packs=0,
        ),
        WarehouseStock(
            sku="VA-ROADMAP-Q4-PRO",
            available_packs=100,
            reserved_packs=0,
        ),
    ]
    for s in stocks:
        db.add(s)

    # 5. Audit Log Initialization
    init_log = AuditLog(
        tenant_id="hotel_nordic_group",
        actor_type="system",
        actor_id="system_initializer",
        action="SYSTEM_INITIALIZED",
        payload_summary={
            "status": "ready",
            "seed": "hotel_nordic_group",
            "active_skus": ["VA-LF-MILK-10L", "VA-LF-MILK-12X1L"],
            "hidden_roadmap_skus": ["VA-ROADMAP-Q4-PRO"],
        },
    )
    db.add(init_log)

    db.commit()
