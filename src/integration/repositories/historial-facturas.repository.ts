import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { HistorialFacturaFuente } from '../enums/historial-factura-fuente.enum';
import { HistorialFacturaTipo } from '../enums/historial-factura-tipo.enum';
import { HistorialFactura } from '../entities/historial-factura.entity';
import type { HistorialFacturaTaxDetail } from '../interfaces/historial-factura-impuestos.interface';

/** Mismo umbral que el resto del producto (VARIABILITY_THRESHOLD en
 * siigo-purchase-history-sync.service.ts) — ≥70% de las facturas de ESA
 * cuenta puntual (cualquier proveedor) coinciden en el mismo medio de pago. */
const ACCOUNT_PAYMENT_METHOD_THRESHOLD = 0.7;

export interface HistorialFacturaAccountPaymentMethod {
  id: number;
  name: string;
}

export interface HistorialFacturaAccountGroup {
  proveedorNit: string;
  cuentaPuc: string;
  count: number;
}

export interface HistorialFacturaTipoGroup {
  proveedorNit: string;
  tipo: HistorialFacturaTipo;
  count: number;
}

export interface HistorialFacturaPaymentMethodGroup {
  proveedorNit: string;
  metodoPagoId: number;
  metodoPagoNombre: string;
  /** Facturas DISTINTAS con ese medio de pago — no líneas, para no pesar de
   * más a las facturas con muchos ítems al elegir la moda por proveedor. */
  count: number;
}

/** Las 4 categorías de HistorialFacturaImpuestos que se evalúan por
 * variabilidad de forma independiente (tarifas no aplica: es una lista
 * abierta, no un valor único por línea). */
export type HistorialFacturaImpuestoCampo =
  | 'iva'
  | 'retefuente'
  | 'reteica'
  | 'autorretencion';

export interface HistorialFacturaImpuestoCampoGroup {
  proveedorNit: string;
  /** null = esa línea no trae impuesto de esta categoría — un grupo válido
   * en sí mismo ("consistentemente no aplica"), no un dato faltante. */
  taxId: number | null;
  count: number;
}

@Injectable()
export class HistorialFacturasRepository {
  constructor(
    @InjectRepository(HistorialFactura)
    private readonly repository: Repository<HistorialFactura>,
  ) {}

  create(data: Partial<HistorialFactura>): HistorialFactura {
    return this.repository.create(data);
  }

  /**
   * Reemplaza en una sola transacción las filas de `fuente` para las
   * facturas dadas (delete + insert atómico): o se aplican los dos, o
   * ninguno — nunca queda un estado a mitad de camino visible para otras
   * consultas (ej. el resolver de sugerencias leyendo mientras corre el
   * sync) ni perdido si algo falla entre el delete y el insert.
   *
   * El `fuente` del delete SIEMPRE es explícito y coincide con el de las
   * filas nuevas — nunca toca filas de otra fuente (ej. un re-sync de SIIGO
   * jamás borra correcciones del contador, y viceversa).
   */
  async replaceRowsForFacturas(
    companyId: string,
    integrationId: string,
    facturaIds: string[],
    rows: HistorialFactura[],
    fuente: HistorialFacturaFuente,
  ): Promise<void> {
    if (facturaIds.length === 0) {
      return;
    }

    await this.repository.manager.transaction(async (manager) => {
      await manager.delete(HistorialFactura, {
        companyId,
        integrationId,
        facturaId: In(facturaIds),
        fuente,
      });

      if (rows.length > 0) {
        await manager.save(HistorialFactura, rows);
      }
    });
  }

  findRecentBySupplier(
    companyId: string,
    integrationId: string,
    proveedorNit: string,
    limit: number,
  ): Promise<HistorialFactura[]> {
    return this.repository
      .createQueryBuilder('historial')
      .where('historial.company_id = :companyId', { companyId })
      .andWhere('historial.integration_id = :integrationId', { integrationId })
      .andWhere('historial.proveedor_nit = :proveedorNit', { proveedorNit })
      .orderBy(
        `CASE WHEN historial.fuente = :fuenteCorregida THEN 0 ELSE 1 END`,
        'ASC',
      )
      .addOrderBy('historial.fecha_factura', 'DESC')
      .setParameter('fuenteCorregida', HistorialFacturaFuente.CORREGIDO_CONTADOR)
      .limit(limit)
      .getMany();
  }

