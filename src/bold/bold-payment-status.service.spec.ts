import { BoldPaymentStatusService } from './bold-payment-status.service';

function setup() {
  const events = { findProductionByReference: jest.fn().mockResolvedValue([]) };
  const config = { get: () => ({ accessSecret: 'test-secret' }) };
  const service = new BoldPaymentStatusService(events as never, config as never);
  return { service, events, token: service.issue('company-1', 'ref-1', 1000) };
}

const approved = { type: 'SALE_APPROVED', paymentId: 'PAY1', amountTotal: '1000.00', amountCurrency: 'COP' };

describe('Bold payment status', () => {
  it('waits without a production webhook', async () => {
    const { service, events, token } = setup();
    await expect(service.getStatus(token)).resolves.toEqual({ reference: 'ref-1', status: 'PENDING' });
    expect(events.findProductionByReference).toHaveBeenCalledWith('company-1', 'ref-1');
  });
  it('approves only the matching amount', async () => {
    const { service, events, token } = setup();
    events.findProductionByReference.mockResolvedValue([approved]);
    await expect(service.getStatus(token)).resolves.toHaveProperty('status', 'APPROVED');
    events.findProductionByReference.mockResolvedValue([{ ...approved, amountTotal: '2000.00' }]);
    await expect(service.getStatus(token)).resolves.toHaveProperty('status', 'PENDING');
  });
  it('does not report a voided sale as approved', async () => {
    const { service, events, token } = setup();
    events.findProductionByReference.mockResolvedValue([approved, { ...approved, type: 'VOID_APPROVED' }]);
    await expect(service.getStatus(token)).resolves.toHaveProperty('status', 'VOIDED');
  });
  it('reports rejected sales and ignores rejected voids', async () => {
    const { service, events, token } = setup();
    events.findProductionByReference.mockResolvedValue([{ ...approved, type: 'SALE_REJECTED' }]);
    await expect(service.getStatus(token)).resolves.toHaveProperty('status', 'REJECTED');
    events.findProductionByReference.mockResolvedValue([approved, { ...approved, type: 'VOID_REJECTED' }]);
    await expect(service.getStatus(token)).resolves.toHaveProperty('status', 'APPROVED');
  });
  it('rejects tampered or expired capabilities before querying', async () => {
    const { service, events, token } = setup();
    await expect(service.getStatus(`x${token}`)).rejects.toThrow();
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000);
    try { await expect(service.getStatus(token)).rejects.toThrow(); } finally { now.mockRestore(); }
    expect(events.findProductionByReference).not.toHaveBeenCalled();
  });
});
