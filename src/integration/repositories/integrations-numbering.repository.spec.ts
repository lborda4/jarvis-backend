import { IntegrationsRepository } from './integrations.repository';
import { JarvisResolutionKind } from '../jarvis/enums/jarvis-resolution-kind.enum';
import { JarvisInvoiceHistoryService } from '../jarvis/jarvis-invoice-history.service';

const resolution = { kind: JarvisResolutionKind.CREDIT_NOTE, prefix: 'NC', fromNumber: 1, toNumber: 1000, nextConsecutive: 43 };

it('avanza la hoja de resolución de forma atómica, aislada por empresa, proveedor y prefijo', async () => {
  const query = jest.fn().mockResolvedValue([{ id: 'integration' }]);
  const repository = new IntegrationsRepository({ query } as never);
  await repository.advanceJarvisResolutionNumber('owner', 'credit_note', resolution as never);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('GREATEST(');
  expect(sql).toContain("'{resolutions}'");
  expect(sql).toContain('company_id=$1 AND provider=$2 AND active=true');
  expect(sql).toContain('SELECT id FROM advanced');
  expect(params).toEqual(['owner', 'JARVIS', 'credit_note', JSON.stringify(resolution), 'NC']);
});

it('detiene la reserva si la resolución cambió o dejó de pertenecer a la empresa', async () => {
  const repository = new IntegrationsRepository({ query: jest.fn().mockResolvedValue([]) } as never);
  await expect(repository.advanceJarvisResolutionNumber('owner', 'credit_note', resolution as never)).rejects.toThrow('prefijo cambió');
});

it.each(['0', '42'])('consulta el máximo enviado (%s) con alcance de empresa, tipo y prefijo', async lastNumber => {
  const query = jest.fn().mockResolvedValue([{ lastNumber }]);
  const history = new JarvisInvoiceHistoryService({ query } as never);
  expect(await history.lastIssuedNumber('owner', JarvisResolutionKind.CREDIT_NOTE, 'NC')).toBe(Number(lastNumber));
  const [sql, params] = query.mock.calls[0];
  expect(params).toEqual(['owner', 'CREDIT_NOTE', 'NC']);
  expect(sql).toContain('MAX(CASE');
  expect(sql).toContain('company_id=$1 AND document_kind=$2 AND prefix=$3');
  expect(sql).toContain('SUBSTRING(number FROM LENGTH($3)+1)::numeric');
  expect(sql).not.toContain('jarvis_invoice_drafts');
});

it.each([undefined, '-1', '9007199254740993'])('no interpreta un historial inválido (%s) como un prefijo sin uso', async lastNumber => {
  const history = new JarvisInvoiceHistoryService({ query: jest.fn().mockResolvedValue([{ lastNumber }]) } as never);
  await expect(history.lastIssuedNumber('owner', JarvisResolutionKind.CREDIT_NOTE, 'NC')).rejects.toThrow('último consecutivo');
});
