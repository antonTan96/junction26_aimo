from typing import Optional, List
import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import TenantPolicy, AuditLog, RecurrentApprovalGrant
from ..dtos import PolicyUpdateDTO, TenantPolicyDTO, GuardrailWhitelistDTO
from ..auth import Principal, require_principal

router = APIRouter(prefix="/policies", tags=["Tenant Policy Configuration"])

SYSTEM_CATEGORIES = ["dairy", "plant-based", "bakery", "beverages", "cleaning", "meat", "alcohol"]

@router.get("", response_model=TenantPolicyDTO)
def get_policy(
    tenant_id: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["agent", "human", "admin"]))
):
    target_tenant = tenant_id or principal.tenant_id
    policy = db.query(TenantPolicy).filter(TenantPolicy.tenant_id == target_tenant).first()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Policy for '{target_tenant}' not found.")
    return TenantPolicyDTO(
        tenant_id=policy.tenant_id,
        tenant_name=policy.tenant_name,
        max_auto_approve_eur=float(policy.max_auto_approve_eur),
        max_auto_approve_litres=float(policy.max_auto_approve_litres),
        allowed_categories=policy.allowed_categories or []
    )

@router.get("/guardrails", response_model=GuardrailWhitelistDTO)
def get_client_guardrails(
    tenant_id: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["agent", "human", "admin"]))
):
    """
    Get client guardrail whitelist and active recurrent approval windows.
    """
    now = datetime.datetime.utcnow()
    target_tenant = tenant_id or principal.tenant_id
    policy = db.query(TenantPolicy).filter(TenantPolicy.tenant_id == target_tenant).first()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Policy for '{target_tenant}' not found.")

    allowed = [c.lower() for c in (policy.allowed_categories or [])]
    restricted = [c for c in SYSTEM_CATEGORIES if c not in allowed]
    active_grants = db.query(RecurrentApprovalGrant).filter(
        RecurrentApprovalGrant.tenant_id == target_tenant,
        RecurrentApprovalGrant.status == "ACTIVE",
        RecurrentApprovalGrant.valid_from <= now,
        RecurrentApprovalGrant.valid_until >= now
    ).count()

    return GuardrailWhitelistDTO(
        tenant_id=policy.tenant_id,
        tenant_name=policy.tenant_name,
        allowed_categories=allowed,
        all_system_categories=SYSTEM_CATEGORIES,
        restricted_categories=restricted,
        max_auto_approve_eur=float(policy.max_auto_approve_eur),
        active_grants_count=active_grants
    )

@router.patch("", response_model=TenantPolicyDTO)
def update_policy(
    payload: PolicyUpdateDTO,
    tenant_id: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["human", "admin"], ["policies:update"]))
):
    """
    S2: Interactive Policy Threshold Slider.
    Allows judges and managers to adjust auto-approval spend limits dynamically.
    """
    target_tenant = tenant_id or principal.tenant_id
    policy = db.query(TenantPolicy).filter(TenantPolicy.tenant_id == target_tenant).first()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Policy for '{target_tenant}' not found.")

    if payload.max_auto_approve_eur is not None:
        policy.max_auto_approve_eur = payload.max_auto_approve_eur
    if payload.max_auto_approve_litres is not None:
        policy.max_auto_approve_litres = payload.max_auto_approve_litres
    if payload.allowed_categories is not None:
        policy.allowed_categories = payload.allowed_categories

    audit = AuditLog(
        tenant_id=target_tenant,
        actor_type=principal.principal_type,
        actor_id=principal.principal_id,
        action="POLICY_UPDATED",
        payload_summary={
            "max_auto_approve_eur": float(policy.max_auto_approve_eur),
            "max_auto_approve_litres": float(policy.max_auto_approve_litres),
            "allowed_categories": policy.allowed_categories
        }
    )
    db.add(audit)
    db.commit()

    return TenantPolicyDTO(
        tenant_id=policy.tenant_id,
        tenant_name=policy.tenant_name,
        max_auto_approve_eur=float(policy.max_auto_approve_eur),
        max_auto_approve_litres=float(policy.max_auto_approve_litres),
        allowed_categories=policy.allowed_categories or []
    )
