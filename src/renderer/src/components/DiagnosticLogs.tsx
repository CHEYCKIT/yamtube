import { useState } from 'react'

export function DiagnosticLogs() {
  const [logs, setLogs] = useState<{ path: string; contents: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setMessage(null)
    try { setLogs(await window.api.getDiagnostics()) }
    catch { setMessage('Could not load logs. Try again.') }
  }
  return <section className="grid gap-3">
    <h2 className="border-b border-neutral-800 pb-2 text-base font-semibold">Logs</h2>
    <p className="text-sm text-neutral-400">Recent playback, network and application errors. Logs stay on this device; cookies and authentication tokens are redacted.</p>
    <div className="flex flex-wrap gap-2">
      <button className="rounded bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700" onClick={() => void refresh()}>{logs ? 'Refresh logs' : 'View logs'}</button>
      {logs && <button className="rounded px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-800" onClick={() => setLogs(null)}>Hide logs</button>}
      <button disabled={busy} className="rounded bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50" onClick={async () => {
        setBusy(true); setMessage(null)
        try { const path = await window.api.exportDiagnostics(); if (path) setMessage(`Logs exported to ${path}`) }
        catch { setMessage('Could not export logs. Try again.') }
        finally { setBusy(false) }
      }}>{busy ? 'Exporting…' : 'Export logs'}</button>
    </div>
    {logs && <div className="grid gap-2"><p className="break-all text-xs text-neutral-500">{logs.path}</p>
      <pre aria-label="Recent diagnostic logs" className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{logs.contents || 'No log entries yet.'}</pre></div>}
    {message && <p role="status" className="break-words text-sm text-neutral-300">{message}</p>}
  </section>
}
