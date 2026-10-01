import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Company } from '../../../company/entities/company.entity';

@Entity('jarvis_payment_methods')
@Index('IDX_jarvis_payment_methods_company', ['companyId'])
export class JarvisPaymentMethod {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ name: 'nextpyme_method_id', type: 'integer' }) nextpymeMethodId: number;
  @Column({ name: 'nextpyme_method_name', type: 'varchar', length: 255 }) nextpymeMethodName: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' }) company: Company;
}
