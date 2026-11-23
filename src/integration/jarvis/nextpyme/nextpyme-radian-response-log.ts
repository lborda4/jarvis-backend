/** Schema allowlist: no arbitrary provider text, object keys or personal data enter server logs. */
export function radianResponseForLog(payload: unknown, _token: string): unknown {
  const containers = new Set(['responsedian', 'envelope', 'body', 'getstatuseventresponse', 'getstatuseventresult', 'dianresponse', 'events', 'event', 'eventos', 'errormessage', 'errors', 'fault', 'result']);
  const scalars = new Set(['success', 'ok', 'isvalid', 'statuscode', 'errorcode', 'eventcode', 'eventid', 'responsecode', 'code', 'status', 'statusdescription', 'statusmessage', 'message', 'string', 'nil', 'mustunderstand']);
  const knownMessages = new Set(['Consulta de eventos generada con exito', 'Consulta generada con éxito', 'EL CUFE o Factura consultada no tiene a la fecha eventos asociados.']);
  const knownStatuses = new Set(['sent', 'failed', 'rejected', 'unknown', 'pending', 'processing', 'sending']);
  const seen = new WeakSet<object>();
  let visited = 0;
  const visit = (value: unknown, field = '', depth = 0): unknown => {
    if (++visited > 1500 || depth > 25) return '[LIMIT]';
    if (value == null) return value;
    if (typeof value !== 'object') {
      if (typeof value === 'string' && containers.has(field) && value.length < 100000) {
        try { return JSON.stringify(visit(JSON.parse(value), field, depth + 1)); } catch { /* Not JSON. */ }
      }
      if (['success', 'ok', 'isvalid', 'nil', 'mustunderstand'].includes(field))
        return typeof value === 'boolean' || (typeof value === 'number' && [0, 1].includes(value)) || (typeof value === 'string' && /^\s*(true|false|0|1)\s*$/i.test(value)) ? value : { redactedType: typeof value };
      if (['statuscode', 'errorcode', 'eventcode', 'eventid', 'responsecode', 'code'].includes(field))
        return (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999) || (typeof value === 'string' && /^\s*\d{1,3}\s*$/.test(value)) ? value : { redactedType: typeof value };
      if (field === 'status' && typeof value === 'string' && knownStatuses.has(value)) return value;
      if (typeof value === 'string' && knownMessages.has(value)) return value;
      return { redactedType: typeof value };
    }
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    if (Array.isArray(value)) return { arrayLength: value.length, items: value.slice(0, 10).map(child => visit(child, field, depth + 1)) };
    const result: Record<string, unknown> = {};
    let omittedFields = 0;
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.split(':').pop()!.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const wrapper = ['value', 'text', 'attributes'].includes(normalized);
      if (containers.has(normalized) || scalars.has(normalized) || wrapper)
        result[normalized] = visit(child, wrapper ? field : normalized, depth + 1);
      else omittedFields++;
    }
    if (omittedFields) result.omittedFields = omittedFields;
    return result;
  };
  return visit(payload);
}
