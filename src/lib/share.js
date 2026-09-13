// Helpers do link colaborativo (#/l/ABC123) — churrasco com edição anônima.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem vogal/ambíguos

export function shortId(len = 7) {
  let out = '';
  const buf = new Uint32Array(len);
  try {
    crypto.getRandomValues(buf);
    for (let i = 0; i < len; i += 1) out += ALPHABET[buf[i] % ALPHABET.length];
  } catch {
    for (let i = 0; i < len; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function parseShareHash(hash = '') {
  const h = String(hash || window?.location?.hash || '');
  const m = h.match(/#\/?l\/([A-Za-z0-9]{4,24})/);
  return m ? m[1].toUpperCase() : null;
}

export function buildShareLink(shareId) {
  const url = new URL(window.location.href);
  url.hash = `/l/${shareId}`;
  return url.toString();
}

export function setShareHash(shareId) {
  try {
    window.location.hash = shareId ? `/l/${shareId}` : '';
  } catch {}
}
