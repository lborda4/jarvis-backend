import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface InvoiceRadianStatus { accepted: boolean; eventCodes: string[] }

const keyName = (key: string) => key.split(':').pop()!.replace(/[^a-z0-9]/gi, '').toLowerCase();
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const scalar = (value: unknown): unknown => record(value) ? scalar(value._value ?? value['#text']) : value;
const field = (value: Record<string, unknown>, names: string[]) => Object.entries(value).find(([key]) => names.includes(keyName(key)))?.[1];
const isFalse = (value: unknown) => value === false || value === 'false';
const isTrue = (value: unknown) => value === true || value === 'true';

/** Unknown/error payloads must never be interpreted as an invoice without events. */
export function parseInvoiceRadianStatus(payload: unknown): InvoiceRadianStatus | null {
  let knownCollection = Array.isArray(payload);
  let uncertain = false;
  let failed = false;
  const codes = new Set<string>();
  const pending: Array<{ value: unknown; inEvents: boolean; depth: number }> = [{ value: payload, inEvents: Array.isArray(payload), depth: 0 }];
  let visited = 0;
  while (pending.length) {
    if (++visited > 5000) return null;
    const { value, inEvents, depth } = pending.shift()!;
    if (depth > 30) return null;
    if (typeof value === 'string') {
      const text = value.trim();
      try {
        if (text.startsWith('{') || text.startsWith('[')) pending.push({ value: JSON.parse(text), inEvents, depth: depth + 1 });
      } catch { uncertain = true; }
      continue;
    }
    if (Array.isArray(value)) {
      if (inEvents && value.some(item => !record(item) && !Array.isArray(item))) uncertain = true;
      pending.push(...value.map(item => ({ value: item, inEvents, depth: depth + 1 })));
      continue;
    }
    if (!record(value)) continue;
    if (isFalse(scalar(field(value, ['success', 'ok']))) || field(value, ['fault']) !== undefined) failed = true;
    const rawCode = scalar(field(value, ['eventcode', 'codigoevento', 'responsecode', ...(inEvents ? ['code'] : [])]));
    const eventId = scalar(field(value, ['eventid']));
    const code = rawCode != null ? String(rawCode).trim().padStart(3, '0')
      : eventId != null ? ({ 1: '030', 2: '031', 3: '032', 4: '033', 5: '034', 6: '002', 7: '004' } as Record<string, string>)[String(eventId)] : undefined;
    const valid = scalar(field(value, ['isvalid']));
    const statusCode = scalar(field(value, ['statuscode']));
    const status = String(scalar(field(value, ['status'])) ?? '').toLowerCase();
    const rejected = isFalse(valid) || ['failed', 'rejected'].includes(status);
    if (code && ['030', '031', '032', '033', '034', '002', '004'].includes(code)) {
      knownCollection = true;
      if (!rejected) {
        if (['unknown', 'pending', 'processing', 'sending'].includes(status)) uncertain = true;
        else codes.add(code);
      }
    } else if (inEvents && rawCode != null) uncertain = true;
    let decodedEvent = false;
    for (const [key, child] of Object.entries(value)) {
      const normalized = keyName(key);
      if (['xmlbase64bytes', 'applicationresponsexml'].includes(normalized) && typeof scalar(child) === 'string' && !rejected) {
        const raw = String(scalar(child)).trim();
        const xml = raw.startsWith('<') ? raw : Buffer.from(raw, 'base64').toString('utf8').trim();
        if (!xml.includes('ApplicationResponse') || /<!DOCTYPE|<!ENTITY/i.test(xml) || xml.length > 2_000_000) { uncertain = true; continue; }
        if (XMLValidator.validate(xml) !== true) { uncertain = true; continue; }
        try {
          const xmlNodes: unknown[] = [new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(xml)];
          let xmlVisited = 0;
          while (xmlNodes.length) {
            if (++xmlVisited > 5000) return null;
            const node = xmlNodes.shift();
            if (Array.isArray(node)) xmlNodes.push(...node);
            else if (record(node)) {
              const responseCode = scalar(field(node, ['responsecode']));
              if (responseCode != null && ['030', '031', '032', '033', '034'].includes(String(responseCode))) {
                codes.add(String(responseCode)); knownCollection = true; decodedEvent = true;
              }
              xmlNodes.push(...Object.values(node));
            }
          }
          if (!decodedEvent) uncertain = true;
        } catch { uncertain = true; }
        continue;
      }
      const collection = ['events', 'event', 'eventos', 'dianresponse'].includes(normalized);
      if (collection && (Array.isArray(child) || record(child))) knownCollection = true;
      if (collection && child == null) uncertain = true;
      pending.push({ value: child, inEvents: inEvents || collection, depth: depth + 1 });
    }
    if (inEvents && !code && !decodedEvent && !Object.keys(value).some(key => ['events', 'event', 'eventos', 'dianresponse'].includes(keyName(key)))) uncertain = true;
    if (!inEvents && (isFalse(valid) || (statusCode != null && String(statusCode) !== '00'))) failed = true;
  }
  if (failed) return null;
  if (codes.has('033') || codes.has('034')) return { accepted: true, eventCodes: [...codes] };
  if (!knownCollection || uncertain) return null;
  return { accepted: false, eventCodes: [...codes] };
}
