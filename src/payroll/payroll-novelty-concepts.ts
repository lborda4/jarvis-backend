import { BadRequestException } from '@nestjs/common';
interface Concept { code: string; kind: string; active?: boolean }
export function extendPayrollNoveltyConcepts<T extends { concepts: Concept[] }>(snapshot: T, configured: { concepts?: Concept[] } | undefined, lines: { concept: string; kind: string }[]): T {
  const concepts = [...(snapshot.concepts ?? [])];
  for (const line of lines) {
    if (concepts.some(concept => concept.code === line.concept && concept.kind === line.kind)) continue;
    const added = configured?.concepts?.find(concept => concept.code === line.concept && concept.kind === line.kind && concept.active !== false);
    if (!added) throw new BadRequestException('El concepto no pertenece a la configuración activa de nómina.');
    concepts.push({ ...added });
  }
  return { ...snapshot, concepts };
}
