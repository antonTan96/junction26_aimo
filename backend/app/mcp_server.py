"""
Model Context Protocol (MCP) Server for AimoGate.
Exposes wholesale trade tools to any MCP-compliant autonomous agent.
"""
import datetime
from typing import List, Optional
from mcp.server import MCPServer
from .database import SessionLocal
from .auth import Principal
from .dtos import SearchOffersRequest, LockQuoteRequest, CommitOrderRequest
from .routes.tools import search_offers, lock_quote, commit_order

mcp_server = MCPServer("AimoGate Wholesale Protocol")

DEFAULT_PRINCIPAL = Principal(
    tenant_id="hotel_nordic_group",
    principal_id="mcp_buyer_agent",
    principal_type="agent",
    scopes=["offers:read", "quotes:lock", "orders:submit"]
)

@mcp_server.tool()
def search_wholesale_offers(
    query: str = "lactose-free milk",
    required_volume_litres: Optional[float] = None,
    deliver_by_iso: Optional[str] = None
) -> str:
    """
    Search Valio Aimo catalog for products matching requirements.
    Normalizes pack conversions and returns guaranteed contract prices with zero internal margin exposure.
    """
    db = SessionLocal()
    try:
        deliver_dt = datetime.datetime.fromisoformat(deliver_by_iso) if deliver_by_iso else None
        req = SearchOffersRequest(
            query=query,
            required_volume_litres=required_volume_litres,
            deliver_by=deliver_dt
        )
        offers = search_offers(payload=req, db=db, principal=DEFAULT_PRINCIPAL)
        return str([o.model_dump() for o in offers])
    finally:
        db.close()

@mcp_server.tool()
def lock_wholesale_quote(
    sku: str,
    pack_quantity: int,
    deliver_by_iso: str
) -> str:
    """
    Two-Phase Stock Lock.
    Creates an atomic 15-minute soft reservation on warehouse stock at fixed contract price.
    """
    db = SessionLocal()
    try:
        deliver_dt = datetime.datetime.fromisoformat(deliver_by_iso)
        req = LockQuoteRequest(
            sku=sku,
            pack_quantity=pack_quantity,
            deliver_by=deliver_dt
        )
        res = lock_quote(payload=req, db=db, principal=DEFAULT_PRINCIPAL)
        return str(res.model_dump())
    finally:
        db.close()

@mcp_server.tool()
def commit_wholesale_order(
    quote_id: str,
    po_reference: str
) -> str:
    """
    Submit an order against a locked quote.
    Evaluated by AimoGate Deterministic Policy Firewall.
    Returns CONFIRMED if within autonomous limits, or PENDING_APPROVAL for human sign-off.
    """
    db = SessionLocal()
    try:
        req = CommitOrderRequest(
            quote_id=quote_id,
            po_reference=po_reference
        )
        res = commit_order(payload=req, db=db, principal=DEFAULT_PRINCIPAL)
        return str(res.model_dump())
    finally:
        db.close()

if __name__ == "__main__":
    mcp_server.run()
