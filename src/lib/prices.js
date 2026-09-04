// Tabela quinzenal (public/prices.json) + matching por nome + conversao de pack.
// priceBase sempre em unidade base (kg/L/un). pricePack = priceBase * fator.

const PACK_RE = /(\d+[.,]?\d*)\s?(kg|g\b|l\b|ml|un|dz)/i;

function norm(value) {
  return (value || '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function normName(value) {
  return norm(value);
}

function packFactor(pack) {
  const q = Number(pack?.qty || 1);
  const u = String(pack?.unit || 'un').toLowerCase();
  if (u === 'kg') return q;
  if (u === 'g') return q / 1000;
  if (u === 'l') return q;
  if (u === 'ml') return q / 1000;
  return q; // un: preco por unidade, escala pelo pack
}

export function parsePackFromName(name, fallback = { qty: 1, unit: 'un' }) {
  const m = String(name || '').match(PACK_RE);
  if (!m) return fallback;
  const qty = Number(m[1].replace(',', '.'));
  let unit = m[2].toLowerCase();
  if (unit === 'dz') return { qty: qty * 12, unit: 'un' };
  if (unit === 'g' || unit === 'kg' || unit === 'ml' || unit === 'l' || unit === 'un') {
    return { qty, unit: unit === 'l' ? 'L' : unit };
  }
  return fallback;
}

// Mapeia nome do item -> chave da tabela (match simples por radical).
// Ordem importa: especificos primeiro. Fonte: Cesta Basica Procon-SP/DIEESE.
const ALIASES = [
  [/acucar/, 'acucar-1kg'],
  [/arroz/, 'arroz-5kg'],
  [/feijao carioca|feijao\b.*carioca/, 'feijao-carioca-1kg'],
  [/feijao preto|feijao\b.*preto/, 'feijao-preto-1kg'],
  [/feijao/, 'feijao-carioca-1kg'],
  [/cafe/, 'cafe-500g'],
  [/leite em po|leite ninho/, 'leite-po-400g'],
  [/leite/, 'leite-1l'],
  [/oleo/, 'oleo-900ml'],
  [/macarrao/, 'macarrao-500g'],
  [/farinha de mandioca|farofa/, 'farinha-mandioca-500g'],
  [/farinha/, 'farinha-1kg'],
  [/azeite/, 'azeite-500ml'],
  [/pao frances/, 'pao-frances-kg'],
  [/pao de forma|pao\b/, 'pao-forma-500g'],
  [/margarina/, 'margarina-250g'],
  [/manteiga/, 'manteiga-500g'],
  [/extrato de tomate|molho de tomate/, 'extrato-tomate-350g'],
  [/biscoito|bolacha/, 'biscoito-200g'],
  [/ovo/, 'ovos-dz'],
  [/batata/, 'batata-kg'],
  [/cebola/, 'cebola-kg'],
  [/alho/, 'alho-kg'],
  [/carne de primeira|picanha|alcatra|contra file|maminha/, 'carne-1kg'],
  [/carne de segunda|carne moida|acem|paleta|patinho|bife|almondega/, 'carne-2kg'],
  [/frango|coxa|sobrecoxa|peito de frango|nuggets/, 'frango-kg'],
  [/salsicha/, 'salsicha-kg'],
  [/linguica/, 'linguica-kg'],
  [/mussarela|mucarela|muçarela|queijo/, 'mussarela-kg'],
  [/presunto|mortadela/, 'presunto-kg'],
  [/sabao em po/, 'sabao-po-800g'],
  [/sabao em barra/, 'sabao-barra-un'],
  [/agua sanitaria|qboa/, 'agua-sanitaria-1l'],
  [/amaciante/, 'amaciante-2l'],
  [/detergente/, 'detergente-500ml'],
  [/multiuso|limpador/, 'limpador-500ml'],
  [/sabonete/, 'sabonete-un'],
  [/papel higienico/, 'papel-hig-12un'],
  [/absorvente/, 'absorvente-10un'],
  [/creme dental|pasta de dente/, 'creme-dental-90g'],
  [/desodorante/, 'desodorante-spray'],
];

export function matchPriceKey(itemName) {
  const n = norm(itemName);
  for (const [re, key] of ALIASES) {
    if (re.test(n)) return key;
  }
  return null;
}

export function priceAutoFor(itemName, table) {
  const key = matchPriceKey(itemName);
  if (!key || !table?.items?.[key]) return { value: null, key: null };
  const entry = table.items[key];
  if (!entry.priceBase) return { value: null, key };
  // Preco do pack de referencia da tabela (ex: arroz 5kg = 5 * preco/kg)
  const value = entry.priceBase * packFactor(entry.pack);
  return { value: Math.round(value * 100) / 100, key, entry };
}

export function finalPriceFor(item, table, book) {
  if (item?.priceManual != null && item.priceManual !== '') {
    const v = Number(item.priceManual);
    if (Number.isFinite(v)) return { value: v, origin: 'manual', entry: null };
  }
  // Memoria: preco que voce informou numa compra anterior vale de novo.
  const MemoryKey = norm(item?.name);
  const remembered = MemoryKey && book?.[MemoryKey];
  if (remembered != null && Number.isFinite(Number(remembered.value))) {
    return { value: Number(remembered.value), origin: 'book', entry: null };
  }
  const auto = priceAutoFor(item?.name, table);
  if (auto.value != null) return { value: auto.value, origin: 'auto', key: auto.key, entry: auto.entry };
  return { value: null, origin: 'none', entry: null };
}

export function priceSourceLabel(fp) {
  if (!fp) return null;
  if (fp.origin === 'book') return 'Seu preço da última compra — clique para corrigir';
  if (fp.origin !== 'auto' || !fp.entry) return null;
  const ref = fp.entry.ref ? ` · ${fp.entry.ref.replace('.pdf', '').replace(/-/g, ' ')}` : '';
  return `Fonte: Cesta Básica Procon-SP/DIEESE (média SP, aproximação)${ref}`;
}

export const priceUpdatedAt = (table) => table?.updatedAt || '—';
