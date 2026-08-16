# Lista de Compras

Aplicação React/Vite com lista ativa, modelos recorrentes e autenticação social do Google.

## Configuração

1. Execute `npm install`.
2. Copie `.env.example` para `.env` e preencha as credenciais do app web no Firebase.
3. No Firebase Authentication, habilite o provedor Google e cadastre o domínio local/de produção.
4. Publique as regras de `firestore.rules` no Firestore.
5. Execute `npm run dev`.

Sem as variáveis do Firebase, a aplicação funciona em modo local no navegador. Com login, itens e modelos ficam em `users/{uid}/items` e `users/{uid}/templates`.
