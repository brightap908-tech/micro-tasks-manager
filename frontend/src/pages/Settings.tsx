import { useState, useRef } from 'react'
import { Download, Upload, Database, Shield, HardDrive, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { getDB } from '../db/index'
import { getAllSettings } from '../db/settings'
import { clearActivityLogs } from '../db/activity'
import { clearAllNotifications } from '../db/notifications'

async function exportAllData(): Promise<object> {
  const db = await getDB()
  const [
    website_folders, websites, credentials, tasks,
    notifications, activity_logs, settings, snapshots,
  ] = await Promise.all([
    db.getAll('website_folders'),
    db.getAll('websites'),
    db.getAll('credentials'),
    db.getAll('tasks'),
    db.getAll('notifications'),
    db.getAll('activity_logs'),
    db.getAll('settings'),
    db.getAll('snapshots'),
  ])
  return {
    version: 2,
    exported_at: new Date().toISOString(),
    website_folders, websites, credentials, tasks,
    notifications, activity_logs, settings, snapshots,
  }
}

async function importAllData(data: Record<string, unknown[]>) {
  const db = await getDB()

  const stores = [
    'website_folders', 'websites', 'credentials', 'tasks',
    'notifications', 'activity_logs', 'settings', 'snapshots',
  ] as const

  for (const store of stores) {
    await db.clear(store)
    const rows = data[store] ?? []
    for (const row of rows) {
      // @ts-expect-error dynamic store write
      await db.put(store, row)
    }
  }
}

async function clearAllData() {
  const db = await getDB()
  const stores = [
    'website_folders', 'websites', 'credentials', 'tasks',
    'notifications', 'activity_logs', 'settings', 'snapshots',
  ] as const
  for (const store of stores) {
    await db.clear(store)
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function SettingsPage() {
  const [importing, setImporting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    try {
      const data = await exportAllData()
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `microtask-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup exported successfully')
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleImport = async (file: File) => {
    setImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text) as Record<string, unknown[]>
      if (!data.version || !data.websites) {
        throw new Error('Invalid backup file — missing required fields')
      }
      await importAllData(data)
      toast.success('Data restored! Reload the page to see changes.')
      window.location.reload()
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleClearAll = async () => {
    setClearing(true)
    try {
      await clearAllData()
      toast.success('All data cleared')
      window.location.reload()
    } catch (e) {
      toast.error(`Clear failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setClearing(false)
      setConfirmClear(false)
    }
  }

  const handleClearLogs = async () => {
    try {
      await clearActivityLogs()
      await clearAllNotifications()
      toast.success('Logs and notifications cleared')
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="hidden sm:block text-2xl font-bold text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500">Data management and local storage controls</p>
      </div>

      {/* Storage info */}
      <div className="card border border-brand-800/40 bg-brand-900/10">
        <div className="flex items-start gap-3">
          <HardDrive size={18} className="text-brand-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-200">Local Storage Only</h3>
            <p className="text-sm text-slate-400 mt-1">
              All data — tasks, websites, credentials, settings, and activity history — is stored
              exclusively in your browser's <strong className="text-slate-300">IndexedDB</strong>.
              Nothing is sent to any server or cloud database.
              The app works completely offline. Use the export/import buttons below to back up
              or migrate your data.
            </p>
          </div>
        </div>
      </div>

      {/* Security info */}
      <div className="card border border-slate-700/40">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-green-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-200">Credential Encryption</h3>
            <p className="text-sm text-slate-400 mt-1">
              Passwords are encrypted with <strong className="text-slate-300">AES-GCM 256-bit</strong> encryption
              using the Web Crypto API before being saved to IndexedDB. The encryption key is
              generated randomly and stored in <code className="text-brand-300 bg-slate-800 px-1 py-0.5 rounded text-xs">localStorage</code>.
              Clearing browser data will permanently delete the key — export your backup first.
            </p>
          </div>
        </div>
      </div>

      {/* Backup & Restore */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Database size={16} className="text-slate-400" /> Backup & Restore
        </h2>
        <p className="text-xs text-slate-500">
          Export all your data as a JSON file. Import it later on the same or a different device to restore everything.
        </p>

        <div className="flex gap-3 flex-wrap">
          <button className="btn-primary" onClick={handleExport}>
            <Download size={15} /> Export Backup
          </button>

          <button
            className="btn-secondary"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            <Upload size={15} />
            {importing ? 'Importing…' : 'Import Backup'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleImport(f)
            }}
          />
        </div>

        <div className="bg-slate-800/50 rounded-lg px-4 py-3 text-xs text-slate-400 space-y-1">
          <p>📦 <strong>Export</strong> — saves a <code>.json</code> file with all websites, tasks, credentials (encrypted), and settings.</p>
          <p>📥 <strong>Import</strong> — replaces ALL current data with the backup file. This cannot be undone.</p>
        </div>
      </div>

      {/* Data management */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Trash2 size={16} className="text-slate-400" /> Data Management
        </h2>

        <div className="space-y-3">
          <div className="flex items-center justify-between py-3 border-b border-slate-800">
            <div>
              <p className="text-sm text-slate-200">Clear logs & notifications</p>
              <p className="text-xs text-slate-500">Removes activity history and all notifications</p>
            </div>
            <button className="btn-secondary text-xs" onClick={handleClearLogs}>
              <Trash2 size={13} /> Clear
            </button>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-red-400 font-medium">Clear all data</p>
              <p className="text-xs text-slate-500">Permanently deletes ALL local data including tasks, websites, credentials, and settings</p>
            </div>
            {!confirmClear ? (
              <button
                className="btn-secondary text-xs text-red-400 hover:text-red-300 hover:border-red-500/40"
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 size={13} /> Clear All
              </button>
            ) : (
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={() => setConfirmClear(false)}>Cancel</button>
                <button
                  className="bg-red-600 hover:bg-red-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  onClick={handleClearAll}
                  disabled={clearing}
                >
                  {clearing ? 'Clearing…' : 'Yes, clear everything'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* About */}
      <div className="card space-y-2">
        <h2 className="text-sm font-semibold text-slate-300">About</h2>
        <p className="text-sm text-slate-500">
          <strong className="text-slate-300">Microtask Manager</strong> v2.0.0 — A private, offline-first
          productivity dashboard for organizing work across multiple microtask platforms.
          All data is stored locally in your browser's IndexedDB — no accounts, no cloud, no tracking.
        </p>
        <p className="text-xs text-slate-600">
          ⚠️ This tool does not automate, submit, or falsely complete any tasks. All completions require explicit user confirmation.
        </p>
      </div>
    </div>
  )
}
