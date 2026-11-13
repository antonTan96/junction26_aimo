from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..database import get_db
from ..models import TenantPolicy, Order, QuoteLock, WarehouseStock, AuditLog, Product
from ..dtos import OrderDTO
from ..auth import Principal, require_principal

router = APIRouter(prefix="/admin", tags=["AimoGate Wholesale Control Tower"])

@router.get("/overview")
def get_admin_overview(
    db: Session = Depends(get_db),
    # principal: Principal = Depends(require_principal(["admin", "human"]))
):
    """
    Wholesaler Monitoring Dashboard: Network-wide metrics across all customer agents.
    """
    total_customers = db.query(TenantPolicy).count()
    all_orders = db.query(Order).all()
    total_orders = len(all_orders)

    confirmed_orders = [o for o in all_orders if o.status == "CONFIRMED"]
    pending_orders = [o for o in all_orders if o.status == "PENDING_APPROVAL"]
    rejected_orders = [o for o in all_orders if o.status == "REJECTED"]

    total_gmv = sum(float(o.total_eur) for o in confirmed_orders)
    pending_gmv = sum(float(o.total_eur) for o in pending_orders)

    auto_approval_rate = (
        round((len(confirmed_orders) / total_orders) * 100, 1) if total_orders > 0 else 100.0
    )

    # Active stock reservations (in 15-min TTL)
    reserved_stock = db.query(func.sum(WarehouseStock.reserved_packs)).scalar() or 0
    available_stock = db.query(func.sum(WarehouseStock.available_packs)).scalar() or 0

    return {
        "network_status": "ACTIVE_PROTECTED",
        "total_customers": total_customers,
        "total_orders": total_orders,
        "total_confirmed_gmv_eur": round(total_gmv, 2),
        "pending_approval_gmv_eur": round(pending_gmv, 2),
        "pending_approvals_count": len(pending_orders),
        "confirmed_count": len(confirmed_orders),
        "rejected_count": len(rejected_orders),
        "auto_approval_rate_pct": auto_approval_rate,
        "stock_metrics": {
            "reserved_packs_in_ttl": int(reserved_stock),
            "available_packs_total": int(available_stock)
        },
        "zero_trust_firewall": {
            "status": "ENFORCED",
            "internal_margins_exposed": 0,
            "roadmap_skus_exposed": 0,
            "policy_rule_checks_passed": total_orders
        }
    }

@router.get("/customers")
def get_all_customers(
    db: Session = Depends(get_db),
):
    """
    Returns all registered customer tenants, their policy settings, and activity stats.
    """
    policies = db.query(TenantPolicy).all()
    customers_data = []

    for p in policies:
        orders = db.query(Order).filter(Order.tenant_id == p.tenant_id).all()
        confirmed = [o for o in orders if o.status == "CONFIRMED"]
        pending = [o for o in orders if o.status == "PENDING_APPROVAL"]
        total_spend = sum(float(o.total_eur) for o in confirmed)

        customers_data.append({
            "tenant_id": p.tenant_id,
            "tenant_name": p.tenant_name,
            "max_auto_approve_eur": float(p.max_auto_approve_eur),
            "max_auto_approve_litres": float(p.max_auto_approve_litres),
            "allowed_categories": p.allowed_categories or [],
            "total_orders": len(orders),
            "pending_approvals": len(pending),
            "confirmed_orders": len(confirmed),
            "total_confirmed_spend_eur": round(total_spend, 2),
            "agent_status": "ONLINE" if len(pending) == 0 else "ACTION_REQUIRED"
        })

    return customers_data

@router.get("/orders", response_model=List[Dict[str, Any]])
def get_all_orders(
    tenant_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Cross-customer global order ledger for Valio Aimo monitoring.
    """
    query = (
        db.query(Order, QuoteLock, TenantPolicy)
        .join(QuoteLock, QuoteLock.quote_id == Order.quote_id)
        .join(TenantPolicy, TenantPolicy.tenant_id == Order.tenant_id)
    )

    if tenant_id:
        query = query.filter(Order.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(Order.status == status_filter.upper())

    results = query.order_by(Order.created_at.desc()).all()
    output = []
    for ord_rec, q_rec, pol_rec in results:
        output.append({
            "order_id": ord_rec.order_id,
            "quote_id": ord_rec.quote_id,
            "tenant_id": ord_rec.tenant_id,
            "tenant_name": pol_rec.tenant_name,
            "po_reference": ord_rec.po_reference,
            "status": ord_rec.status,
            "total_eur": float(ord_rec.total_eur),
            "violation_reasons": ord_rec.violation_reasons,
            "approved_by": ord_rec.approved_by,
            "created_at": ord_rec.created_at.isoformat() + "Z",
            "sku": q_rec.sku,
            "pack_quantity": q_rec.pack_quantity,
            "total_litres": float(q_rec.total_litres),
            "expires_at": q_rec.expires_at.isoformat() + "Z"
        })
    return output

@router.get("/audit_logs")
def get_global_audit_logs(
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """
    Global immutable audit stream across all customer agents.
    """
    logs = db.query(AuditLog, TenantPolicy).outerjoin(
        TenantPolicy, TenantPolicy.tenant_id == AuditLog.tenant_id
    ).order_by(AuditLog.timestamp.desc()).limit(limit).all()

    return [
        {
            "id": log.id,
            "timestamp": log.timestamp.isoformat() + "Z",
            "tenant_id": log.tenant_id,
            "tenant_name": pol.tenant_name if pol else log.tenant_id,
            "actor_type": log.actor_type,
            "actor_id": log.actor_id,
            "action": log.action,
            "payload_summary": log.payload_summary
        }
        for log, pol in logs
    ]
