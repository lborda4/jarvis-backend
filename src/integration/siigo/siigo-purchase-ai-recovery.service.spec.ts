import { SiigoPurchaseAiRecoveryService } from './siigo-purchase-ai-recovery.service';

function setup() {
  const documents = {
    findMissingPurchaseAiSuggestions: jest
      .fn()
      .mockResolvedValue(
        Array.from({ length: 40 }, (_, id) => ({
          id: String(id),
          companyId: 'company',
        })),
      ),
  };
  const classifier = {
    classifyDocuments: jest.fn().mockResolvedValue(undefined),
  };
  const router = { isConfigured: jest.fn().mockReturnValue(true) };
  return {
    documents,
    classifier,
    router,
    service: new SiigoPurchaseAiRecoveryService(
      documents as any,
      classifier as any,
      router as any,
    ),
  };
}

describe('recovery of omitted import batches', () => {
  it('recovers all 40 missing documents from durable storage, scoped by company', async () => {
    const { service, documents, classifier } = setup();
    await service.recoverMissingSuggestions();
    expect(classifier.classifyDocuments).toHaveBeenCalledWith(
      Array.from({ length: 40 }, (_, i) => String(i)),
      'company',
    );
    await service.recoverMissingSuggestions();
    expect(
      documents.findMissingPurchaseAiSuggestions.mock.calls[1][0],
    ).toHaveLength(40);
  });
  it('retries after errors and after restart without depending on the original import callback', async () => {
    const { service, classifier, documents } = setup();
    classifier.classifyDocuments.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(service.recoverMissingSuggestions()).rejects.toThrow();
    await service.recoverMissingSuggestions();
    expect(documents.findMissingPurchaseAiSuggestions).toHaveBeenCalledTimes(2);
    const restarted = setup();
    await restarted.service.recoverMissingSuggestions();
    expect(
      restarted.documents.findMissingPurchaseAiSuggestions,
    ).toHaveBeenCalledWith([]);
  });
  it('does not call AI when disabled or after shutdown', async () => {
    const { service, router, documents } = setup();
    router.isConfigured.mockReturnValue(false);
    await service.recoverMissingSuggestions();
    router.isConfigured.mockReturnValue(true);
    service.onApplicationShutdown();
    await service.recoverMissingSuggestions();
    expect(documents.findMissingPurchaseAiSuggestions).not.toHaveBeenCalled();
  });
});
