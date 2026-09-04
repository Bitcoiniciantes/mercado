"""Atualiza public/prices.json via Falcon Data Hub (quinzenal).
Uso local:  FALCON_TOKEN=xxx python scripts/update_prices.py
No Action:  secrets.FALCON_TOKEN. Sem token -> mantem seed e sai com aviso.
Nao publica nada, so reescreve o JSON local.
"""
import json
import os
import re
import sys
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent.parent
STAPLES = ROOT / "scripts" / "staples.json"
OUT = ROOT / "public" / "prices.json"
FALCON_URL = "https://datahub.falcon-server.com.br/private/v1/products/ean/{ean}"

PACK_RE = re.compile(r"(\d+[.,]?\d*)\s?(kg|g\b|l\b|ml|un)", re.I)


def to_base_factor(pack):
    q, u = float(pack["qty"]), pack["unit"].lower()
    if u == "kg":
        return q
    if u == "g":
        return q / 1000.0
    if u == "l":
        return q
    if u == "ml":
        return q / 1000.0
    return 1.0  # un/dz: preco do pack


def falcon_get(ean, token, region=None):
    url = FALCON_URL.format(ean=ean)
    if region:
        url += f"?region={region}"
    req = Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 404:
            return None
        raise


def main():
    token = os.getenv("FALCON_TOKEN", "").strip()
    region = os.getenv("FALCON_REGION", "").strip() or None
    staples = json.loads(STAPLES.read_text(encoding="utf-8"))["staples"]
    current = json.loads(OUT.read_text(encoding="utf-8"))
    items = current.get("items", {})

    if not token:
        print("AVISO: sem FALCON_TOKEN, mantendo seed atual.")
        return 0

    updated = 0
    for s in staples:
        key = s["key"]
        ean = s.get("ean")
        if not ean:
            continue
        try:
            payload = falcon_get(ean, token, region)
        except Exception as e:
            print(f"{key}: erro {e}, mantendo anterior")
            continue
        if not payload:
            print(f"{key}: 404, mantendo anterior")
            continue
        data = payload.get("data", {})
        obs = data.get("observations_count", 0)
        if obs < 10:
            print(f"{key}: obs={obs} baixo, mantendo anterior (stale)")
            if key in items:
                items[key]["stale"] = True
            continue
        pr = data.get("price_range", {})
        sugg = (data.get("suggested_price") or 0) / 100.0
        # tenta normalizado por kg/L quando disponivel
        norm = None
        for store in data.get("by_store", []):
            if str(store.get("normalization_unit", "")).lower() in ("kg", "l", "litro"):
                norm = (store.get("normalized_price") or 0) / 100.0
                if norm:
                    break
        unit_base = s.get("unitBase", "un")
        price_base = norm or sugg
        if unit_base in ("kg", "L") and not norm:
            # fallback: sugg e preco do pack; converte p/ base
            price_base = sugg / to_base_factor(s.get("pack", {"qty": 1, "unit": "un"}))
        prev = items.get(key, {})
        # trava anti-outlier: variacao >60% mantem anterior
        if prev.get("priceBase") and price_base:
            var = abs(price_base - prev["priceBase"]) / prev["priceBase"]
            if var > 0.6:
                print(f"{key}: variacao {var:.0%} alta, mantendo anterior p/ revisao")
                items[key]["stale"] = True
                continue
        items[key] = {
            **prev,
            "display": s.get("display", key),
            "eanRef": ean,
            "unitBase": unit_base,
            "pack": s.get("pack", {"qty": 1, "unit": "un"}),
            "priceBase": round(price_base, 2),
            "faixa": {
                "min": round((pr.get("min") or 0) / 100.0, 2),
                "max": round((pr.get("max") or 0) / 100.0, 2),
            },
            "obs": obs,
            "stale": False,
        }
        updated += 1
        print(f"{key}: R$ {price_base:.2f}/{unit_base} obs={obs}")

    current["items"] = items
    current["updatedAt"] = date.today().isoformat()
    OUT.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {updated} atualizados em {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
