/**
 * Aplica `mapper` a cada elemento de `items` con un máximo de `concurrency`
 * ejecuciones en simultáneo (en vez de esperar cada una antes de lanzar la
 * siguiente, como hace un `for...of` con `await`, ni lanzarlas todas de una
 * con `Promise.all` sin límite). Pensado para lotes de llamadas HTTP/IO
 * (ej. una consulta por fila de un Excel importado).
 *
 * El resultado conserva el orden original de `items`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: limit }, () => worker()),
  );

  return results;
}
