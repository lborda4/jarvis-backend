import { selectProductsForClassificationPrompt } from './siigo-ai-account-suggestion.service';

function buildProduct(code: string, name: string) {
  return { code, name };
}

describe('selectProductsForClassificationPrompt', () => {
  it('deja pasar el catálogo intacto cuando está por debajo del límite', () => {
    const products = [
      buildProduct('P1', 'Producto uno'),
      buildProduct('P2', 'Producto dos'),
    ];

    expect(selectProductsForClassificationPrompt(['X'], products)).toEqual(
      products,
    );
  });

  it('caso real reportado: catálogo grande (textilera) sin ningún producto relacionado con snacks queda vacío, en vez de mandar "los primeros N" que no aportan nada', () => {
    const products = Array.from({ length: 200 }, (_, index) =>
      buildProduct(`TEL-${index}`, `Tela ripstop referencia ${index}`),
    );

    const selected = selectProductsForClassificationPrompt(
      ['PONY MALTA GO PET 20', 'GALLETA MUUU LECHE C'],
      products,
    );

    expect(selected).toEqual([]);
  });

  it('con catálogo grande, se queda solo con los productos que comparten alguna palabra con la descripción del ítem', () => {
    const products = [
      ...Array.from({ length: 200 }, (_, index) =>
        buildProduct(`TEL-${index}`, `Tela ripstop referencia ${index}`),
      ),
      buildProduct('GALLETA-001', 'Galleta de leche surtida'),
    ];

    const selected = selectProductsForClassificationPrompt(
      ['GALLETA MUUU LECHE C'],
      products,
    );

    expect(selected).toEqual([
      buildProduct('GALLETA-001', 'Galleta de leche surtida'),
    ]);
  });

  it('recorta a MAX_PRODUCTS_FOR_CLASSIFICATION_PROMPT aunque haya muchos matches', () => {
    const products = Array.from({ length: 200 }, (_, index) =>
      buildProduct(`GALLETA-${index}`, `Galleta surtida ${index}`),
    );

    const selected = selectProductsForClassificationPrompt(
      ['GALLETA MUUU LECHE C'],
      products,
    );

    expect(selected.length).toBe(80);
  });

  it('ignora palabras de menos de 4 letras al buscar coincidencias (poco discriminantes)', () => {
    const products = Array.from({ length: 200 }, (_, index) =>
      buildProduct(`X-${index}`, `Producto de tela sin relación ${index}`),
    );

    // "de" (2 letras) no debería matchear con "Producto de tela..." en todos.
    const selected = selectProductsForClassificationPrompt(['de'], products);

    expect(selected).toEqual([]);
  });
});
