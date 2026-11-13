import datetime
from typing import List, Tuple, Optional
from sqlalchemy.orm import Session
from .models import TenantPolicy, Product, QuoteLock, RecurrentApprovalGrant

class PolicyEngine:
    @staticmethod
    def evaluate(
        policy: TenantPolicy,
        product: Product,
        quote: QuoteLock,
        db: Optional[Session] = None
    ) -> Tuple[bool, List[str], Optional[RecurrentApprovalGrant]]:
        """
        Deterministic Policy & Guardrail Evaluator.
        1. Whitelist of Guardrail Categories: Checks if product category is whitelisted for this client.
        2. Spend Limit & Recurrent Window Check: Evaluates order total against autonomous spend limit,
           or against an active Time-Windowed Recurrent Approval Grant.
        3. Volume Limit check.

        Returns: (passes: bool, violation_reasons: List[str], matching_grant: Optional[RecurrentApprovalGrant])
        """
        violations: List[str] = []
        matching_grant: Optional[RecurrentApprovalGrant] = None
        now = datetime.datetime.utcnow()
        locked_eur = float(quote.locked_total_eur)
        max_eur = float(policy.max_auto_approve_eur)

        # 1. Search for an active, valid recurrent window grant for this client and category/SKU
        if db is not None:
            active_grants = db.query(RecurrentApprovalGrant).filter(
                RecurrentApprovalGrant.tenant_id == policy.tenant_id,
                RecurrentApprovalGrant.status == "ACTIVE",
                RecurrentApprovalGrant.valid_from <= now,
                RecurrentApprovalGrant.valid_until >= now,
            ).all()

            for g in active_grants:
                cat_match = (g.category.lower() == product.category.lower() or g.category == "*")
                sku_match = (g.sku is None or g.sku == quote.sku)
                if cat_match and sku_match:
                    remaining_budget = float(g.max_budget_per_period_eur) - float(g.current_period_spent_eur)
                    if locked_eur <= remaining_budget:
                        matching_grant = g
                        break
                    else:
                        violations.append(
                            f"Recurrent grant budget exceeded: Order €{locked_eur:,.2f} exceeds remaining window budget €{remaining_budget:,.2f} (Cap: €{float(g.max_budget_per_period_eur):,.2f})"
                        )

        # 2. Guardrail Whitelist Categories check (Waived if an active recurrent standing grant was established for it)
        allowed_cats = [c.lower() for c in (policy.allowed_categories or [])]
        if not matching_grant and product.category.lower() not in allowed_cats:
            violations.append(
                f"GUARDRAIL BLOCKED: Category '{product.category}' is not whitelisted for client '{policy.tenant_name}' (Allowed: {', '.join(allowed_cats)})"
            )

        # 3. Spend Limit check (Waived if covered under matching recurrent grant)
        if not matching_grant and locked_eur > max_eur:
            if not any("budget exceeded" in v for v in violations):
                violations.append(
                    f"Order total €{locked_eur:,.2f} exceeds autonomous limit of €{max_eur:,.2f}"
                )

        # 4. Volume Limit check
        total_litres = float(quote.total_litres)
        max_litres = float(policy.max_auto_approve_litres)
        if not matching_grant and total_litres > max_litres:
            violations.append(
                f"Order volume {total_litres:,.1f}L exceeds autonomous limit of {max_litres:,.1f}L"
            )

        passes = (len(violations) == 0)
        return (passes, violations, matching_grant)
