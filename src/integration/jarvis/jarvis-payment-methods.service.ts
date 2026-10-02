import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { JarvisPaymentMethod } from './entities/jarvis-payment-method.entity';
import { SaveJarvisPaymentMethodDto } from './dto/jarvis-payment-method.dto';
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';

@Injectable()
export class JarvisPaymentMethodsService {
  private readonly logger = new Logger(JarvisPaymentMethodsService.name);
  constructor(
    @InjectRepository(JarvisPaymentMethod) private readonly repository: Repository<JarvisPaymentMethod>,
    private readonly integrations: IntegrationsRepository,
    private readonly catalogs: NextPymeMasterCatalogService,
  ) {}

  private async requireCompany(companyId: string) {
    if (!companyId?.trim()) throw new BadRequestException('No se pudo determinar la empresa activa.');
    if (!await this.integrations.findByCompanyAndProvider(companyId, IntegrationProvider.JARVIS)) {
      throw new NotFoundException('La empresa no tiene integración Jarvis configurada.');
    }
  }

  async list(companyId: string) {
    await this.requireCompany(companyId);
    let items = await this.repository.find({ where: { companyId }, order: { createdAt: 'ASC', id: 'ASC' } });
    const defaults = [
      { name: 'Efectivo', masterName: 'Efectivo', code: '10' },
      { name: 'Crédito clientes', masterName: 'Otro', code: 'ZZZ' },
      { name: 'Transferencia bancaria', masterName: 'Transferencia crédito', code: '30' },
      { name: 'Tarjeta crédito', masterName: 'Tarjeta crédito', code: '48' },
      { name: 'Tarjeta débito', masterName: 'Tarjeta débito', code: '49' },
    ];
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const missing = defaults.filter(preset => !items.some(item => item.name.trim().toLowerCase() === preset.name.toLowerCase()));
    if (missing.length) {
      const catalog = await this.catalogs.getPaymentMethods(companyId);
      const values = missing.flatMap(preset => {
        const master = catalog.find(row => String(row.code ?? '').trim().toUpperCase() === preset.code)
          ?? catalog.find(row => normalize(row.name) === normalize(preset.masterName));
        if (!master) {
          this.logger.warn('No está disponible el medio de pago maestro con código ' + preset.code);
          return [];
        }
        return [{ companyId, name: preset.name, nextpymeMethodId: master.id, nextpymeMethodName: master.name }];
      });
      // La restricción única por empresa y nombre evita duplicados en cargas simultáneas.
      if (values.length) await this.repository.createQueryBuilder().insert().values(values).orIgnore().execute();
      items = await this.repository.find({ where: { companyId }, order: { createdAt: 'ASC', id: 'ASC' } });
    }
    const priority = (name: string) => { const index = defaults.findIndex(item => item.name.toLowerCase() === name.trim().toLowerCase()); return index < 0 ? defaults.length : index; };
    items.sort((a, b) => priority(a.name) - priority(b.name));
    return { items: items.map(item => this.toDto(item)), total: items.length };
  }

  async save(companyId: string, request: SaveJarvisPaymentMethodDto, id?: string) {
    await this.requireCompany(companyId);
    const item = id ? await this.repository.findOneBy({ id, companyId }) : this.repository.create({ companyId });
    if (!item) throw new NotFoundException('No se encontró la forma de pago.');
    const name = typeof request.name === 'string' ? request.name.trim() : '';
    if (!name || name.length > 120) throw new BadRequestException('El nombre debe tener entre 1 y 120 caracteres.');
    if (!Number.isInteger(request.nextpymeMethodId) || request.nextpymeMethodId <= 0) {
      throw new BadRequestException('Selecciona una forma de pago válida del catálogo.');
    }
    const master = (await this.catalogs.getPaymentMethods(companyId)).find(row => row.id === request.nextpymeMethodId);
    if (!master) throw new BadRequestException('La forma de pago seleccionada no existe en NextPyme.');
    item.name = name;
    item.nextpymeMethodId = master.id;
    item.nextpymeMethodName = master.name;
    try {
      return { success: true, paymentMethod: this.toDto(await this.repository.save(item)) };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Ya existe una forma de pago con ese nombre.');
      throw error;
    }
  }

  async remove(companyId: string, id: string) {
    await this.requireCompany(companyId);
    const result = await this.repository.delete({ id, companyId });
    if (!result.affected) throw new NotFoundException('No se encontró la forma de pago.');
    return { success: true };
  }

  private toDto(item: JarvisPaymentMethod) {
    return { id: item.id, name: item.name, nextpymeMethodId: item.nextpymeMethodId, nextpymeMethodName: item.nextpymeMethodName };
  }
}
