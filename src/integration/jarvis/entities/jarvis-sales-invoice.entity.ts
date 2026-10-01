import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Company } from '../../../company/entities/company.entity';
@Entity('jarvis_sales_invoices')
@Index('IDX_jarvis_sales_invoices_company_sent', ['companyId', 'sentAt'])
@Index('UQ_jarvis_sales_invoices_number', ['companyId', 'documentKind', 'prefix', 'number'], { unique: true })
export class JarvisSalesInvoice {
  @Column({ name: 'invoice_xml', type: 'text', nullable: true, select: false }) invoiceXml: string | null;
  @Column({ name: 'source_request', type: 'jsonb', nullable: true, select: false })
  sourceRequest: import('../dto/create-jarvis-invoice.dto').CreateJarvisInvoiceRequestDto | null;
  @Column({ name: 'document_kind', type: 'varchar', length: 30, default: 'ELECTRONIC_INVOICE' }) documentKind: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string;
  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' }) company: Company;
  @Column({ name: 'provider_id', type: 'text' }) providerId: string;
  @Column({ type: 'varchar', length: 30 }) prefix: string;
  @Column({ type: 'varchar', length: 80 }) number: string;
  @Column({ name: 'issue_date', type: 'date' }) issueDate: string;
  @Column({ name: 'customer_name', type: 'text' }) customerName: string;
  @Column({ name: 'customer_identification', type: 'varchar', length: 100 }) customerIdentification: string;
  @Column({ type: 'varchar', length: 10 }) currency: string;
  @Column({ type: 'numeric', precision: 20, scale: 2 }) total: string;
  @Column({ type: 'text', nullable: true }) cufe: string | null;
  @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' }) sentAt: Date;
}
