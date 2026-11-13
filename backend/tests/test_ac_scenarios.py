import pytest
import datetime
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal
from backend.app.seed import seed_database
from backend.app.auth import get_preset_token
from backend.app.models import WarehouseStock, Order, AuditLog

@pytest.fixture(autouse=True)
def reset_db_before_test():
    db = SessionLocal()
    seed_database(db)
    db.close()

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture
def agent_headers():
    token = get_preset_token("agent")
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def human_headers():
    token = get_preset_token("human")
    return {"Authorization": f"Bearer {token}"}

def test_ac1_catalog_search_zero_trust(client, agent_headers):
    """
    AC-1: Querying 1,000L lactose-free milk by Monday returns both:
      - VA-LF-MILK-10L (100 packs = €1,180.00)
      - VA-LF-MILK-12X1L (84 packs = 1,008L = €1,300.32)
      while completely hiding VA-ROADMAP-Q4-PRO and internal_margin_pct.
    """
    deliver_by = (datetime.datetime.utcnow() + datetime.timedelta(days=3)).isoformat() + "Z"
    response = client.post(
        "/api/v1/tools/search_offers",
        json={
            "query": "lactose-free milk",
            "required_volume_litres": 1000.0,
            "deliver_by": deliver_by
        },
        headers=agent_headers
    )
    assert response.status_code == 200, response.text
    offers = response.json()
    assert len(offers) == 2

    # Check SKUs present
    skus = [o["sku"] for o in offers]
    assert "VA-LF-MILK-10L" in skus
    assert "VA-LF-MILK-12X1L" in skus
    
    # Verify unreleased roadmap SKU is strictly hidden
    assert "VA-ROADMAP-Q4-PRO" not in skus

    # Check VA-LF-MILK-10L pricing and pack count
    o_10l = next(o for o in offers if o["sku"] == "VA-LF-MILK-10L")
    assert o_10l["packs_required"] == 100
    assert o_10l["delivered_volume_litres"] == 1000.0
    assert o_10l["total_contract_price_eur"] == 1180.00
    assert o_10l["price_per_litre_eur"] == 1.18

    # Check VA-LF-MILK-12X1L pricing and pack count
    o_12l = next(o for o in offers if o["sku"] == "VA-LF-MILK-12X1L")
    assert o_12l["packs_required"] == 84
    assert o_12l["delivered_volume_litres"] == 1008.0
    assert o_12l["total_contract_price_eur"] == 1300.32
    assert o_12l["price_per_litre_eur"] == 1.29

    # Verify zero-trust: no internal margins, costs, or internal fields anywhere in JSON
    for o in offers:
        assert "internal_margin_pct" not in o
        assert "internal_cost_eur" not in o
        assert "roadmap_status" not in o
        assert "margin" not in str(o).lower()

def test_ac2_quote_lock_and_policy_hold(client, agent_headers):
    """
    AC-2: Submitting the €1,180.00 quote transitions order status to PENDING_APPROVAL
    and holds 100 reserved packs in MariaDB/database.
    """
    deliver_by = (datetime.datetime.utcnow() + datetime.timedelta(days=3)).isoformat() + "Z"
    
    # 1. Lock quote for 100 packs of VA-LF-MILK-10L
    lock_res = client.post(
        "/api/v1/tools/lock_quote",
        json={
            "sku": "VA-LF-MILK-10L",
            "pack_quantity": 100,
            "deliver_by": deliver_by
        },
        headers=agent_headers
    )
    assert lock_res.status_code == 200, lock_res.text
    quote_data = lock_res.json()
    assert quote_data["locked_total_eur"] == 1180.00
    quote_id = quote_data["quote_id"]

    # Check warehouse stock: available decreased from 250 to 150, reserved increased from 0 to 100
    db = SessionLocal()
    stock = db.query(WarehouseStock).filter(WarehouseStock.sku == "VA-LF-MILK-10L").first()
    assert stock.available_packs == 150
    assert stock.reserved_packs == 100
    db.close()

    # 2. Submit order exceeding €800 limit
    commit_res = client.post(
        "/api/v1/tools/commit_order",
        json={
            "quote_id": quote_id,
            "po_reference": "PO-TEST-AC2-001"
        },
        headers=agent_headers
    )
    assert commit_res.status_code == 200, commit_res.text
    order_data = commit_res.json()
    assert order_data["status"] == "PENDING_APPROVAL"
    assert "exceeds autonomous limit" in str(order_data["violation_reasons"])

    # Stock reservation must STILL be held!
    db = SessionLocal()
    stock = db.query(WarehouseStock).filter(WarehouseStock.sku == "VA-LF-MILK-10L").first()
    assert stock.available_packs == 150
    assert stock.reserved_packs == 100
    db.close()

