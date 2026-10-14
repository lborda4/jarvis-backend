import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Company } from '../../../company/entities/company.entity';

@Entity('jarvis_radian_events')
export class JarvisRadianEvent {
  @PrimaryColumn({ name: 'company_id', type: 'uuid' }) companyId: string;
  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' }) company: Company;
  @PrimaryColumn({ type: 'varchar', length: 96 }) cufe: string;
  @PrimaryColumn({ name: 'event_id', type: 'smallint' }) eventId: number;
  @Column({ type: 'varchar', length: 12 }) status:
    | 'processing'
    | 'sent'
    | 'failed'
    | 'unknown';
  @Column({ name: 'attempt_id', type: 'uuid' }) attemptId: string;
  @Column({ name: 'rejection_id', type: 'integer', nullable: true })
  rejectionId: number | null;
  @Column({ type: 'text', nullable: true }) cude: string | null;
  @Column({ name: 'dian_code', type: 'text', nullable: true }) dianCode:
    | string
    | null;
  @Column({ type: 'text', nullable: true }) message: string | null;
  @Column({ type: 'jsonb', nullable: true, select: false }) response: unknown;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb", select: false })
  history: unknown[];
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
