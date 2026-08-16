import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy 
} from 'firebase/firestore';

const CATEGORIAS = [
  { id: 'hortifruti', label: '🥬 Hortifruti' },
  { id: 'carnes', label: '🥩 Carnes e Peixes' },
  { id: 'frios', label: '🧀 Frios e Laticínios' },
  { id: 'mercearia', label: '🥫 Mercearia' },
  { id: 'limpeza', label: '🧻 Higiene e Limpeza' },
  { id: 'bebidas', label: '🧃 Bebidas' },
  { id: 'outros', label: '📦 Outros' }
];

export default function App() {
  const [items, setItems] = useState([]);
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('hortifruti');

  // Conexão em tempo real com a coleção 'active_list' do Firestore
  useEffect(() => {
    const q = query(collection(db, 'active_list'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setItems(docs);
    });

    return () => unsubscribe();
  }, []);

  // Adicionar novo item à lista
  const addItem = async (e) => {
    e.preventDefault();
    if (!itemName.trim()) return;

    await addDoc(collection(db, 'active_list'), {
      name: itemName.trim(),
      category: category,
      isChecked: false,
      createdAt: new Date()
    });

    setItemName('');
  };

  // Alternar status de comprado (check/uncheck)
  const toggleCheck = async (id, currentStatus) => {
    const itemRef = doc(db, 'active_list', id);
    await updateDoc(itemRef, {
      isChecked: !currentStatus
    });
  };

  // Excluir item individual
  const deleteItem = async (id) => {
    await deleteDoc(doc(db, 'active_list', id));
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6 font-sans">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden p-6">
        
        {/* Cabeçalho */}
        <header className="mb-6 border-b pb-4">
          <h1 className="text-2xl font-bold text-slate-800">🛒 Lista de Compras</h1>
          <p className="text-sm text-slate-500">Organizada por seções do mercado</p>
        </header>

        {/* Formulário de Inserção */}
        <form onSubmit={addItem} className="flex flex-col gap-3 mb-6">
          <input
            type="text"
            placeholder="Nome do item (ex: Leite, Batata)..."
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          
          <div className="flex gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {CATEGORIAS.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>

            <button
              type="submit"
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
            >
              Adicionar
            </button>
          </div>
        </form>

        {/* Lista de Itens Agrupada por Categoria */}
        <div className="space-y-6">
          {CATEGORIAS.map((cat) => {
            const categoryItems = items.filter(item => item.category === cat.id);
            if (categoryItems.length === 0) return null;

            return (
              <section key={cat.id} className="border-t pt-3">
                <h2 className="text-md font-semibold text-slate-600 mb-2">
                  {cat.label}
                </h2>
                
                <ul className="space-y-2">
                  {categoryItems.map((item) => (
                    <li 
                      key={item.id}
                      className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                        item.isChecked ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={item.isChecked}
                          onChange={() => toggleCheck(item.id, item.isChecked)}
                          className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
                        />
                        <span className={`text-base ${
                          item.isChecked ? 'line-through text-slate-400' : 'text-slate-800'
                        }`}>
                          {item.name}
                        </span>
                      </div>

                      <button
                        onClick={() => deleteItem(item.id)}
                        className="text-slate-400 hover:text-red-500 transition-colors px-2 py-1"
                        aria-label="Excluir item"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {items.length === 0 && (
            <p className="text-center text-slate-400 py-8">
              Nenhum item na lista. Comece adicionando acima!
            </p>
          )}
        </div>

      </div>
    </div>
  );
}