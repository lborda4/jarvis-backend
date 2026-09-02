import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { HistorialFacturaFuente } from '../enums/historial-factura-fuente.enum';
import { HistorialFacturaTipo } from '../enums/historial-factura-tipo.enum';
import type { HistorialFacturaImpuestos } from '../interfaces/historial-factura-impuestos.interface';
import { Integration } from './integration.entity';

@Entity('historial_facturas')
@Index('IDX_historial_facturas_proveedor', [
  'companyId',
  'integrationId',
  'proveedorNit',
])
@Index('IDX_historial_facturas_cuenta', [
  'companyId',
  'integrationId',
  'proveedorNit',
  'cuentaPuc',
])
@Index('IDX_historial_facturas_factura', [
  'companyId',
  'integrationId',
  'facturaId',
])
@Index('IDX_historial_facturas_provider_invoice', [
  'companyId',
  'integrationId',
  'providerInvoicePrefix',
  'providerInvoiceNumber',
])
export class HistorialFactura {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ name: 'factura_id' })
  facturaId: string;

  @Column({ name: 'proveedor_nit' })
  proveedorNit: string;

  @Column({ name: 'descripcion_item', type: 'text' })
  descripcionItem: string;

  @Column({ type: 'varchar' })
  tipo: HistorialFacturaTipo;

  @Column({ name: 'cuenta_puc' })
  cuentaPuc: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  impuestos: HistorialFacturaImpuestos;

  /** Medio de pago de la factura completa (SiigoPurchaseResponse.payments[0])
   * — se repite en todas las líneas de una misma factura, igual que el resto
   * de columnas de esta tabla, que son por línea. */
  @Column({ name: 'metodo_pago_id', type: 'integer', nullable: true })
  metodoPagoId: number | null;

  @Column({ name: 'metodo_pago_nombre', type: 'varchar', nullable: true })
  metodoPagoNombre: string | null;

  /** provider_invoice.prefix/number de la respuesta de SIIGO — el prefijo y
   * número de la factura del TERCERO (ej. "FE"/"652"), no el consecutivo
   * interno de SIIGO ("FC-3-93"). Se repite en todas las líneas de una
   * misma factura, igual que metodoPagoId/Nombre. Se usa para detectar, al
   * importar un Excel de Factura de compra, si esa factura del proveedor
   * ya está creada en SIIGO (evita duplicarla) — ver
   * findByProviderInvoices. */
  @Column({ name: 'provider_invoice_prefix', type: 'varchar', nullable: true })
  providerInvoicePrefix: string | null;

  @Column({ name: 'provider_invoice_number', type: 'varchar', nullable: true })
  providerInvoiceNumber: string | null;

  /** Consecutivo numérico de SIIGO (SiigoPurchaseResponse.number, ej. 93) —
   * se guarda acá para poder mostrarlo de una en el documento importado que
   * matchea por provider_invoice, sin tener que volver a consultar SIIGO. */
  @Column({ name: 'siigo_numero', type: 'integer', nullable: true })
  siigoNumero: number | null;

  @Column({ type: 'varchar' })
  fuente: HistorialFacturaFuente;

  @Column({ name: 'fecha_factura', type: 'date' })
  fechaFactura: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration: Integration;
}
