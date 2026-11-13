import re
import time
import math
import uuid
import datetime
from typing import Dict, Any, List, Optional
import httpx
from sqlalchemy.orm import Session
from .config import settings
from .auth import Principal
from .valio_client import valio_client
from .dtos import (
    SearchOffersRequest,
    LockQuoteRequest,
    CommitOrderRequest,
    AgentStepTrace,
    AgentRunResponse,
    OrderDTO
)
from .routes.tools import search_offers, lock_quote, commit_order

def parse_buyer_prompt(prompt: str) -> Dict[str, Any]:
    """Extract volume in litres, delivery timeframe, and product keywords from natural language"""
    text = prompt.lower()
    
    # 1. Volume extraction (e.g. 1000 litres, 1,000L, 400 l, 1000.0)
    vol_match = re.search(r'([\d,]+(?:\.\d+)?)\s*(?:l|litres|liter|liters)\b', text)
    if vol_match:
        vol_str = vol_match.group(1).replace(',', '')
        volume_litres = float(vol_str)
    else:
        # Default to 1000 if not specified
        volume_litres = 1000.0

    # 2. Dietary / Product query
    query = "lactose-free milk"
    if "oat" in text:
        query = "oat"
    elif "dairy" in text or "milk" in text:
        query = "lactose-free milk"

    # 3. Delivery date (by Monday / default 3 days ahead)
    now = datetime.datetime.utcnow()
    # next Monday or 3 days later
    days_ahead = (0 - now.weekday()) % 7
    if days_ahead <= 1:
        days_ahead += 7
    deliver_by = now + datetime.timedelta(days=days_ahead, hours=8)

    return {
        "volume_litres": volume_litres,
        "query": query,
        "deliver_by": deliver_by
    }

