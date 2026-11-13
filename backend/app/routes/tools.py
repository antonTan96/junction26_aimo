import math
import uuid
import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Product, TenantContractPrice, WarehouseStock, TenantPolicy, QuoteLock, Order, AuditLog
from ..dtos import (
    SearchOffersRequest,
    PublicOfferDTO,
    LockQuoteRequest,
    LockQuoteResponse,
    CommitOrderRequest,
    OrderDTO,
)
from ..auth import Principal, get_current_principal, require_principal
from ..policy_engine import PolicyEngine

router = APIRouter(prefix="/tools", tags=["Agent Tools & Protocol Gateway"])

@router.post("/search_offers", response_model=List[PublicOfferDTO])
def search_offers(
    payload: SearchOffersRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["agent", "human", "admin"], ["offers:read"]))
):
    """
    FR-1: Scoped Catalog & Unit-Normalized Lookup.
    Zero-Trust Protected: Filters out unreleased SKUs and strips all internal margin/cost fields.
    """
    tenant_id = principal.tenant_id
    now = datetime.datetime.utcnow()

    # Query only active and LIVE products (UNRELEASED roadmaps are physically filtered)
    query = (
        db.query(Product, TenantContractPrice, WarehouseStock)
        .join(TenantContractPrice, (TenantContractPrice.sku == Product.sku) & (TenantContractPrice.tenant_id == tenant_id))
        .join(WarehouseStock, WarehouseStock.sku == Product.sku)
        .filter(Product.is_active == True)
        .filter(Product.roadmap_status == "LIVE")
    )

    results = query.all()
    filtered_offers: List[PublicOfferDTO] = []

    search_term = payload.query.lower().strip() if payload.query else ""
    search_words = [w for w in search_term.split() if w]
    required_tags = [t.lower() for t in (payload.attributes or [])]

    for product, price_rec, stock_rec in results:
        # Check text search across name, category, and dietary tags
        product_tags = [t.lower() for t in (product.dietary_tags or [])]
        text_corpus = f"{product.name.lower()} {product.category.lower()} {' '.join(product_tags)}"
        
        # Word-level matching (e.g. "lactose-free" and "milk")
        query_match = not search_words or all(word in text_corpus for word in search_words)
        
        # Dietary attributes match
        tags_match = all(req in product_tags for req in required_tags)

        if not query_match or not tags_match:
            continue

        pack_vol = float(product.pack_volume_litres)
        unit_price = float(price_rec.contract_pack_price_eur)
        price_per_litre = round(unit_price / pack_vol, 2)

        packs_required = None
        delivered_vol = None
        total_price = None

        if payload.required_volume_litres is not None and payload.required_volume_litres > 0:
            packs_required = math.ceil(payload.required_volume_litres / pack_vol)
            delivered_vol = round(packs_required * pack_vol, 2)
            total_price = round(packs_required * unit_price, 2)

        # Lead time feasibility check
        earliest_delivery = now + datetime.timedelta(hours=product.min_lead_time_hours)
        lead_time_feasible = True
        if payload.deliver_by is not None:
            # strip tz if needed for clean comparison
            deliver_by_naive = payload.deliver_by.replace(tzinfo=None)
            lead_time_feasible = deliver_by_naive >= earliest_delivery

        is_stock_available = (
            stock_rec.available_packs >= (packs_required or 1)
        )

        # Construct Zero-Trust Public DTO
        offer = PublicOfferDTO(
            sku=product.sku,
            name=product.name,
            category=product.category,
            dietary_tags=product.dietary_tags or [],
            pack_format=product.pack_format,
            pack_volume_litres=pack_vol,
            unit_contract_price_eur=unit_price,
            price_per_litre_eur=price_per_litre,
            packs_required=packs_required,
            delivered_volume_litres=delivered_vol,
            total_contract_price_eur=total_price,
            is_stock_available=is_stock_available,
            available_packs=stock_rec.available_packs,
            lead_time_feasible=lead_time_feasible,
            earliest_delivery=earliest_delivery,
        )
        filtered_offers.append(offer)

    # Sort primarily by total_contract_price if calculated, else price_per_litre
    filtered_offers.sort(key=lambda x: (x.total_contract_price_eur or 0, x.price_per_litre_eur))
    return filtered_offers

