import os
import json
import math
import datetime
from typing import List, Dict, Any, Optional
import httpx
from .config import settings
from .dtos import PublicOfferDTO

class ValioAimoClient:
    def __init__(self):
        self.base_url = settings.VALIO_API_BASE_URL.rstrip('/')
        self.api_key = settings.VALIO_API_KEY
        self.catalog_index: Optional[List[Dict[str, Any]]] = None

    def _get_headers(self) -> Dict[str, str]:
        return {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json"
        }

    def ping(self) -> bool:
        """Ping upstream Valio Aimo API"""
        try:
            with httpx.Client(timeout=4.0) as client:
                res = client.get(f"{self.base_url}/api/ping", headers=self._get_headers())
                return res.status_code == 200
        except Exception:
            return False

    def ensure_catalog_loaded(self):
        """Loads static catalog from JSON once and creates fast in-memory search index"""
        if self.catalog_index is not None:
            return
        
        data_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "../../valio_aimo_junction26_product_data.json")
        )
        if not os.path.exists(data_path):
            self.catalog_index = []
            return

        with open(data_path, "r", encoding="utf-8") as f:
            raw_products = json.load(f)

        index = []
        for p in raw_products:
            synkka = p.get("synkkaData", {})
            names_text = " ".join(n.get("value", "").lower() for n in synkka.get("names", []))
            
            # Dietary / allergen tags
            tags = []
            for c in synkka.get("classifications", []):
                for v in c.get("values", []):
                    tags.append(v.get("id", "").lower())

            # Best volume calculation in litres
            vol = 1.0
            for uc in synkka.get("unitConversions", []):
                v_dict = uc.get("volume")
                if v_dict and v_dict.get("value"):
                    vol = float(v_dict.get("value"))
                    break

            # Pack description
            en_name = next((n.get("value") for n in synkka.get("names", []) if n.get("language") == "en"), "")
            fi_name = next((n.get("value") for n in synkka.get("names", []) if n.get("language") == "fi"), "")
            display_name = en_name or fi_name or f"Product {p.get('id')}"

            # Formatting label
            pack_format = "Pack"
            if "10 l" in display_name.lower() or "10l" in display_name.lower():
                pack_format = "10L Novobox"
            elif "1 l" in display_name.lower() or "1l" in display_name.lower():
                pack_format = "1L Carton"
            elif "12x1l" in display_name.lower() or "12 x 1l" in display_name.lower():
                pack_format = "12x1L Carton"
            elif vol > 1:
                pack_format = f"{vol}L Unit"

            index.append({
                "id": p.get("id"),
                "name": display_name,
                "vendor": p.get("vendorName", "Valio Aimo"),
                "category": "dairy" if any(w in names_text for w in ["maito", "milk", "viili", "kerma"]) else "general",
                "dietary_tags": tags,
                "search_corpus": f"{names_text} {p.get('vendorName', '').lower()} {' '.join(tags)}",
                "pack_format": pack_format,
                "pack_volume_litres": vol,
                "units": p.get("units", [])
            })

        self.catalog_index = index

    def search_catalog(
        self,
        query: str,
        required_tags: Optional[List[str]] = None,
        limit: int = 6
    ) -> List[Dict[str, Any]]:
        self.ensure_catalog_loaded()
        if not self.catalog_index:
            return []

        words = [w.lower() for w in query.split() if w]
        req_tags = [t.lower() for t in (required_tags or [])]

        matches = []
        for item in self.catalog_index:
            corpus = item["search_corpus"]
            # All words must match
            if words and not all(w in corpus for w in words):
                continue
            # All required tags must match
            if req_tags and not all(t in item["dietary_tags"] for t in req_tags):
                continue
            matches.append(item)
            if len(matches) >= limit:
                break
        return matches

    def query_live_availability(
        self,
        product_ids: List[str],
        requested_date: str,
        customer: str = "123"
    ) -> Dict[str, Any]:
        """Calls POST /api/availability on junction26.valioaimo.fi"""
        url = f"{self.base_url}/api/availability"
        payload = {
            "customer": customer,
            "requestedDate": requested_date,
            "products": product_ids
        }
        with httpx.Client(timeout=6.0) as client:
            res = client.post(url, headers=self._get_headers(), json=payload)
            res.raise_for_status()
            return res.json()

    def query_live_prices(
        self,
        product_ids: List[str],
        requested_date: str,
        customer: str = "123"
    ) -> Dict[str, Any]:
        """Calls POST /api/price on junction26.valioaimo.fi"""
        url = f"{self.base_url}/api/price"
        payload = {
            "customer": customer,
            "requestedDate": requested_date,
            "products": product_ids
        }
        with httpx.Client(timeout=6.0) as client:
            res = client.post(url, headers=self._get_headers(), json=payload)
            res.raise_for_status()
            return res.json()

    def get_live_offers(
        self,
        query: str = "lactose-free milk",
        required_volume_litres: Optional[float] = 1000.0,
        deliver_by: Optional[datetime.datetime] = None
    ) -> List[PublicOfferDTO]:
        """
        End-to-End Live Runtime Pipeline:
        1. Narrows candidate products from 17,546 static catalog records.
        2. Queries live availability & prices from junction26.valioaimo.fi.
        3. Computes unit economics and returns zero-trust PublicOfferDTOs.
        """
        # Search static catalog for top 4 candidates
        candidates = self.search_catalog(query=query, limit=4)
        if not candidates:
            # Fallback to key Novobox & 1L products if broad search
            candidates = self.search_catalog(query="valio eila", limit=4)
        
        if not candidates:
            return []

        p_ids = [c["id"] for c in candidates]
        date_str = deliver_by.strftime("%Y-%m-%d") if deliver_by else "2026-11-16"

        # Query live API
        avail_resp = self.query_live_availability(p_ids, date_str)
        price_resp = self.query_live_prices(p_ids, date_str)

        # Index live results
        avail_map = {p["productId"]: p for p in avail_resp.get("products", [])}
        price_map = {p["productId"]: p for p in price_resp.get("products", [])}

        offers: List[PublicOfferDTO] = []
        now = datetime.datetime.utcnow()

        for cand in candidates:
            pid = cand["id"]
            p_price = price_map.get(pid)
            p_avail = avail_map.get(pid)

            if not p_price or p_price.get("error"):
                continue

            # Pricing extraction
            unit_price = p_price.get("catalogPrice", {}).get("value", 10.0)
            comp_price = p_price.get("comparisonPrice", {}).get("value", 1.20)
            pack_vol = cand["pack_volume_litres"]

            # Availability & Lead Time
            is_avail = not p_avail.get("salesBlock", False) if p_avail else True
            available_packs = 1000
            if p_avail and p_avail.get("scheduleLines"):
                sl = p_avail["scheduleLines"][0]
                available_packs = int(sl.get("availableAmount", 1000))
                if available_packs > 99999:
                    available_packs = 999

            packs_required = None
            delivered_vol = None
            total_price = None

            if required_volume_litres:
                packs_required = math.ceil(required_volume_litres / pack_vol)
                delivered_vol = round(packs_required * pack_vol, 2)
                total_price = round(packs_required * unit_price, 2)

            offers.append(PublicOfferDTO(
                sku=f"VA-LIVE-{pid}",
                name=cand["name"],
                category=cand["category"],
                dietary_tags=["lactose-free"] if "lactose" in cand["name"].lower() else [],
                pack_format=cand["pack_format"],
                pack_volume_litres=pack_vol,
                unit_contract_price_eur=unit_price,
                price_per_litre_eur=comp_price,
                packs_required=packs_required,
                delivered_volume_litres=delivered_vol,
                total_contract_price_eur=total_price,
                is_stock_available=is_avail,
                available_packs=available_packs,
                lead_time_feasible=True,
                earliest_delivery=now + datetime.timedelta(hours=24)
            ))

        offers.sort(key=lambda x: (x.total_contract_price_eur or 99999, x.price_per_litre_eur))
        return offers

valio_client = ValioAimoClient()
