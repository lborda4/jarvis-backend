import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdvisorSale } from './advisor-sale.entity';
import { commissionMonth } from './advisor-commission';
import { Company } from '../company/entities/company.entity';
import { commercialActivity } from '../admin/commercial-activity';

@Injectable()
export class AdvisorSalesService {
  constructor(private readonly db: DataSource) {}
  async report(monthValue?: unknown, advisorId?: string, companyId?: string) {
    const term = commissionMonth(monthValue);
    const query = this.db.getRepository(AdvisorSale).createQueryBuilder('sale')
      .innerJoinAndSelect('sale.advisor', 'advisor').innerJoinAndSelect('advisor.user', 'user')
      .where('(sale.paid_at >= :start AND sale.paid_at < :end OR sale.paid_at IS NULL)', term)
      .andWhere('sale.activation = :activation', { activation: 'APPLIED' });
    if (advisorId) query.andWhere('sale.advisor_id = :advisorId', { advisorId });
    if (companyId) query.andWhere('sale.company_id = :companyId', { companyId });
    const rows = await query.orderBy('sale.created_at', 'DESC').getMany();
    const items = rows.map(sale => ({ id: sale.id, advisorId: sale.advisorId, advisorName: sale.advisor.user.name,
      companyId: sale.companyId, companyName: sale.companyName, companyNit: sale.companyNit, provider: sale.provider,
      kind: sale.kind, productName: sale.productName, priceCop: Number(sale.priceCop), commissionClass: sale.commissionClass,
      commissionRate: Number(sale.commissionRate), commissionStage: sale.commissionStage ?? 'INITIAL', commissionCop: Number(sale.commissionCop), createdAt: sale.createdAt.toISOString(), paidAt: sale.paidAt?.toISOString() ?? null }));
    const paid = items.filter(item => item.paidAt), pending = items.filter(item => !item.paidAt);
    const sum = (values: typeof items, field: 'priceCop' | 'commissionCop') => values.reduce((total, item) => total + Math.round(item[field] * 100), 0) / 100;
    const advisorIds = [...new Set(items.map(item => item.advisorId))];
    return { month: term.month, paid, pending, totalSalesCop: sum(paid, 'priceCop'), totalCommissionCop: sum(paid, 'commissionCop'),
      summary: advisorIds.map(id => { const own = paid.filter(item => item.advisorId === id); return { advisorId: id,
        advisorName: items.find(item => item.advisorId === id)!.advisorName, salesCop: sum(own, 'priceCop'), commissionCop: sum(own, 'commissionCop'), paidSales: own.length }; }) };
  }
  async registerPayment(id: string, adminUserId: string) {
    const registered = await this.db.transaction(async manager => {
      // Always lock the company before the sale, matching subscription/top-up transactions.
      const repository = manager.getRepository(AdvisorSale);
      const found = await repository.findOneBy({ id });
      if (!found) throw new NotFoundException('Venta no encontrada.');
      const companies = manager.getRepository(Company);
      const company = await companies.findOne({ where: { id: found.companyId }, lock: { mode: 'pessimistic_write' } });
      if (!company) throw new NotFoundException('Cliente no encontrado.');
      const sale = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!sale) throw new NotFoundException('Venta no encontrada.');
      if (sale.paidAt) return false;
      if (sale.activation !== 'APPLIED') throw new ConflictException('Primero debe confirmarse la activación de la recarga.');
      sale.paidAt = new Date(); sale.paidBy = adminUserId;
      await repository.save(sale);
      company.commercialActivity = [...(company.commercialActivity ?? []), commercialActivity({ kind: 'PAYMENT', amountCop: Number(sale.priceCop), planName: sale.productName, provider: sale.provider })];
      await companies.save(company);
      return true;
    });
    return { message: registered ? 'Pago registrado. La comisión se incluyó en el mes actual.' : 'Este pago ya estaba registrado. Se conservó su mes original.' };
  }
}
