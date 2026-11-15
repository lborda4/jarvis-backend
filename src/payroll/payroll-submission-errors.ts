/** Extract user-facing validation messages without displaying payloads or stack traces. */
export function payrollSubmissionErrors(value: unknown): string[] {
  const messages = new Set<string>()
  const visit = (item: unknown, text = false, depth = 0) => {
    if (depth > 16 || messages.size >= 20) return
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (/^[\[{]/.test(trimmed)) {
        try { visit(JSON.parse(trimmed), text, depth + 1); return } catch { /* plain text */ }
      }
      if (text && trimmed && !/^(Bad Request|Service Unavailable|Conflict|Internal Server Error)$/i.test(trimmed) && !/<[^>]+>|\bat \S+.*:\d+:\d+/.test(trimmed))
        trimmed.split(/\s*\|\s*|\r?\n/).forEach(message => {
          if (message.trim() && messages.size < 20 && !/^AttachedDocument\b.*generad[oa].*(?:éxito|exito)/i.test(message.trim())) messages.add(message.trim().slice(0, 1000))
        })
      return
    }
    if (Array.isArray(item)) { item.forEach(row => visit(row, text || typeof row === 'string', depth + 1)); return }
    if (!item || typeof item !== 'object') return
    for (const [key, child] of Object.entries(item)) {
      if (/token|authorization|stack|request|payload/i.test(key)) continue
      const normalized = key.replace(/_/g, '').toLowerCase()
      const isMessage = /^(error|errors|message|errormessage|statusdescription|statusmessage|string)$/.test(normalized)
      if (isMessage || typeof child === 'object' || (typeof child === 'string' && /^[\[{]/.test(child.trim()))) visit(child, isMessage || text, depth + 1)
      else if (text) visit(child, true, depth + 1)
    }
  }
  visit(value, typeof value === 'string')
  return [...messages]
}
