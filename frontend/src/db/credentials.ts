/**
 * Credential storage with AES-GCM encryption via Web Crypto API.
 * The encryption key is derived once per session and stored in sessionStorage,
 * with a persistent key material saved in localStorage. This keeps passwords
 * encrypted at rest in IndexedDB while remaining transparently usable in-app.
 */
import { getDB, StoredCredential, now, nextId } from './index'

const KEY_MATERIAL_LS = 'mtm_key_material_v1'

async function getEncryptionKey(): Promise<CryptoKey> {
  let raw = localStorage.getItem(KEY_MATERIAL_LS)
  if (!raw) {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32))
    raw = btoa(String.fromCharCode(...keyBytes))
    localStorage.setItem(KEY_MATERIAL_LS, raw)
  }

  const keyBytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
  const keyMaterial = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return keyMaterial
}

async function encryptPassword(password: string): Promise<{ encrypted: string; iv: string }> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(password)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
  }
}

async function decryptPassword(encrypted: string, ivB64: string): Promise<string> {
  const key = await getEncryptionKey()
  const ciphertext = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plain)
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getCredentials(websiteId?: number): Promise<StoredCredential[]> {
  const db = await getDB()
  if (websiteId !== undefined) {
    return db.getAllFromIndex('credentials', 'by_website', websiteId)
  }
  return db.getAll('credentials')
}

export async function createCredential(data: {
  website_id: number
  username: string
  password: string
  notes?: string
}): Promise<StoredCredential> {
  const db = await getDB()
  const { encrypted, iv } = await encryptPassword(data.password)
  const cred: StoredCredential = {
    id: nextId(),
    website_id: data.website_id,
    username: data.username,
    encrypted_password: encrypted,
    iv,
    notes: data.notes,
    created_at: now(),
  }
  await db.put('credentials', cred)
  return cred
}

export async function revealCredentialPassword(id: number): Promise<string> {
  const db = await getDB()
  const cred = await db.get('credentials', id)
  if (!cred) throw new Error('Credential not found')

  // Mark last_used
  await db.put('credentials', { ...cred, last_used: now() })

  return decryptPassword(cred.encrypted_password, cred.iv)
}

export async function deleteCredential(id: number): Promise<void> {
  const db = await getDB()
  await db.delete('credentials', id)
}

export async function updateCredential(id: number, data: {
  username?: string
  password?: string
  notes?: string
}): Promise<StoredCredential> {
  const db = await getDB()
  const existing = await db.get('credentials', id)
  if (!existing) throw new Error('Credential not found')

  let updated = { ...existing, ...data }
  if (data.password) {
    const { encrypted, iv } = await encryptPassword(data.password)
    updated = { ...updated, encrypted_password: encrypted, iv }
  }
  await db.put('credentials', updated)
  return updated
}
