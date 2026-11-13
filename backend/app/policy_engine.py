from typing import List, Tuple
from .models import TenantPolicy, Product, QuoteLock

class PolicyEngine:
    @staticmethod
    def evaluate(
        policy: TenantPolicy,
        product: Product,
        quote: QuoteLock
    ) -> Tuple[bool, List[str]]:
        """
        Deterministic Policy Evaluator.
        Returns: (passes: bool, violation_reasons: List[str])
        """
        violations: List[str] = []

        # 1. Category check
        allowed_cats = [c.lower() for c in (policy.allowed_categories or [])]
        if product.category.lower() not in allowed_cats:
            violations.append(
                f"Product category '{product.category}' is not in allowed categories ({', '.join(allowed_cats)})"
            )

        # 2. Spend Limit check
        locked_eur = float(quote.locked_total_eur)
        max_eur = float(policy.max_auto_approve_eur)
        if locked_eur > max_eur:
            violations.append(
                f"Order total €{locked_eur:,.2f} exceeds autonomous limit of €{max_eur:,.2f}"
            )

        # 3. Volume Limit check
        total_litres = float(quote.total_litres)
        max_litres = float(policy.max_auto_approve_litres)
        if total_litres > max_litres:
            violations.append(
                f"Order volume {total_litres:,.1f}L exceeds autonomous limit of {max_litres:,.1f}L"
            )

        return (len(violations) == 0, violations)
