import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { Check, ChevronDown, CircleHelp, Copy, LogIn, LogOut, Plus, Repeat2, ShoppingCart, Trash2, X } from 'lucide-react';
import { auth, db, firebaseConfigured, googleProvider } from './firebase';
import { QUICK_CATALOG } from './quickCatalog';

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
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [visitCount, setVisitCount] = useState(null);
  const [openQuickGroups, setOpenQuickGroups] = useState(new Set());

  useEffect(() => auth ? onAuthStateChanged(auth, setUser) : undefined, []);
  useEffect(() => {
    fetch('https://listadecompras.goatcounter.com/counter/TOTAL.json').then((response) => response.ok ? response.json() : null).then((data) => { if (data?.count) setVisitCount(data.count); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user || !db) {
      const saved = JSON.parse(localStorage.getItem(`${localKey}-lists`) || 'null');
      const nextLists = saved?.length ? saved : [defaultList];
      setLists(nextLists);
      const savedActive = localStorage.getItem(`${localKey}-active-list`);
      setActiveListId(savedActive && nextLists.some((list) => list.id === savedActive) ? savedActive : nextLists.find((list) => !list.hidden)?.id || null);
      return undefined;
    }
    return onSnapshot(query(collection(db, 'users', user.uid, 'lists'), orderBy('createdAt', 'asc')), (snapshot) => {
      const nextLists = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      setLists(nextLists.length ? nextLists : [defaultList]);
      setActiveListId((current) => current && nextLists.some((list) => list.id === current) ? current : nextLists.find((list) => !list.hidden)?.id || 'default');
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

  const persistLocalItems = (next) => { setItems(next); localStorage.setItem(localKey, JSON.stringify(next)); };
  function toggleQuickGroup(groupId) {
    setOpenQuickGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }
  function selectList(listId) {
    setActiveListId(listId || null);
    localStorage.setItem(`${localKey}-active-list`, listId || '');
    setSelectedSuggestions([]);
  }

  async function createList() {
    const cleanName = window.prompt('Nome da nova lista:', 'Lista do mês')?.trim();
    if (!cleanName) return;
    if (user && db) {
      const listRef = doc(collection(db, 'users', user.uid, 'lists'));
      await setDoc(listRef, { name: cleanName, hidden: false, createdAt: serverTimestamp() });
      setActiveListId(listRef.id);
    } else {
      const nextList = { id: crypto.randomUUID(), name: cleanName, hidden: false, createdAt: Date.now() };
      const nextLists = [...lists, nextList];
      setLists(nextLists);
      localStorage.setItem(`${localKey}-lists`, JSON.stringify(nextLists));
      selectList(nextList.id);
    }
    setStatus(`Lista “${cleanName}” criada.`);
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
  async function addSuggestion(itemName, itemCategory) {
    if (!activeListId) { setStatus('Crie ou selecione uma lista antes de adicionar itens.'); return; }
    const alreadyAdded = activeItems.some((item) => normalizeItemName(item.name) === normalizeItemName(itemName));
    if (alreadyAdded) return;
    const payload = { name: itemName, category: itemCategory, listId: activeListId, isChecked: false };
    if (user && db) await addDoc(collection(db, 'users', user.uid, 'items'), { ...payload, createdAt: serverTimestamp() });
    else persistLocalItems([{ ...payload, id: crypto.randomUUID(), createdAt: Date.now() }, ...items]);
    setStatus(`${itemName} adicionado à lista.`);
  }

  async function addItem(event) {
    event.preventDefault();
    if (!activeListId) { setStatus('Crie ou selecione uma lista antes de adicionar itens.'); return; }
    const cleanName = name.trim();
    if (!cleanName) return;
    if (activeItems.some((item) => normalizeItemName(item.name) === normalizeItemName(cleanName))) { setStatus(`${cleanName} já está na lista.`); return; }
    const payload = { name: cleanName, category, listId: activeListId, isChecked: false, createdAt: Date.now() };
    if (user && db) await addDoc(collection(db, 'users', user.uid, 'items'), { ...payload, createdAt: serverTimestamp() });
    else persistLocalItems([{ ...payload, id: crypto.randomUUID() }, ...items]);
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
    else { const next = [{ id: crypto.randomUUID(), name: cleanName, items: entries }, ...templates]; setTemplates(next); localStorage.setItem(`${localKey}-templates`, JSON.stringify(next)); }
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
      persistLocalItems([...uniqueItems.map((item) => ({ ...item, listId: targetListId, isChecked: false, id: crypto.randomUUID(), createdAt: Date.now() })), ...items.map((item) => resetIds.has(item.id) ? { ...item, isChecked: false } : item)]);
    }
    if (!checkedMatches.length && !uniqueItems.length) { setStatus('Todos os itens dessa lista já estão pendentes.'); return; }
    const total = checkedMatches.length + uniqueItems.length;
    setStatus(`${total} ${total === 1 ? 'item preparado' : 'itens preparados'} para a nova compra, sem marcações.`);
  }
  async function login() {
    if (!auth) return setStatus('Configure as variáveis do Firebase para ativar o login.');
    setLoadingAuth(true); try { await signInWithPopup(auth, googleProvider); } finally { setLoadingAuth(false); }
  }

  async function logout() { if (auth) await signOut(auth); }

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><ShoppingCart size={21} /></div><div><strong>Lista de Compras</strong><span>Organize. Compre. Simplifique.</span></div></div><div className="account">{user ? <><span className="avatar">{(user.displayName || 'C').charAt(0).toUpperCase()}</span><span className="user-name">Olá, {(user.displayName || 'Conta').split(' ')[0]}</span><button className="icon-button" onClick={logout} title="Sair"><LogOut size={17} /></button></> : <button className="login-button" onClick={login} disabled={loadingAuth}><LogIn size={16} /> Entrar com Google</button>}</div></header>
    {!firebaseConfigured && <div className="setup-notice"><CircleHelp size={17} /> Modo local ativo. Configure o arquivo `.env` para sincronizar listas por usuário.</div>}
    <section className="hero"><div><p className="eyebrow">COMPRA ATIVA</p><h1>{activeList?.name || 'Nenhuma lista ativa'}</h1><p className="muted">{pending} {pending === 1 ? 'item pendente' : 'itens pendentes'}</p></div><div className="hero-actions"><div className="list-controls"><select value={activeListId || ''} onChange={(event) => selectList(event.target.value)} aria-label="Selecionar lista"><option value="">Nenhuma lista ativa</option>{lists.map((list) => <option value={list.id} key={list.id}>{list.hidden ? 'Oculta · ' : ''}{list.name}</option>)}</select><button className="secondary-button small" onClick={createList}><Plus size={15} /> Nova lista</button>{activeList && <button className="secondary-button small" onClick={hideActiveList}>Ocultar</button>}</div><button className="secondary-button" onClick={() => setShowTemplates((value) => !value)}><Repeat2 size={17} /> Listas recorrentes <ChevronDown size={15} className={showTemplates ? 'rotate' : ''} /></button></div></section>
    {status && <div className="status" role="alert"><span>{status}</span><button onClick={() => setStatus('')}><X size={15} /></button></div>}
    {showTemplates && <section className="templates-panel"><div className="panel-heading"><div><p className="eyebrow">LISTA RECORRENTE</p><h2>Listas recorrentes</h2></div><button className="icon-button" onClick={() => setShowTemplates(false)}><X size={17} /></button></div><div className="template-save"><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Nome da lista recorrente (ex.: Compra mensal)" /><button className="primary-button" onClick={saveTemplate}><Copy size={16} /> Salvar lista atual</button></div>{templates.length ? <div className="template-list">{templates.map((template) => <div className="template-card" key={template.id}><div><strong>{template.name}</strong><span>{template.items.length} {template.items.length === 1 ? 'item' : 'itens'}</span></div><button className="secondary-button small" onClick={() => importTemplate(template)}>Importar</button></div>)}</div> : <p className="empty-template">Nenhuma lista recorrente salva.</p>}</section>}
    <section className="suggestions-panel"><div className="suggestions-heading"><div><p className="eyebrow">PARA FACILITAR</p><h2>Adicione produtos rápidos</h2><p className="muted">Abra uma categoria e escolha os produtos. Cada item adicionado desaparece do catálogo.</p></div></div><div className="quick-menu">{QUICK_CATALOG.map((group)=>{const subtypes=group.subtypes.map((subtype)=>({...subtype,availableItems:subtype.items.filter(([itemName])=>!activeItems.some((item)=>normalizeItemName(item.name)===normalizeItemName(itemName)))})).filter((subtype)=>subtype.availableItems.length);if(!subtypes.length)return null;const groupCount=subtypes.reduce((total,subtype)=>total+subtype.availableItems.length,0),groupOpen=openQuickGroups.has(group.id);return <div className="quick-group" key={group.id}><button type="button" className="quick-group-toggle" onClick={()=>toggleQuickGroup(group.id)} aria-expanded={groupOpen}><span>{group.emoji} {group.label}</span><span className="quick-count">{groupCount}<ChevronDown size={15} className={groupOpen?'rotate':''}/></span></button>{groupOpen&&<div className="quick-subtypes">{subtypes.map((subtype)=><details className="quick-subtype" key={subtype.id}><summary>{subtype.label}<span>{subtype.availableItems.length}</span></summary><div className="suggestion-list">{subtype.availableItems.map(([itemName,itemCategory])=><button type="button" className="suggestion-chip" key={itemName} onClick={()=>addSuggestion(itemName,itemCategory)}><Plus size={13}/>{itemName}</button>)}</div></details>)}</div>}</div>})}</div></section>    <section className="card"><form className="add-form" onSubmit={addItem}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="O que você precisa comprar?" aria-label="Nome do item" /><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Categoria">{CATEGORIES.map((item) => <option value={item.id} key={item.id}>{item.emoji} {item.label}</option>)}</select><button className="primary-button" type="submit"><Plus size={18} /> Adicionar item</button></form>{grouped.length ? <div className="groups">{grouped.map((group) => <section key={group.id} className={group.items.every((item) => item.isChecked) ? 'category-section category-complete' : 'category-section'}><h2><span>{group.emoji}</span>{group.label}<small className={group.items.some((item) => !item.isChecked) ? "" : "badge-done"}>{group.items.filter((item) => !item.isChecked).length}</small>{group.items.every((item) => item.isChecked) && <em>Concluída</em>}</h2><ul>{group.items.map((item) => <li key={item.id} className={item.isChecked ? 'checked' : ''}><button className="check" onClick={() => toggleItem(item)} aria-label={`Marcar ${item.name}`}><Check size={14} /></button><span>{item.name}</span><button className="delete" onClick={() => removeItem(item)} aria-label={`Excluir ${item.name}`}><Trash2 size={16} /></button></li>)}</ul></section>)}</div> : <div className="empty"><ShoppingCart size={34} /><h2>Sua lista está vazia</h2><p>Adicione seu primeiro item para começar.</p></div>}</section>
    <footer><span>Seus itens ficam isolados por conta quando o login está ativo.</span><small>Copyright <b>{visitCount || "—"}</b></small></footer>
  </main>;
}





