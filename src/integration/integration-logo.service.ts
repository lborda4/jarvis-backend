import { BadRequestException, Inject, Injectable, NotFoundException, Optional, PayloadTooLargeException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Integration } from './entities/integration.entity';
import { IntegrationProvider } from './enums/integration-provider.enum';
import { NextPymeApiClient } from './jarvis/nextpyme/nextpyme-api.client';
import { NextPymeMasterCatalogService } from './jarvis/nextpyme/nextpyme-master-catalog.service';

export const MAX_LOGO_BYTES = 500 * 1024;

export function logoMime(data: Buffer): 'image/png' | 'image/jpeg' {
  if (data.length > MAX_LOGO_BYTES) throw new PayloadTooLargeException('El logo no puede superar 500 KB.');
  let width = 0, height = 0;
  let mime: 'image/png' | 'image/jpeg';
  if (data.length >= 45 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      data.toString('ascii', 12, 16) === 'IHDR' && data.toString('ascii', data.length - 8, data.length - 4) === 'IEND') {
    width = data.readUInt32BE(16); height = data.readUInt32BE(20); mime = 'image/png';
  } else if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[data.length - 2] === 255 && data[data.length - 1] === 217) {
    mime = 'image/jpeg';
    for (let offset = 2; offset + 4 < data.length;) {
      if (data[offset++] !== 255) break;
      while (data[offset] === 255) offset++;
      const marker = data[offset++];
      if (marker === 218 || marker === 217) break;
      if (offset + 2 > data.length) break;
      const size = data.readUInt16BE(offset);
      if (size < 2 || offset + size > data.length) break;
      if ([192, 193, 194].includes(marker) && size >= 8) {
        height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); break;
      }
      offset += size;
    }
  } else throw new BadRequestException('Sube una imagen PNG o JPG válida.');
  if (!width || !height || width > 4096 || height > 4096 || width * height > 4000000) {
    throw new BadRequestException('El logo debe ser una imagen válida de máximo 4096 píxeles por lado y 4 megapíxeles.');
  }
  return mime;
}

@Injectable()
export class IntegrationLogoService {
  constructor(
    @InjectRepository(Integration) private readonly integrations: Repository<Integration>,
    @Optional()
    @Inject(forwardRef(() => NextPymeApiClient))
    private readonly nextPymeApiClient?: NextPymeApiClient,
    @Optional()
    @Inject(forwardRef(() => NextPymeMasterCatalogService))
    private readonly nextPymeMasterCatalog?: NextPymeMasterCatalogService,
  ) {}
  async get(companyId: string, provider: IntegrationProvider): Promise<{ logoDataUrl: string | null }> {
    const integration = await this.integrations.createQueryBuilder('integration').addSelect('integration.logo')
      .where('integration.companyId = :companyId', { companyId })
      .andWhere('integration.provider = :provider', { provider })
      .andWhere('integration.active = true').getOne();
    if (!integration) throw new NotFoundException('No se encontró la integración de la empresa.');
    return { logoDataUrl: integration.logo ? `data:${logoMime(integration.logo)};base64,${integration.logo.toString('base64')}` : null };
  }
  async save(companyId: string, provider: IntegrationProvider, file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Selecciona una imagen PNG o JPG.');
    const mime = logoMime(file.buffer);
    if (provider === IntegrationProvider.JARVIS) {
      if (mime !== 'image/jpeg') {
        throw new BadRequestException('El logotipo para facturación electrónica debe ser JPG.');
      }
      if (!this.nextPymeApiClient || !this.nextPymeMasterCatalog) {
        throw new BadRequestException('No está disponible la configuración de logo en NextPyme.');
      }
      const token = await this.nextPymeMasterCatalog.requireCompanyToken(companyId);
      await this.nextPymeApiClient.putConfigLogo(file.buffer.toString('base64'), token);
    }
    await this.update(companyId, provider, file.buffer);
    return { logoDataUrl: `data:${mime};base64,${file.buffer.toString('base64')}` };
  }
  async remove(companyId: string, provider: IntegrationProvider) {
    await this.update(companyId, provider, null);
    return { logoDataUrl: null };
  }
  private async update(companyId: string, provider: IntegrationProvider, logo: Buffer | null) {
    const result = await this.integrations.update({ companyId, provider, active: true }, { logo });
    if (!result.affected) throw new NotFoundException('No se encontró la integración de la empresa.');
  }
}
