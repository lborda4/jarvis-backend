import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import type { SupplierFieldVariability } from '../interfaces/supplier-field-variability.interface';
import type { SupplierPreferenceSnapshot } from '../interfaces/supplier-preference.interface';
import { Integration } from './integration.entity';

@Entity('supplier_configurations')
export class SupplierConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ name: 'supplier_document' })
  supplierDocument: string;

  @Column({ name: 'supplier_document_type', type: 'varchar', default: 'NIT' })
  supplierDocumentType: string;

  @Column({ name: 'supplier_name', type: 'varchar', nullable: true })
  supplierName: string | null;

  @Column({ name: 'item_type' })
  itemType: string;

  @Column({ type: 'jsonb', nullable: true })
  preference: SupplierPreferenceSnapshot | null;

  /**
   * Señal general de estabilidad de la CUENTA CONTABLE únicamente (≥70% del
   * historial de líneas en la misma cuenta ⇒ false); true = varía; null =
   * aún no se calculó. Se mantiene como indicador rápido/de uso puntual
   * (ej. SiigoPurchaseAiClassificationService decide si vale la pena llamar
   * IA), pero YA NO es el gate de las sugerencias automáticas — ver
   * `campoVariabilidad`, que evalúa cada campo (cuenta, impuestos, medio de
   * pago...) de forma independiente, porque un proveedor puede ser 100%
   * constante en cuenta contable y variar en medio de pago (o viceversa) sin
   * que eso deba apagar TODAS las sugerencias.
   */
  @Column({ name: 'tiene_variabilidad', type: 'boolean', nullable: true })
  tieneVariabilidad: boolean | null;

  /** Variabilidad calculada por campo (cuentaPuc, tipoItem, medioPago, iva,
   * retefuente, reteica, autorretencion) — ver SupplierFieldVariability. */
  @Column({ name: 'campo_variabilidad', type: 'jsonb', nullable: true })
  campoVariabilidad: SupplierFieldVariability | null;

  @Column({ name: 'ultima_actualizacion', type: 'timestamptz', nullable: true })
  ultimaActualizacion: Date | null;

  /** Momento en que este tercero se creó AUTOMÁTICAMENTE en SIIGO (sin que
   * el usuario clickeara "Crear tercero"), ver
   * SiigoDocumentPreparationService.tryAutoCreateSupplier — null si nunca
   * pasó por ese flujo (creado a mano, o ya existía en SIIGO de antes). Se
   * usa para avisarle al usuario cuántos y cuáles terceros se crearon solos
   * durante un import (ver findAutoCreatedSince). */
  @Column({
    name: 'auto_created_in_siigo_at',
    type: 'timestamptz',
    nullable: true,
  })
  autoCreatedInSiigoAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Company, (company) => company.supplierConfigurations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration: Integration;
}
