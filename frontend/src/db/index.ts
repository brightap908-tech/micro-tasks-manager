import { openDB, DBSchema, IDBPDatabase } from 'idb'

export interface WebsiteFolder {
  id: number
  name: string
  color: string
  created_at: string
}

export interface Website {
  id: number
  name: string
  login_url: string
  dashboard_url?: string
  description?: string
  plugin_id: string
  is_enabled: boolean
  folder_id?: number
  favicon_url?: string
  created_at: string
}

export interface StoredCredential {
  id: number
  website_id: number
  username: string
  encrypted_password: string // AES-GCM encrypted, base64
  iv: string                 // base64 IV
  notes?: string
  last_used?: string
  created_at: string
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'
export type TaskCategory =
  | 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'telegram'
  | 'x' | 'linkedin' | 'discord' | 'website_visit' | 'survey'
  | 'app_install' | 'other'

export interface Task {
  id: number
  title: string
  description?: string
  url?: string
  category: TaskCategory
  status: TaskStatus
  reward: number
  currency: string
  website_id?: number
  started_at?: string
  completed_at?: string
  time_spent_seconds: number
  notes?: string
  created_at: string
  updated_at?: string
}

export interface Notification {
  id: number
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  is_read: boolean
  website_id?: number
  created_at: string
}

export interface ActivityLog {
  id: number
  action: string
  details?: string
  entity_type?: string
  entity_id?: number
  created_at: string
}

export interface Setting {
  key: string
  value: string
}

export interface WebsiteSnapshot {
  id: number
  website_id: number
  status: 'ok' | 'auth_required' | 'error'
  available_balance?: number
  pending_balance?: number
  available_tasks?: number
  pending_tasks?: number
  completed_tasks?: number
  in_progress_tasks?: number
  skipped_tasks?: number
  total_earnings?: number
  page_title?: string
  error_message?: string
  synced_at: string
}

export interface SessionCookie {
  id: number
  website_id: number
  encrypted_value: string  // AES-GCM encrypted, base64
  iv: string               // base64 IV
  updated_at: string
}

interface AppDB extends DBSchema {
  website_folders: { key: number; value: WebsiteFolder }
  websites: { key: number; value: Website; indexes: { by_enabled: number } }
  credentials: { key: number; value: StoredCredential; indexes: { by_website: number } }
  tasks: {
    key: number; value: Task
    indexes: { by_status: string; by_website: number; by_category: string }
  }
  notifications: { key: number; value: Notification; indexes: { by_read: number } }
  activity_logs: { key: number; value: ActivityLog }
  settings: { key: string; value: Setting }
  snapshots: { key: number; value: WebsiteSnapshot; indexes: { by_website: number } }
  session_cookies: { key: number; value: SessionCookie; indexes: { by_website: number } }
}

let _db: IDBPDatabase<AppDB> | null = null

export async function getDB(): Promise<IDBPDatabase<AppDB>> {
  if (_db) return _db
  _db = await openDB<AppDB>('microtask-manager', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        // website_folders
        db.createObjectStore('website_folders', { keyPath: 'id', autoIncrement: true })

        // websites
        const ws = db.createObjectStore('websites', { keyPath: 'id', autoIncrement: true })
        ws.createIndex('by_enabled', 'is_enabled')

        // credentials
        const cs = db.createObjectStore('credentials', { keyPath: 'id', autoIncrement: true })
        cs.createIndex('by_website', 'website_id')

        // tasks
        const ts = db.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true })
        ts.createIndex('by_status', 'status')
        ts.createIndex('by_website', 'website_id')
        ts.createIndex('by_category', 'category')

        // notifications
        const ns = db.createObjectStore('notifications', { keyPath: 'id', autoIncrement: true })
        ns.createIndex('by_read', 'is_read')

        // activity_logs
        db.createObjectStore('activity_logs', { keyPath: 'id', autoIncrement: true })

        // settings
        db.createObjectStore('settings', { keyPath: 'key' })

        // snapshots
        const snaps = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true })
        snaps.createIndex('by_website', 'website_id')
      }

      if (oldVersion < 2) {
        // session_cookies — one encrypted session cookie per website for proxy auth
        const sc = db.createObjectStore('session_cookies', { keyPath: 'id', autoIncrement: true })
        sc.createIndex('by_website', 'website_id')
      }
    },
  })
  return _db
}

export function now(): string {
  return new Date().toISOString()
}

export function nextId(): number {
  return Date.now() + Math.floor(Math.random() * 1000)
}
