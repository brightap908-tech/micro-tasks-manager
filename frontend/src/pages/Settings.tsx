import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload, Database, Shield, Puzzle, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api/client'

interface Plugin { plugin_id: string; plugin_name: string; description: string }
interface Backup { filename: string; size_bytes: number; created_at: string }

export default function SettingsPage() {
  const qc = useQueryClient()
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoring, setRestoring] = useState(false)

  const { data: plugins = [] } = useQuery<Plugin[]>({
    queryKey: ['plugins'],
    queryFn: () => api.get('/settings/plugins/list').then(r => r.data),
  })

  const { data: backups = [], refetch: refetchBackups } = useQuery<Backup[]>({
    queryKey: ['backups'],
    queryFn: () => api.get('/settings/backup/list').then(r => r.data),
  })

  const createBackup = useMutation({
    mutationFn: () => api.post('/settings/backup'),
    onSuccess: () => {
      toast.success('Backup created successfully')
      refetchBackups()
    },
    onError: () => toast.error('Backup failed'),
  })

  const handleRestore = async () => {
    if (!restoreFile) return
    setRestoring(true)
    const form = new FormData()
    form.append('file', restoreFile)
    try {
      await api.post('/settings/restore', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success('Database restored! Please reload the page.')
      setRestoreFile(null)
    } catch {
      toast.error('Restore failed. Make sure the file is a valid .json backup.')
    } finally {
      setRestoring(false)
    }
  }

  const exportSettings = () => { window.open('/api/settings/export/json', '_blank') }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="hidden sm:block text-2xl font-bold text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500">Database management, backups, and plugin configuration</p>
      </div>

      {/* Security info */}
      <div className="card border border-brand-800/40 bg-brand-900/10">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-brand-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-200">Security</h3>
            <p className="text-sm text-slate-400 mt-1">
              All credentials are encrypted with Fernet symmetric encryption before being stored.
              The encryption key is read from the{' '}
              <code className="text-brand-300 bg-slate-800 px-1 py-0.5 rounded text-xs break-all">ENCRYPTION_KEY</code>
              {' '}environment variable in production — never rotate this key after credentials are saved.
              Data is persisted in a PostgreSQL cloud database and survives restarts and redeploys.
            </p>
          </div>
        </div>
      </div>

      {/* Database backup */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Database size={16} className="text-slate-400" /> Database Backup
        </h2>

        <div className="flex gap-2 sm:gap-3 flex-wrap">
          <button
            className="btn-primary"
            onClick={() => createBackup.mutate()}
            disabled={createBackup.isPending}
          >
            <Download size={15} />
            {createBackup.isPending ? 'Creating…' : 'Create Backup'}
          </button>
          <button className="btn-secondary" onClick={() => refetchBackups()}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>

        {backups.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-xs text-slate-500 bg-slate-800/50">
                  <th className="text-left px-4 py-2">Filename</th>
                  <th className="text-right px-4 py-2">Size</th>
                  <th className="text-right px-4 py-2">Created</th>
                  <th className="text-right px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {backups.map(b => (
                  <tr key={b.filename} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 text-slate-300 font-mono text-xs max-w-[160px] truncate">{b.filename}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 text-xs whitespace-nowrap">
                      {(b.size_bytes / 1024).toFixed(1)} KB
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 text-xs whitespace-nowrap">
                      {new Date(b.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/settings/backup/download/${b.filename}`}
                        className="text-xs text-brand-400 hover:text-brand-300 transition-colors whitespace-nowrap"
                        download
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Restore */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Upload size={16} className="text-yellow-400" /> Restore from Backup
        </h2>
        <p className="text-xs text-slate-500">
          Upload a <code className="bg-slate-800 px-1 rounded">.json</code> backup file to restore all data.
          All existing records will be replaced with the contents of the backup.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <input
            type="file"
            accept=".json"
            className="text-sm text-slate-400 file:btn-secondary file:mr-3 file:cursor-pointer flex-1"
            onChange={e => setRestoreFile(e.target.files?.[0] ?? null)}
          />
          {restoreFile && (
            <button
              className="btn-primary shrink-0"
              onClick={handleRestore}
              disabled={restoring}
            >
              <Upload size={15} />
              {restoring ? 'Restoring…' : 'Restore Database'}
            </button>
          )}
        </div>
      </div>

      {/* Export settings */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-300">Export Settings</h2>
        <button className="btn-secondary" onClick={exportSettings}>
          <Download size={15} /> Export Settings as JSON
        </button>
      </div>

      {/* Plugins */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Puzzle size={16} className="text-purple-400" /> Website Adapter Plugins
        </h2>
        <p className="text-xs text-slate-500">
          Plugins enable website-specific navigation. Add new adapters in{' '}
          <code className="bg-slate-800 px-1 rounded">backend/plugins/adapters/</code> and
          register them in the plugin registry.
        </p>
        <div className="space-y-2">
          {plugins.map(p => (
            <div key={p.plugin_id} className="flex items-start sm:items-center gap-3 bg-slate-800/50 rounded-lg px-4 py-3">
              <div className="w-2 h-2 rounded-full bg-green-500 shrink-0 mt-1 sm:mt-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200">{p.plugin_name}</p>
                <p className="text-xs text-slate-500">{p.description}</p>
              </div>
              <code className="text-xs text-slate-600 bg-slate-800 px-2 py-0.5 rounded shrink-0">{p.plugin_id}</code>
            </div>
          ))}
        </div>
      </div>

      {/* About */}
      <div className="card space-y-2">
        <h2 className="text-sm font-semibold text-slate-300">About</h2>
        <p className="text-sm text-slate-500">
          <strong className="text-slate-300">Microtask Manager</strong> v1.0.0 — A private productivity dashboard
          for organizing work across multiple microtask platforms. Data is persisted in PostgreSQL.
        </p>
        <p className="text-xs text-slate-600">
          ⚠️ This tool does not automate, submit, or falsely complete any tasks. All completions require explicit user confirmation.
        </p>
      </div>
    </div>
  )
}
