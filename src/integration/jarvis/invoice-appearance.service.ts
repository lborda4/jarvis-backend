import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { normalizeInvoiceAppearance, normalizeInvoiceColor, type InvoiceAppearance } from './pdf/invoice-appearance';

@Injectable()
export class InvoiceAppearanceService {
  constructor(private readonly db: DataSource) {}

  async get(companyId: string): Promise<InvoiceAppearance> {
    const [row] = await this.db.query(
      "SELECT credentials->'invoice_appearance' AS appearance FROM integrations WHERE company_id=$1 AND provider='JARVIS' AND active=true",
      [companyId],
    );
    if (!row) throw new NotFoundException('No se encontró una integración Jarvis activa para esta empresa.');
    return normalizeInvoiceAppearance(row.appearance);
  }

  async save(companyId: string, input: unknown): Promise<InvoiceAppearance> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('La personalización no es válida.');
    const value = input as Record<string, unknown>;
    if (typeof value.accentColor !== 'string' || !normalizeInvoiceColor(value.accentColor)) throw new BadRequestException('Escribe un color hexadecimal válido.');
    if (typeof value.footerText !== 'string' || value.footerText.length > 300) throw new BadRequestException('El mensaje al pie admite hasta 300 caracteres.');
    if (typeof value.showLogo !== 'boolean') throw new BadRequestException('La opción de logo no es válida.');
    const appearance = normalizeInvoiceAppearance(value as unknown as InvoiceAppearance);
    // Update only this JSON key: credentials, resolutions and other settings stay intact.
    const rows = await this.db.query(
      "UPDATE integrations SET credentials=jsonb_set(COALESCE(credentials, '{}'::jsonb), '{invoice_appearance}', $2::jsonb, true), updated_at=NOW() WHERE company_id=$1 AND provider='JARVIS' AND active=true RETURNING credentials->'invoice_appearance' AS appearance",
      [companyId, JSON.stringify(appearance)],
    );
    // TypeORM/pg may return UPDATE ... RETURNING as [rows, affectedCount].
    const result = Array.isArray(rows[0]) ? rows[0] : rows;
    if (!result[0]) throw new NotFoundException('No se encontró una integración Jarvis activa para esta empresa.');
    return normalizeInvoiceAppearance(result[0].appearance);
  }
}
