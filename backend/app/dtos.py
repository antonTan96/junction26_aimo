import datetime
from typing import List, Optional, Any
from pydantic import BaseModel, Field, ConfigDict

# --- Search Offers ---
class SearchOffersRequest(BaseModel):
    query: Optional[str] = Field(default=None, description="Search term, e.g. lactose-free milk")
    attributes: Optional[List[str]] = Field(default_factory=list, description="Tags like ['lactose-free']")
    required_volume_litres: Optional[float] = Field(default=None, description="Volume requested, e.g. 1000.0")
    deliver_by: Optional[datetime.datetime] = Field(default=None, description="ISO-8601 delivery deadline")

class PublicOfferDTO(BaseModel):
    """
    Zero-Trust Protected Public DTO.
    Guarantees internal margins, supplier costs, and roadmap statuses are physically absent.
    """
    model_config = ConfigDict(extra="forbid")

    sku: str
    name: str
    category: str
    dietary_tags: List[str]
    pack_format: str
    pack_volume_litres: float
    unit_contract_price_eur: float
    price_per_litre_eur: float
    packs_required: Optional[int] = None
    delivered_volume_litres: Optional[float] = None
    total_contract_price_eur: Optional[float] = None
    is_stock_available: bool = True
    available_packs: int
    lead_time_feasible: bool = True
    earliest_delivery: datetime.datetime

# --- Lock Quote ---
class LockQuoteRequest(BaseModel):
    sku: str
    pack_quantity: int = Field(gt=0, description="Number of wholesale packs")
    deliver_by: datetime.datetime

class LockQuoteResponse(BaseModel):
    quote_id: str
    tenant_id: str
    sku: str
    pack_quantity: int
    total_litres: float
    locked_total_eur: float
    deliver_by: datetime.datetime
    status: str
    expires_at: datetime.datetime
    created_at: datetime.datetime

# --- Commit Order ---
class CommitOrderRequest(BaseModel):
    quote_id: str
    po_reference: str = Field(description="Idempotency PO key, e.g. PO-2026-NORDIC-001")

class OrderDTO(BaseModel):
    order_id: str
    quote_id: str
    tenant_id: str
    po_reference: str
    status: str  # CONFIRMED, PENDING_APPROVAL, REJECTED
    total_eur: float
    violation_reasons: Optional[List[str]] = None
    approved_by: Optional[str] = None
    created_at: datetime.datetime
    sku: Optional[str] = None
    pack_quantity: Optional[int] = None
    total_litres: Optional[float] = None

# --- Policy Management ---
class PolicyUpdateDTO(BaseModel):
    max_auto_approve_eur: Optional[float] = None
    max_auto_approve_litres: Optional[float] = None
    allowed_categories: Optional[List[str]] = None

class TenantPolicyDTO(BaseModel):
    tenant_id: str
    tenant_name: str
    max_auto_approve_eur: float
    max_auto_approve_litres: float
    allowed_categories: List[str]

# --- Agent Run ---
class AgentRunRequest(BaseModel):
    prompt: str = Field(..., description="Buyer instruction, e.g. I need 1,000 litres of lactose-free milk by Monday")
    mode: str = Field(default="deterministic", description="'deterministic' or 'live'")
    po_reference: Optional[str] = None

class AgentStepTrace(BaseModel):
    step_number: int
    title: str
    description: str
    action_type: str  # 'reasoning', 'tool_call', 'tool_result', 'policy_decision', 'final_answer'
    tool_name: Optional[str] = None
    tool_input: Optional[Any] = None
    tool_output: Optional[Any] = None
    timestamp: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)

class AgentRunResponse(BaseModel):
    success: bool
    mode_used: str
    execution_time_ms: float
    traces: List[AgentStepTrace]
    final_status: str
    order: Optional[OrderDTO] = None
    summary_message: str