  /** Agrupa por (proveedor_nit, cuenta_puc) para el recálculo de variabilidad. */
  groupByProveedorAndCuenta(
    companyId: string,
    integrationId: string,
  ): Promise<HistorialFacturaAccountGroup[]> {
    return this.repository
      .createQueryBuilder('historial')
      .select('historial.proveedor_nit', 'proveedorNit')
      .addSelect('historial.cuenta_puc', 'cuentaPuc')
      .addSelect('COUNT(*)', 'count')
      .where('historial.company_id = :companyId', { companyId })
      .andWhere('historial.integration_id = :integrationId', { integrationId })
      .groupBy('historial.proveedor_nit')
      .addGroupBy('historial.cuenta_puc')
      .getRawMany<{ proveedorNit: string; cuentaPuc: string; count: string }>()
      .then((rows) =>
        rows.map((row) => ({
          proveedorNit: row.proveedorNit,
          cuentaPuc: row.cuentaPuc,
          count: Number(row.count),
        })),
      );
  }

  /** Agrupa por (proveedor_nit, tipo) para evaluar la variabilidad del tipo
   * de ítem (Account/Product) de forma independiente de la cuenta. */
  groupByProveedorAndTipo(
    companyId: string,
    integrationId: string,
  ): Promise<HistorialFacturaTipoGroup[]> {
    return this.repository
      .createQueryBuilder('historial')
      .select('historial.proveedor_nit', 'proveedorNit')
      .addSelect('historial.tipo', 'tipo')
      .addSelect('COUNT(*)', 'count')
      .where('historial.company_id = :companyId', { companyId })
      .andWhere('historial.integration_id = :integrationId', { integrationId })
      .groupBy('historial.proveedor_nit')
      .addGroupBy('historial.tipo')
      .getRawMany<{ proveedorNit: string; tipo: HistorialFacturaTipo; count: string }>()
      .then((rows) =>
        rows.map((row) => ({
          proveedorNit: row.proveedorNit,
          tipo: row.tipo,
          count: Number(row.count),
        })),
      );
  }

  /** Agrupa por (proveedor_nit, impuestos->campo->>'id') para evaluar la
   * variabilidad de esa categoría de impuesto de forma independiente de la
   * cuenta contable y del resto de categorías — `campo` viene de un tipo
   * unión fijo (HistorialFacturaImpuestoCampo), nunca de un valor externo,
   * así que interpolarlo en el path JSON es seguro. */
  groupByProveedorAndImpuestoCampo(
    companyId: string,
    integrationId: string,
    campo: HistorialFacturaImpuestoCampo,
  ): Promise<HistorialFacturaImpuestoCampoGroup[]> {
    const jsonPath = `historial.impuestos->'${campo}'->>'id'`;

    return this.repository
      .createQueryBuilder('historial')
      .select('historial.proveedor_nit', 'proveedorNit')
      .addSelect(`(${jsonPath})::integer`, 'taxId')
      .addSelect('COUNT(*)', 'count')
      .where('historial.company_id = :companyId', { companyId })
      .andWhere('historial.integration_id = :integrationId', { integrationId })
      .groupBy('historial.proveedor_nit')
      .addGroupBy(jsonPath)
      .getRawMany<{ proveedorNit: string; taxId: string | null; count: string }>()
      .then((rows) =>
        rows.map((row) => ({
          proveedorNit: row.proveedorNit,
          taxId: row.taxId === null ? null : Number(row.taxId),
          count: Number(row.count),
        })),
      );
  }

  /** El detalle {id, name, percentage} más reciente para ese
   * (proveedor, categoría de impuesto, id ganador) — se usa como `valor` de
   * SupplierFieldVariability cuando esa categoría resultó fija. `taxId:
   * null` (la categoría consistentemente no aplica) siempre devuelve null
   * sin consultar, ver SupplierFieldVariabilityEntry. */
  async findMostRecentByProveedorAndImpuestoCampo(
    companyId: string,
    integrationId: string,
    proveedorNit: string,
    campo: HistorialFacturaImpuestoCampo,
    taxId: number | null,
  ): Promise<HistorialFacturaTaxDetail | null> {
    if (taxId === null) {
      return null;
    }

    const jsonPath = `historial.impuestos->'${campo}'`;
    const row = await this.repository
      .createQueryBuilder('historial')
      .where('historial.company_id = :companyId', { companyId })
      .andWhere('historial.integration_id = :integrationId', { integrationId })
      .andWhere('historial.proveedor_nit = :proveedorNit', { proveedorNit })
      .andWhere(`(${jsonPath}->>'id')::integer = :taxId`, { taxId })
      .orderBy('historial.fecha_factura', 'DESC')
      .getOne();

    const impuestos = row?.impuestos as
      | Record<HistorialFacturaImpuestoCampo, HistorialFacturaTaxDetail | undefined>
      | undefined;

    return impuestos?.[campo] ?? null;
  }

