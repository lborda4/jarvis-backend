import { collectRecords } from '../integration/jarvis/nextpyme/nextpyme-record-scan.helper';
export function payrollCune(response: unknown): string | null {
  for (const record of collectRecords(response, { parseJsonStrings: true })) {
    for (const [key, value] of Object.entries(record)) {
      if (typeof value !== 'string') continue;
      if (
        /^(cune|uuiddian|xmldocumentkey)$/i.test(key.replace(/_/g, '')) &&
        /^[a-f0-9]{64,96}$/i.test(value)
      )
        return value;
      const match = /CUNE\s+([a-f0-9]{64,96})/i.exec(value);
      if (match) return match[1];
    }
  }
  return null;
}
export function payrollFiles(
  response: unknown,
): { kind: 'pdf' | 'xml'; filename: string }[] {
  const result: { kind: 'pdf' | 'xml'; filename: string }[] = [];
  for (const record of collectRecords(response, { parseJsonStrings: true }))
    for (const [key, value] of Object.entries(record)) {
      if (typeof value !== 'string' || !/(pdf|xml)/i.test(key)) continue;
      const filename = value.split('/').at(-1) ?? '';
      if (/^[A-Za-z0-9_.-]+\.(pdf|xml)$/i.test(filename))
        result.push({
          kind: filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'xml',
          filename,
        });
    }
  return result.filter(
    (file, index) =>
      result.findIndex((f) => f.filename === file.filename) === index,
  );
}
