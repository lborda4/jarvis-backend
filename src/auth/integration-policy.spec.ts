import { AuthService } from './auth.service';
const policy = 'jarvis-terms-2026-10-08-v1';
function setup() {
  const query = jest.fn().mockResolvedValue([]);
  const call = (user = 'user', company: string | null = 'company', id = policy, accept = false) => AuthService.prototype.integrationPolicyAcceptance.call({ dataSource: { query } }, user, company, id, accept);
  return { query, call };
}
it('consulta por usuario, empresa y versión', async () => {
  const { query, call } = setup(); query.mockResolvedValue([{ accepted_at: new Date() }]);
  expect(await call()).toEqual({ accepted: true });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id=$1 AND company_id=$2 AND policy_id=$3'), ['user', 'company', policy]);
});
it('guarda una copia del texto y su hash sin reemplazar aceptaciones anteriores', async () => {
  const { query, call } = setup(); query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ accepted_at: new Date() }]);
  expect(await call('user', 'company', policy, true)).toEqual({ accepted: true });
  expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('DO NOTHING'), ['user', 'company', policy, '1.0', expect.stringContaining('JARVIS'), expect.stringMatching(/^[a-f0-9]{64}$/)]);
});
it('rechaza políticas desconocidas o empresas no identificadas', async () => {
  const { query, call } = setup();
  await expect(call('user', null)).rejects.toThrow();
  await expect(call('user', 'company', 'toString')).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
