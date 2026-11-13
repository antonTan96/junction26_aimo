import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal
from backend.app.seed import seed_database
from backend.app.models import WarehouseStock

@pytest.fixture(autouse=True)
def reset_db_before_test():
    db = SessionLocal()
    seed_database(db)
    db.close()

@pytest.fixture
def client():
    return TestClient(app)

def test_agent_run_1000L_triggers_pending_approval(client):
    """Test full agent run with 1,000L prompt exceeding spend cap"""
    res = client.post(
        "/api/v1/agent/run",
        json={
            "prompt": "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.",
            "mode": "deterministic"
        }
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["success"] is True
    assert data["final_status"] == "PENDING_APPROVAL"
    assert data["order"] is not None
    assert data["order"]["total_eur"] == 1180.00
    assert "exceeds autonomous limit" in data["summary_message"]

    # Verify traces are structured with 6 steps
    traces = data["traces"]
    assert len(traces) == 6
    assert traces[0]["action_type"] == "reasoning"
    assert traces[1]["tool_name"] == "search_offers"
    assert traces[2]["action_type"] == "reasoning"
    assert traces[3]["tool_name"] == "lock_quote"
    assert traces[4]["tool_name"] == "commit_order"
    assert traces[5]["action_type"] == "policy_decision"

def test_agent_run_400L_auto_confirms(client):
    """Test agent run with 400L prompt that stays within spend cap"""
    res = client.post(
        "/api/v1/agent/run",
        json={
            "prompt": "I need 400 litres of lactose-free milk by Monday.",
            "mode": "deterministic"
        }
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["success"] is True
    assert data["final_status"] == "CONFIRMED"
    assert data["order"]["total_eur"] == 472.00
    assert "AUTO-APPROVED" in data["summary_message"]

def test_demo_reset_and_inspect(client):
    """Test S3 instant reset and zero-trust inspection view"""
    # 1. Inspect view shows raw internal fields in DB view, but strips them in sanitized view
    inspect_res = client.get("/api/v1/demo/inspect")
    assert inspect_res.status_code == 200
    inspect_data = inspect_res.json()
    
    raw_records = inspect_data["raw_erp_database_view"]["records"]
    assert any("internal_margin_pct" in r for r in raw_records)
    assert any(r["sku"] == "VA-ROADMAP-Q4-PRO" for r in raw_records)

    sanitized_records = inspect_data["sanitized_agent_gateway_view"]["records"]
    assert not any("internal_margin_pct" in r for r in sanitized_records)
    assert not any(r["sku"] == "VA-ROADMAP-Q4-PRO" for r in sanitized_records)

    # 2. Reset endpoint
    reset_res = client.post("/api/v1/demo/reset")
    assert reset_res.status_code == 200
    assert reset_res.json()["status"] == "success"
