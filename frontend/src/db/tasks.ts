import { getDB, Task, TaskStatus, TaskCategory, now, nextId } from './index'
import { logActivity } from './activity'

export async function getTasks(filters?: {
  status?: TaskStatus
  website_id?: number
  category?: TaskCategory
  search?: string
}): Promise<Task[]> {
  const db = await getDB()
  let tasks: Task[]

  if (filters?.status) {
    tasks = await db.getAllFromIndex('tasks', 'by_status', filters.status)
  } else if (filters?.website_id !== undefined) {
    tasks = await db.getAllFromIndex('tasks', 'by_website', filters.website_id)
  } else {
    tasks = await db.getAll('tasks')
  }

  if (filters?.category) tasks = tasks.filter(t => t.category === filters.category)
  if (filters?.website_id !== undefined && !filters?.status) {
    tasks = tasks.filter(t => t.website_id === filters.website_id)
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase()
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q)
    )
  }

  return tasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

export async function getTaskById(id: number): Promise<Task | undefined> {
  const db = await getDB()
  return db.get('tasks', id)
}

export async function createTask(data: Omit<Task, 'id' | 'created_at' | 'time_spent_seconds'>): Promise<Task> {
  const db = await getDB()
  const task: Task = {
    ...data,
    id: nextId(),
    created_at: now(),
    time_spent_seconds: 0,
  }
  await db.put('tasks', task)
  await logActivity(`Task created: ${task.title}`, undefined, 'task', task.id)
  return task
}

export async function updateTask(id: number, data: Partial<Omit<Task, 'id' | 'created_at'>>): Promise<Task> {
  const db = await getDB()
  const existing = await db.get('tasks', id)
  if (!existing) throw new Error('Task not found')

  const prevStatus = existing.status
  const updated: Task = {
    ...existing,
    ...data,
    updated_at: now(),
  }

  // Auto-set timestamps on status changes
  if (data.status && data.status !== prevStatus) {
    if (data.status === 'in_progress' && !updated.started_at) updated.started_at = now()
    if (data.status === 'completed' && !updated.completed_at) updated.completed_at = now()
  }

  await db.put('tasks', updated)
  if (data.status && data.status !== prevStatus) {
    await logActivity(
      `Task ${data.status.replace('_', ' ')}: ${existing.title}`,
      `Reward: $${existing.reward.toFixed(2)}`,
      'task',
      id,
    )
  }
  return updated
}

export async function deleteTask(id: number): Promise<void> {
  const db = await getDB()
  const task = await db.get('tasks', id)
  await db.delete('tasks', id)
  if (task) await logActivity(`Task deleted: ${task.title}`, undefined, 'task', id)
}

export async function getTaskStats() {
  const tasks = await getTasks()
  const completed = tasks.filter(t => t.status === 'completed')
  const pending = tasks.filter(t => t.status === 'pending')
  const in_progress = tasks.filter(t => t.status === 'in_progress')
  const skipped = tasks.filter(t => t.status === 'skipped')

  const totalEarnings = completed.reduce((s, t) => s + t.reward, 0)

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayTasks = completed.filter(t => (t.completed_at ?? '').slice(0, 10) === todayStr)
  const todaySeconds = todayTasks.reduce((s, t) => s + t.time_spent_seconds, 0)

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const weekTasks = completed.filter(t => new Date(t.completed_at ?? 0) > weekAgo)
  const weekSeconds = weekTasks.reduce((s, t) => s + t.time_spent_seconds, 0)

  return {
    total_earnings: totalEarnings,
    tasks_completed: completed.length,
    tasks_pending: pending.length,
    tasks_in_progress: in_progress.length,
    tasks_skipped: skipped.length,
    time_spent_today_seconds: todaySeconds,
    time_spent_week_seconds: weekSeconds,
  }
}

export async function getDailyStats(days = 14): Promise<Array<{
  date: string; earnings: number; tasks_completed: number; time_spent_seconds: number
}>> {
  const tasks = await getTasks({ status: 'completed' })
  const map: Record<string, { earnings: number; tasks_completed: number; time_spent_seconds: number }> = {}

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    map[d.toISOString().slice(0, 10)] = { earnings: 0, tasks_completed: 0, time_spent_seconds: 0 }
  }

  for (const t of tasks) {
    const dateKey = (t.completed_at ?? t.created_at).slice(0, 10)
    if (map[dateKey]) {
      map[dateKey].earnings += t.reward
      map[dateKey].tasks_completed++
      map[dateKey].time_spent_seconds += t.time_spent_seconds
    }
  }

  return Object.entries(map).map(([date, v]) => ({ date, ...v }))
}

export async function getEarningsByWebsite(websites: Array<{ id: number; name: string }>) {
  const tasks = await getTasks()
  return websites.map(w => {
    const wtasks = tasks.filter(t => t.website_id === w.id)
    const completed = wtasks.filter(t => t.status === 'completed')
    return {
      website_id: w.id,
      website_name: w.name,
      total_earnings: completed.reduce((s, t) => s + t.reward, 0),
      task_count: wtasks.length,
      completed_count: completed.length,
    }
  }).filter(w => w.task_count > 0)
}

export async function getEarningsByCategory() {
  const tasks = await getTasks()
  const map: Record<string, { total_earnings: number; task_count: number; completed_count: number }> = {}
  for (const t of tasks) {
    if (!map[t.category]) map[t.category] = { total_earnings: 0, task_count: 0, completed_count: 0 }
    map[t.category].task_count++
    if (t.status === 'completed') {
      map[t.category].completed_count++
      map[t.category].total_earnings += t.reward
    }
  }
  return Object.entries(map).map(([category, v]) => ({ category, ...v }))
}
