import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

export default api

// ── Sync-only types (used by the backend proxy) ────────────────────────────

export interface SyncRequest {
  url: string
  name: string
}

export interface SyncResult {
  status: 'ok' | 'auth_required' | 'error'
  available_balance: number | null
  available_tasks: number | null
  pending_tasks: number | null
  completed_tasks: number | null
  total_earnings: number | null
  page_title: string | null
  error_message: string | null
  error_detail: string | null
  synced_at: string
  http_status: number | null
}

export async function syncWebsite(url: string, name: string, cookies?: string | null): Promise<SyncResult> {
  const { data } = await api.post<SyncResult>('/sync/fetch', { url, name, cookies: cookies ?? null })
  return data
}
