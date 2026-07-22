import { getDB } from './index'

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDB()
  const s = await db.get('settings', key)
  return s?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDB()
  await db.put('settings', { key, value })
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const db = await getDB()
  const all = await db.getAll('settings')
  return Object.fromEntries(all.map(s => [s.key, s.value]))
}
