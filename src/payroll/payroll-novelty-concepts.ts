import { BadRequestException } from '@nestjs/common';
interface Concept { code: string; kind: string; active?: boolean }
const additionalDeductions = [
  ...[{"code":"third_party_payment_deduction","name":"Pagos a terceros deducidos","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"advance","name":"Anticipo","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"other_deduction","name":"Otras deducciones","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"voluntary","name":"Pensión voluntaria","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"withholding","name":"Retención en la fuente","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"afc","name":"Ahorro para el Fomento de la Construcción (AFC)","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"cooperative","name":"Cooperativa","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"garnishment","name":"Embargo fiscal","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"supplementary_plan","name":"Plan complementario de salud","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"education","name":"Deducción por educación","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"refund_deduction","name":"Reintegro deducido","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true},{"code":"debt","name":"Deuda","category":"Deducciones","kind":"deduction","factor":"","percentage":"","base":"manual","salaried":false,"active":true}],
  { code: 'labor_union', name: 'Aporte sindical', category: 'Deducciones', kind: 'deduction', factor: '', percentage: '', base: 'manual', salaried: false, active: true },
  { code: 'sanctions', name: 'Sanciones disciplinarias', category: 'Deducciones', kind: 'deduction', factor: '', percentage: '', base: 'manual', salaried: false, active: true },
];
export function withPayrollAdditionalDeductions<T extends { concepts?: Concept[] }>(parameters: T) {
  const concepts = parameters.concepts ?? [];
  return { ...parameters, concepts: [...concepts, ...additionalDeductions.filter(item => !concepts.some(current => current.code === item.code)).map(item => ({ ...item }))] };
}
export function extendPayrollNoveltyConcepts<T extends { concepts: Concept[] }>(snapshot: T, configured: { concepts?: Concept[] } | undefined, lines: { concept: string; kind: string }[]): T {
  const concepts = [...(snapshot.concepts ?? [])];
  for (const line of lines) {
    if (concepts.some(concept => concept.code === line.concept && concept.kind === line.kind)) continue;
    const added = withPayrollAdditionalDeductions(configured ?? {}).concepts.find(concept => concept.code === line.concept && concept.kind === line.kind && concept.active !== false);
    if (!added) throw new BadRequestException('El concepto no pertenece a la configuración activa de nómina.');
    concepts.push({ ...added });
  }
  return { ...snapshot, concepts };
}
