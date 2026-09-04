"""Atualiza public/prices.json a partir da Cesta Basica mensal Procon-SP/DIEESE.

Fonte oficial, gratuita, sem chave: PDFs mensais em
https://www.procon.sp.gov.br/wp-content/uploads/... (ex.: CB-junho-2026-com-comparativo-anual.pdf)

Uso:  python scripts/update_prices_procon.py [--pdf URL_OU_ARQUIVO]
Sem argumento: descobre o PDF mais recente (tenta os ultimos 6 meses).
NUNCA quebra o workflow: qualquer falha mantem o prices.json atual (exit 0).
Itens sem correspondencia: mantem o ultimo preco e marca stale=True.
"""
import json
import re
import sys
import unicodedata
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "prices.json"
SEEDS = ROOT / "scripts" / "seeds.json"
BASE = "https://www.procon.sp.gov.br/wp-content/uploads"

# key, display, pack, unitBase, padroes (texto normalizado) no PDF
MAP = [
    ("arroz-5kg", "Arroz branco 5kg", (5, "kg"), "kg", ["arroz (5 kg)"]),
    ("feijao-carioca-1kg", "Feijão carioca 1kg", (1, "kg"), "kg", ["feijao carioquinha (kg)"]),
    ("acucar-1kg", "Açúcar cristal 1kg", (1, "kg"), "kg", ["acucar refinado (5 kg)"]),
    ("cafe-500g", "Café torrado e moído 500g", (500, "g"), "kg", ["cafe em po (500g)"]),
    ("farinha-1kg", "Farinha de trigo 1kg", (1, "kg"), "kg", ["farinha de trigo (kg)"]),
    ("farinha-mandioca-500g", "Farinha de mandioca 500g", (500, "g"), "kg", ["farinha de mandioca torrada (500g)"]),
    ("batata-kg", "Batata 1kg", (1, "kg"), "kg", ["batata (kg)"]),
    ("cebola-kg", "Cebola 1kg", (1, "kg"), "kg", ["cebola (kg)"]),
    ("alho-kg", "Alho 1kg", (1, "kg"), "kg", ["alho (kg)"]),
    ("ovos-dz", "Ovos brancos dúzia", (12, "un"), "un", ["ovos brancos (duzia)"]),
    ("margarina-250g", "Margarina 250g", (250, "g"), "kg", ["margarina (250g)"]),
    ("extrato-tomate-350g", "Extrato de tomate 350g", (350, "g"), "kg", ["extrato de tomate (340/350g)", "extrato de tomate"]),
    ("oleo-900ml", "Óleo de soja 900ml", (900, "ml"), "L", ["oleo de soja (900 ml)"]),
    ("leite-po-400g", "Leite em pó 400g", (400, "g"), "kg", ["leite em po integral (400g)", "leite em po"]),
    ("leite-1l", "Leite UHT 1L", (1, "L"), "L", ["leite uht (litro)"]),
    ("pao-forma-500g", "Pão de forma 500g", (500, "g"), "kg", ["pao de forma (500g)"]),
    ("pao-frances-kg", "Pão francês 1kg", (1, "kg"), "kg", ["pao frances (kg)"]),
    ("macarrao-500g", "Macarrão 500g", (500, "g"), "kg", ["macarrao com ovos (500g)"]),
    ("biscoito-200g", "Biscoito 200g", (200, "g"), "kg", ["biscoito maisena (pacote 200g)"]),
    ("carne-1kg", "Carne de primeira 1kg", (1, "kg"), "kg", ["carne de primeira (kg)"]),
    ("carne-2kg", "Carne de segunda 1kg", (1, "kg"), "kg", ["carne de segunda sem osso (kg)"]),
    ("frango-kg", "Frango resfriado 1kg", (1, "kg"), "kg", ["frango resfriado inteiro (kg)"]),
    ("salsicha-kg", "Salsicha 1kg", (1, "kg"), "kg", ["salsicha avulsa (kg)"]),
    ("linguica-kg", "Linguiça 1kg", (1, "kg"), "kg", ["linguica fresca (kg)"]),
    ("mussarela-kg", "Muçarela fatiada 1kg", (1, "kg"), "kg", ["mucarela fatiado", "muarela fatiado", "mussarela"]),
    ("presunto-kg", "Presunto fatiado 1kg", (1, "kg"), "kg", ["presunto fatiado (kg)"]),
    ("sabao-po-800g", "Sabão em pó 800g", (800, "g"), "kg", ["sabao em po (kg)"]),
    ("sabao-barra-un", "Sabão em barra un.", (1, "un"), "un", ["sabao em barra (unidade)"]),
    ("agua-sanitaria-1l", "Água sanitária 1L", (1, "L"), "L", ["agua sanitaria (litro)"]),
    ("amaciante-2l", "Amaciante 2L", (2, "L"), "L", ["amaciante (2 litros)"]),
    ("detergente-500ml", "Detergente 500ml", (500, "ml"), "L", ["detergente liquido (500 ml)"]),
    ("limpador-500ml", "Limpador multiuso 500ml", (500, "ml"), "L", ["limpador multiuso (500 ml)"]),
    ("sabonete-un", "Sabonete 90g", (1, "un"), "un", ["sabonete (unidade 90g)"]),
    ("papel-hig-12un", "Papel higiênico (ref. un.)", (12, "un"), "un", ["papel higienico fino branco (com 4 unidades)", "papel higienico"]),
    ("absorvente-10un", "Absorvente 10un", (10, "un"), "un", ["absorvente aderente (com 10 unidades)"]),
    ("creme-dental-90g", "Creme dental 90g", (90, "g"), "kg", ["creme dental (tubo 90g)"]),
    ("desodorante-spray", "Desodorante spray", (1, "un"), "un", ["desodorante spray (90/100 ml)"]),
]

MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho",
         "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

# Pack da FONTE quando difere do pack de exibicao (ex.: acucar vem de 5kg)
SRC_PACK = {"acucar-1kg": (5, "kg"), "papel-hig-12un": (4, "un"), "sabao-po-800g": (1, "kg")}


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9 ()./,%-]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def parse_num(s):
    return float(s.replace(".", "").replace(",", "."))


def candidate_urls():
    """Gera URLs candidatas dos ultimos 6 meses (padrao varia por ano)."""
    out = []
    y, m = date.today().year, date.today().month
    for back in range(6):
        mm = m - back
        yy = y
        while mm < 1:
            mm += 12
            yy -= 1
        mes = MESES[mm - 1]
        aa = str(yy)[-2:]
        slugs = [
            f"CB-{mes}-{yy}-com-comparativo-anual.pdf",
            f"CB-{mes.capitalize()}-{yy}-com-comparativo-anual.pdf",
            f"CB-{mes.upper()}-{yy}-com-comparativo-anual.pdf",
            f"CB-{mes.capitalize()}-{aa}.pdf",
            f"CB-{mes.upper()}-{yy}.pdf",
            f"CB-mensal-{mes[:3]}{aa}-com-anual-1.pdf",
        ]
        for pub_back in (1, 2, 0):  # boletim sai no mes seguinte
            pm = mm + pub_back
            py = yy
            while pm > 12:
                pm -= 12
                py += 1
            for slug in slugs:
                out.append(f"{BASE}/{py}/{pm:02d}/{slug}")
    seen = set()
    return [u for u in out if not (u in seen or seen.add(u))]


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "mercado-precos/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def discover():
    for url in candidate_urls():
        try:
            data = fetch(url)
            if data[:4] == b"%PDF":
                ref = re.search(r"(CB-[^/]+\.pdf)", url).group(1)
                return data, ref
        except Exception:
            continue
    return None, None


def extract_text(pdf_bytes):
    from pypdf import PdfReader
    import io
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def find_price(text, patterns):
    """Acha pares (anterior, atual); o valor vigente e a moda dos 'atuais'.
    Tolera parenteses de unidade grudados ou ausentes: '(kg)6,46' ou '(kg) 6,46'."""
    cands = []
    num = r"(\d{1,3}(?:\.\d{3})*,\d{2})"
    for pat in patterns:
        core = re.sub(r"\s*\([^)]*\)", "", pat).strip()
        rx = re.compile(re.escape(core) + r"(?:\s*\([^)]*\))?\s*" + num + r"\s*" + num)
        for m in rx.finditer(text):
            try:
                cands.append(parse_num(m.group(2)))
            except ValueError:
                pass
    if not cands:
        return None
    return Counter(cands).most_common(1)[0][0]


