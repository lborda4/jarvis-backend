import { SiigoPurchaseAiRecoveryService } from './siigo-purchase-ai-recovery.service';

function setup() {
  const documents = {
    findMissingPurchaseAiSuggestions: jest.fn().mockResolvedValue(
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
      documents as never,
      classifier as never,
      router as never,
    ),
  };
}

describe('recovery al entrar a una empresa', () => {
  it('solo clasifica documentos de esa empresa', async () => {
    const { service, documents, classifier } = setup();
    await service.recoverForCompany('company');
    expect(documents.findMissingPurchaseAiSuggestions).toHaveBeenCalledWith(
      'company',
    );
    expect(classifier.classifyDocuments).toHaveBeenCalledWith(
      Array.from({ length: 40 }, (_, i) => String(i)),
      'company',
    );
  });

  it('no arranca otra pasada de la misma empresa mientras la anterior sigue', async () => {
    const { service, classifier, documents } = setup();
    let finish!: () => void;
    classifier.classifyDocuments.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const first = service.recoverForCompany('company');
    await service.recoverForCompany('company');
    expect(documents.findMissingPurchaseAiSuggestions).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  it('no vuelve a revisar la misma empresa tras una pasada', async () => {
    const { service, documents } = setup();
    await service.recoverForCompany('company');
    await service.recoverForCompany('company');
    expect(documents.findMissingPurchaseAiSuggestions).toHaveBeenCalledTimes(1);
  });

  it('no llama IA si OpenRouter no está configurado o no hay empresa', async () => {
    const { service, router, documents } = setup();
    router.isConfigured.mockReturnValue(false);
    await service.recoverForCompany('company');
    router.isConfigured.mockReturnValue(true);
    await service.recoverForCompany('  ');
    expect(documents.findMissingPurchaseAiSuggestions).not.toHaveBeenCalled();
  });
});
