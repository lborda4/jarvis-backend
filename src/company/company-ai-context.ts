import { BadRequestException } from '@nestjs/common';
export interface CompanyAiContext {
  description: string;
  rules: string[];
  blockedAccounts?: string[];
}
export function readCompanyAiContext(value: unknown): CompanyAiContext {
  if (typeof value === 'string') return { description: value, rules: [] };
  const context = value as Partial<CompanyAiContext> | null;
  return {
    ...(Array.isArray(context?.blockedAccounts)
      ? {
          blockedAccounts: context.blockedAccounts.filter(
            (entry): entry is string => typeof entry === 'string',
          ),
        }
      : {}),
    description:
      typeof context?.description === 'string' ? context.description : '',
    rules: Array.isArray(context?.rules)
      ? context.rules.filter((rule): rule is string => typeof rule === 'string')
      : [],
  };
}
export function validateCompanyAiContext(value: unknown): CompanyAiContext {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException(
      'La configuración de IA debe incluir descripción y reglas.',
    );
  const { description, rules, blockedAccounts } = value as CompanyAiContext;
  if (
    blockedAccounts !== undefined &&
    (!Array.isArray(blockedAccounts) ||
      blockedAccounts.length > 100 ||
      blockedAccounts.some(
        (entry) =>
          typeof entry !== 'string' ||
          !entry.trim() ||
          entry.trim().length > 200,
      ))
  )
    throw new BadRequestException(
      'Las cuentas bloqueadas admiten hasta 100 nombres, expresiones o codigos de hasta 200 caracteres.',
    );
  if (typeof description !== 'string' || description.trim().length > 1000)
    throw new BadRequestException(
      'La descripción admite hasta 1000 caracteres.',
    );
  if (
    !Array.isArray(rules) ||
    rules.length > 10 ||
    rules.some(
      (rule) =>
        typeof rule !== 'string' || !rule.trim() || rule.trim().length > 500,
    )
  )
    throw new BadRequestException(
      'Agregue hasta 10 reglas no vacías, de máximo 500 caracteres cada una.',
    );
  return {
    ...(blockedAccounts !== undefined
      ? { blockedAccounts: blockedAccounts.map((entry) => entry.trim()) }
      : {}),
    description: description.trim(),
    rules: rules.map((rule) => rule.trim()),
  };
}
export function companyDescriptionForPrompt(
  value: unknown,
  includePurchaseRules: boolean,
): string | null {
  const context = readCompanyAiContext(value);
  const rules = includePurchaseRules ? context.rules : [];
  if (!rules.length) return context.description.trim() || null;
  return [
    context.description.trim(),
    'Reglas de contabilización definidas por la empresa para facturas de compra:',
    'Aplica las reglas pertinentes al concepto y destino de cada ítem. Si difieren del histórico, prioriza la regla explícita. Conserva las restricciones del catálogo y el formato de respuesta. No inventes códigos.',
    ...rules.map((rule, index) => String(index + 1) + '. ' + rule),
  ]
    .filter(Boolean)
    .join('\n');
}
