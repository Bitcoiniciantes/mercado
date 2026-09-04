import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { Check, ChevronDown, CircleHelp, Copy, LogIn, LogOut, Plus, Repeat2, ShoppingCart, Trash2, X } from 'lucide-react';
import { auth, db, firebaseConfigured, googleProvider } from './firebase';
import { QUICK_CATALOG } from './quickCatalog';
import { finalPriceFor, normName, priceSourceLabel, priceUpdatedAt } from './lib/prices';

const CATEGORIES = [
  { id: 'hortifruti', label: 'Hortifruti', emoji: '🥬' },
  { id: 'carnes', label: 'Carnes e peixes', emoji: '🥩' },
  { id: 'frios', label: 'Frios e laticínios', emoji: '🧀' },
  { id: 'mercearia', label: 'Mercearia', emoji: '🥫' },
  { id: 'limpeza', label: 'Higiene e limpeza', emoji: '🧻' },
  { id: 'bebidas', label: 'Bebidas', emoji: '🧃' },
  { id: 'outros', label: 'Outros', emoji: '📦' },
];

const localKey = 'lista-compras-local';
const defaultList = { id: 'default', name: 'Minha lista', hidden: false };

function categoryLabel(id) {
  const category = CATEGORIES.find((item) => item.id === id);
  return category ? `${category.emoji} ${category.label}` : '📦 Outros';
}function normalizeItemName(value) {
  return value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function uid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return uid();
  } catch {}
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [lists, setLists] = useState([defaultList]);
  const [activeListId, setActiveListId] = useState('default');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('hortifruti');
  const [templateName, setTemplateName] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [status, setStatus] = useState('');
  const [duplicateNotice, setDuplicateNotice] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [visitCount, setVisitCount] = useState(null);
  const [openQuickGroups, setOpenQuickGroups] = useState(new Set());
  const [priceTable, setPriceTable] = useState(null);
  const [totalCaixa, setTotalCaixa] = useState('');
  const [purchases, setPurchases] = useState([]);
  const [showDash, setShowDash] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState(null);
  const [editingPriceValue, setEditingPriceValue] = useState('');
  const [priceBook, setPriceBook] = useState(() => { try { return JSON.parse(localStorage.getItem('lista-compras-pricebook') || '{}'); } catch { return {}; } });
  function persistBook(next) {
    setPriceBook(next);
    try { localStorage.setItem('lista-compras-pricebook', JSON.stringify(next)); } catch {}
    if (user && db) {
      Object.entries(next).forEach(([k, v]) => {
        setDoc(doc(db, 'users', user.uid, 'priceBook', k), { value: v.value, display: v.display || '', at: v.at || Date.now(), updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
      });
    }
  }
  // Colheita: manuais digitados em listas antigas (inclusive arquivadas) viram memoria.
  useEffect(() => {
    if (!items.length) return;
    setPriceBook((cur) => {
      const fresh = {};
      items.forEach((it) => {
        if (it?.priceManual == null || it.priceManual === '') return;
        const v = Number(it.priceManual);
        if (!Number.isFinite(v)) return;
        const k = normName(it.name);
        if (!k || cur[k] || fresh[k]) return;
        fresh[k] = { value: Math.round(v * 100) / 100, display: it.name, at: Date.now() };
      });
      const keys = Object.keys(fresh);
      if (!keys.length) return cur;
      const next = { ...cur, ...fresh };
      try { localStorage.setItem('lista-compras-pricebook', JSON.stringify(next)); } catch {}
      if (user && db) {
        keys.forEach((k) => {
          setDoc(doc(db, 'users', user.uid, 'priceBook', k), { ...fresh[k], updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
        });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  useEffect(() => {
    if (!user || !db) return undefined;
    return onSnapshot(collection(db, 'users', user.uid, 'priceBook'), (snap) => {
      const remote = {};
      snap.docs.forEach((d) => { remote[d.id] = d.data(); });
      if (Object.keys(remote).length) {
        setPriceBook((cur) => {
          const merged = { ...cur, ...remote };
          try { localStorage.setItem('lista-compras-pricebook', JSON.stringify(merged)); } catch {}
          return merged;
        });
      }
    });
  }, [user]);
  const [market, setMarket] = useState(() => { try { return localStorage.getItem('lista-compras-last-market') || ''; } catch { return ''; } });
  const [showNewList, setShowNewList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListMarket, setNewListMarket] = useState('');

  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/';
    fetch(`${base}prices.json`.replace(/\/\//g, '/'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setPriceTable(data))
      .catch(() => {});
    try {
      setPurchases(JSON.parse(localStorage.getItem('lista-compras-purchases') || '[]'));
    } catch { setPurchases([]); }
  }, []);

  useEffect(() => auth ? onAuthStateChanged(auth, setUser) : undefined, []);
  useEffect(() => {
    const WORKER_URL = 'https://floral-truth-af64.bitcoiniciantes.workers.dev';
    const SITE_NAME = 'mercado';
    const today = new Date().toISOString().slice(0, 10);
    const lastVisit = localStorage.getItem('btc_last_visit_' + SITE_NAME);
    if (lastVisit === today) {
      fetch(WORKER_URL + '/total?site=' + SITE_NAME).then(r => r.json()).then(data => { if (data.count !== undefined) setVisitCount(data.count); }).catch(() => {});
    } else {
      localStorage.setItem('btc_last_visit_' + SITE_NAME, today);
      fetch(WORKER_URL + '/count?site=' + SITE_NAME).then(r => r.json()).then(data => { if (data.count !== undefined) setVisitCount(data.count); }).catch(() => {
        fetch(WORKER_URL + '/total?site=' + SITE_NAME).then(r => r.json()).then(data => { if (data.count !== undefined) setVisitCount(data.count); }).catch(() => {});
      });
    }
  }, []);
  useEffect(() => {
    if (!user || !db) {
      const storedLists = localStorage.getItem(`${localKey}-lists`);
      const saved = storedLists ? JSON.parse(storedLists) : null;
      const nextLists = Array.isArray(saved) ? saved : [defaultList];
      setLists(nextLists);
      const savedActive = localStorage.getItem(`${localKey}-active-list`);
      setActiveListId(savedActive && nextLists.some((list) => list.id === savedActive) ? savedActive : nextLists.find((list) => !list.hidden)?.id || null);
      return undefined;
    }
    return onSnapshot(query(collection(db, 'users', user.uid, 'lists'), orderBy('createdAt', 'asc')), (snapshot) => {
      const nextLists = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      setLists(nextLists);
      setActiveListId((current) => current && nextLists.some((list) => list.id === current) ? current : nextLists.find((list) => !list.hidden)?.id || null);
    });
  }, [user]);

  useEffect(() => {
    if (!user || !db) {
      const saved = JSON.parse(localStorage.getItem(localKey) || '[]');
      setItems(saved);
      return undefined;
    }
    return onSnapshot(query(collection(db, 'users', user.uid, 'items'), orderBy('createdAt', 'desc')), (snapshot) => {
      setItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    });
  }, [user]);

  useEffect(() => {
    if (!user || !db) {
      setTemplates(JSON.parse(localStorage.getItem(`${localKey}-templates`) || '[]'));
      return undefined;
    }
    return onSnapshot(query(collection(db, 'users', user.uid, 'templates'), orderBy('createdAt', 'desc')), (snapshot) => {
      setTemplates(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    });
  }, [user]);

  const activeList = lists.find((list) => list.id === activeListId) || null;
  const activeItems = items.filter((item) => (item.listId || 'default') === activeListId);
  const pending = activeItems.filter((item) => !item.isChecked).length;
  const grouped = useMemo(() => CATEGORIES.map((categoryItem) => ({ ...categoryItem, items: activeItems.filter((item) => item.category === categoryItem.id).sort((a, b) => Number(a.isChecked) - Number(b.isChecked)) })).filter((group) => group.items.length), [activeItems]);

  const totals = useMemo(() => {
    let estimado = 0; let auto = 0; let manual = 0; let book = 0; let semPreco = 0;
    activeItems.forEach((item) => {
      const fp = finalPriceFor(item, priceTable, priceBook);
      if (fp.value == null) semPreco += 1;
      else { estimado += fp.value; if (fp.origin === 'manual') manual += 1; else if (fp.origin === 'book') book += 1; else auto += 1; }
    });
    const caixa = Number(String(totalCaixa).replace(',', '.'));
    const caixaNum = Number.isFinite(caixa) && String(totalCaixa).trim() !== '' ? caixa : null;
    const diff = caixaNum != null ? caixaNum - estimado : null;
    const diffPct = caixaNum != null && estimado > 0 ? (diff / estimado) * 100 : null;
    return { estimado, auto, manual, book, semPreco, cobertura: activeItems.length ? activeItems.length - semPreco : 0, caixaNum, diff, diffPct };
  }, [activeItems, priceTable, totalCaixa]);

  const fmt = (v) => v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const dashStats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const inMonth = purchases.filter((p) => p.at >= monthStart);
    const estMonth = inMonth.reduce((s, p) => s + (Number(p.totalEstimado) || 0), 0);
    const caixaMonth = inMonth.filter((p) => p.totalCaixa != null).reduce((s, p) => s + Number(p.totalCaixa), 0);
    const freq = {};
    purchases.forEach((p) => (p.snapshot || []).forEach((it) => {
      const k = normalizeItemName(it.name || '');
      if (!k) return;
      freq[k] = freq[k] || { name: it.name, count: 0, total: 0 };
      freq[k].count += 1;
      if (Number.isFinite(Number(it.value))) freq[k].total += Number(it.value);
    }));
    const top = Object.values(freq).sort((a, b) => b.count - a.count).slice(0, 8);
    const maxTop = Math.max(...top.map((t) => t.count), 1);
    const byDay = {};
    purchases.slice(0, 30).forEach((p) => {
      const d = new Date(p.at).toLocaleDateString('pt-BR');
      (byDay[d] = byDay[d] || []).push(p);
    });
    const byMarket = {};
    purchases.forEach((p) => {
      const k = (p.market || 'Sem mercado').trim() || 'Sem mercado';
      byMarket[k] = byMarket[k] || { name: k, count: 0, est: 0, caixa: 0, caixaCount: 0 };
      byMarket[k].count += 1;
      byMarket[k].est += Number(p.totalEstimado) || 0;
      if (p.totalCaixa != null) { byMarket[k].caixa += Number(p.totalCaixa); byMarket[k].caixaCount += 1; }
    });
    const markets = Object.values(byMarket).map((m) => ({ ...m, ticket: m.caixaCount ? m.caixa / m.caixaCount : (m.count ? m.est / m.count : 0) })).sort((a, b) => a.ticket - b.ticket);
    return { inMonth, estMonth, caixaMonth, diffMonth: caixaMonth ? caixaMonth - estMonth : null, top, maxTop, byDay, markets };
  }, [purchases]);

  const persistLocalItems = (next) => { setItems(next); localStorage.setItem(localKey, JSON.stringify(next)); };
  function toggleQuickGroup(groupId) {
    // Sanfona: só uma sessão aberta por vez; clicar na aberta fecha.
    setOpenQuickGroups((current) => (current.has(groupId) ? new Set() : new Set([groupId])));
  }
  const quickMenuRef = useRef(null);
  useEffect(() => {
    // Clicou fora do catálogo rápido: recolhe a sessão aberta.
    function onDocClick(event) {
      if (quickMenuRef.current && !quickMenuRef.current.contains(event.target)) setOpenQuickGroups(new Set());
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);
  async function selectList(listId) {
    setActiveListId(listId || null);
    try { localStorage.setItem(`${localKey}-active-list`, listId || ''); } catch {}
    if (!listId) return;
    const target = lists.find((l) => l.id === listId);
    if (!target || !target.hidden) return;
    // Reabrir lista arquivada: zera os ticks e desoculta para nova compra.
    try {
      if (user && db) {
        const checked = items.filter((i) => (i.listId || 'default') === listId && i.isChecked);
        for (let i = 0; i < checked.length; i += 400) {
          const batch = writeBatch(db);
          checked.slice(i, i + 400).forEach((item) => batch.update(doc(db, 'users', user.uid, 'items', item.id), { isChecked: false }));
          if (i + 400 >= checked.length) {
            if (listId === 'default') batch.set(doc(db, 'users', user.uid, 'lists', 'default'), { hidden: false }, { merge: true });
            else batch.update(doc(db, 'users', user.uid, 'lists', listId), { hidden: false });
          }
          await batch.commit();
        }
        if (!checked.length) {
          if (listId === 'default') await setDoc(doc(db, 'users', user.uid, 'lists', 'default'), { hidden: false }, { merge: true });
          else await updateDoc(doc(db, 'users', user.uid, 'lists', listId), { hidden: false });
        }
      } else {
        const nextLists = lists.map((l) => l.id === listId ? { ...l, hidden: false } : l);
        setLists(nextLists);
        try { localStorage.setItem(`${localKey}-lists`, JSON.stringify(nextLists)); } catch {}
        persistLocalItems(items.map((i) => (i.listId || 'default') === listId ? { ...i, isChecked: false } : i));
      }
      setStatus(`Lista “${target.name}” reaberta em branco para nova compra.`);
    } catch (e) {
      setStatus(`Não foi possível reabrir a lista: ${e?.message || e}`);
    }
  }

  function createList() {
    // Abre a caixa única: nome da lista + nome do mercado (opcional).
    setNewListName('');
    try { setNewListMarket(localStorage.getItem('lista-compras-last-market') || ''); } catch { setNewListMarket(''); }
    setShowNewList(true);
  }
  async function confirmNewList() {
    const cleanName = newListName.trim() || 'Lista do mês';
    const cleanMarket = newListMarket.trim();
    if (user && db) {
      const listRef = doc(collection(db, 'users', user.uid, 'lists'));
      await setDoc(listRef, { name: cleanName, hidden: false, createdAt: serverTimestamp() });
      setActiveListId(listRef.id);
    } else {
      const nextList = { id: uid(), name: cleanName, hidden: false, createdAt: Date.now() };
      const nextLists = [...lists, nextList];
      setLists(nextLists);
      try { localStorage.setItem(`${localKey}-lists`, JSON.stringify(nextLists)); } catch {}
      selectList(nextList.id);
    }
    setMarket(cleanMarket);
    try {
      if (cleanMarket) localStorage.setItem('lista-compras-last-market', cleanMarket);
      else localStorage.removeItem('lista-compras-last-market');
    } catch {}
    setShowNewList(false);
    setStatus(`Lista “${cleanName}” criada${cleanMarket ? ` para ${cleanMarket}` : ''}.`);
  }

  async function hideActiveList() {
    if (!activeListId || !activeList) return;
    const nextLists = lists.map((list) => list.id === activeListId ? { ...list, hidden: true } : list);
    if (user && db) {
      if (activeListId === 'default') await setDoc(doc(db, 'users', user.uid, 'lists', 'default'), { name: activeList.name, hidden: true, createdAt: serverTimestamp() }, { merge: true });
      else await updateDoc(doc(db, 'users', user.uid, 'lists', activeListId), { hidden: true });
    } else {
      setLists(nextLists);
      localStorage.setItem(`${localKey}-lists`, JSON.stringify(nextLists));
    }
    const nextActive = nextLists.find((list) => !list.hidden)?.id || null;
    setActiveListId(nextActive);
    localStorage.setItem(`${localKey}-active-list`, nextActive || '');
    setStatus(`Lista “${activeList.name}” ocultada. Você pode criar ou importar outra.`);
  }
  async function deleteActiveList() {
    if (!activeListId || !activeList) return;
    const itemCount = activeItems.length;
    const itemText = itemCount === 1 ? '1 item' : `${itemCount} itens`;
    if (!window.confirm(`Excluir a lista “${activeList.name}” e seus ${itemText}? Esta ação não pode ser desfeita.`)) return;

    const remainingLists = lists.filter((list) => list.id !== activeListId);
    const nextActive = remainingLists.find((list) => !list.hidden)?.id || null;

    if (user && db) {
      const itemRefs = activeItems.map((item) => doc(db, 'users', user.uid, 'items', item.id));
      const chunks = [];
      while (itemRefs.length) chunks.push(itemRefs.splice(0, 499));
      if (!chunks.length) chunks.push([]);
      for (let index = 0; index < chunks.length; index += 1) {
        const batch = writeBatch(db);
        chunks[index].forEach((itemRef) => batch.delete(itemRef));
        if (index === chunks.length - 1) batch.delete(doc(db, 'users', user.uid, 'lists', activeListId));
        await batch.commit();
      }
    } else {
      setLists(remainingLists);
      localStorage.setItem(`${localKey}-lists`, JSON.stringify(remainingLists));
      persistLocalItems(items.filter((item) => (item.listId || 'default') !== activeListId));
    }

    setActiveListId(nextActive);
    localStorage.setItem(`${localKey}-active-list`, nextActive || '');
    setStatus(`Lista “${activeList.name}” excluída.`);
  }
  async function addSuggestion(itemName, itemCategory) {
    if (!activeListId) { setStatus('Crie ou selecione uma lista antes de adicionar itens.'); return; }
    const alreadyAdded = activeItems.some((item) => normalizeItemName(item.name) === normalizeItemName(itemName));
    if (alreadyAdded) return;
    const payload = { name: itemName, category: itemCategory, listId: activeListId, isChecked: false };
    if (user && db) await addDoc(collection(db, 'users', user.uid, 'items'), { ...payload, createdAt: serverTimestamp() });
    else persistLocalItems([{ ...payload, id: uid(), createdAt: Date.now() }, ...items]);
    setStatus(`${itemName} adicionado à lista.`);
  }

  async function addItem(event) {
    event.preventDefault();
    if (!activeListId) { setStatus('Crie ou selecione uma lista antes de adicionar itens.'); return; }
    const cleanName = name.trim();
    if (!cleanName) return;
    if (activeItems.some((item) => normalizeItemName(item.name) === normalizeItemName(cleanName))) { setDuplicateNotice(`${cleanName} já está na lista.`); return; }
    const payload = { name: cleanName, category, listId: activeListId, isChecked: false, createdAt: Date.now() };
    if (user && db) await addDoc(collection(db, 'users', user.uid, 'items'), { ...payload, createdAt: serverTimestamp() });
    else persistLocalItems([{ ...payload, id: uid() }, ...items]);
    setName('');
  }

  async function toggleItem(item) {
    if (user && db) await updateDoc(doc(db, 'users', user.uid, 'items', item.id), { isChecked: !item.isChecked });
    else persistLocalItems(items.map((entry) => entry.id === item.id ? { ...entry, isChecked: !entry.isChecked } : entry));
  }

  async function removeItem(item) {
    if (user && db) await deleteDoc(doc(db, 'users', user.uid, 'items', item.id));
    else persistLocalItems(items.filter((entry) => entry.id !== item.id));
  }

  async function saveTemplate() {
    const cleanName = templateName.trim() || `Lista de ${new Date().toLocaleDateString('pt-BR')}`;
    const entries = activeItems.map(({ name: itemName, category: itemCategory }) => ({ name: itemName, category: itemCategory }));
    if (!entries.length) return setStatus('Adicione itens antes de salvar uma lista recorrente.');
    if (user && db) await addDoc(collection(db, 'users', user.uid, 'templates'), { name: cleanName, items: entries, createdAt: serverTimestamp() });
    else { const next = [{ id: uid(), name: cleanName, items: entries }, ...templates]; setTemplates(next); localStorage.setItem(`${localKey}-templates`, JSON.stringify(next)); }
    setTemplateName(''); setStatus('Lista recorrente salva.');
  }

  async function importTemplate(template) {
    const targetListId = activeListId || lists.find((list) => !list.hidden)?.id || null;
    if (!targetListId) { setStatus('Crie uma lista de compras antes de importar.'); return; }
    if (!activeListId) { setActiveListId(targetListId); localStorage.setItem(`${localKey}-active-list`, targetListId); }
    const targetItems = items.filter((item) => (item.listId || 'default') === targetListId);
    const templateNames = new Set(template.items.map((item) => normalizeItemName(item.name)));
    const checkedMatches = targetItems.filter((item) => item.isChecked && templateNames.has(normalizeItemName(item.name)));
    const existingNames = new Set(targetItems.filter((item) => !item.isChecked).map((item) => normalizeItemName(item.name)));
    const uniqueItems = template.items.filter((item) => {
      const normalized = normalizeItemName(item.name);
      if (existingNames.has(normalized)) return false;
      existingNames.add(normalized);
      return !targetItems.some((entry) => !entry.isChecked && normalizeItemName(entry.name) === normalized);
    });
    if (user && db) {
      const batch = writeBatch(db);
      checkedMatches.forEach((item) => batch.update(doc(db, 'users', user.uid, 'items', item.id), { isChecked: false }));
      uniqueItems.forEach((item) => batch.set(doc(collection(db, 'users', user.uid, 'items')), { ...item, listId: targetListId, isChecked: false, createdAt: serverTimestamp() }));
      if (checkedMatches.length || uniqueItems.length) await batch.commit();
    } else {
      const resetIds = new Set(checkedMatches.map((item) => item.id));
      persistLocalItems([...uniqueItems.map((item) => ({ ...item, listId: targetListId, isChecked: false, id: uid(), createdAt: Date.now() })), ...items.map((item) => resetIds.has(item.id) ? { ...item, isChecked: false } : item)]);
    }
    if (!checkedMatches.length && !uniqueItems.length) { setStatus('Todos os itens dessa lista já estão pendentes.'); return; }
    const total = checkedMatches.length + uniqueItems.length;
    setStatus(`${total} ${total === 1 ? 'item preparado' : 'itens preparados'} para a nova compra, sem marcações.`);
  }
  function startEditPrice(item) {
    setEditingPriceId(item.id);
    const fp = finalPriceFor(item, priceTable, priceBook);
    setEditingPriceValue(fp.value != null ? String(fp.value).replace('.', ',') : '');
  }
  async function saveManualPrice(item) {
    const raw = String(editingPriceValue).replace(',', '.').trim();
    const bookKey = normName(item.name);
    if (raw === '') {
      if (user && db) await updateDoc(doc(db, 'users', user.uid, 'items', item.id), { priceManual: null });
      else persistLocalItems(items.map((e) => e.id === item.id ? { ...e, priceManual: null } : e));
      // Limpar volta ao automatico: esquece tambem a memoria desse produto.
      if (bookKey && priceBook[bookKey]) {
        const next = { ...priceBook };
        delete next[bookKey];
        persistBook(next);
        if (user && db) deleteDoc(doc(db, 'users', user.uid, 'priceBook', bookKey)).catch(() => {});
      }
    } else {
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) { setStatus('Valor inválido. Use ex.: 12,90'); return; }
      const rounded = Math.round(v * 100) / 100;
      if (user && db) await updateDoc(doc(db, 'users', user.uid, 'items', item.id), { priceManual: rounded });
      else persistLocalItems(items.map((e) => e.id === item.id ? { ...e, priceManual: rounded } : e));
      // Aprende: passa a valer nas proximas compras.
      if (bookKey) persistBook({ ...priceBook, [bookKey]: { value: rounded, display: item.name, at: Date.now() } });
    }
    setEditingPriceId(null); setEditingPriceValue('');
  }
  async function finalizePurchase() {
    if (!activeListId || !activeItems.length) { setStatus('Lista vazia, nada para finalizar.'); return; }
    try {
      const caixa = Number(String(totalCaixa).replace(',', '.'));
      const caixaNum = Number.isFinite(caixa) && String(totalCaixa).trim() !== '' ? Math.round(caixa * 100) / 100 : null;
      const estimado = Math.round(totals.estimado * 100) / 100;
      if (caixaNum == null && !window.confirm(`Total do caixa não preenchido. Finalizar só com o estimado (${fmt(estimado)})?`)) return;
      const last = purchases[0];
      if (last && last.listId === activeListId && last.itemCount === activeItems.length
        && Number(last.totalEstimado) === estimado && Date.now() - last.at < 10 * 60 * 1000) {
        const mins = Math.max(1, Math.round((Date.now() - last.at) / 60000));
        if (!window.confirm(`Esta lista já foi finalizada há ${mins} min com o mesmo total (${fmt(estimado)}). Finalizar de novo mesmo assim?`)) return;
      }
      const snapshot = activeItems.map((item) => {
        const fp = finalPriceFor(item, priceTable, priceBook);
        return { name: item.name, category: item.category, value: fp.value, origin: fp.origin };
      });
      const record = { id: uid(), listId: activeListId, listName: activeList?.name || '', market: market.trim() || null, at: Date.now(), totalEstimado: Math.round(totals.estimado * 100) / 100, totalCaixa: caixaNum, itemCount: activeItems.length, snapshot };
      const next = [record, ...purchases].slice(0, 60);
      setPurchases(next);
      try { localStorage.setItem('lista-compras-purchases', JSON.stringify(next)); } catch {}
      if (user && db) {
        try { await addDoc(collection(db, 'users', user.uid, 'purchases'), { ...record, createdAt: serverTimestamp() }); }
        catch (e) { setStatus(`Compra salva localmente, mas falhou ao sincronizar: ${e?.message || e}`); }
      }
      setTotalCaixa('');
      try { if (market.trim()) localStorage.setItem('lista-compras-last-market', market.trim()); } catch {}
      setShowDash(true);
      const finishedName = activeList?.name || 'Lista';
      // Arquiva a lista finalizada: ela some e a próxima começa do zero.
      try {
        const nextLists = lists.map((l) => l.id === activeListId ? { ...l, hidden: true } : l);
        const nextActive = nextLists.find((l) => !l.hidden)?.id || null;
        if (user && db) {
          if (activeListId === 'default') await setDoc(doc(db, 'users', user.uid, 'lists', 'default'), { name: finishedName, hidden: true, createdAt: serverTimestamp() }, { merge: true });
          else await updateDoc(doc(db, 'users', user.uid, 'lists', activeListId), { hidden: true });
        } else {
          setLists(nextLists);
          try { localStorage.setItem(`${localKey}-lists`, JSON.stringify(nextLists)); } catch {}
        }
        setActiveListId(nextActive);
        try { localStorage.setItem(`${localKey}-active-list`, nextActive || ''); } catch {}
      } catch {}
      setStatus(caixaNum != null ? `Compra finalizada (${fmt(record.totalEstimado)} x caixa ${fmt(caixaNum)}). Lista “${finishedName}” arquivada — crie ou importe uma nova.` : `Compra arquivada (${fmt(record.totalEstimado)}). Lista “${finishedName}” arquivada — crie ou importe uma nova.`);
    } catch (e) {
      setStatus(`Não foi possível finalizar: ${e?.message || e}`);
    }
  }
  async function removePurchase(id) {
    const next = purchases.filter((p) => p.id !== id);
    setPurchases(next);
    try { localStorage.setItem('lista-compras-purchases', JSON.stringify(next)); } catch {}
    setStatus('Registro excluído do comparativo.');
  }
  function clearPurchases() {
    if (!purchases.length) return;
    if (!window.confirm(`Apagar todo o histórico (${purchases.length} ${purchases.length === 1 ? 'registro' : 'registros'})?`)) return;
    setPurchases([]);
    try { localStorage.setItem('lista-compras-purchases', '[]'); } catch {}
    setStatus('Histórico de compras apagado.');
  }
  async function rebuy(purchase) {
    // Gera nova lista em branco (sem ticks) a partir do histórico.
    const entries = (purchase.snapshot || []).map(({ name, category }) => ({ name, category: category || 'outros' }));
    if (!entries.length) { setStatus('Este registro não tem itens para reaproveitar.'); return; }
    const listName = `${purchase.listName || 'Lista'} ${new Date().toLocaleDateString('pt-BR')}`;
    try {
      let targetId;
      if (user && db) {
        const listRef = doc(collection(db, 'users', user.uid, 'lists'));
        await setDoc(listRef, { name: listName, hidden: false, createdAt: serverTimestamp() });
        targetId = listRef.id;
        for (let i = 0; i < entries.length; i += 400) {
          const batch = writeBatch(db);
          entries.slice(i, i + 400).forEach((e) => batch.set(doc(collection(db, 'users', user.uid, 'items')), { ...e, listId: targetId, isChecked: false, createdAt: serverTimestamp() }));
          await batch.commit();
        }
      } else {
        const nextList = { id: uid(), name: listName, hidden: false, createdAt: Date.now() };
        const nextLists = [...lists, nextList];
        targetId = nextList.id;
        setLists(nextLists);
        try { localStorage.setItem(`${localKey}-lists`, JSON.stringify(nextLists)); } catch {}
        persistLocalItems([...entries.map((e) => ({ ...e, listId: targetId, isChecked: false, id: uid(), createdAt: Date.now() })), ...items]);
      }
      setActiveListId(targetId);
      try { localStorage.setItem(`${localKey}-active-list`, targetId); } catch {}
      setShowDash(false);
      setStatus(`Nova lista “${listName}” criada com ${entries.length} ${entries.length === 1 ? 'item' : 'itens'} em branco.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setStatus(`Não foi possível reaproveitar: ${e?.message || e}`);
    }
  }
  async function login() {
    if (!auth) return setStatus('Configure as variáveis do Firebase para ativar o login.');
    setLoadingAuth(true); try { await signInWithPopup(auth, googleProvider); } finally { setLoadingAuth(false); }
  }

  async function logout() { if (auth) await signOut(auth); }

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><ShoppingCart size={21} /></div><div><strong>Lista de Compras</strong><span>Organize. Compre. Simplifique.</span></div></div><div className="account">{user ? <><span className="avatar">{(user.displayName || 'C').charAt(0).toUpperCase()}</span><span className="user-name">Olá, {(user.displayName || 'Conta').split(' ')[0]}</span><button className="icon-button" onClick={logout} title="Sair"><LogOut size={17} /></button></> : <button className="login-button" onClick={login} disabled={loadingAuth}><LogIn size={16} /> Entrar com Google</button>}</div></header>
    {!firebaseConfigured && <div className="setup-notice"><CircleHelp size={17} /> Modo local ativo. Configure o arquivo `.env` para sincronizar listas por usuário.</div>}
    <section className="hero"><div><p className="eyebrow">COMPRA ATIVA</p><h1>{activeList?.name || 'Nenhuma lista ativa'}</h1><p className="muted">{pending} {pending === 1 ? 'item pendente' : 'itens pendentes'} · preços Procon-SP de {priceUpdatedAt(priceTable)} (aprox. p/ RJ)</p><div className="totals-top"><div className="total-box"><span>Total compras cliente</span><strong>{fmt(totals.estimado)}{totals.semPreco > 0 ? '*' : ''}</strong><small>{totals.auto} auto · {totals.manual + totals.book} seus · {totals.cobertura}/{activeItems.length} com preço</small></div><div className="total-box"><span>Total compras caixa</span><input value={totalCaixa} onChange={(e) => setTotalCaixa(e.target.value)} placeholder="R$ do cupom" inputMode="decimal" aria-label="Total do caixa" />{market ? <small> Mercado: {market}</small> : null}{totals.diff != null && <small className={totals.diff > 0 ? 'diff-up' : 'diff-ok'}>Diferença {fmt(totals.diff)} ({totals.diffPct != null ? `${totals.diffPct > 0 ? '+' : ''}${totals.diffPct.toFixed(1)}%` : '—'})</small>}<button className="primary-button total-box-btn" onClick={finalizePurchase} disabled={!activeItems.length}>Finalizar e arquivar</button></div></div></div><div className="hero-actions"><div className="list-controls"><select value={activeListId || ''} onChange={(event) => selectList(event.target.value)} aria-label="Selecionar lista"><option value="">Nenhuma lista ativa</option>{lists.map((list) => <option value={list.id} key={list.id}>{list.hidden ? 'Oculta · ' : ''}{list.name}</option>)}</select><button className="secondary-button small attention-button" onClick={createList}><Plus size={15} /> Nova lista</button>{activeList && <><button className="secondary-button small" onClick={hideActiveList}>Ocultar</button><button className="secondary-button small danger-button" onClick={deleteActiveList}><Trash2 size={14} /> Excluir</button></>}</div><button className="secondary-button" onClick={() => setShowTemplates((value) => !value)}><Repeat2 size={17} /> Listas recorrentes <ChevronDown size={15} className={showTemplates ? 'rotate' : ''} /></button></div></section>
    {status && <div className="status" role="alert"><span>{status}</span><button onClick={() => setStatus('')}><X size={15} /></button></div>}
    {showNewList && <div className="modal-overlay" onClick={() => setShowNewList(false)}><div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Nova lista"><div className="panel-heading"><div><p className="eyebrow">NOVA LISTA</p><h2>Criar lista</h2></div><button className="icon-button" onClick={() => setShowNewList(false)}><X size={17} /></button></div><label>Nome da lista<input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="Ex.: Compra do mês" aria-label="Nome da lista" /></label><label>Nome do mercado (opcional)<input value={newListMarket} onChange={(e) => setNewListMarket(e.target.value)} placeholder="Ex.: Gama" aria-label="Nome do mercado" /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setShowNewList(false)}>Cancelar</button><button className="primary-button" onClick={confirmNewList}><Plus size={16} /> Criar lista</button></div></div></div>}
    {showTemplates && <section className="templates-panel"><div className="panel-heading"><div><p className="eyebrow">LISTA RECORRENTE</p><h2>Listas recorrentes</h2></div><button className="icon-button" onClick={() => setShowTemplates(false)}><X size={17} /></button></div><div className="template-save"><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Nome da lista recorrente (ex.: Compra mensal)" /><button className="primary-button" onClick={saveTemplate}><Copy size={16} /> Salvar lista atual</button></div>{templates.length ? <div className="template-list">{templates.map((template) => <div className="template-card" key={template.id}><div><strong>{template.name}</strong><span>{template.items.length} {template.items.length === 1 ? 'item' : 'itens'}</span></div><button className="secondary-button small" onClick={() => importTemplate(template)}>Importar</button></div>)}</div> : <p className="empty-template">Nenhuma lista recorrente salva.</p>}</section>}
    <section className="suggestions-panel"><div className="suggestions-heading"><div><p className="eyebrow">PARA FACILITAR</p><h2>Adicione produtos rápidos</h2><p className="muted">Abra uma categoria e escolha os produtos. Cada item adicionado desaparece do catálogo.</p></div></div><div className="quick-menu" ref={quickMenuRef}>{QUICK_CATALOG.map((group)=>{const subtypes=group.subtypes.map((subtype)=>({...subtype,availableItems:subtype.items.filter(([itemName])=>!activeItems.some((item)=>normalizeItemName(item.name)===normalizeItemName(itemName)))})).filter((subtype)=>subtype.availableItems.length);if(!subtypes.length)return null;const groupCount=subtypes.reduce((total,subtype)=>total+subtype.availableItems.length,0),groupOpen=openQuickGroups.has(group.id);return <div className="quick-group" key={group.id}><button type="button" className="quick-group-toggle" onClick={()=>toggleQuickGroup(group.id)} aria-expanded={groupOpen}><span>{group.emoji} {group.label}</span><span className="quick-count">{groupCount}<ChevronDown size={15} className={groupOpen?'rotate':''}/></span></button>{groupOpen&&<div className="quick-subtypes">{subtypes.map((subtype)=><details className="quick-subtype" key={subtype.id}><summary>{subtype.label}<span>{subtype.availableItems.length}</span></summary><div className="suggestion-list">{subtype.availableItems.map(([itemName,itemCategory])=><button type="button" className="suggestion-chip" key={itemName} onClick={()=>addSuggestion(itemName,itemCategory)}><Plus size={13}/>{itemName}</button>)}</div></details>)}</div>}</div>})}</div></section>    <section className="card"><form className="add-form" onSubmit={addItem}><input value={name} onChange={(event) => { setName(event.target.value); setDuplicateNotice(''); }} placeholder="O que você precisa comprar?" aria-label="Nome do item" /><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Categoria">{CATEGORIES.map((item) => <option value={item.id} key={item.id}>{item.emoji} {item.label}</option>)}</select><button className="primary-button" type="submit"><Plus size={18} /> Adicionar item</button></form>{duplicateNotice && <p className="duplicate-notice" role="alert">{duplicateNotice}</p>}{grouped.length ? <div className="groups">{grouped.map((group) => <section key={group.id} className={group.items.every((item) => item.isChecked) ? 'category-section category-complete' : 'category-section'}><h2><span>{group.emoji}</span>{group.label}<small className={group.items.some((item) => !item.isChecked) ? "" : "badge-done"}>{group.items.filter((item) => !item.isChecked).length}</small>{group.items.every((item) => item.isChecked) && <em>Concluída</em>}</h2><ul>{group.items.map((item) => <li key={item.id} className={item.isChecked ? 'checked' : ''}><button className="check" onClick={() => toggleItem(item)} aria-label={`Marcar ${item.name}`}><Check size={14} /></button><span className="item-name">{item.name}</span>{(() => { const fp = finalPriceFor(item, priceTable, priceBook); if (editingPriceId === item.id) return <span className="price-edit"><input value={editingPriceValue} onChange={(e) => setEditingPriceValue(e.target.value)} placeholder="12,90" inputMode="decimal" aria-label={`Preço de ${item.name}`} /><button className="secondary-button small" onClick={() => saveManualPrice(item)}>OK</button><button className="secondary-button small" onClick={() => setEditingPriceId(null)}>X</button></span>; if (fp.value == null) return <button className="price-chip price-none" onClick={() => startEditPrice(item)} title="Sem referência — clique para informar">—</button>; const srcLabel = priceSourceLabel(fp); const chipClass = fp.origin === 'manual' ? 'price-chip price-manual' : fp.origin === 'book' ? 'price-chip price-book' : 'price-chip price-auto'; const chipTitle = fp.origin === 'manual' ? 'Preço manual — clique para corrigir' : fp.origin === 'book' ? srcLabel : `Pré-valor — clique para corrigir${srcLabel ? `. ${srcLabel}` : ''}`; return <button className={chipClass} onClick={() => startEditPrice(item)} title={chipTitle}>{fmt(fp.value)}{fp.origin === 'auto' ? '*' : ''}</button>; })()}<button className="delete" onClick={() => removeItem(item)} aria-label={`Excluir ${item.name}`}><Trash2 size={16} /></button></li>)}</ul></section>)}</div> : <div className="empty"><ShoppingCart size={34} /><h2>Sua lista está vazia</h2><p>Adicione seu primeiro item para começar.</p></div>}</section>
    <section className="totals-bottom"><div><span>Total compras cliente</span><strong>{fmt(totals.estimado)}{totals.semPreco > 0 ? '*' : ''}</strong><small>{totals.cobertura}/{activeItems.length} com preço</small></div><div><span>Total compras caixa</span><input className="caixa-input" value={totalCaixa} onChange={(e) => setTotalCaixa(e.target.value)} placeholder="R$ cupom" inputMode="decimal" aria-label="Total do caixa" />{totals.diff != null && <small>Dif. {fmt(totals.diff)}</small>}</div><button className="primary-button" onClick={finalizePurchase} disabled={!activeItems.length}>Finalizar e arquivar</button><button className="secondary-button small" onClick={() => setShowDash((v) => !v)}>{showDash ? 'Ocultar comparativo' : 'Ver comparativo'}</button></section>
    {showDash && <section className="card dash"><div className="panel-heading"><div><p className="eyebrow">COMPARATIVO</p><h2>Estimado x caixa</h2><p className="muted">* = pré-valor da tabela quinzenal. Sem * = preço que você corrigiu.</p></div><button className="icon-button" onClick={() => setShowDash(false)}><X size={17} /></button></div>
    <div className="dash-cards"><div className="dash-card"><span>No mês · estimado</span><strong>{fmt(dashStats.estMonth)}</strong><small>{dashStats.inMonth.length} {dashStats.inMonth.length === 1 ? 'compra' : 'compras'}</small></div><div className="dash-card"><span>No mês · caixa</span><strong>{dashStats.caixaMonth ? fmt(dashStats.caixaMonth) : '—'}</strong><small>{dashStats.diffMonth != null ? `dif. ${fmt(dashStats.diffMonth)}` : 'sem cupom lançado'}</small></div><div className="dash-card"><span>Ticket médio (caixa)</span><strong>{(() => { const withCaixa = dashStats.inMonth.filter((p) => p.totalCaixa != null); return withCaixa.length ? fmt(dashStats.caixaMonth / withCaixa.length) : '—'; })()}</strong><small>por ida ao mercado</small></div></div>
    {dashStats.top.length > 0 && <div className="dash-top"><h3>Mais frequentes</h3>{dashStats.top.map((t) => <div className="bar" key={t.name}><span className="bar-label">{t.name} · {t.count}x</span><div className="bar-track"><i style={{ width: `${(t.count / dashStats.maxTop) * 100}%` }} className="bar-est" /></div><span>{fmt(t.total)}</span></div>)}</div>}
    {dashStats.markets.length > 1 && <div className="dash-top"><h3>Por mercado (menor ticket primeiro)</h3>{dashStats.markets.map((m, i) => <div className="bar" key={m.name}><span className="bar-label">{i === 0 ? '★ ' : ''}{m.name} · {m.count}x</span><div className="bar-track"><i style={{ width: `${(m.ticket / (dashStats.markets[dashStats.markets.length - 1].ticket || 1)) * 100}%` }} className={i === 0 ? 'bar-caixa' : 'bar-est'} /></div><span>ticket {fmt(m.ticket)}</span></div>)}</div>}
    {purchases.length ? <div><div className="dash-list-head"><span>{purchases.length} {purchases.length === 1 ? 'registro' : 'registros'} · agrupado por dia</span><button className="secondary-button small danger-button" onClick={clearPurchases}>Apagar histórico</button></div><div className="dash-rows">{Object.entries(dashStats.byDay).map(([day, list]) => { const dayEst = list.reduce((s, p) => s + (Number(p.totalEstimado) || 0), 0); const dayCaixa = list.filter((p) => p.totalCaixa != null).reduce((s, p) => s + Number(p.totalCaixa), 0); return <div key={day}><div className="dash-day"><strong>{day}</strong><span>{list.length}x · est. {fmt(dayEst)}{dayCaixa ? ` · caixa ${fmt(dayCaixa)}` : ''}</span></div>{list.map((p) => { const max = Math.max(p.totalEstimado || 0, p.totalCaixa || 0, 1); const d = p.totalCaixa != null ? p.totalCaixa - (p.totalEstimado || 0) : null; const pct = d != null && (p.totalEstimado || 0) > 0 ? (d / p.totalEstimado) * 100 : null; return <div className="dash-row" key={p.id}><div className="dash-meta"><div><strong>{p.listName || 'Lista'}{p.market ? <span className="market-tag">{p.market}</span> : null}</strong><span>{new Date(p.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {p.itemCount} {p.itemCount === 1 ? 'item' : 'itens'}</span></div><div className="dash-side">{d != null && <em className={d > 0 ? 'diff-up' : 'diff-ok'}>{d > 0 ? '+' : ''}{fmt(d)}{pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}</em>}<button className="secondary-button small" onClick={() => rebuy(p)} title="Criar nova lista em branco com estes itens">Recomprar</button><button className="icon-button" onClick={() => removePurchase(p.id)} title="Excluir registro"><Trash2 size={15} /></button></div></div><div className="dash-bars"><div className="bar"><span className="bar-label">Est.</span><div className="bar-track"><i style={{ width: `${((p.totalEstimado || 0) / max) * 100}%` }} className="bar-est" /></div><span>{fmt(p.totalEstimado)}</span></div><div className="bar"><span className="bar-label">Caixa</span><div className="bar-track"><i style={{ width: `${((p.totalCaixa || 0) / max) * 100}%` }} className="bar-caixa" /></div><span>{p.totalCaixa != null ? fmt(p.totalCaixa) : '—'}</span></div></div></div>; })}</div>; })}</div></div> : <p className="empty-template">Nenhuma compra finalizada ainda. Preencha o total do caixa e clique em Finalizar compra.</p>}</section>}
    <footer><span>Seus itens ficam isolados por conta quando o login está ativo.</span><small>Copyright <b>{visitCount || "—"}</b></small></footer>
  </main>;
}





