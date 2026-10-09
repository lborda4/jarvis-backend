import { UnauthorizedException } from '@nestjs/common';
import { BoldWebhookService } from './bold-webhook.service';
import { computeBoldWebhookSignature } from './helpers/bold-webhook-signature.helper';

const BODY = '{"id":"n1","type":"SALE_APPROVED","data":{"payment_id":"PAY1","merchant_id":"M1","amount":{"currency":"COP","total":1500},"metadata":{"reference":"ref-1"}}}';
const SECRET = 'company-secret';

function setup(overrides?: {
  nodeEnv?: string;
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
      if (key === 'app.nodeEnv') return overrides?.nodeEnv ?? 'local';
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
  const payload = JSON.parse(BODY);

  it('persists an approved sale when the HMAC matches the company secret', async () => {
    const { service, events } = setup();
    await expect(
      service.receive({ rawBody: BODY, signature, body: payload }),
    ).resolves.toEqual({ received: true });
    expect(events.insertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: 'n1',
        companyId: 'company-1',
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

  it('still returns 200 when Bold retries the same notification', async () => {
    const { service, events } = setup();
    events.insertIfNew.mockResolvedValue('duplicate');
    await expect(
      service.receive({ rawBody: BODY, signature, body: payload }),
    ).resolves.toEqual({ received: true });
  });

  it('rejects a missing or invalid signature', async () => {
    const { service, events } = setup();
    await expect(
      service.receive({ rawBody: BODY, signature: undefined, body: payload }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.receive({
        rawBody: BODY,
        signature: computeBoldWebhookSignature(BODY, 'wrong'),
        body: payload,
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(events.insertIfNew).not.toHaveBeenCalled();
  });

  it('accepts the empty test-mode secret only outside production', async () => {
    const testSignature = computeBoldWebhookSignature(BODY, '');
    const local = setup({
      nodeEnv: 'local',
      integrations: [{ companyId: 'company-1', credentials: {} }],
    });
    await expect(
      local.service.receive({
        rawBody: BODY,
        signature: testSignature,
        body: payload,
      }),
    ).resolves.toEqual({ received: true });

    const production = setup({
      nodeEnv: 'production',
      integrations: [{ companyId: 'company-1', credentials: {} }],
    });
    await expect(
      production.service.receive({
        rawBody: BODY,
        signature: testSignature,
        body: payload,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
