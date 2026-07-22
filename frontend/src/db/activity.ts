import { getDB, ActivityLog, now, nextId } from './index'

export async function logActivity(
  action: string,
  details?: string,
  entityType?: string,
  entityId?: number,
): Promise<void> {
  const db = await getDB()
  const entry: ActivityLog = {
    id: nextId(),
    action,
    details,
    entity_type: entityType,
    entity_id: entityId,
    created_at: now(),
  }
  await db.put('activity_logs', entry)
}

export async function getActivityLogs(limit = 20): Promise<ActivityLog[]> {
  const db = await getDB()
  const all = await db.getAll('activity_logs')
  return all
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
}

export async function clearActivityLogs(): Promise<void> {
  const db = await getDB()
  await db.clear('activity_logs')
}
