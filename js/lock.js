/* Passphrase lock for a hosted copy of the atlas.

   The whole trip (itinerary, places, coordinates, routes, photo credits) is
   published as one encrypted file, atlas.dat. Nothing about the trip is
   readable without the passphrase: not on the page, not in its source.

   File layout   "JATL1" · iterations (uint32) · salt (16) · iv (12) · ciphertext
   Key           PBKDF2-HMAC-SHA256(passphrase, salt, iterations) → AES-256-GCM
   Everything happens in the browser with Web Crypto; the passphrase is never
   sent anywhere. "Remember on this device" stores the derived key (not the
   passphrase) in this browser's local storage.

   Films and their photographs are too large for atlas.dat, so each is its own
   file, encrypted with the same key:   "JATM1" · iv (12) · ciphertext        */

import { h, mount } from './lib/dom.js';

const MAGIC = 'JATL1';
const MEDIA_MAGIC = 'JATM1';
let opened = null;            // the key that opened this atlas (kept in memory for its films)
const KEY_STORE = 'japan-atlas:key:v1';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

function parse(buffer) {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== MAGIC) throw new Error('not an atlas data file');
  return {
    iterations: new DataView(buffer).getUint32(5),
    salt: bytes.subarray(9, 25),
    iv: bytes.subarray(25, 37),
    data: bytes.subarray(37),
  };
}

async function deriveKey(passphrase, file) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.trim().normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: file.salt, iterations: file.iterations }, material, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

async function decrypt(key, file) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: file.iv }, key, file.data);   // throws on a wrong key
  return JSON.parse(new TextDecoder().decode(plain));
}

function remembered() { try { return localStorage.getItem(KEY_STORE); } catch (err) { return null; } }
function remember(value) { try { if (value) localStorage.setItem(KEY_STORE, value); else localStorage.removeItem(KEY_STORE); } catch (err) { /* private mode */ } }

/** Forget the key on this device (used by "Lock this device" in the dashboard). */
export function forgetKey() { remember(null); }
export const hasRememberedKey = () => !!remembered();

/**
 * Resolves with the decrypted bundle. Shows the passphrase form inside `host`
 * (the loading screen) unless this device already holds a working key.
 */
export async function openLocked(host, { url = 'atlas.dat' } = {}) {
  if (!window.crypto || !crypto.subtle) throw new Error('This page must be opened over https to unlock the atlas.');
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('The atlas data could not be downloaded. Check the connection and reload.');
  const file = parse(await res.arrayBuffer());

  const saved = remembered();
  if (saved) {
    try {
      const key = await crypto.subtle.importKey('raw', unb64(saved), 'AES-GCM', true, ['decrypt']);
      const bundle = await decrypt(key, file);
      opened = key;
      return bundle;
    } catch (err) {
      remember(null);   // the passphrase was changed since this device last unlocked
    }
  }

  return new Promise((resolve) => {
    const input = h('input.lock__input', { type: 'password', name: 'passphrase', autocomplete: 'current-password', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
      placeholder: 'Passphrase', 'aria-label': 'Passphrase', required: true });
    const show = h('input', { type: 'checkbox', id: 'lock-show' });
    const keep = h('input', { type: 'checkbox', id: 'lock-keep', checked: true });
    const button = h('button.btn.btn--primary.lock__btn', { type: 'submit' }, 'Unlock');
    const message = h('p.lock__msg', { role: 'alert' });
    const form = h('form.lock', { novalidate: true },
      h('p.lock__lead', 'This atlas is private. Enter the passphrase to open it.'),
      h('div.lock__row', input, button),
      h('div.lock__opts',
        h('label', { for: 'lock-keep' }, keep, 'Remember on this device'),
        h('label', { for: 'lock-show' }, show, 'Show')),
      message);
    show.addEventListener('change', () => { input.type = show.checked ? 'text' : 'password'; });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      button.disabled = true;
      button.textContent = 'Unlocking…';
      message.textContent = '';
      try {
        const key = await deriveKey(input.value, file);
        const bundle = await decrypt(key, file);
        opened = key;
        if (keep.checked) remember(b64(await crypto.subtle.exportKey('raw', key)));
        form.remove();
        resolve(bundle);
      } catch (err) {
        message.textContent = 'That passphrase does not open this atlas.';
        button.disabled = false;
        button.textContent = 'Unlock';
        input.select();
      }
    });

    mount(host, form);
    host.hidden = false;
    document.body.classList.add('is-locked');
    input.focus();
  });
}

/**
 * Download and decrypt one media file listed in the bundle ({ file, type }).
 * Resolves with a Blob; rejects if it is missing or the atlas is not open.
 */
export async function openMedia(entry) {
  if (!entry || !opened) throw new Error('media not available');
  const res = await fetch(entry.file);
  if (!res.ok) throw new Error(String(res.status));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== MEDIA_MAGIC) throw new Error('not an atlas media file');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(5, 17) }, opened, bytes.subarray(17));
  return new Blob([plain], { type: entry.type || 'application/octet-stream' });
}
