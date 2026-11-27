import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface DemoInvoiceInput {
  id: string;
  customerName: string;
  customerIdentification: string;
  description: string;
  quantity: number;
  unitValue: number;
}

function text(value: unknown, length: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > length)
    throw new BadRequestException(`${label} es obligatorio y no debe superar ${length} caracteres.`);
  return value.trim();
}

function cents(value: unknown, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
      value > max || !/^\d+(?:\.\d{1,2})?$/.test(String(value)))
    throw new BadRequestException(`${label} debe ser positivo y tener máximo dos decimales.`);
  return Math.round(value * 100);
}

@Injectable()
export class AdvisorDemoInvoicesService {
  constructor(private readonly db: DataSource) {}

  async list(pageValue?: string) {
    const page = pageValue === undefined ? 1 : Number(pageValue);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000)
      throw new BadRequestException('La página no es válida.');
    const pageSize = 20;
    const [count] = await this.db.query('SELECT COUNT(*)::int AS total FROM advisor_demo_invoices');
    const items = await this.db.query(`SELECT id, number::text AS number, customer_name AS "customerName",
      customer_identification AS "customerIdentification", description, quantity::text AS quantity,
      unit_value::text AS "unitValue", total::text AS total, created_at AS "createdAt"
      FROM advisor_demo_invoices ORDER BY number DESC LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]);
    return { items, total: count.total, page, pageSize };
  }

  async create(input: DemoInvoiceInput, actorId: string) {
    if (!input || typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id))
      throw new BadRequestException('El identificador de la factura simulada no es válido.');
    const customerName = text(input.customerName, 200, 'El nombre del cliente');
    const customerIdentification = text(input.customerIdentification, 100, 'La identificación');
    const description = text(input.description, 500, 'La descripción');
    const quantity = cents(input.quantity, 99999999, 'La cantidad');
    const unitValue = cents(input.unitValue, 99999999, 'El valor unitario');
    const totalCents = (BigInt(quantity) * BigInt(unitValue) + 50n) / 100n;
    if (totalCents < 1n || totalCents > 999999999999999999n) throw new BadRequestException('El total de la factura no es válido.');
    const total = `${totalCents / 100n}.${String(totalCents % 100n).padStart(2, '0')}`;
    return this.db.transaction(async manager => {
      const [company] = await manager.query('SELECT next_invoice_number AS "nextNumber" FROM advisor_demo_company WHERE singleton = true AND is_demo = true FOR UPDATE');
      if (!company) throw new ServiceUnavailableException('La empresa de demostración no está disponible.');
      const [existing] = await manager.query(`SELECT id, number::text AS number, customer_name AS "customerName",
        customer_identification AS "customerIdentification", description, quantity::text AS quantity,
        unit_value::text AS "unitValue", total::text AS total, created_at AS "createdAt", created_by AS "createdBy"
        FROM advisor_demo_invoices WHERE id = $1`, [input.id]);
      if (existing) {
        if (existing.createdBy !== actorId || existing.customerName !== customerName ||
          existing.customerIdentification !== customerIdentification || existing.description !== description ||
          Number(existing.quantity) !== quantity / 100 || Number(existing.unitValue) !== unitValue / 100)
          throw new ConflictException('El identificador de la factura ya se utilizó con otros datos.');
        const { createdBy: _createdBy, ...invoice } = existing;
        return invoice;
      }
      const [invoice] = await manager.query(`INSERT INTO advisor_demo_invoices
        (id, number, customer_name, customer_identification, description, quantity, unit_value, total, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id, number::text AS number, customer_name AS "customerName", customer_identification AS "customerIdentification",
          description, quantity::text AS quantity, unit_value::text AS "unitValue", total::text AS total, created_at AS "createdAt"`,
      [input.id, company.nextNumber, customerName, customerIdentification, description, (quantity / 100).toFixed(2), (unitValue / 100).toFixed(2), total, actorId]);
      await manager.query('UPDATE advisor_demo_company SET next_invoice_number = next_invoice_number + 1 WHERE singleton = true AND is_demo = true');
      return invoice;
    });
  }
}
