import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Advisor } from '../auth/entities/advisor.entity';
import { Company } from '../company/entities/company.entity';

export type CommissionClass = 'BASIC' | 'PLUS' | 'PRO';
@Entity('advisor_sales')
export class AdvisorSale {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'source_key', unique: true, length: 200 }) sourceKey: string;
  @Column({ name: 'operation_key', length: 120 }) operationKey: string;
  @Column({ length: 10, default: 'APPLIED' }) activation: 'PROCESSING' | 'APPLIED' | 'FAILED' | 'UNCERTAIN';
  @Column({ name: 'advisor_id', type: 'uuid' }) advisorId: string;
  @ManyToOne(() => Advisor, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'advisor_id' }) advisor: Advisor;
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string;
  @ManyToOne(() => Company, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'company_id' }) company: Company;
  @Column({ name: 'company_name' }) companyName: string;
  @Column({ name: 'company_nit' }) companyNit: string;
  @Column({ length: 10 }) provider: string;
  @Column({ length: 10 }) kind: 'PLAN' | 'TOP_UP';
  @Column({ name: 'product_code' }) productCode: string;
  @Column({ name: 'product_name' }) productName: string;
  @Column({ name: 'price_cop', type: 'numeric', precision: 14, scale: 2 }) priceCop: string;
  @Column({ name: 'commission_class', length: 10 }) commissionClass: CommissionClass;
  @Column({ name: 'commission_rate', type: 'numeric', precision: 5, scale: 2 }) commissionRate: string;
  @Column({ name: 'commission_stage', length: 10, default: 'INITIAL' }) commissionStage: 'INITIAL' | 'RENEWAL';
  @Column({ name: 'commission_cop', type: 'numeric', precision: 14, scale: 2 }) commissionCop: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true }) paidAt: Date | null;
  @Column({ name: 'paid_by', type: 'uuid', nullable: true }) paidBy: string | null;
}
