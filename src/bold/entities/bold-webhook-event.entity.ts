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
import type { BoldWebhookNotification } from '../interfaces/bold-webhook-notification.interface';

@Entity('bold_webhook_events')
@Index('IDX_bold_webhook_events_payment', ['companyId', 'paymentId'])
@Index('IDX_bold_webhook_events_reference', ['companyId', 'reference'])
export class BoldWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** UUID de la notificación de Bold (`id` del CloudEvent). */
  @Column({ name: 'notification_id', type: 'varchar', unique: true })
  notificationId: string;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  /** `production` o `test` — el de pruebas no debe disparar cobros reales. */
  @Column({ type: 'varchar', length: 16, default: 'production' })
  environment: 'production' | 'test';

  @Column({ type: 'varchar' })
  type: string;

  @Column({ name: 'payment_id', type: 'varchar', nullable: true })
  paymentId: string | null;

  /** `metadata.reference` — el UUID que mandamos en app-checkout. */
  @Column({ name: 'reference', type: 'varchar', nullable: true })
  reference: string | null;

  @Column({ name: 'merchant_id', type: 'varchar', nullable: true })
  merchantId: string | null;

  @Column({
    name: 'amount_total',
    type: 'numeric',
    precision: 20,
    scale: 2,
    nullable: true,
  })
  amountTotal: string | null;

  @Column({ name: 'amount_currency', type: 'varchar', length: 10, nullable: true })
  amountCurrency: string | null;

  @Column({ type: 'jsonb' })
  payload: BoldWebhookNotification;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Company, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'company_id' })
  company: Company | null;
}
