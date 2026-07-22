import { getDB, Notification, now, nextId } from './index'

export async function getNotifications(): Promise<Notification[]> {
  const db = await getDB()
  const all = await db.getAll('notifications')
  return all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

export async function getUnreadCount(): Promise<number> {
  const db = await getDB()
  const unread = await db.getAllFromIndex('notifications', 'by_read', 0)
  return unread.length
}

export async function createNotification(data: Omit<Notification, 'id' | 'created_at' | 'is_read'>): Promise<Notification> {
  const db = await getDB()
  const notif: Notification = { ...data, id: nextId(), is_read: false, created_at: now() }
  await db.put('notifications', notif)
  return notif
}

export async function markNotificationRead(id: number): Promise<void> {
  const db = await getDB()
  const n = await db.get('notifications', id)
  if (n) await db.put('notifications', { ...n, is_read: true })
}

export async function markAllNotificationsRead(): Promise<void> {
  const db = await getDB()
  const all = await db.getAll('notifications')
  for (const n of all) {
    if (!n.is_read) await db.put('notifications', { ...n, is_read: true })
  }
}

export async function deleteNotification(id: number): Promise<void> {
  const db = await getDB()
  await db.delete('notifications', id)
}

export async function clearAllNotifications(): Promise<void> {
  const db = await getDB()
  await db.clear('notifications')
}
