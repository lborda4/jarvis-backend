import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { payrollWorkedTime } from './payroll-employment';
import type { PayrollInput, PayrollWorker } from './payroll-domain';

export function payrollPredecessor(original: any) {
  if (!original || original.status !== 'ACCEPTED' || !original.cune || original.number == null || !original.prefix || original.state?.noteType === 2)
    throw new BadRequestException('Selecciona un documento aceptado que no esté anulado para ajustar.');
  const number = String(original.number);
  return {
    predecessor_number: number.startsWith(original.prefix) ? number : `${original.prefix}${number}`,
    predecessor_cune: original.cune,
    predecessor_issue_date: original.state.issueDate,
  };
}

export function payrollAdjustmentState(original: any, noteType: 1 | 2, changes: any, now = new Date()) {
  payrollPredecessor(original);
  if (![1, 2].includes(noteType)) throw new BadRequestException('El tipo de ajuste es inválido.');
  const state = structuredClone(original.state);
  for (const key of ['monthlyDocumentId', 'monthlyConsolidation', 'payrollGroupId', 'duplicationSourceKey', 'duplicatedFromDocumentId', 'adjustmentRequestKey']) delete state[key];
  state.employeeId = original.employee_id;
  state.originalId = original.id;
  state.noteType = noteType;
  state.issueDate = changes?.issueDate ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(now);
  state.notes = typeof changes?.notes === 'string' ? changes.notes.trim() : '';
  if (!state.notes || state.notes.length > 2000) throw new BadRequestException('Indica el motivo del ajuste (máximo 2000 caracteres).');
  // El navegador solo puede modificar las novedades, días y motivo del reemplazo.
  // Las referencias y fechas del período se toman del documento aceptado.
  if (noteType === 1 && changes) {
    if (changes.lines !== undefined) state.lines = structuredClone(changes.lines);
    if (changes.workedDays !== undefined) state.workedDays = changes.workedDays;
  }
  state.lines = state.lines.map((line: any) => ({ ...line, id: randomUUID() }));
  return state;
}

/** Eliminación: no se reenvían devengos, deducciones ni datos bancarios. */
export function buildPayrollDeletionPayload(state: PayrollInput, worker: PayrollWorker, number: number, prefix: string, predecessor: ReturnType<typeof payrollPredecessor>) {
  return {
    type_document_id: 10, type_note: 2, prefix, consecutive: number,
    head_note: state.headNote ?? '', foot_note: state.footNote ?? '', notes: state.notes ?? '',
    predecessor, payroll_period_id: state.payrollPeriodId,
    period: { admision_date: worker.admittanceDate, settlement_start_date: state.startDate,
      settlement_end_date: state.endDate, worked_time: payrollWorkedTime(state.endDate, worker), issue_date: state.issueDate },
  };
}

export function payrollAdjustmentProjection(rootId: string, notes: any[]) {
  let currentId = rootId;
  let adjustment: any;
  const visited = new Set<string>();
  while (!visited.has(currentId)) {
    visited.add(currentId);
    const children = notes.filter(note => note.original_id === currentId);
    const note = children.find(note => note.status === 'ACCEPTED') ?? children[0];
    if (!note) break;
    adjustment = { id: note.id, status: note.status, noteType: note.state.noteType, number: note.number, prefix: note.prefix };
    if (note.status !== 'ACCEPTED') break;
    if (note.state.noteType === 2) return { adjustmentTargetId: null, adjustment };
    currentId = note.id;
  }
  return { adjustmentTargetId: currentId, adjustment };
}