@router.post("/lock_quote", response_model=LockQuoteResponse)
def lock_quote(
    payload: LockQuoteRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["agent", "human", "admin"], ["quotes:lock"]))
):
    """
    FR-2: Two-Phase Fixed-Price Quote Locking.
    Performs atomic row reservation in warehouse_stock and locks quote for 15 minutes.
    """
    tenant_id = principal.tenant_id
    now = datetime.datetime.utcnow()

    # Verify product and contract pricing
    product = db.query(Product).filter(Product.sku == payload.sku, Product.is_active == True, Product.roadmap_status == "LIVE").first()
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"SKU '{payload.sku}' is not available in catalog."
        )

    price_rec = db.query(TenantContractPrice).filter(
        TenantContractPrice.tenant_id == tenant_id,
        TenantContractPrice.sku == payload.sku
    ).first()
    if not price_rec:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"No contract pricing found for tenant '{tenant_id}' on SKU '{payload.sku}'."
        )

    # Stock check and atomic lock
    stock_rec = db.query(WarehouseStock).filter(WarehouseStock.sku == payload.sku).with_for_update().first()
    if not stock_rec or stock_rec.available_packs < payload.pack_quantity:
        available = stock_rec.available_packs if stock_rec else 0
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Insufficient stock for SKU '{payload.sku}'. Requested: {payload.pack_quantity}, Available: {available}"
        )

    # Lead time check
    deliver_by_naive = payload.deliver_by.replace(tzinfo=None)
    earliest_allowed = now + datetime.timedelta(hours=product.min_lead_time_hours)
    if deliver_by_naive < earliest_allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Requested delivery '{payload.deliver_by}' violates lead time ({product.min_lead_time_hours}h). Earliest: {earliest_allowed.isoformat()}Z"
        )

    # Decrement available, increment reserved
    stock_rec.available_packs -= payload.pack_quantity
    stock_rec.reserved_packs += payload.pack_quantity

    # Calculate locked totals
    pack_vol = float(product.pack_volume_litres)
    unit_price = float(price_rec.contract_pack_price_eur)
    total_litres = round(payload.pack_quantity * pack_vol, 2)
    locked_total_eur = round(payload.pack_quantity * unit_price, 2)

    quote_id = f"Q-{uuid.uuid4().hex[:8].upper()}"
    expires_at = now + datetime.timedelta(minutes=15)

    quote = QuoteLock(
        quote_id=quote_id,
        tenant_id=tenant_id,
        sku=payload.sku,
        pack_quantity=payload.pack_quantity,
        total_litres=total_litres,
        locked_total_eur=locked_total_eur,
        deliver_by=deliver_by_naive,
        status="LOCKED",
        expires_at=expires_at,
        created_at=now
    )
    db.add(quote)

    # Audit log
    audit = AuditLog(
        tenant_id=tenant_id,
        actor_type=principal.principal_type,
        actor_id=principal.principal_id,
        action="QUOTE_LOCKED",
        payload_summary={
            "quote_id": quote_id,
            "sku": payload.sku,
            "pack_quantity": payload.pack_quantity,
            "locked_total_eur": locked_total_eur,
            "expires_at": expires_at.isoformat() + "Z"
        }
    )
    db.add(audit)
    db.commit()

    return LockQuoteResponse(
        quote_id=quote_id,
        tenant_id=tenant_id,
        sku=payload.sku,
        pack_quantity=payload.pack_quantity,
        total_litres=total_litres,
        locked_total_eur=locked_total_eur,
        deliver_by=quote.deliver_by,
        status="LOCKED",
        expires_at=expires_at,
        created_at=now
    )

