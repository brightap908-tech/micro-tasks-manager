import { getDB, WebsiteSnapshot, now, nextId } from './index'

function hasExtractedValue(snapshot: WebsiteSnapshot): boolean {
  return [
    snapshot.available_balance,
    snapshot.pending_balance,
    snapshot.available_tasks,
    snapshot.pending_tasks,
    snapshot.completed_tasks,
    snapshot.in_progress_tasks,
    snapshot.skipped_tasks,
    snapshot.total_earnings,
  ].some(value => value !== undefined && value !== null)
}

export async function saveSnapshot(data: Omit<WebsiteSnapshot, 'id' | 'synced_at'> & {
  pending_tasks?: number
  completed_tasks?: number
  in_progress_tasks?: number
  skipped_tasks?: number
  total_earnings?: number
}): Promise<WebsiteSnapshot> {
  const db = await getDB()

  // Remove old snapshots for this website (keep last 10)
  const existing = await db.getAllFromIndex('snapshots', 'by_website', data.website_id)
  existing.sort((a, b) => new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime())
  for (const old of existing.slice(9)) {
    await db.delete('snapshots', old.id)
  }

  const snap: WebsiteSnapshot = { ...data, id: nextId(), synced_at: now() }
  await db.put('snapshots', snap)
  console.info('[Sync] Snapshot written to IndexedDB', {
    website_id: snap.website_id,
    status: snap.status,
    available_balance: snap.available_balance ?? null,
    pending_balance: snap.pending_balance ?? null,
    available_tasks: snap.available_tasks ?? null,
    pending_tasks: snap.pending_tasks ?? null,
    completed_tasks: snap.completed_tasks ?? null,
    in_progress_tasks: snap.in_progress_tasks ?? null,
    skipped_tasks: snap.skipped_tasks ?? null,
    total_earnings: snap.total_earnings ?? null,
  })
  return snap
}

export async function getLatestSnapshot(websiteId: number): Promise<WebsiteSnapshot | undefined> {
  const db = await getDB()
  const snaps = await db.getAllFromIndex('snapshots', 'by_website', websiteId)
  const latest = snaps.sort((a, b) => new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime())[0]
  console.info('[Sync] Snapshot read from IndexedDB', {
    website_id: websiteId,
    found: Boolean(latest),
    values: latest ? {
      status: latest.status,
      available_balance: latest.available_balance ?? null,
      pending_balance: latest.pending_balance ?? null,
      available_tasks: latest.available_tasks ?? null,
      pending_tasks: latest.pending_tasks ?? null,
      completed_tasks: latest.completed_tasks ?? null,
      in_progress_tasks: latest.in_progress_tasks ?? null,
      skipped_tasks: latest.skipped_tasks ?? null,
      total_earnings: latest.total_earnings ?? null,
    } : null,
  })
  return latest
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
  total_earnings: number
  pending_balance: number
  available_tasks: number
  pending_tasks: number
  completed_tasks: number
  in_progress_tasks: number
  skipped_tasks: number
}> {
  if (websiteIds.length === 0) return {
    status: 'never', last_sync_at: null, available_balance: 0, pending_balance: 0,
    available_tasks: 0, total_earnings: 0, pending_tasks: 0, completed_tasks: 0,
    in_progress_tasks: 0, skipped_tasks: 0,
  }

  const snapshots = await getAllLatestSnapshots()
  const relevant = snapshots.filter(s => websiteIds.includes(s.website_id))

  if (relevant.length === 0) return {
    status: 'never', last_sync_at: null, available_balance: 0, pending_balance: 0,
    available_tasks: 0, total_earnings: 0, pending_tasks: 0, completed_tasks: 0,
    in_progress_tasks: 0, skipped_tasks: 0,
  }

  const ok = relevant.filter(s => s.status === 'ok' && hasExtractedValue(s))
  const latest = relevant.sort((a, b) => new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime())[0]

  const available_balance = relevant.reduce((s, snap) => s + (snap.available_balance ?? 0), 0)
  const pending_balance = relevant.reduce((s, snap) => s + (snap.pending_balance ?? 0), 0)
  const available_tasks = relevant.reduce((s, snap) => s + (snap.available_tasks ?? 0), 0)
  const total_earnings = relevant.reduce((s, snap) => s + (snap.total_earnings ?? 0), 0)
  const pending_tasks = relevant.reduce((s, snap) => s + (snap.pending_tasks ?? 0), 0)
  const completed_tasks = relevant.reduce((s, snap) => s + (snap.completed_tasks ?? 0), 0)
  const in_progress_tasks = relevant.reduce((s, snap) => s + (snap.in_progress_tasks ?? 0), 0)
  const skipped_tasks = relevant.reduce((s, snap) => s + (snap.skipped_tasks ?? 0), 0)

  let status: 'ok' | 'partial' | 'error'
  if (ok.length === relevant.length) status = 'ok'
  else if (ok.length > 0) status = 'partial'
  else status = 'error'

  console.info('[Sync] Dashboard read-back from IndexedDB', {
    website_ids: websiteIds,
    snapshot_count: relevant.length,
    status,
    available_balance,
    pending_balance,
    available_tasks,
    total_earnings,
    pending_tasks,
    completed_tasks,
    in_progress_tasks,
    skipped_tasks,
    latest_snapshot: latest.id,
  })
  return {
    status, last_sync_at: latest.synced_at, available_balance, pending_balance, available_tasks,
    total_earnings, pending_tasks, completed_tasks, in_progress_tasks, skipped_tasks,
  }
}
