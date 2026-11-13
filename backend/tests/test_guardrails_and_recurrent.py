import pytest
import datetime
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal, engine, Base
from backend.app.models import (
    TenantPolicy,
    WarehouseStock,
    Order,
    RecurrentApprovalGrant,
    AuditLog
)
from backend.app.seed import seed_database
from backend.app.auth import create_access_token

@pytest.fixture(autouse=True)
def reset_db():
    db = SessionLocal()
    seed_database(db)
    db.close()
    yield

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture
def agent_headers():
    token = create_access_token(
        tenant_id="hotel_nordic_group",
        principal_id="buyer_agent_nordic_01",
        principal_type="agent",
        scopes=["offers:read", "quotes:lock", "orders:submit"]
    )
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def human_headers():
    token = create_access_token(
        tenant_id="hotel_nordic_group",
        principal_id="manager_helsinki_01",
        principal_type="human",
        scopes=["orders:approve", "orders:reject", "policies:update", "offers:read"]
    )
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def admin_headers():
    token = create_access_token(
        tenant_id="valio_aimo_platform",
        principal_id="tower_admin_01",
        principal_type="admin",
        scopes=["catalog:inspect", "demo:reset", "policies:update", "orders:approve"]
    )
    return {"Authorization": f"Bearer {token}"}

def test_guardrail_category_whitelist_enforcement(client, agent_headers, admin_headers):
    """
    1. Hotel Nordic Group whitelist is ["dairy", "plant-based"].
    2. Attempting to lock & order 'VA-BAKERY-CROISSANT-50' (category 'bakery') triggers GUARDRAIL violation.
    3. Tower Admin updates whitelist to include 'bakery'.
    4. Re-submitting order now passes category guardrail.
    """
    deliver_by = (datetime.datetime.utcnow() + datetime.timedelta(days=2)).isoformat() + "Z"

    # Step 1: Agent locks quote for Croissants (category = bakery)
    lock_res = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-BAKERY-CROISSANT-50", "pack_quantity": 5, "deliver_by": deliver_by},
        headers=agent_headers
    )
    assert lock_res.status_code == 200, lock_res.text
    quote_id = lock_res.json()["quote_id"]

    # Step 2: Agent commits order
    commit_res = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": quote_id, "po_reference": "PO-TEST-GUARDRAIL-001"},
        headers=agent_headers
    )
    assert commit_res.status_code == 200
    order_data = commit_res.json()
    assert order_data["status"] == "PENDING_APPROVAL"
    assert any("GUARDRAIL BLOCKED" in r for r in order_data["violation_reasons"])
    assert any("bakery" in r for r in order_data["violation_reasons"])

    # Step 3: Tower Server inspects client guardrails
    g_res = client.get(
        "/api/v1/admin/customers/hotel_nordic_group/guardrails"
    )
    assert g_res.status_code == 200
    guardrails = g_res.json()
    assert "bakery" in guardrails["restricted_categories"]
    assert "dairy" in guardrails["allowed_categories"]

    # Step 4: Tower Server adds 'bakery' to whitelist
    update_res = client.put(
        "/api/v1/admin/customers/hotel_nordic_group/guardrails",
        json={"allowed_categories": ["dairy", "plant-based", "bakery"]}
    )
    assert update_res.status_code == 200
    assert "bakery" in update_res.json()["allowed_categories"]

    # Step 5: Lock and commit another croissant order (within spend limit 5 * €39.50 = €197.50 < €800)
    lock_res_2 = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-BAKERY-CROISSANT-50", "pack_quantity": 5, "deliver_by": deliver_by},
        headers=agent_headers
    )
    quote_id_2 = lock_res_2.json()["quote_id"]
    commit_res_2 = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": quote_id_2, "po_reference": "PO-TEST-GUARDRAIL-002"},
        headers=agent_headers
    )
    assert commit_res_2.status_code == 200
    # Now it is auto-approved because bakery is whitelisted and €197.50 < €800!
    assert commit_res_2.json()["status"] == "CONFIRMED"
    assert commit_res_2.json()["approval_type"] == "AUTO"

def test_one_time_approval_scenario(client, agent_headers, human_headers):
    """
    Scenario: One-Time Approval
    1. Agent places order exceeding spend cap (€1,180 > €800) -> PENDING_APPROVAL.
    2. Manager approves with approval_type = 'ONE_TIME'.
    3. Order confirmed as ONE_TIME.
    4. A second order by the agent exceeding spend cap is still held in PENDING_APPROVAL.
    """
    deliver_by = (datetime.datetime.utcnow() + datetime.timedelta(days=2)).isoformat() + "Z"

    # Order 1
    lock1 = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-LF-MILK-10L", "pack_quantity": 100, "deliver_by": deliver_by},
        headers=agent_headers
    ).json()
    ord1 = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": lock1["quote_id"], "po_reference": "PO-TEST-ONETIME-01"},
        headers=agent_headers
    ).json()
    assert ord1["status"] == "PENDING_APPROVAL"

    # Manager grants ONE-TIME approval
    app1 = client.post(
        f"/api/v1/orders/{ord1['order_id']}/approve",
        json={"approval_type": "ONE_TIME"},
        headers=human_headers
    )
    assert app1.status_code == 200
    assert app1.json()["status"] == "CONFIRMED"
    assert app1.json()["approval_type"] == "ONE_TIME"

    # Order 2 (identical request by agent)
    lock2 = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-LF-MILK-10L", "pack_quantity": 100, "deliver_by": deliver_by},
        headers=agent_headers
    ).json()
    ord2 = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": lock2["quote_id"], "po_reference": "PO-TEST-ONETIME-02"},
        headers=agent_headers
    ).json()
    # Still PENDING_APPROVAL because ONE_TIME approval does not recur!
    assert ord2["status"] == "PENDING_APPROVAL"