  /** Agrupa por (proveedor_nit, metodo_pago_id) contando FACTURAS distintas
   * (no líneas) para el recálculo del medio de pago dominante por proveedor. */
  groupByProveedorAndMetodoPago(
    companyId: string,
    integrationId: string,
  ): Promise<HistorialFacturaPaymentMethodGroup[]> {
    return this.repository
      .createQueryBuilder('historial')
      .select('historial.proveedor_nit', 'proveedorNit')
      .addSelect('historial.metodo_pago_id', 'metodoPagoId')
      .addSelect('historial.metodo_pago_nombre', 'metodoPagoNombre')
      .addSelect('COUNT(DISTINCT historial.factura_id)', 'count')
      .where('historial.company_id = :companyId', { companyId })
      .andWhere('historial.integration_id = :integrationId', { integrationId })
      .andWhere('historial.metodo_pago_id IS NOT NULL')
      .groupBy('historial.proveedor_nit')
      .addGroupBy('historial.metodo_pago_id')
      .addGroupBy('historial.metodo_pago_nombre')
      .getRawMany<{
        proveedorNit: string;
        metodoPagoId: number;
        metodoPagoNombre: string;
        count: string;
      }>()
      .then((rows) =>
        rows.map((row) => ({
          proveedorNit: row.proveedorNit,
          metodoPagoId: Number(row.metodoPagoId),
          metodoPagoNombre: row.metodoPagoNombre,
          count: Number(row.count),
        })),
      );
  }

  /**
   * Medio de pago dominante de UNA cuenta contable puntual, sin importar el
   * proveedor — caso real reportado: un proveedor nuevo (D1 SAS) no tiene
   * historial propio todavía, pero la cuenta a la que la IA lo clasificó
   * ("Elementos de aseo y Cafetería") siempre se paga a crédito a
   * proveedores en el histórico de OTROS proveedores. A diferencia de
   * `groupByProveedorAndMetodoPago` (variabilidad por proveedor, usada por
   * el sync para `SupplierConfiguration`), esta es una consulta puntual
   * bajo demanda: las cuentas no son una dimensión precomputada como los
   * proveedores, así que se calcula en el momento que se necesita, no en
   * el sync periódico.
   */
  async findDominantPaymentMethodByCuenta(
    companyId: string,
    integrationId: string,
    cuentaPuc: string,
  ): Promise<HistorialFacturaAccountPaymentMethod | null> {
    const rows = await this.repository
      .createQueryBuilder('historial')
      .select('historial.metodo_pago_id', 'metodoPagoId')
      .addSelect('historial.metodo_pago_nombre', 'metodoPagoNombre')
      .addSelect('COUNT(DISTINCT historial.factura_id)', 'count')
      .where('historial.company_id = :companyId', { companyId })
      .andWhere('historial.integration_id = :integrationId', { integrationId })
      .andWhere('historial.cuenta_puc = :cuentaPuc', { cuentaPuc })
      .andWhere('historial.metodo_pago_id IS NOT NULL')
      .groupBy('historial.metodo_pago_id')
      .addGroupBy('historial.metodo_pago_nombre')
      .getRawMany<{
        metodoPagoId: string;
        metodoPagoNombre: string;
        count: string;
      }>();

    if (rows.length === 0) {
      return null;
    }

    const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
    const best = rows.reduce((current, row) =>
      Number(row.count) > Number(current.count) ? row : current,
    );

    if (Number(best.count) / total < ACCOUNT_PAYMENT_METHOD_THRESHOLD) {
      return null;
    }

    return { id: Number(best.metodoPagoId), name: best.metodoPagoNombre };
  }

  /** La fila de impuestos más reciente para ese (proveedor, cuenta) — se usa como impuestos_default. */
  findMostRecentByProveedorAndCuenta(
    companyId: string,
    integrationId: string,
    proveedorNit: string,
    cuentaPuc: string,
  ): Promise<HistorialFactura | null> {
    return this.repository.findOne({
      where: { companyId, integrationId, proveedorNit, cuentaPuc },
      order: { fechaFactura: 'DESC' },
    });
  }
}
