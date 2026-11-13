from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..dtos import AgentRunRequest, AgentRunResponse
from ..agent import run_agent_workflow

router = APIRouter(prefix="/agent", tags=["Autonomous Buyer Agent Driver"])

@router.post("/run", response_model=AgentRunResponse)
def execute_buyer_agent(
    payload: AgentRunRequest,
    db: Session = Depends(get_db)
):
    """
    S1: Driver for Autonomous Buyer Agent.
    Accepts natural language procurement request (e.g. 'I need 1,000 litres of lactose-free milk by Monday').
    Executes search_offers -> lock_quote -> commit_order, evaluating against policy firewall.
    Supports instant deterministic replay or live LLM mode.
    """
    return run_agent_workflow(
        prompt=payload.prompt,
        db=db,
        mode=payload.mode,
        po_reference=payload.po_reference,
        tenant_id=payload.tenant_id or "hotel_nordic_group"
    )
