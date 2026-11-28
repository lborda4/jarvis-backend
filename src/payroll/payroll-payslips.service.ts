import { SHARED_DEMO_COMPANY_ID } from '../advisor/shared-demo.constants';
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import AdmZip from 'adm-zip';
import { createHash } from 'crypto';
import { ResendMailService } from '../auth/services/resend-mail.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validEmail = (value: string) => value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
const name = (worker: any) => [worker.firstName, worker.secondName, worker.surname, worker.secondSurname].filter(Boolean).join(' ');
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

@Injectable()
export class PayrollPayslipsService {
  // Retain the exact attachment for explicit retries with the same provider idempotency key.
  private readonly mailJobs = new Map<string, { created: number; operation: Promise<{ sent: true }>; retry?: () => Promise<{ sent: true }> }>();
  constructor(private readonly db: DataSource, private readonly mail: ResendMailService) {}

  private async records(company: string, ids: unknown) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(ids).size !== ids.length)
      throw new BadRequestException('Selecciona entre 1 y 1000 desprendibles diferentes.');
    const rows = await this.db.query(`SELECT d.*, e.data->>'email' AS "recipientEmail", p.name AS "positionName",
      COALESCE(m.status,d.status) AS "submissionStatus"
      FROM jarvis_payroll_documents d
      LEFT JOIN jarvis_payroll_employees e ON e.company_id=d.company_id AND e.id=d.employee_id
      LEFT JOIN jarvis_payroll_positions p ON p.company_id=d.company_id AND p.id::text=d.employee_snapshot->>'positionId'
      LEFT JOIN jarvis_payroll_documents m ON m.company_id=d.company_id AND m.id::text=d.state->>'monthlyDocumentId'
      WHERE d.company_id=$1 AND d.id=ANY($2::uuid[]) ORDER BY d.id`, [company, ids]);
    if (rows.length !== ids.length) throw new NotFoundException('Un desprendible no existe o no pertenece a esta empresa.');
    if (rows.some((row: any) => row.submissionStatus !== 'ACCEPTED' || row.original_id || row.state.monthlyConsolidation?.generated))
      throw new ConflictException('Los desprendibles deben corresponder a un período de nómina aceptado.');
    const period = (row: any) => JSON.stringify([row.state.startDate, row.state.endDate, row.state.payrollGroupId ?? '']);
    if (rows.some((row: any) => period(row) !== period(rows[0]))) throw new BadRequestException('Selecciona empleados de un mismo período de nómina.');
    return rows;
  }
  async recipients(company: string, ids: unknown) {
    const rows = await this.records(company, ids);
    return rows.map((row: any) => {
      const email = typeof row.recipientEmail === 'string' ? row.recipientEmail.trim() : '';
      return { id: row.id, name: name(row.employee_snapshot), identification: row.employee_snapshot.identification, email, canEmail: validEmail(email) };
    });
  }
  private filename(row: any) {
    const identification = String(row.employee_snapshot.identification).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `Desprendible-${identification}-${row.state.startDate}-${row.state.endDate}-${row.id}.pdf`;
  }
  private async render(company: string, row: any) {
    const [employer] = await this.db.query('SELECT name,nit,is_demo AS "isDemo" FROM companies WHERE id=$1', [company]);
    if (!employer) throw new NotFoundException('No se encontró la empresa.');
    const { generatePayrollPayslip } = await import('./payroll-payslip-pdf.js');
    return { filename: this.filename(row), buffer: await generatePayrollPayslip({ detail: row, company: employer, position: row.positionName }) };
  }
  async pdf(company: string, id: string) {
    const [row] = await this.records(company, [id]);
    return this.render(company, row);
  }
  async zip(company: string, ids: unknown) {
    const rows = await this.records(company, ids);
    const archive = new AdmZip();
    let size = 0;
    for (const row of rows) {
      const pdf = await this.render(company, row);
      size += pdf.buffer.length;
      if (size > 50 * 1024 * 1024) throw new BadRequestException('Selecciona menos empleados para descargar este grupo de desprendibles.');
      archive.addFile(pdf.filename, pdf.buffer);
    }
    return { filename: `Desprendibles-${rows[0].state.startDate}-${rows[0].state.endDate}.zip`, buffer: archive.toBuffer() };
  }
  async email(company: string, id: string, requestId: unknown) {
    if (typeof requestId !== 'string' || !uuid.test(requestId)) throw new BadRequestException('La solicitud de correo no es válida.');
    const [row] = await this.records(company, [id]);
    const recipient = typeof row.recipientEmail === 'string' ? row.recipientEmail.trim() : '';
    if (!validEmail(recipient)) throw new BadRequestException('Configura un correo válido en el empleado antes de enviar su desprendible.');
    if (company === SHARED_DEMO_COMPANY_ID) return { sent: true, simulated: true };
    const fingerprint = createHash('sha256').update(JSON.stringify([row.state, row.employee_snapshot, row.parameter_snapshot, recipient, row.positionName])).digest('hex');
    const key = `payroll-${company}-${id}-${requestId}-${fingerprint}`;
    for (const [key, job] of this.mailJobs) if (Date.now() - job.created > 23 * 60 * 60 * 1000) this.mailJobs.delete(key);
    const existing = this.mailJobs.get(key);
    if (existing) {
      if (existing.retry) { const retry = existing.retry; delete existing.retry; existing.operation = retry(); }
      return existing.operation;
    }
    if (this.mailJobs.size >= 1000) throw new ServiceUnavailableException('Hay muchos envíos en curso. Intenta de nuevo más tarde.');
    const job: { created: number; operation: Promise<{ sent: true }>; retry?: () => Promise<{ sent: true }> } = { created: Date.now(), operation: Promise.resolve({ sent: true }) };
    const operation = async (): Promise<{ sent: true }> => {
      let pdf: Awaited<ReturnType<PayrollPayslipsService['render']>>;
      try { pdf = await this.render(company, row); }
      catch (error) { this.mailJobs.delete(key); throw error; }
      const period = `${row.state.startDate} al ${row.state.endDate}`;
      const text = `Hola ${name(row.employee_snapshot)},\nAdjuntamos tu desprendible de nómina del período ${period}.`;
      const template = { subject: `Desprendible de nómina · ${period}`, text, html: `<p>${escape(text).replace(/\n/g, '<br>')}</p>` };
      const send = async (): Promise<{ sent: true }> => {
        const sent = await this.mail.sendPayrollPayslip(recipient, template, { filename: pdf.filename, content: pdf.buffer.toString('base64') }, key);
        if (!sent) {
          job.retry = send;
          throw new ServiceUnavailableException('No se confirmó el envío del correo. Intenta nuevamente o consulta con soporte.');
        }
        return { sent: true };
      };
      return send();
    };
    this.mailJobs.set(key, job);
    job.operation = operation();
    return job.operation;
  }
}
