import { of } from 'rxjs';
import { OpenRouterHttpClient } from './openrouter-http.client';

describe('OpenRouterHttpClient response validation', () => {
  const context = { purpose: 'test' };
  function setup(content: string, finishReason = 'stop') {
    const logs = {
      createPending: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const http = {
      post: jest.fn().mockReturnValue(
        of({
          status: 200,
          data: {
            choices: [{ finish_reason: finishReason, message: { content } }],
          },
        }),
      ),
    };
    const config = {
      get: () => ({
        apiKey: 'test',
        model: 'test',
        baseUrl: 'https://example.test',
      }),
    };
    return {
      logs,
      client: new OpenRouterHttpClient(http as any, config as any, logs as any),
    };
  }

  it.each([
    ['', 'stop'],
    ['  ', 'stop'],
    ['{"items":[]}', 'length'],
    ['invalid', 'stop'],
    ['null', 'stop'],
    ['[]', 'stop'],
  ])('rejects unusable answer %s (%s)', async (content, reason) => {
    const { client, logs } = setup(content, reason);
    await expect(
      client.createChatCompletion([], { context }),
    ).rejects.toThrow();
    expect(logs.markFailed).toHaveBeenCalledTimes(1);
    expect(logs.markCompleted).not.toHaveBeenCalled();
  });

  it('returns a complete JSON answer', async () => {
    const { client, logs } = setup('{"itemType":"Account"}');
    await expect(
      client.createChatCompletion([], { context }),
    ).resolves.toMatchObject({ content: '{"itemType":"Account"}' });
    expect(logs.markCompleted).toHaveBeenCalledTimes(1);
    expect(logs.markFailed).not.toHaveBeenCalled();
  });
});
