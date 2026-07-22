import { getDB, Website, WebsiteFolder, now, nextId } from './index'

// ── Folders ──────────────────────────────────────────────────────────────────

export async function getFolders(): Promise<WebsiteFolder[]> {
  const db = await getDB()
  return db.getAll('website_folders')
}

export async function createFolder(data: Omit<WebsiteFolder, 'id' | 'created_at'>): Promise<WebsiteFolder> {
  const db = await getDB()
  const folder: WebsiteFolder = { ...data, id: nextId(), created_at: now() }
  await db.put('website_folders', folder)
  return folder
}

export async function deleteFolder(id: number): Promise<void> {
  const db = await getDB()
  await db.delete('website_folders', id)
}

// ── Websites ──────────────────────────────────────────────────────────────────

export async function getWebsites(): Promise<Website[]> {
  const db = await getDB()
  const all = await db.getAll('websites')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getEnabledWebsites(): Promise<Website[]> {
  const db = await getDB()
  return db.getAllFromIndex('websites', 'by_enabled', 1)
}

export async function getWebsiteById(id: number): Promise<Website | undefined> {
  const db = await getDB()
  return db.get('websites', id)
}

export async function createWebsite(data: Omit<Website, 'id' | 'created_at'>): Promise<Website> {
  const db = await getDB()
  const website: Website = { ...data, id: nextId(), created_at: now() }
  await db.put('websites', website)
  return website
}

export async function updateWebsite(id: number, data: Partial<Omit<Website, 'id' | 'created_at'>>): Promise<Website> {
  const db = await getDB()
  const existing = await db.get('websites', id)
  if (!existing) throw new Error('Website not found')
  const updated = { ...existing, ...data }
  await db.put('websites', updated)
  return updated
}

export async function deleteWebsite(id: number): Promise<void> {
  const db = await getDB()

  // Cascade: delete all credentials for this website
  const creds = await db.getAllFromIndex('credentials', 'by_website', id)
  for (const c of creds) {
    await db.delete('credentials', c.id)
  }

  // Unlink tasks (set website_id to undefined so they're not orphaned)
  const tasks = await db.getAllFromIndex('tasks', 'by_website', id)
  for (const t of tasks) {
    await db.put('tasks', { ...t, website_id: undefined })
  }

  // Delete snapshots for this website
  const snaps = await db.getAllFromIndex('snapshots', 'by_website', id)
  for (const s of snaps) {
    await db.delete('snapshots', s.id)
  }

  await db.delete('websites', id)
}