def pack_factor(pack):
    q, u = float(pack[0]), str(pack[1]).lower()
    if u == "kg":
        return q
    if u == "g":
        return q / 1000.0
    if u == "l":
        return q
    if u == "ml":
        return q / 1000.0
    return q  # un: preco por unidade, escala pelo pack


def main():
    args = sys.argv[1:]
    reset = "--reset" in args
    arg = next((a for a in args if not a.startswith("--")), None)
    try:
        current = json.loads(OUT.read_text(encoding="utf-8"))
        had_file = True
    except Exception:
        current = {"items": {}, "updatedAt": None,
                   "source": "Cesta Basica Procon-SP/DIEESE (media SP capital, aproximacao) + seeds manuais"}
        had_file = False
    items = current.get("items", {})

    try:
        if arg and Path(arg).exists():
            pdf_bytes = Path(arg).read_bytes()
            ref = Path(arg).name
        elif arg and arg.startswith("http"):
            pdf_bytes = fetch(arg)
            ref = arg.split("/")[-1]
        else:
            pdf_bytes, ref = discover()
            if not pdf_bytes:
                if items:
                    # Falha de rede/atraso com tabela previa: marca stale, exit 0.
                    for k in items:
                        items[k]["stale"] = True
                    current["items"] = items
                    OUT.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
                    print("AVISO: nenhum boletim encontrado; tabela anterior marcada como stale. exit 0.")
                    return 0
                # Sem boletim E sem arquivo: nada para criar -> falha visivel.
                print("ERRO: nenhum boletim Procon-SP encontrado e sem prices.json previo. exit 1.")
                return 1
        print(f"Boletim: {ref}")
        text = norm(extract_text(pdf_bytes))
        ok, miss, kept = 0, [], 0
        for key, display, pack, unit_base, patterns in MAP:
            value = find_price(text, [norm(p) for p in patterns])
            prev = items.get(key, {})
            if value is None:
                miss.append(key)
                if key in items:
                    items[key]["stale"] = True
                continue
            src = SRC_PACK.get(key, pack)
            price_base = round(value / pack_factor(src), 3 if pack_factor(src) != 1 else 2)
            if prev.get("priceBase") and not reset:
                var = abs(price_base - prev["priceBase"]) / prev["priceBase"] if prev["priceBase"] else 0
                if var > 0.6:
                    print(f"{key}: variacao {var:.0%} suspeita, mantendo anterior")
                    items[key]["stale"] = True
                    kept += 1
                    continue
            items[key] = {
                **prev,
                "display": display,
                "unitBase": unit_base,
                "pack": {"qty": pack[0], "unit": pack[1]},
                "priceBase": price_base,
                "faixa": prev.get("faixa", {"min": None, "max": None}),
                "obs": None,
                "stale": False,
                "src": "procon-sp",
                "ref": ref,
            }
            ok += 1
        current["items"] = items
        try:
            seeds = json.loads(SEEDS.read_text(encoding="utf-8"))
            for k, v in seeds.items():
                if k not in current["items"]:
                    current["items"][k] = v
        except Exception as e:
            print(f"AVISO: seeds.json ignorado ({e})")
        current["updatedAt"] = date.today().isoformat()
        current["source"] = "Cesta Basica Procon-SP/DIEESE (media SP capital, aproximacao) + seeds manuais"
        OUT.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"OK: {ok} atualizados, {kept} mantidos (outlier), {len(miss)} sem correspondencia: {miss}")
        if ok == 0:
            # PDF abriu mas zero produtos: layout mudou -> falha ALTA.
            print("ERRO: 0 produtos extraidos; layout do boletim provavelmente mudou. exit 2.")
            return 2
    except Exception as e:
        if items:
            for k in items:
                items[k]["stale"] = True
            current["items"] = items
            try:
                OUT.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass
        print(f"AVISO: falha ({e}); tabela marcada como stale.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
