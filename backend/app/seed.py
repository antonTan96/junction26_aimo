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
    RecurrentApprovalGrant,
)
from .database import Base, engine

def init_db():
    Base.metadata.create_all(bind=engine)

def seed_database(db: Session):
    # Ensure fresh schema reflecting any updated columns
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    now = datetime.datetime.utcnow()

    # 1. Multiple Customer Tenants with Guardrail Category Whitelists
    policies = [
        TenantPolicy(
            tenant_id="hotel_nordic_group",
            tenant_name="Nordic Crown Hotels (Helsinki)",
            max_auto_approve_eur=800.00,
            max_auto_approve_litres=600.00,
            allowed_categories=["dairy", "plant-based"],
        ),
        TenantPolicy(
            tenant_id="scandic_helsinki_hub",
            tenant_name="Scandic Hotels Finland",
            max_auto_approve_eur=1500.00,
            max_auto_approve_litres=1200.00,
            allowed_categories=["dairy", "bakery", "plant-based"],
        ),
        TenantPolicy(
            tenant_id="sodexo_campus_espoo",
            tenant_name="Sodexo Campus Dining (Otaniemi)",
            max_auto_approve_eur=500.00,
            max_auto_approve_litres=400.00,
            allowed_categories=["dairy"],
        ),
        TenantPolicy(
            tenant_id="fazer_food_services",
            tenant_name="Fazer Food & Restaurant Services",
            max_auto_approve_eur=2500.00,
            max_auto_approve_litres=2000.00,
            allowed_categories=["dairy", "plant-based", "bakery"],
        ),
    ]
    for pol in policies:
        db.add(pol)

    # 2. Multi-Category Products
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
            sku="VA-OAT-BARISTA-10L",
            name="Valio Oddlygood® Barista Oat Drink",
            category="plant-based",
            dietary_tags=["plant-based", "vegan", "gluten-free"],
            pack_format="10L Bag-in-Box",
            pack_volume_litres=10.0,
            min_lead_time_hours=24,
            is_active=True,
            internal_cost_eur=10.20,
            internal_margin_pct=22.0,
            roadmap_status="LIVE",
        ),
        Product(
            sku="VA-BAKERY-CROISSANT-50",
            name="Valio Artisanal Butter Croissant (50pk)",
            category="bakery",
            dietary_tags=["vegetarian"],
            pack_format="50x65g Case",
            pack_volume_litres=3.25,
            min_lead_time_hours=24,
            is_active=True,
            internal_cost_eur=28.50,
            internal_margin_pct=24.0,
            roadmap_status="LIVE",
        ),
        Product(
            sku="VA-CLEAN-HYGIENE-5L",
            name="Valio Pro Hygiene Food-Contact Sanitizer 5L",
            category="cleaning",
            dietary_tags=[],
            pack_format="5L Canister",
            pack_volume_litres=5.0,
            min_lead_time_hours=24,
            is_active=True,
            internal_cost_eur=16.80,
            internal_margin_pct=25.0,
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

    # 3. Tenant Contract Prices for All Customers
    contract_prices = [
        # Nordic Crown Hotels (Standard Contract)
        TenantContractPrice(tenant_id="hotel_nordic_group", sku="VA-LF-MILK-10L", contract_pack_price_eur=11.80),
        TenantContractPrice(tenant_id="hotel_nordic_group", sku="VA-LF-MILK-12X1L", contract_pack_price_eur=15.48),
        TenantContractPrice(tenant_id="hotel_nordic_group", sku="VA-OAT-BARISTA-10L", contract_pack_price_eur=13.90),
        TenantContractPrice(tenant_id="hotel_nordic_group", sku="VA-BAKERY-CROISSANT-50", contract_pack_price_eur=39.50),
        TenantContractPrice(tenant_id="hotel_nordic_group", sku="VA-CLEAN-HYGIENE-5L", contract_pack_price_eur=24.00),
        TenantContractPrice(tenant_id="hotel_nordic_group", sku="VA-ROADMAP-Q4-PRO", contract_pack_price_eur=14.00),

        # Scandic Hotels (High-Volume Tier)
        TenantContractPrice(tenant_id="scandic_helsinki_hub", sku="VA-LF-MILK-10L", contract_pack_price_eur=11.50),
        TenantContractPrice(tenant_id="scandic_helsinki_hub", sku="VA-LF-MILK-12X1L", contract_pack_price_eur=15.10),
        TenantContractPrice(tenant_id="scandic_helsinki_hub", sku="VA-OAT-BARISTA-10L", contract_pack_price_eur=13.50),
        TenantContractPrice(tenant_id="scandic_helsinki_hub", sku="VA-BAKERY-CROISSANT-50", contract_pack_price_eur=37.50),
        TenantContractPrice(tenant_id="scandic_helsinki_hub", sku="VA-CLEAN-HYGIENE-5L", contract_pack_price_eur=22.50),

        # Sodexo Campus Dining
        TenantContractPrice(tenant_id="sodexo_campus_espoo", sku="VA-LF-MILK-10L", contract_pack_price_eur=12.10),
        TenantContractPrice(tenant_id="sodexo_campus_espoo", sku="VA-LF-MILK-12X1L", contract_pack_price_eur=15.80),
        TenantContractPrice(tenant_id="sodexo_campus_espoo", sku="VA-OAT-BARISTA-10L", contract_pack_price_eur=14.20),
        TenantContractPrice(tenant_id="sodexo_campus_espoo", sku="VA-BAKERY-CROISSANT-50", contract_pack_price_eur=41.00),
        TenantContractPrice(tenant_id="sodexo_campus_espoo", sku="VA-CLEAN-HYGIENE-5L", contract_pack_price_eur=25.00),

        # Fazer Food Services (Enterprise Tier)
        TenantContractPrice(tenant_id="fazer_food_services", sku="VA-LF-MILK-10L", contract_pack_price_eur=11.20),
        TenantContractPrice(tenant_id="fazer_food_services", sku="VA-LF-MILK-12X1L", contract_pack_price_eur=14.90),
        TenantContractPrice(tenant_id="fazer_food_services", sku="VA-OAT-BARISTA-10L", contract_pack_price_eur=13.10),
        TenantContractPrice(tenant_id="fazer_food_services", sku="VA-BAKERY-CROISSANT-50", contract_pack_price_eur=36.00),
        TenantContractPrice(tenant_id="fazer_food_services", sku="VA-CLEAN-HYGIENE-5L", contract_pack_price_eur=21.50),
    ]
    for cp in contract_prices:
        db.add(cp)

    # 4. Warehouse Stock (initial clean available pool)
    stocks = [
        WarehouseStock(sku="VA-LF-MILK-10L", available_packs=250, reserved_packs=0),
        WarehouseStock(sku="VA-LF-MILK-12X1L", available_packs=180, reserved_packs=0),
        WarehouseStock(sku="VA-OAT-BARISTA-10L", available_packs=200, reserved_packs=0),
        WarehouseStock(sku="VA-BAKERY-CROISSANT-50", available_packs=120, reserved_packs=0),
        WarehouseStock(sku="VA-CLEAN-HYGIENE-5L", available_packs=80, reserved_packs=0),
        WarehouseStock(sku="VA-ROADMAP-Q4-PRO", available_packs=100, reserved_packs=0),
    ]
    for s in stocks:
        db.add(s)

    # 5. Seed active Time-Windowed Recurrent Grant for Scandic Hotels
    grant_scandic = RecurrentApprovalGrant(
        grant_id="RAG-SCANDIC-01",
        tenant_id="scandic_helsinki_hub",
        category="dairy",
        sku="VA-LF-MILK-10L",
        frequency="WEEKLY",
        window_days=14,
        max_budget_per_period_eur=2500.00,
        current_period_spent_eur=575.00,
        valid_from=now - datetime.timedelta(days=2),
        valid_until=now + datetime.timedelta(days=12),
        status="ACTIVE",
        approved_by="Tuomas Korhonen (F&B Director)",
        notes="Standing 14-day recurrent breakfast milk allocation for Helsinki Hub",
        created_at=now - datetime.timedelta(days=2)
    )
    db.add(grant_scandic)

    # 6. Seed historical / active multi-customer orders for the Wholesaler Control Tower
    # Scandic: Auto-Approved Order under Recurrent Grant
    q_scandic = QuoteLock(
        quote_id="Q-SCANDIC-001",
        tenant_id="scandic_helsinki_hub",
        sku="VA-LF-MILK-10L",
        pack_quantity=50,
        total_litres=500.0,
        locked_total_eur=575.00,
        deliver_by=now + datetime.timedelta(days=2),
        status="CONSUMED",
        expires_at=now + datetime.timedelta(minutes=15),
        created_at=now - datetime.timedelta(hours=3)
    )
    db.add(q_scandic)
    ord_scandic = Order(
        order_id="ORD-SCANDIC-101",
        quote_id="Q-SCANDIC-001",
        tenant_id="scandic_helsinki_hub",
        po_reference="PO-SCANDIC-2026-089",
        status="CONFIRMED",
        total_eur=575.00,
        approval_type="RECURRENT_WINDOW",
        recurrent_grant_id="RAG-SCANDIC-01",
        approved_by="AimoGate-PolicyEngine [Recurrent Grant RAG-SCANDIC-01]",
        created_at=now - datetime.timedelta(hours=3)
    )
    db.add(ord_scandic)

    # Fazer: Auto-Approved Order
    q_fazer = QuoteLock(
        quote_id="Q-FAZER-001",
        tenant_id="fazer_food_services",
        sku="VA-LF-MILK-10L",
        pack_quantity=120,
        total_litres=1200.0,
        locked_total_eur=1344.00,
        deliver_by=now + datetime.timedelta(days=1),
        status="CONSUMED",
        expires_at=now + datetime.timedelta(minutes=15),
        created_at=now - datetime.timedelta(hours=1)
    )
    db.add(q_fazer)
    ord_fazer = Order(
        order_id="ORD-FAZER-808",
        quote_id="Q-FAZER-001",
        tenant_id="fazer_food_services",
        po_reference="PO-FAZER-2026-551",
        status="CONFIRMED",
        total_eur=1344.00,
        approval_type="AUTO",
        recurrent_grant_id=None,
        approved_by="AimoGate-PolicyEngine (Auto-Approved < €2,500)",
        created_at=now - datetime.timedelta(hours=1)
    )
    db.add(ord_fazer)

    # Audit Logs
    db.add(AuditLog(
        tenant_id="scandic_helsinki_hub",
        actor_type="system",
        actor_id="AimoGate-PolicyEngine",
        action="RECURRENT_TRANSACTION_EXECUTED",
        payload_summary={"order_id": "ORD-SCANDIC-101", "grant_id": "RAG-SCANDIC-01", "total_eur": 575.00}
    ))
    db.add(AuditLog(
        tenant_id="fazer_food_services",
        actor_type="agent",
        actor_id="fazer_agent_03",
        action="AUTO_APPROVED",
        payload_summary={"order_id": "ORD-FAZER-808", "total_eur": 1344.00}
    ))
    db.add(AuditLog(
        tenant_id="hotel_nordic_group",
        actor_type="system",
        actor_id="system_initializer",
        action="SYSTEM_INITIALIZED",
        payload_summary={"status": "ready", "seed": "multi_customer_network_with_guardrails"}
    ))

    db.commit()
