import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SupplierConfiguration } from '../../integration/entities/supplier-configuration.entity';
import { UserCompany } from '../../auth/entities/user-company.entity';
import { Integration } from '../../integration/entities/integration.entity';
import { Plan } from '../../plan/entities/plan.entity';
import type { CompanyResponsible } from '../interfaces/company-responsible.interface';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  nit: string;

  @Column()
  name: string;

  @Column({ type: 'jsonb', nullable: true })
  responsible: CompanyResponsible | null;

  @Column({ name: 'company_plan_id', type: 'uuid', nullable: true })
  companyPlanId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(
    () => SupplierConfiguration,
    (configuration) => configuration.company,
  )
  supplierConfigurations: SupplierConfiguration[];

  @OneToMany(() => UserCompany, (userCompany) => userCompany.company)
  userCompanies: UserCompany[];

  @ManyToOne(() => Plan, (plan) => plan.companies, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'company_plan_id' })
  companyPlan: Plan | null;

  @OneToMany(() => Integration, (integration) => integration.company)
  integrations: Integration[];
}
