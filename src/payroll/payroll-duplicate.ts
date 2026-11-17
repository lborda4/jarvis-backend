import { randomUUID } from 'crypto';
import type { PayrollInput } from './payroll-domain';

/** Copies novelty values only. Document identities, transmission data and period metadata are new. */
export function duplicatePayrollNovelties(source: PayrollInput, target: { startDate: string; endDate: string }) {
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`);
  const start = day(target.startDate), end = day(target.endDate), original = day(source.startDate);
  const shift = (date: string) => {
    if (date === source.endDate) return target.endDate;
    const value = Math.max(start, Math.min(end, start + day(date) - original));
    return new Date(value).toISOString().slice(0, 10);
  };
  const lines = source.lines.map(line => {
    const copied = { ...line, id: randomUUID(), manual: true };
    delete copied.formula;
    if (line.startDate) copied.startDate = shift(line.startDate);
    if (line.endDate) copied.endDate = shift(line.endDate);
    if (line.startTime && line.endTime) {
      const duration = Date.parse(line.endTime.slice(0, 19) + 'Z') - Date.parse(line.startTime.slice(0, 19) + 'Z');
      let from = Date.parse(shift(line.startTime.slice(0, 10)) + line.startTime.slice(10, 19) + 'Z');
      let to = from + duration;
      if (to >= end + 86400000) {
        to = Date.parse(shift(line.endTime.slice(0, 10)) + line.endTime.slice(10, 19) + 'Z');
        from = to - duration;
      }
      copied.startTime = new Date(from).toISOString().slice(0, 19);
      copied.endTime = new Date(to).toISOString().slice(0, 19);
      if (line.startDate) copied.startDate = copied.startTime.slice(0, 10);
      if (line.endDate) copied.endDate = copied.endTime.slice(0, 10);
    }
    return copied;
  });
  return { lines, workedDays: source.workedDays,
    ...(source.epsTypeLawDeductionsId !== undefined ? { epsTypeLawDeductionsId: source.epsTypeLawDeductionsId } : {}),
    ...(source.pensionTypeLawDeductionsId !== undefined ? { pensionTypeLawDeductionsId: source.pensionTypeLawDeductionsId } : {}),
    ...(source.notes !== undefined ? { notes: source.notes } : {}),
    ...(source.headNote !== undefined ? { headNote: source.headNote } : {}),
    ...(source.footNote !== undefined ? { footNote: source.footNote } : {}),
  };
}
