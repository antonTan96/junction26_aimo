from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import TenantPolicy, AuditLog
from ..dtos import PolicyUpdateDTO, TenantPolicyDTO
from ..auth import Principal, require_principal

router = APIRouter(prefix="/policies", tags=["Tenant Policy Configuration"])

@router.get("", response_model=TenantPolicyDTO)
def get_policy(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["agent", "human", "admin"]))
):
    policy = db.query(TenantPolicy).filter(TenantPolicy.tenant_id == principal.tenant_id).first()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found.")
    return TenantPolicyDTO(
        tenant_id=policy.tenant_id,
        tenant_name=policy.tenant_name,
        max_auto_approve_eur=float(policy.max_auto_approve_eur),
        max_auto_approve_litres=float(policy.max_auto_approve_litres),
        allowed_categories=policy.allowed_categories or []
    )

@router.patch("", response_model=TenantPolicyDTO)
def update_policy(
    payload: PolicyUpdateDTO,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_principal(["human", "admin"], ["policies:update"]))
):
    """
    S2: Interactive Policy Threshold Slider.
    Allows judges and managers to adjust auto-approval spend limits dynamically.
    """
    policy = db.query(TenantPolicy).filter(TenantPolicy.tenant_id == principal.tenant_id).first()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found.")

    if payload.max_auto_approve_eur is not None:
        policy.max_auto_approve_eur = payload.max_auto_approve_eur
    if payload.max_auto_approve_litres is not None:
        policy.max_auto_approve_litres = payload.max_auto_approve_litres
    if payload.allowed_categories is not None:
        policy.allowed_categories = payload.allowed_categories

    audit = AuditLog(
        tenant_id=principal.tenant_id,
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
