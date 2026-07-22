/**
 * Session cookie storage — same AES-GCM encryption as credentials.
 * One session cookie per website, stored encrypted in IndexedDB.
 * The cookie value is passed to the backend proxy so it can authenticate
 * as the logged-in user when fetching dashboard pages.
 */
import { getDB, SessionCookie, now, nextId } from './index'

const KEY_MATERIAL_LS = 'mtm_key_material_v1'

async function getEncryptionKey(): Promise<CryptoKey> {
  let raw = localStorage.getItem(KEY_MATERIAL_LS)
  if (!raw) {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32))
    raw = btoa(String.fromCharCode(...keyBytes))
    localStorage.setItem(KEY_MATERIAL_LS, raw)
  }
  const keyBytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encrypt(value: string): Promise<{ encrypted: string; iv: string }> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(value)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
  }
}

async function decrypt(encrypted: string, ivB64: string): Promise<string> {
  const key = await getEncryptionKey()
  const ciphertext = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plain)
}

export async function saveSessionCookie(websiteId: number, cookieValue: string): Promise<SessionCookie> {
  const db = await getDB()
  const { encrypted, iv } = await encrypt(cookieValue.trim())

  // Remove any existing cookie for this website
  const existing = await db.getAllFromIndex('session_cookies', 'by_website', websiteId)
  for (const old of existing) await db.delete('session_cookies', old.id)

  const cookie: SessionCookie = {
    id: nextId(),
    website_id: websiteId,
    encrypted_value: encrypted,
    iv,
    updated_at: now(),
  }
  await db.put('session_cookies', cookie)
  return cookie
}

export async function getSessionCookieValue(websiteId: number): Promise<string | null> {
  const db = await getDB()
  const cookies = await db.getAllFromIndex('session_cookies', 'by_website', websiteId)
  if (cookies.length === 0) return null
  const cookie = cookies[0]
  try {
    return await decrypt(cookie.encrypted_value, cookie.iv)
  } catch {
    return null
  }
}

export async function hasSessionCookie(websiteId: number): Promise<boolean> {
  const db = await getDB()
  const cookies = await db.getAllFromIndex('session_cookies', 'by_website', websiteId)
  return cookies.length > 0
}

export async function deleteSessionCookie(websiteId: number): Promise<void> {
  const db = await getDB()
  const cookies = await db.getAllFromIndex('session_cookies', 'by_website', websiteId)
  for (const c of cookies) await db.delete('session_cookies', c.id)
}

export async function getSessionCookieUpdatedAt(websiteId: number): Promise<string | null> {
  const db = await getDB()
  const cookies = await db.getAllFromIndex('session_cookies', 'by_website', websiteId)
  return cookies.length > 0 ? cookies[0].updated_at : null
}
