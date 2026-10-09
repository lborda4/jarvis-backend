import { UnauthorizedException } from '@nestjs/common';
import { BoldWebhookService } from './bold-webhook.service';
import { computeBoldWebhookSignature } from './helpers/bold-webhook-signature.helper';

const BODY = '{"id":"n1","type":"SALE_APPROVED","data":{"payment_id":"PAY1","merchant_id":"M1","amount":{"currency":"COP","total":1500},"metadata":{"reference":"ref-1"}}}';
const SECRET = 'company-secret';

function setup(overrides?: {
  envKey?: string;
  integrations?: Array<{ companyId: string; credentials: { secret_key?: string } }>;
}) {
  const events = { insertIfNew: jest.fn().mockResolvedValue('inserted') };
  const integrations = {
    findAllActiveByProvider: jest
      .fn()
      .mockResolvedValue(overrides?.integrations ?? [
        { companyId: 'company-1', credentials: { secret_key: SECRET } },
      ]),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'bold') return { key: overrides?.envKey };
      return undefined;
    }),
  };
  const service = new BoldWebhookService(
    events as never,
    integrations as never,
    configService as never,
  );
  return { service, events };
}

describe('BoldWebhookService', () => {
  const signature = computeBoldWebhookSignature(BODY, SECRET);
  const testSignature = computeBoldWebhookSignature(BODY, '');
  const payload = JSON.parse(BODY);

  it('production persists an approved sale signed with the company secret', async () => {
    const { service, events } = setup();
    await expect(
      service.receiveProduction({ rawBody: BODY, signature, body: payload }),
    ).resolves.toEqual({ received: true });
    expect(events.insertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: 'n1',
        companyId: 'company-1',
        environment: 'production',
        type: 'SALE_APPROVED',
        paymentId: 'PAY1',
        reference: 'ref-1',
        merchantId: 'M1',
        amountTotal: '1500.00',
        amountCurrency: 'COP',
        payload,
      }),
    );
  });

  it('production still returns 200 when Bold retries the same notification', async () => {
    const { service, events } = setup();
    events.insertIfNew.mockResolvedValue('duplicate');
    await expect(
      service.receiveProduction({ rawBody: BODY, signature, body: payload }),
    ).resolves.toEqual({ received: true });
  });

  it('production rejects a missing, invalid or empty test-mode signature', async () => {
    const { service, events } = setup();
    await expect(
      service.receiveProduction({
        rawBody: BODY,
        signature: undefined,
        body: payload,
      }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.receiveProduction({
        rawBody: BODY,
        signature: computeBoldWebhookSignature(BODY, 'wrong'),
        body: payload,
      }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.receiveProduction({
        rawBody: BODY,
        signature: testSignature,
        body: payload,
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(events.insertIfNew).not.toHaveBeenCalled();
  });

  it('test accepts the empty Bold test-mode secret and prefixes the id', async () => {
    const { service, events } = setup();
    await expect(
      service.receiveTest({
        rawBody: BODY,
        signature: testSignature,
        body: payload,
      }),
    ).resolves.toEqual({ received: true });
    expect(events.insertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: 'test:n1',
        companyId: 'company-1',
        environment: 'test',
      }),
    );
  });

  it('test rejects a production HMAC', async () => {
    const { service, events } = setup();
    await expect(
      service.receiveTest({ rawBody: BODY, signature, body: payload }),
    ).rejects.toThrow(UnauthorizedException);
    expect(events.insertIfNew).not.toHaveBeenCalled();
  });
});
