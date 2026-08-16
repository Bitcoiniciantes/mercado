import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { Check, ChevronDown, CircleHelp, Copy, LogIn, LogOut, Plus, Repeat2, ShoppingCart, Trash2, X } from 'lucide-react';
import { auth, db, firebaseConfigured, googleProvider } from './firebase';

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

function categoryLabel(id) {
  const category = CATEGORIES.find((item) => item.id === id);
  return category ? `${category.emoji} ${category.label}` : '📦 Outros';
}

export default function App() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('hortifruti');
  const [templateName, setTemplateName] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [status, setStatus] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);

  useEffect(() => auth ? onAuthStateChanged(auth, setUser) : undefined, []);

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

  const pending = items.filter((item) => !item.isChecked).length;
  const grouped = useMemo(() => CATEGORIES.map((categoryItem) => ({ ...categoryItem, items: items.filter((item) => item.category === categoryItem.id) })).filter((group) => group.items.length), [items]);

  const persistLocalItems = (next) => { setItems(next); localStorage.setItem(localKey, JSON.stringify(next)); };

  async function addItem(event) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const payload = { name: cleanName, category, isChecked: false, createdAt: Date.now() };
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
    const entries = items.map(({ name: itemName, category: itemCategory }) => ({ name: itemName, category: itemCategory }));
    if (!entries.length) return setStatus('Adicione itens antes de salvar um modelo.');
    if (user && db) await addDoc(collection(db, 'users', user.uid, 'templates'), { name: cleanName, items: entries, createdAt: serverTimestamp() });
    else { const next = [{ id: crypto.randomUUID(), name: cleanName, items: entries }, ...templates]; setTemplates(next); localStorage.setItem(`${localKey}-templates`, JSON.stringify(next)); }
    setTemplateName(''); setStatus('Modelo recorrente salvo.');
  }

  async function importTemplate(template) {
    if (user && db) {
      const batch = writeBatch(db);
      template.items.forEach((item) => batch.set(doc(collection(db, 'users', user.uid, 'items')), { ...item, isChecked: false, createdAt: serverTimestamp() }));
      await batch.commit();
    } else persistLocalItems([...template.items.map((item) => ({ ...item, isChecked: false, id: crypto.randomUUID(), createdAt: Date.now() })), ...items]);
    setStatus(`“${template.name}” importada para a compra ativa.`);
  }

  async function login() {
    if (!auth) return setStatus('Configure as variáveis do Firebase para ativar o login.');
    setLoadingAuth(true); try { await signInWithPopup(auth, googleProvider); } finally { setLoadingAuth(false); }
  }

  async function logout() { if (auth) await signOut(auth); }

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><ShoppingCart size={21} /></div><div><strong>Lista de Compras</strong><span>Organize. Compre. Simplifique.</span></div></div><div className="account">{user ? <><span className="user-name">{user.displayName || user.email}</span><button className="icon-button" onClick={logout} title="Sair"><LogOut size={17} /></button></> : <button className="login-button" onClick={login} disabled={loadingAuth}><LogIn size={16} /> Entrar com Google</button>}</div></header>
    {!firebaseConfigured && <div className="setup-notice"><CircleHelp size={17} /> Modo local ativo. Configure o arquivo `.env` para sincronizar listas por usuário.</div>}
    <section className="hero"><div><p className="eyebrow">COMPRA ATIVA</p><h1>Minha lista</h1><p className="muted">{pending} {pending === 1 ? 'item pendente' : 'itens pendentes'}</p></div><div className="hero-actions"><button className="secondary-button" onClick={() => setShowTemplates((value) => !value)}><Repeat2 size={17} /> Modelos recorrentes <ChevronDown size={15} className={showTemplates ? 'rotate' : ''} /></button></div></section>
    {status && <div className="status"><span>{status}</span><button onClick={() => setStatus('')}><X size={15} /></button></div>}
    {showTemplates && <section className="templates-panel"><div className="panel-heading"><div><p className="eyebrow">REUTILIZE SUA ROTINA</p><h2>Modelos recorrentes</h2></div><button className="icon-button" onClick={() => setShowTemplates(false)}><X size={17} /></button></div><div className="template-save"><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Nome do modelo (ex.: Compra mensal)" /><button className="primary-button" onClick={saveTemplate}><Copy size={16} /> Salvar lista atual</button></div>{templates.length ? <div className="template-list">{templates.map((template) => <div className="template-card" key={template.id}><div><strong>{template.name}</strong><span>{template.items.length} {template.items.length === 1 ? 'item' : 'itens'}</span></div><button className="secondary-button small" onClick={() => importTemplate(template)}>Importar</button></div>)}</div> : <p className="empty-template">Nenhum modelo salvo.</p>}</section>}
    <section className="card"><form className="add-form" onSubmit={addItem}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="O que você precisa comprar?" aria-label="Nome do item" /><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Categoria">{CATEGORIES.map((item) => <option value={item.id} key={item.id}>{item.emoji} {item.label}</option>)}</select><button className="primary-button" type="submit"><Plus size={18} /> Adicionar item</button></form>{grouped.length ? <div className="groups">{grouped.map((group) => <section key={group.id}><h2><span>{group.emoji}</span>{group.label}<small>{group.items.length}</small></h2><ul>{group.items.map((item) => <li key={item.id} className={item.isChecked ? 'checked' : ''}><button className="check" onClick={() => toggleItem(item)} aria-label={`Marcar ${item.name}`}><Check size={14} /></button><span>{item.name}</span><button className="delete" onClick={() => removeItem(item)} aria-label={`Excluir ${item.name}`}><Trash2 size={16} /></button></li>)}</ul></section>)}</div> : <div className="empty"><ShoppingCart size={34} /><h2>Sua lista está vazia</h2><p>Adicione seu primeiro item para começar.</p></div>}</section>
    <footer>Seus itens ficam isolados por conta quando o login está ativo.</footer>
  </main>;
}
