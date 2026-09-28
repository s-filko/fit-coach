import { EmbeddingService, disposeAllEmbeddingServices } from '../embedding.service';

let resolveLoad: (pipeline: unknown) => void = () => {
  throw new Error('resolveLoad called before a load started');
};

jest.mock('@huggingface/transformers', () => ({
  pipeline: jest.fn(
    () =>
      new Promise(resolve => {
        resolveLoad = resolve;
      }),
  ),
}));

describe('EmbeddingService.dispose (review advisory 2)', () => {
  const makeMockPipeline = () => ({
    dispose: jest.fn().mockResolvedValue(undefined),
  });

  it('awaits an in-flight load before releasing, so a dispose issued during loading still releases the session', async () => {
    const service = new EmbeddingService();
    const mockPipeline = makeMockPipeline();

    const warmUpPromise = service.warmUp();
    // Let the `await import('@huggingface/transformers')` inside init() resolve and the mocked
    // pipeline() call actually happen, so `resolveLoad` is assigned — its own promise is still
    // pending at this point.
    await new Promise(resolve => setImmediate(resolve));

    // dispose() is issued while that pipeline() call is still pending — this.pipeline is still
    // null at this point.
    const disposePromise = service.dispose();

    resolveLoad(mockPipeline);
    await Promise.all([warmUpPromise, disposePromise]);

    expect(mockPipeline.dispose).toHaveBeenCalledTimes(1);

    // The instance must not have re-registered itself after dispose() returned —
    // a later sweep must find nothing left of it to dispose.
    mockPipeline.dispose.mockClear();
    await disposeAllEmbeddingServices();
    expect(mockPipeline.dispose).not.toHaveBeenCalled();
  });
});