def run_agent_workflow(
    prompt: str,
    db: Session,
    mode: str = "deterministic",
    po_reference: Optional[str] = None
) -> AgentRunResponse:
    start_time = time.time()
    traces: List[AgentStepTrace] = []
    
    principal = Principal(
        tenant_id="hotel_nordic_group",
        principal_id="buyer_agent_nordic_01",
        principal_type="agent",
        scopes=["offers:read", "quotes:lock", "orders:submit"]
    )

    # Step 1: Requirement Parsing & Autonomous Planning
    parsed = parse_buyer_prompt(prompt)
    target_vol = parsed["volume_litres"]
    target_query = parsed["query"]
    target_date = parsed["deliver_by"]

    traces.append(AgentStepTrace(
        step_number=1,
        title="Autonomous Goal & Intent Analysis",
        description=f"Parsed requirement: {target_vol:,.0f}L of '{target_query}' needed by {target_date.strftime('%Y-%m-%d %H:%M')} UTC. Initiating catalog discovery via AimoGate.",
        action_type="reasoning",
        tool_input={"prompt": prompt, "parsed_intent": parsed}
    ))

    # Step 2: Tool Call -> search_offers (Local Catalog or Live junction26.valioaimo.fi)
    search_payload = SearchOffersRequest(
        query=target_query,
        attributes=["lactose-free"],
        required_volume_litres=target_vol,
        deliver_by=target_date
    )
    
    offers = []
    source_label = "Local Catalog"
    if mode == "live":
        try:
            live_offers = valio_client.get_live_offers(
                query=target_query,
                required_volume_litres=target_vol,
                deliver_by=target_date
            )
            if live_offers:
                offers = live_offers
                source_label = "Live Upstream (junction26.valioaimo.fi)"
                # Register SKUs dynamically in local database for quote locking & policy evaluation
                from .models import Product, TenantContractPrice, WarehouseStock
                for off in offers:
                    p_exist = db.query(Product).filter(Product.sku == off.sku).first()
                    if not p_exist:
                        p_new = Product(
                            sku=off.sku,
                            name=off.name,
                            category=off.category,
                            dietary_tags=off.dietary_tags,
                            pack_format=off.pack_format,
                            pack_volume_litres=off.pack_volume_litres,
                            min_lead_time_hours=24,
                            is_active=True,
                            internal_cost_eur=round(off.unit_contract_price_eur * 0.82, 2),
                            internal_margin_pct=18.0,
                            roadmap_status="LIVE"
                        )
                        db.add(p_new)
                        cp_new = TenantContractPrice(
                            tenant_id="hotel_nordic_group",
                            sku=off.sku,
                            contract_pack_price_eur=off.unit_contract_price_eur
                        )
                        db.add(cp_new)
                        st_new = WarehouseStock(
                            sku=off.sku,
                            available_packs=off.available_packs,
                            reserved_packs=0
                        )
                        db.add(st_new)
                db.commit()
        except Exception as e:
            # Fall back to local search if remote is unreachable
            pass

    if not offers:
        offers = search_offers(payload=search_payload, db=db, principal=principal)
    
    traces.append(AgentStepTrace(
        step_number=2,
        title="Tool Call: search_offers",
        description=f"Retrieved {len(offers)} matching contract offers from {source_label}. Pack sizes normalized, internal margins securely withheld.",
        action_type="tool_call",
        tool_name="search_offers",
        tool_input=search_payload.model_dump(),
        tool_output=[o.model_dump() for o in offers]
    ))

    if not offers:
        return AgentRunResponse(
            success=False,
            mode_used=mode,
            execution_time_ms=(time.time() - start_time) * 1000,
            traces=traces,
            final_status="NO_OFFERS",
            summary_message="No matching products found matching criteria."
        )

    # Step 3: Best Offer Evaluation
    best_offer = min(offers, key=lambda x: (x.total_contract_price_eur or 999999, x.price_per_litre_eur))
    comparison_notes = ", ".join(
        [f"{o.sku} ({o.pack_format}): €{o.total_contract_price_eur:,.2f} total (€{o.price_per_litre_eur:.2f}/L)" for o in offers]
    )

    traces.append(AgentStepTrace(
        step_number=3,
        title="Autonomous Unit-Economics Optimization",
        description=f"Evaluated options: {comparison_notes}. Selected SKU '{best_offer.sku}' ({best_offer.pack_format}) with lowest unit cost €{best_offer.price_per_litre_eur:.2f}/L (Total: €{best_offer.total_contract_price_eur:,.2f} for {best_offer.packs_required} packs).",
        action_type="reasoning",
        tool_output={
            "selected_sku": best_offer.sku,
            "packs_required": best_offer.packs_required,
            "total_contract_price_eur": best_offer.total_contract_price_eur
        }
    ))

    # Step 4: Tool Call -> lock_quote (Two-Phase Soft Stock Lock)
    lock_payload = LockQuoteRequest(
        sku=best_offer.sku,
        pack_quantity=best_offer.packs_required,
        deliver_by=target_date
    )
    quote_res = lock_quote(payload=lock_payload, db=db, principal=principal)

    traces.append(AgentStepTrace(
        step_number=4,
        title="Tool Call: lock_quote (Two-Phase Stock Lock)",
        description=f"Locked quote {quote_res.quote_id} with Valio Aimo. Reserved {quote_res.pack_quantity} packs ({quote_res.total_litres}L) at fixed price €{quote_res.locked_total_eur:,.2f} with 15-minute TTL.",
        action_type="tool_call",
        tool_name="lock_quote",
        tool_input=lock_payload.model_dump(),
        tool_output=quote_res.model_dump()
    ))

    # Step 5: Tool Call -> commit_order
    po_ref = po_reference or f"PO-{datetime.datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    commit_payload = CommitOrderRequest(
        quote_id=quote_res.quote_id,
        po_reference=po_ref
    )
    order_res = commit_order(payload=commit_payload, db=db, principal=principal)

    traces.append(AgentStepTrace(
        step_number=5,
        title="Tool Call: commit_order (Policy Firewall Evaluation)",
        description=f"Submitted order for quote {quote_res.quote_id} with PO Reference {po_ref}. Evaluated against buyer autonomous spend & volume rules.",
        action_type="tool_call",
        tool_name="commit_order",
        tool_input=commit_payload.model_dump(),
        tool_output=order_res.model_dump()
    ))

    # Step 6: Policy Decision & Synthesis
    if order_res.status == "CONFIRMED":
        summary = (
            f"Order {order_res.order_id} AUTO-APPROVED by AimoGate. "
            f"Total €{order_res.total_eur:,.2f} is within the autonomous spend threshold. "
            f"Stock permanently allocated for delivery by {target_date.strftime('%Y-%m-%d')}."
        )
        final_status = "CONFIRMED"
    else:
        violation_str = "; ".join(order_res.violation_reasons or ["Policy limit exceeded"])
        summary = (
            f"Order {order_res.order_id} HELD by Policy Firewall: {violation_str}. "
            f"Stock ({best_offer.packs_required} packs / {best_offer.delivered_volume_litres}L) is safely locked under {quote_res.quote_id}. "
            f"Approval card automatically dispatched to Human F&B Manager inbox."
        )
        final_status = "PENDING_APPROVAL"

    traces.append(AgentStepTrace(
        step_number=6,
        title="Final Governance Decision",
        description=summary,
        action_type="policy_decision",
        tool_output={
            "order_id": order_res.order_id,
            "status": order_res.status,
            "violations": order_res.violation_reasons
        }
    ))

    elapsed_ms = round((time.time() - start_time) * 1000, 2)
    return AgentRunResponse(
        success=True,
        mode_used=mode,
        execution_time_ms=elapsed_ms,
        traces=traces,
        final_status=final_status,
        order=order_res,
        summary_message=summary
    )
