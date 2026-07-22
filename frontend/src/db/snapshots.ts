import { getDB, WebsiteSnapshot, now, nextId } from './index'

export async function saveSnapshot(data: Omit<WebsiteSnapshot, 'id' | 'synced_at'>): Promise<WebsiteSnapshot> {
  const db = await getDB()

  // Remove old snapshots for this website (keep last 10)
  const existing = await db.getAllFromIndex('snapshots', 'by_website', data.website_id)
  existing.sort((a, b) => new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime())
  for (const old of existing.slice(9)) {
    await db.delete('snapshots', old.id)
  }

  const snap: WebsiteSnapshot = { ...data, id: nextId(), synced_at: now() }
  await db.put('snapshots', snap)
  return snap
}

export async function getLatestSnapshot(websiteId: number): Promise<WebsiteSnapshot | undefined> {
  const db = await getDB()
  const snaps = await db.getAllFromIndex('snapshots', 'by_website', websiteId)
  return snaps.sort((a, b) => new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime())[0]
}

export async function getAllLatestSnapshots(): Promise<WebsiteSnapshot[]> {
  const db = await getDB()
  const all = await db.getAll('snapshots')

  // Group by website_id, keep latest per website
  const map = new Map<number, WebsiteSnapshot>()
  for (const snap of all) {
    const existing = map.get(snap.website_id)
    if (!existing || new Date(snap.synced_at) > new Date(existing.synced_at)) {
      map.set(snap.website_id, snap)
    }
  }
  return Array.from(map.values())
}

export async function getSyncStatus(websiteIds: number[]): Promise<{
  status: 'never' | 'ok' | 'partial' | 'error'
  last_sync_at: string | null
  available_balance: number
}> {
  if (websiteIds.length === 0) return { status: 'never', last_sync_at: null, available_balance: 0 }

  const snapshots = await getAllLatestSnapshots()
  const relevant = snapshots.filter(s => websiteIds.includes(s.website_id))

  if (relevant.length === 0) return { status: 'never', last_sync_at: null, available_balance: 0 }

  const ok = relevant.filter(s => s.status === 'ok')
  const latest = relevant.sort((a, b) => new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime())[0]

  const available_balance = relevant.reduce((s, snap) => s + (snap.available_balance ?? 0), 0)

  let status: 'ok' | 'partial' | 'error'
  if (ok.length === relevant.length) status = 'ok'
  else if (ok.length > 0) status = 'partial'
  else status = 'error'

  return { status, last_sync_at: latest.synced_at, available_balance }
}
