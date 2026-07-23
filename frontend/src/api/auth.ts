import api from './client'

export interface AuthStatus {
  website_id: number
  authenticated: boolean
  saved_at: string | null
}

export interface SessionState {
  status: 'starting' | 'ready' | 'logged_in' | 'error' | 'closed'
  current_url: string
  error_message: string | null
  image: string | null           // base64 JPEG, null while starting
  viewport: { width: number; height: number }
}

export interface StartSessionResult {
  session_id: string
  status: string
  viewport: { width: number; height: number }
}

export async function startAuthSession(
  website_id: number,
  login_url: string,
  name: string,
): Promise<StartSessionResult> {
  const { data } = await api.post('/auth/session/start', { website_id, login_url, name })
  return data
}

export async function pollScreenshot(session_id: string): Promise<SessionState> {
  const { data } = await api.get(`/auth/session/${session_id}/screenshot`)
  return data
}

export async function sendInteraction(
  session_id: string,
  interaction: {
    action: 'click' | 'type' | 'key' | 'scroll' | 'navigate'
    x?: number
    y?: number
    text?: string
    key?: string
    delta_y?: number
    url?: string
  },
): Promise<{ status: string; current_url: string }> {
  const { data } = await api.post(`/auth/session/${session_id}/interact`, interaction)
  return data
}

export async function saveSession(session_id: string): Promise<{ success: boolean; cookie_count: number }> {
  const { data } = await api.post(`/auth/session/${session_id}/save`)
  return data
}

export async function closeSession(session_id: string): Promise<void> {
  await api.delete(`/auth/session/${session_id}`)
}

export async function getAuthStatus(website_id: number): Promise<AuthStatus> {
  const { data } = await api.get(`/auth/status/${website_id}`)
  return data
}

export async function logout(website_id: number): Promise<void> {
  await api.delete(`/auth/logout/${website_id}`)
}
