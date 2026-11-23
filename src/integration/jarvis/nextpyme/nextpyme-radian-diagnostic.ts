/** Bounded, selected provider diagnostics for server logs only. */
export function radianProviderDiagnostic(payload: unknown, token: string) {
  const messages = new Set<string>();
  const statusCodes = new Set<string>();
  const pending = [{ value: payload, message: false, depth: 0 }];
  const seen = new Set<object>();
  let visited = 0;
  const sanitize = (value: string) => value
    .split(token).join('[REDACTED]')
    .replace(/Bearer\s+[^\s,"<>]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|contrase[nñ]a|token|secret|authorization|api[_-]?key)\s*["']?\s*[:=]\s*["']?)[^\s,"'<>]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b[a-f0-9]{96}\b/gi, '[CUFE]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[EMAIL]')
    .replace(/[\r\n\t\x00-\x1f]+/g, ' ')
    .slice(0, 500);
  while (pending.length && ++visited <= 150) {
    const item = pending.shift()!;
    if (item.depth > 12) continue;
    if (typeof item.value === 'string') {
      const text = item.value.trim();
      if ((text.startsWith('{') || text.startsWith('[')) && text.length < 20000) {
        try { pending.push({ ...item, value: JSON.parse(text), depth: item.depth + 1 }); } catch { /* Not JSON. */ }
      }
      if (item.message && text && !text.includes('<') && !/^[A-Za-z0-9+/=]{150,}$/.test(text) && messages.size < 4)
        messages.add(sanitize(text));
      continue;
    }
    if (!item.value || typeof item.value !== 'object' || seen.has(item.value)) continue;
    seen.add(item.value);
    if (Array.isArray(item.value)) {
      pending.push(...item.value.slice(0, 10).map(value => ({ ...item, value, depth: item.depth + 1 })));
      continue;
    }
    for (const [key, value] of Object.entries(item.value).slice(0, 30)) {
      const normalized = key.split(':').pop()!.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (/password|token|secret|authorization|credential|xml|base64|certificate/i.test(normalized)) continue;
      if (['statuscode', 'errorcode'].includes(normalized) && /^[a-z0-9_-]{1,12}$/i.test(String(value)) && statusCodes.size < 4)
        statusCodes.add(String(value));
      const message = ['message', 'errormessage', 'statusmessage', 'statusdescription', 'faultstring', 'faultreason', 'error', 'errors', 'detail', 'errordescription'].includes(normalized)
        || (item.message && ['string', 'text', 'reason'].includes(normalized));
      if (pending.length < 150) pending.push({ value, message, depth: item.depth + 1 });
    }
  }
  return { providerMessages: [...messages], providerStatusCodes: [...statusCodes], responseType: Array.isArray(payload) ? 'array' : payload === null ? 'null' : typeof payload };
}
