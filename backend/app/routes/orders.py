import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Order, QuoteLock, WarehouseStock, AuditLog
from ..dtos import OrderDTO
from ..auth import Principal, require_principal

router = APIRouter(prefix="/orders", tags=["Order Management & Human Governance"])

@router.get("", response_model=List[OrderDTO])
def list_orders(
    tenant_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["agent", "human", "admin"]))
):
    query = db.query(Order, QuoteLock).join(QuoteLock, QuoteLock.quote_id == Order.quote_id)
    target_tenant = tenant_id or (principal.tenant_id if principal.principal_type != "admin" else None)
    if target_tenant:
        query = query.filter(Order.tenant_id == target_tenant)
    if status_filter:
        query = query.filter(Order.status == status_filter.upper())
    
    results = query.order_by(Order.created_at.desc()).all()
    orders: List[OrderDTO] = []
    for ord_rec, q_rec in results:
        orders.append(
            OrderDTO(
                order_id=ord_rec.order_id,
                quote_id=ord_rec.quote_id,
                tenant_id=ord_rec.tenant_id,
                po_reference=ord_rec.po_reference,
                status=ord_rec.status,
                total_eur=float(ord_rec.total_eur),
                violation_reasons=ord_rec.violation_reasons,
                approved_by=ord_rec.approved_by,
                created_at=ord_rec.created_at,
                sku=q_rec.sku,
                pack_quantity=q_rec.pack_quantity,
                total_litres=float(q_rec.total_litres)
            )
        )
    return orders

@router.get("/pending", response_model=List[OrderDTO])
def list_pending_orders(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["human", "admin"]))
):
    """Inbox of orders awaiting human approval"""
    return list_orders(status_filter="PENDING_APPROVAL", db=db, principal=principal)

@router.post("/{order_id}/approve", response_model=OrderDTO)
def approve_order(
    order_id: str,
    db: Session = Depends(get_db),
    # Guard: STRICTLY require human or admin with 'orders:approve'. Agent will get 403 Forbidden!
    principal: Principal = Depends(require_principal(["human", "admin"], ["orders:approve"]))
):
    """
    FR-4: Human Sign-Off Gate.
    Authorized human manager approves a PENDING_APPROVAL order.
    Finalizes stock deduction and converts quote to CONSUMED.
    """
    tenant_id = principal.tenant_id
    order = db.query(Order).filter(Order.order_id == order_id, Order.tenant_id == tenant_id).first()
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order '{order_id}' not found."
        )

    if order.status != "PENDING_APPROVAL":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Order '{order_id}' cannot be approved: current status is {order.status}."
        )

    quote = db.query(QuoteLock).filter(QuoteLock.quote_id == order.quote_id).first()
    if not quote:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Associated quote lock not found."
        )

    # Transition order and quote
    order.status = "CONFIRMED"
    order.approved_by = f"{principal.principal_id} ({principal.principal_type})"
    quote.status = "CONSUMED"

    # Finalize stock deduction from reserved_packs
    stock_rec = db.query(WarehouseStock).filter(WarehouseStock.sku == quote.sku).first()
    if stock_rec:
        stock_rec.reserved_packs -= quote.pack_quantity

    # Append audit log
    audit = AuditLog(
        tenant_id=tenant_id,
        actor_type=principal.principal_type,
        actor_id=principal.principal_id,
        action="HUMAN_APPROVED",
        payload_summary={
            "order_id": order.order_id,
            "quote_id": quote.quote_id,
            "approved_by": order.approved_by,
            "total_eur": float(order.total_eur)
        }
    )
    db.add(audit)
    db.commit()

    return OrderDTO(
        order_id=order.order_id,
        quote_id=order.quote_id,
        tenant_id=order.tenant_id,
        po_reference=order.po_reference,
        status=order.status,
        total_eur=float(order.total_eur),
        violation_reasons=order.violation_reasons,
        approved_by=order.approved_by,
        created_at=order.created_at,
        sku=quote.sku,
        pack_quantity=quote.pack_quantity,
        total_litres=float(quote.total_litres)
    )

@router.post("/{order_id}/reject", response_model=OrderDTO)
def reject_order(
    order_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["human", "admin"], ["orders:reject"]))
):
    """
    FR-4: Human Rejection Gate.
    Releases reserved stock back to available warehouse pool.
    """
    tenant_id = principal.tenant_id
    order = db.query(Order).filter(Order.order_id == order_id, Order.tenant_id == tenant_id).first()
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order '{order_id}' not found."
        )

    if order.status != "PENDING_APPROVAL":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Order '{order_id}' cannot be rejected: current status is {order.status}."
        )

    quote = db.query(QuoteLock).filter(QuoteLock.quote_id == order.quote_id).first()
    if not quote:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Associated quote lock not found."
        )

    # Transition order and quote
    order.status = "REJECTED"
    order.approved_by = f"REJECTED by {principal.principal_id}"
    quote.status = "RELEASED"

    # Return reserved stock back to available
    stock_rec = db.query(WarehouseStock).filter(WarehouseStock.sku == quote.sku).first()
    if stock_rec:
        stock_rec.available_packs += quote.pack_quantity
        stock_rec.reserved_packs -= quote.pack_quantity

    audit = AuditLog(
        tenant_id=tenant_id,
        actor_type=principal.principal_type,
        actor_id=principal.principal_id,
        action="HUMAN_REJECTED",
        payload_summary={
            "order_id": order.order_id,
            "quote_id": quote.quote_id,
            "rejected_by": order.approved_by
        }
    )
    db.add(audit)
    db.commit()

    return OrderDTO(
        order_id=order.order_id,
        quote_id=order.quote_id,
        tenant_id=order.tenant_id,
        po_reference=order.po_reference,
        status=order.status,
        total_eur=float(order.total_eur),
        violation_reasons=order.violation_reasons,
        approved_by=order.approved_by,
        created_at=order.created_at,
        sku=quote.sku,
        pack_quantity=quote.pack_quantity,
        total_litres=float(quote.total_litres)
    )

@router.get("/audit/logs")
def get_audit_logs(
    limit: int = 50,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["agent", "human", "admin"]))
):
    logs = db.query(AuditLog).filter(AuditLog.tenant_id == principal.tenant_id).order_by(AuditLog.timestamp.desc()).limit(limit).all()
    return [
        {
            "id": log.id,
            "timestamp": log.timestamp.isoformat() + "Z",
            "actor_type": log.actor_type,
            "actor_id": log.actor_id,
            "action": log.action,
            "payload_summary": log.payload_summary
        }
        for log in logs
    ]
