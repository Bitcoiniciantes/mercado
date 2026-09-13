import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(Boolean);
const app = firebaseConfigured ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const googleProvider = new GoogleAuthProvider();

// Aguarda a restauração da sessão persistida antes de decidir.
// Sem isso, cada reload criava um anônimo novo órfão (currentUser ainda null).
let initialAuthPromise = null;
export function awaitInitialAuth() {
  if (!auth) return Promise.resolve(null);
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!initialAuthPromise) {
    initialAuthPromise = new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (u) => { try { unsub(); } catch {} resolve(u); });
    });
  }
  return initialAuthPromise;
}

// Entra anônimo se ainda não há usuário (usado no link compartilhado do churrasco).
// Reaproveita a conta anônima já salva no navegador; chamadas concorrentes dividem 1 promise.
let anonPromise = null;
export async function ensureAnon() {
  if (!auth) return null;
  const existing = await awaitInitialAuth();
  if (existing || auth.currentUser) return auth.currentUser;
  if (!anonPromise) {
    anonPromise = signInAnonymously(auth)
      .then((cred) => cred.user)
      .catch(() => auth.currentUser)
      .finally(() => { anonPromise = null; });
  }
  return anonPromise;
}
