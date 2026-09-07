import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';

/**
 * Relaciona una caja/sucursal de SIIGO POS con el terminal de Bold que debe
 * recibir el cobro — cuando la extensión detecta una venta en una caja
 * puntual, esta tabla dice a cuál datáfono (bold_terminal_id) empujarle el
 * valor. Una fila por caja física; una empresa puede tener varias.
 */
@Entity('siigo_bold_cash_register')
@Index(
  'IDX_siigo_bold_cash_register_key',
  ['companyId', 'branchOfficeId', 'cashRegisterId'],
  { unique: true },
)
export class SiigoBoldCashRegister {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  /** Sucursal de SIIGO (branch_office) — mismo campo numérico que usa el
   * resto de la integración con SIIGO (ver siigo-api.interface.ts). */
  @Column({ name: 'branch_office_id', type: 'integer' })
  branchOfficeId: number;

  /** Identificador de la caja en Siigo POS — se lee del DOM/estado de la
   * página, formato todavía no confirmado con Siigo, por eso texto libre. */
  @Column({ name: 'cash_register_id', type: 'varchar' })
  cashRegisterId: string;

  @Column({ name: 'cash_register_name', type: 'varchar' })
  cashRegisterName: string;

  /** Identificador del terminal/datáfono en Bold al que se le empuja el
   * cobro para esta caja. */
  @Column({ name: 'bold_terminal_id', type: 'varchar' })
  boldTerminalId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
