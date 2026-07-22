import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

export default api

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'
export type TaskCategory =
  | 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'telegram'
  | 'x' | 'linkedin' | 'discord' | 'website_visit' | 'survey'
  | 'app_install' | 'other'

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
  task_count?: number
  completed_tasks?: number
  total_earnings?: number
  folder?: WebsiteFolder
}

export interface WebsiteFolder {
  id: number
  name: string
  color: string
  created_at: string
}

export interface Credential {
  id: number
  website_id: number
  username: string
  notes?: string
  last_used?: string
  created_at: string
}

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
  website?: Website
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
  type: string
  is_read: boolean
  website_id?: number
  created_at: string
}

export interface DashboardStats {
  total_earnings: number
  tasks_completed: number
  tasks_pending: number
  tasks_in_progress: number
  tasks_skipped: number
  connected_websites: number
  active_websites: number
  time_spent_today_seconds: number
  time_spent_week_seconds: number
  // Sync-enriched fields
  available_balance: number
  last_sync_at: string | null
  sync_status: 'never' | 'ok' | 'partial' | 'error'
}

export interface WebsiteSyncResult {
  website_id: number
  website_name: string
  status: 'ok' | 'auth_required' | 'error'
  available_balance: number | null
  available_tasks: number | null
  page_title: string | null
  error_message: string | null
  synced_at: string
}

export interface SyncAllResult {
  total: number
  succeeded: number
  results: WebsiteSyncResult[]
}

export interface DailyStats {
  date: string
  earnings: number
  tasks_completed: number
  time_spent_seconds: number
}

export interface EarningsByWebsite {
  website_id: number
  website_name: string
  total_earnings: number
  task_count: number
  completed_count: number
}

export interface EarningsByCategory {
  category: string
  total_earnings: number
  task_count: number
  completed_count: number
}

export interface ActivityLog {
  id: number
  action: string
  details?: string
  entity_type?: string
  entity_id?: number
  created_at: string
}