def test_time_windowed_recurrent_approval_scenario(client, agent_headers, human_headers, admin_headers):
    """
    Scenario: Time-Windowed Recurrent Transaction Approval
    1. Agent places order exceeding spend cap (€1,180 > €800) -> PENDING_APPROVAL.
    2. Manager approves with approval_type = 'RECURRENT_WINDOW' (7-day window, €3,500 recurring budget).
    3. Order confirmed as RECURRENT_WINDOW, recurrent grant active.
    4. Agent places a subsequent 1,000L order -> AUTO-CONFIRMS under the standing recurrent grant!
    5. Wholesaler Tower revokes the grant.
    6. A third 1,000L order by agent is held again in PENDING_APPROVAL.
    """
    deliver_by = (datetime.datetime.utcnow() + datetime.timedelta(days=2)).isoformat() + "Z"

    # 1. First order exceeding limit
    lock1 = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-LF-MILK-10L", "pack_quantity": 100, "deliver_by": deliver_by},
        headers=agent_headers
    ).json()
    ord1 = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": lock1["quote_id"], "po_reference": "PO-TEST-REC-01"},
        headers=agent_headers
    ).json()
    assert ord1["status"] == "PENDING_APPROVAL"

    # 2. Manager approves with RECURRENT_WINDOW
    app_res = client.post(
        f"/api/v1/orders/{ord1['order_id']}/approve",
        json={
            "approval_type": "RECURRENT_WINDOW",
            "window_days": 7,
            "frequency": "WEEKLY",
            "recurrent_budget_eur": 3500.0,
            "notes": "Approved weekly standing milk order for Nordic Crown"
        },
        headers=human_headers
    )
    assert app_res.status_code == 200
    app_data = app_res.json()
    assert app_data["status"] == "CONFIRMED"
    assert app_data["approval_type"] == "RECURRENT_WINDOW"
    grant_id = app_data["recurrent_grant_id"]
    assert grant_id is not None
    assert grant_id.startswith("RAG-")

    # 3. Check client recurrent grants list
    grants_res = client.get("/api/v1/orders/recurrent-grants", headers=human_headers)
    assert grants_res.status_code == 200
    grants = grants_res.json()
    assert len(grants) >= 1
    matching_g = [g for g in grants if g["grant_id"] == grant_id][0]
    assert matching_g["status"] == "ACTIVE"
    assert matching_g["max_budget_per_period_eur"] == 3500.0

    # 4. Subsequent order by Agent: 1,000L milk (€1,180.00)
    lock2 = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-LF-MILK-10L", "pack_quantity": 100, "deliver_by": deliver_by},
        headers=agent_headers
    ).json()
    ord2 = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": lock2["quote_id"], "po_reference": "PO-TEST-REC-02"},
        headers=agent_headers
    ).json()

    # The order MUST BE AUTO-APPROVED under the active standing recurrent grant!
    assert ord2["status"] == "CONFIRMED"
    assert ord2["approval_type"] == "RECURRENT_WINDOW"
    assert ord2["recurrent_grant_id"] == grant_id
    assert "Recurrent Grant" in ord2["approved_by"]

    # 5. Tower Server revokes the grant
    revoke_res = client.post(
        f"/api/v1/admin/recurrent-grants/{grant_id}/revoke"
    )
    assert revoke_res.status_code == 200
    assert revoke_res.json()["status"] == "REVOKED"

    # 6. Third order by Agent: now held in PENDING_APPROVAL because grant is revoked!
    # SKU VA-LF-MILK-12X1L (60 packs * €15.48 = €928.80 > €800 limit)
    lock3 = client.post(
        "/api/v1/tools/lock_quote",
        json={"sku": "VA-LF-MILK-12X1L", "pack_quantity": 60, "deliver_by": deliver_by},
        headers=agent_headers
    ).json()
    assert "quote_id" in lock3, lock3
    ord3 = client.post(
        "/api/v1/tools/commit_order",
        json={"quote_id": lock3["quote_id"], "po_reference": "PO-TEST-REC-03"},
        headers=agent_headers
    ).json()
    assert ord3["status"] == "PENDING_APPROVAL"