@router.post("/commit_order", response_model=OrderDTO)
def commit_order(
    payload: CommitOrderRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["agent", "human", "admin"], ["orders:submit"]))
):
    """
    FR-3: Order Submission & Policy Firewall Evaluation.
    Evaluates policy limits (spend, volume, categories).
    Auto-commits if rules pass, or transitions to PENDING_APPROVAL with stock held.
    """
    tenant_id = principal.tenant_id
    now = datetime.datetime.utcnow()

    # 1. Idempotency Check
    existing_order = db.query(Order).filter(
        Order.tenant_id == tenant_id,
        Order.po_reference == payload.po_reference
    ).first()
    if existing_order:
        q = db.query(QuoteLock).filter(QuoteLock.quote_id == existing_order.quote_id).first()
        return OrderDTO(
            order_id=existing_order.order_id,
            quote_id=existing_order.quote_id,
            tenant_id=existing_order.tenant_id,
            po_reference=existing_order.po_reference,
            status=existing_order.status,
            total_eur=float(existing_order.total_eur),
            violation_reasons=existing_order.violation_reasons,
            approved_by=existing_order.approved_by,
            created_at=existing_order.created_at,
            sku=q.sku if q else None,
            pack_quantity=q.pack_quantity if q else None,
            total_litres=float(q.total_litres) if q else None
        )

    # 2. Validate Quote Lock
    quote = db.query(QuoteLock).filter(
        QuoteLock.quote_id == payload.quote_id,
        QuoteLock.tenant_id == tenant_id
    ).first()
    if not quote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quote '{payload.quote_id}' not found for tenant '{tenant_id}'."
        )

    if quote.status != "LOCKED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Quote '{payload.quote_id}' is not in LOCKED status (Current: {quote.status})."
        )

    if quote.expires_at < now:
        quote.status = "EXPIRED"
        # Release reserved stock back to available
        stock_rec = db.query(WarehouseStock).filter(WarehouseStock.sku == quote.sku).first()
        if stock_rec:
            stock_rec.available_packs += quote.pack_quantity
            stock_rec.reserved_packs -= quote.pack_quantity
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=f"Quote '{payload.quote_id}' has expired. Please create a new quote."
        )

    # 3. Policy Firewall Evaluation
    policy = db.query(TenantPolicy).filter(TenantPolicy.tenant_id == tenant_id).first()
    product = db.query(Product).filter(Product.sku == quote.sku).first()

    passes, violations = PolicyEngine.evaluate(policy, product, quote)

    order_id = f"ORD-{uuid.uuid4().hex[:8].upper()}"

    if passes:
        order_status = "CONFIRMED"
        quote.status = "CONSUMED"
        # Finalize stock deduction: decrement reserved_packs (available was decremented at quote lock)
        stock_rec = db.query(WarehouseStock).filter(WarehouseStock.sku == quote.sku).first()
        if stock_rec:
            stock_rec.reserved_packs -= quote.pack_quantity

        action = "AUTO_APPROVED"
    else:
        order_status = "PENDING_APPROVAL"
        # Stock remains reserved in warehouse_stock
        action = "POLICY_HELD"

    order = Order(
        order_id=order_id,
        quote_id=quote.quote_id,
        tenant_id=tenant_id,
        po_reference=payload.po_reference,
        status=order_status,
        total_eur=quote.locked_total_eur,
        violation_reasons=violations if not passes else None,
        approved_by="AimoGate-PolicyEngine" if passes else None,
        created_at=now
    )
    db.add(order)

    # Audit log
    audit = AuditLog(
        tenant_id=tenant_id,
        actor_type=principal.principal_type,
        actor_id=principal.principal_id,
        action=action,
        payload_summary={
            "order_id": order_id,
            "quote_id": quote.quote_id,
            "po_reference": payload.po_reference,
            "total_eur": float(quote.locked_total_eur),
            "status": order_status,
            "violations": violations
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
