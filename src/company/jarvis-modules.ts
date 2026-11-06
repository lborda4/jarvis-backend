import { BadRequestException } from '@nestjs/common';

export type JarvisModule = 'BILLING' | 'PAYROLL';
export const DEFAULT_JARVIS_MODULES: JarvisModule[] = ['BILLING', 'PAYROLL'];

export function validateJarvisModules(value: unknown): JarvisModule[] {
  if (!Array.isArray(value) || !value.length || value.some(module => !DEFAULT_JARVIS_MODULES.includes(module))) {
    throw new BadRequestException('Selecciona Facturación, Nómina o ambos módulos de Jarvis.');
  }
  return [...new Set(value)] as JarvisModule[];
}
