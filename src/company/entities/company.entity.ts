import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SupplierConfiguration } from '../../integration/entities/supplier-configuration.entity';
import { UserCompany } from '../../auth/entities/user-company.entity';
import { Integration } from '../../integration/entities/integration.entity';
import { CompanyPersonType } from '../enums/company-person-type.enum';
import type { CompanyResponsible } from '../interfaces/company-responsible.interface';

import type { CompanyAiContext } from '../company-ai-context';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  nit: string;

  @Column()
  name: string;

  /** A qué se dedica la empresa — contexto para los prompts de IA. */
  @Column({ type: 'jsonb', nullable: true })
  description: CompanyAiContext | null;

  @Column({ name: 'invite_code', unique: true, length: 20 })
  inviteCode: string;

  @Column({
    name: 'person_type',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  personType: CompanyPersonType | null;

  @Column({ type: 'jsonb', nullable: true })
  responsible: CompanyResponsible | null;

  /** Token Bearer propio de la empresa para NextPyme. Es obligatorio para consultar o emitir documentos. */
  @Column({ name: 'next_pyme_token', type: 'varchar', nullable: true })
  nextPymeToken: string | null;

  /** Ciudad de la empresa (código DANE, ej. "11001") — default de ciudad al crear un tercero en SIIGO sin dirección propia. */
  @Column({ name: 'city_code', type: 'varchar', nullable: true })
  cityCode: string | null;

  /** Nombre de la ciudad, solo para mostrar (el código es lo que se usa). */
  @Column({ name: 'city_name', type: 'varchar', nullable: true })
  cityName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  commercial: string | null;

  @Column({ name: 'billing_cycle', type: 'varchar', length: 10, nullable: true })
  billingCycle: 'MONTHLY' | 'ANNUAL' | null;

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

  @OneToMany(() => Integration, (integration) => integration.company)
  integrations: Integration[];
}