def test_ac3_agent_forbidden_from_approve(client, agent_headers):
    """
    AC-3: Attempting to call POST /api/v1/orders/{id}/approve using the agent JWT
    fails with 403 Forbidden.
    """
    deliver_by = (datetime.datetime.utcnow() + datetime.timedelta(days=3)).isoformat() + "Z"
    
    # Lock quote & commit order
    lock_res = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-LF-MILK-10L", "pack_quantity": 100, "deliver_by": deliver_by},
        headers=agent_headers
    )
    quote_id = lock_res.json()["quote_id"]
    commit_res = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": quote_id, "po_reference": "PO-TEST-AC3-001"},
        headers=agent_headers
    )
    order_id = commit_res.json()["order_id"]

    # Attempt to approve with agent token
    approve_res = client.post(
        f"/api/v1/orders/{order_id}/approve",
        headers=agent_headers
    )
    assert approve_res.status_code == 403, "Agent must not be permitted to approve orders!"

def test_ac4_human_approval_flow(client, agent_headers, human_headers):
    """
    AC-4: Clicking Approve in the Manager UI (authenticated as human) transitions the order
    to CONFIRMED, finalizes stock deduction, and writes an immutable entry to audit_logs.
    """
    deliver_by = (datetime.datetime.utcnow() + datetime.timedelta(days=3)).isoformat() + "Z"
    
    # 1. Agent locks quote and commits order
    lock_res = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-LF-MILK-10L", "pack_quantity": 100, "deliver_by": deliver_by},
        headers=agent_headers
    )
    quote_id = lock_res.json()["quote_id"]
    commit_res = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": quote_id, "po_reference": "PO-TEST-AC4-001"},
        headers=agent_headers
    )
    order_id = commit_res.json()["order_id"]
    assert commit_res.json()["status"] == "PENDING_APPROVAL"

    # 2. Human Manager approves order
    approve_res = client.post(
        f"/api/v1/orders/{order_id}/approve",
        headers=human_headers
    )
    assert approve_res.status_code == 200, approve_res.text
    order_data = approve_res.json()
    assert order_data["status"] == "CONFIRMED"
    assert "human" in order_data["approved_by"]

    # Verify finalized stock deduction in DB: reserved was 100, now 0; available is 150 (total remaining = 150)
    db = SessionLocal()
    stock = db.query(WarehouseStock).filter(WarehouseStock.sku == "VA-LF-MILK-10L").first()
    assert stock.available_packs == 150
    assert stock.reserved_packs == 0

    # Verify immutable audit log record
    log = db.query(AuditLog).filter(
        AuditLog.action == "HUMAN_APPROVED",
        AuditLog.tenant_id == "hotel_nordic_group"
    ).first()
    assert log is not None
    assert log.actor_type == "human"
    assert log.payload_summary["order_id"] == order_id
    db.close()

def test_ac5_threshold_slider_and_auto_approval(client, agent_headers, human_headers):
    """
    AC-5:
    Part A: Lowering the order quantity to 400L (€472.00) causes immediate CONFIRMED (AUTO_APPROVED).
    Part B: Raising max_auto_approve_eur to €1,500 causes the 1,000L (€1,180.00) workflow
    to result in immediate CONFIRMED (AUTO_APPROVED) status.
    """
    deliver_by = (datetime.datetime.utcnow() + datetime.timedelta(days=3)).isoformat() + "Z"

    # --- Part A: 400L Order (40 packs x €11.80 = €472.00 < €800 cap) ---
    lock_400 = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-LF-MILK-10L", "pack_quantity": 40, "deliver_by": deliver_by},
        headers=agent_headers
    )
    assert lock_400.status_code == 200
    quote_400_id = lock_400.json()["quote_id"]
    assert lock_400.json()["locked_total_eur"] == 472.00

    commit_400 = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": quote_400_id, "po_reference": "PO-TEST-AC5-400L"},
        headers=agent_headers
    )
    assert commit_400.status_code == 200
    assert commit_400.json()["status"] == "CONFIRMED"

    # --- Part B: Raising threshold to €1,500 for 1,000L order (€1,180.00) ---
    update_policy = client.patch(
        "/api/v1/policies",
        json={"max_auto_approve_eur": 1500.00, "max_auto_approve_litres": 1500.00},
        headers=human_headers
    )
    assert update_policy.status_code == 200
    assert update_policy.json()["max_auto_approve_eur"] == 1500.00

    # Agent runs 1000L order workflow
    lock_1000 = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-LF-MILK-10L", "pack_quantity": 100, "deliver_by": deliver_by},
        headers=agent_headers
    )
    assert lock_1000.status_code == 200
    quote_1000_id = lock_1000.json()["quote_id"]

    commit_1000 = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": quote_1000_id, "po_reference": "PO-TEST-AC5-1000L"},
        headers=agent_headers
    )
    assert commit_1000.status_code == 200
    assert commit_1000.json()["status"] == "CONFIRMED"
