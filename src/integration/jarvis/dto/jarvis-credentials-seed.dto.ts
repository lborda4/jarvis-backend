import { ApiPropertyOptional } from '@nestjs/swagger';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from '../enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from '../enums/jarvis-vat-regime.enum';

export class JarvisCredentialsSeedDto {
  @ApiPropertyOptional({ example: 'JARVIS COLOMBIA S.A.S' })
  business_name?: string;

  @ApiPropertyOptional()
  trade_name?: string;

  @ApiPropertyOptional({ enum: JarvisTaxRegime })
  tax_regime?: JarvisTaxRegime;

  @ApiPropertyOptional({ enum: JarvisVatRegime })
  vat_regime?: JarvisVatRegime;

  @ApiPropertyOptional({ enum: JarvisTaxResponsibility })
  tax_responsibility?: JarvisTaxResponsibility;

  @ApiPropertyOptional()
  economic_activity?: string;

  @ApiPropertyOptional({ example: 'Colombia' })
  country?: string;

  @ApiPropertyOptional()
  department?: string;

  @ApiPropertyOptional()
  municipality?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  address?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'ID de software DIAN/NextPyme de la empresa.',
  })
  idSoftware?: string;

  @ApiPropertyOptional({
    description: 'Token de autenticación NextPyme de la empresa.',
  })
  tokenNextPyme?: string;
}
