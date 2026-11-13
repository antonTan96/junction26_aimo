import uuid
import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Order, QuoteLock, WarehouseStock, AuditLog, Product, RecurrentApprovalGrant
from ..dtos import OrderDTO, OrderApprovalRequest, RecurrentGrantDTO
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
                approval_type=ord_rec.approval_type,
                recurrent_grant_id=ord_rec.recurrent_grant_id,
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
    payload: Optional[OrderApprovalRequest] = None,
    db: Session = Depends(get_db),
    # Guard: STRICTLY require human or admin with 'orders:approve'. Agent will get 403 Forbidden!
    principal: Principal = Depends(require_principal(["human", "admin"], ["orders:approve"]))
):
    """
    FR-4: Human Sign-Off Gate.
    Authorized human manager approves a PENDING_APPROVAL order.
    Supports either ONE_TIME transaction approval or TIME-WINDOWED RECURRENT approval.
    """
    tenant_id = principal.tenant_id
    now = datetime.datetime.utcnow()
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

    # Determine approval type
    req_type = (payload.approval_type if payload else "ONE_TIME").upper()
    grant_id = None

    if req_type == "RECURRENT_WINDOW":
        window_days = payload.window_days if (payload and payload.window_days > 0) else 7
        valid_until = now + datetime.timedelta(days=window_days)
        product = db.query(Product).filter(Product.sku == quote.sku).first()
        category = product.category if product else "dairy"
        budget = (
            payload.recurrent_budget_eur
            if (payload and payload.recurrent_budget_eur)
            else max(float(order.total_eur) * 2.5, 3000.0)
        )
        frequency = payload.frequency if payload else "WEEKLY"

        grant_id = f"RAG-{uuid.uuid4().hex[:8].upper()}"
        grant = RecurrentApprovalGrant(
            grant_id=grant_id,
            tenant_id=tenant_id,
            category=category,
            sku=quote.sku,
            frequency=frequency,
            window_days=window_days,
            max_budget_per_period_eur=budget,
            current_period_spent_eur=float(order.total_eur),
            valid_from=now,
            valid_until=valid_until,
            status="ACTIVE",
            approved_by=f"{principal.principal_id} ({principal.principal_type})",
            notes=payload.notes if payload else f"Standing approval window for {quote.sku}",
            created_at=now
        )
        db.add(grant)

        order.approval_type = "RECURRENT_WINDOW"
        order.recurrent_grant_id = grant_id
        order.approved_by = f"{principal.principal_id} [RECURRENT-WINDOW: {window_days}d until {valid_until.strftime('%b %d')}]"
        audit_action = "RECURRENT_GRANT_ESTABLISHED"
    else:
        # Default: ONE_TIME transaction approval
        order.approval_type = "ONE_TIME"
        order.recurrent_grant_id = None
        order.approved_by = f"{principal.principal_id} ({principal.principal_type}) [ONE-TIME]"
        audit_action = "HUMAN_APPROVED"

    # Transition order and quote
    order.status = "CONFIRMED"
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
        action=audit_action,
        payload_summary={
            "order_id": order.order_id,
            "quote_id": quote.quote_id,
            "approval_type": order.approval_type,
            "recurrent_grant_id": order.recurrent_grant_id,
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
        approval_type=order.approval_type,
        recurrent_grant_id=order.recurrent_grant_id,
        created_at=order.created_at,
        sku=quote.sku,
        pack_quantity=quote.pack_quantity,
        total_litres=float(quote.total_litres)
    )

@router.get("/recurrent-grants", response_model=List[RecurrentGrantDTO])
def list_recurrent_grants(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["agent", "human", "admin"]))
):
    """
    List active and historical recurrent approval window grants for the client tenant.
    """
    now = datetime.datetime.utcnow()
    query = db.query(RecurrentApprovalGrant)
    if principal.principal_type != "admin":
        query = query.filter(RecurrentApprovalGrant.tenant_id == principal.tenant_id)

    grants = query.order_by(RecurrentApprovalGrant.created_at.desc()).all()
    results = []
    for g in grants:
        days_rem = max(0, (g.valid_until - now).days)
        is_val = g.status == "ACTIVE" and g.valid_from <= now <= g.valid_until
        results.append(
            RecurrentGrantDTO(
                grant_id=g.grant_id,
                tenant_id=g.tenant_id,
                category=g.category,
                sku=g.sku,
                frequency=g.frequency,
                window_days=g.window_days,
                max_budget_per_period_eur=float(g.max_budget_per_period_eur),
                current_period_spent_eur=float(g.current_period_spent_eur),
                valid_from=g.valid_from,
                valid_until=g.valid_until,
                status=g.status,
                approved_by=g.approved_by,
                notes=g.notes,
                created_at=g.created_at,
                is_valid=is_val,
                days_remaining=days_rem
            )
        )
    return results

@router.post("/recurrent-grants/{grant_id}/revoke")
def revoke_recurrent_grant(
    grant_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["human", "admin"], ["orders:approve"]))
):
    """
    Revoke an active recurrent approval grant immediately.
    """
    query = db.query(RecurrentApprovalGrant).filter(RecurrentApprovalGrant.grant_id == grant_id)
    if principal.principal_type != "admin":
        query = query.filter(RecurrentApprovalGrant.tenant_id == principal.tenant_id)

    grant = query.first()
    if not grant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recurrent grant '{grant_id}' not found."
        )

    grant.status = "REVOKED"
    db.add(AuditLog(
        tenant_id=grant.tenant_id,
        actor_type=principal.principal_type,
        actor_id=principal.principal_id,
        action="RECURRENT_GRANT_REVOKED",
        payload_summary={
            "grant_id": grant_id,
            "revoked_by": principal.principal_id
        }
    ))
    db.commit()
    return {"status": "REVOKED", "grant_id": grant_id}

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
