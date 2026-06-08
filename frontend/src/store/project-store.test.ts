describe("project store hydration", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("deduplicates concurrent hydrate calls", async () => {
    let resolveSnapshot: (value: string | null) => void = () => undefined;
    const readProjectSnapshot = jest.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveSnapshot = resolve;
        })
    );
    const writeProjectSnapshot = jest.fn();

    jest.doMock("./project-persistence", () => ({
      readProjectSnapshot,
      writeProjectSnapshot,
    }));

    const { useProjectStore } = await import("./project-store");

    const firstHydration = useProjectStore.getState().hydrateProject();
    const secondHydration = useProjectStore.getState().hydrateProject();

    expect(readProjectSnapshot).toHaveBeenCalledTimes(1);

    resolveSnapshot(null);
    await Promise.all([firstHydration, secondHydration]);

    expect(useProjectStore.getState().hasHydrated).toBe(true);
  });

  test("does not re-read snapshots after hydration completes", async () => {
    const readProjectSnapshot = jest.fn<Promise<string | null>, [string]>(() =>
      Promise.resolve(null)
    );
    const writeProjectSnapshot = jest.fn();

    jest.doMock("./project-persistence", () => ({
      readProjectSnapshot,
      writeProjectSnapshot,
    }));

    const { useProjectStore } = await import("./project-store");

    await useProjectStore.getState().hydrateProject();
    await useProjectStore.getState().hydrateProject();

    expect(readProjectSnapshot).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().hasHydrated).toBe(true);
  });

  test("skips invalid persisted commits and falls back to latest valid commit", async () => {
    const snapshot = {
      version: 1,
      state: {
        inputMode: "text",
        referenceImages: [],
        initialPrompt: "Create a pricing page",
        assetsById: {},
        commits: {
          "bad-commit": {
            hash: "bad-commit",
            dateCreated: "2026-06-08T09:00:00.000Z",
          },
          "invalid-date": {
            hash: "invalid-date",
            parentHash: null,
            dateCreated: "not-a-date",
            isCommitted: false,
            selectedVariantIndex: 0,
            type: "ai_create",
            inputs: { text: "Broken", images: [], videos: [] },
            variants: [{ code: "", history: [], status: "complete" }],
          },
          "commit-1": {
            hash: "commit-1",
            parentHash: null,
            dateCreated: "2026-06-08T10:00:00.000Z",
            isCommitted: false,
            selectedVariantIndex: 99,
            type: "ai_create",
            inputs: { text: "Create a pricing page", images: [], videos: [] },
            variants: [
              "broken-variant",
              {
                code: "<html>Pricing</html>",
                history: "not-an-array",
                agentEvents: "not-an-array",
                status: "complete",
              },
            ],
          },
        },
        head: "bad-commit",
        latestCommitHash: "commit-1",
        executionConsoles: {
          0: "not-an-array",
          1: ["line-1", 123, "line-2"],
        },
      },
    };
    const readProjectSnapshot = jest.fn<Promise<string | null>, [string]>(() =>
      Promise.resolve(JSON.stringify(snapshot))
    );
    const writeProjectSnapshot = jest.fn();

    jest.doMock("./project-persistence", () => ({
      readProjectSnapshot,
      writeProjectSnapshot,
    }));

    const { useProjectStore } = await import("./project-store");

    await useProjectStore.getState().hydrateProject();

    const state = useProjectStore.getState();
    expect(Object.keys(state.commits)).toEqual(["commit-1"]);
    expect(state.head).toBe("commit-1");
    expect(state.latestCommitHash).toBe("commit-1");
    expect(state.commits["commit-1"].dateCreated).toBeInstanceOf(Date);
    expect(state.commits["commit-1"].selectedVariantIndex).toBe(0);
    expect(state.commits["commit-1"].variants).toHaveLength(1);
    expect(state.commits["commit-1"].variants[0].history).toEqual([]);
    expect(state.commits["commit-1"].variants[0].agentEvents).toEqual([]);
    expect(state.executionConsoles).toEqual({ 1: ["line-1", "line-2"] });
  });

  test("restores interrupted generations as retryable errors", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_717_808_400_000);

    const snapshot = {
      version: 1,
      state: {
        inputMode: "image",
        referenceImages: ["data:image/png;base64,input"],
        initialPrompt: "Create a checkout page",
        assetsById: {
          "asset-1": {
            id: "asset-1",
            type: "image",
            dataUrl: "data:image/png;base64,input",
          },
        },
        commits: {
          "commit-1": {
            hash: "commit-1",
            parentHash: null,
            dateCreated: "2026-06-08T10:00:00.000Z",
            isCommitted: false,
            selectedVariantIndex: 0,
            type: "ai_create",
            inputs: {
              text: "Create a checkout page",
              images: ["data:image/png;base64,input"],
              videos: [],
            },
            variants: [
              {
                code: "",
                history: [
                  {
                    role: "user",
                    text: "Create a checkout page",
                    imageAssetIds: ["asset-1"],
                    videoAssetIds: [],
                  },
                ],
                status: "generating",
                requestStartedAt: 1_717_808_000_000,
                agentEvents: [
                  {
                    id: "tool-1",
                    type: "tool",
                    status: "running",
                    toolName: "generate",
                    startedAt: 1_717_808_000_000,
                  },
                ],
              },
              {
                code: "<html>done</html>",
                history: [],
                status: "complete",
                completedAt: 1_717_808_100_000,
                agentEvents: [
                  {
                    id: "assistant-1",
                    type: "assistant",
                    status: "complete",
                    startedAt: 1_717_808_000_000,
                    endedAt: 1_717_808_100_000,
                  },
                ],
              },
            ],
          },
        },
        head: "commit-1",
        latestCommitHash: "commit-1",
        executionConsoles: {
          0: Array.from({ length: 250 }, (_, index) => `line-${index}`),
        },
      },
    };
    const readProjectSnapshot = jest.fn<Promise<string | null>, [string]>(() =>
      Promise.resolve(JSON.stringify(snapshot))
    );
    const writeProjectSnapshot = jest.fn();

    jest.doMock("./project-persistence", () => ({
      readProjectSnapshot,
      writeProjectSnapshot,
    }));

    const { useProjectStore } = await import("./project-store");

    await useProjectStore.getState().hydrateProject();

    const state = useProjectStore.getState();
    const commit = state.commits["commit-1"];

    expect(state.head).toBe("commit-1");
    expect(commit.dateCreated).toBeInstanceOf(Date);
    expect(commit.variants[0]).toMatchObject({
      status: "error",
      errorMessage:
        "Generation was interrupted before it finished. Retry to run it again.",
      completedAt: 1_717_808_400_000,
    });
    expect(commit.variants[0].agentEvents?.[0]).toMatchObject({
      status: "error",
      endedAt: 1_717_808_400_000,
    });
    expect(commit.variants[1]).toMatchObject({
      status: "complete",
      completedAt: 1_717_808_100_000,
    });
    expect(state.executionConsoles[0]).toHaveLength(200);
    expect(state.executionConsoles[0][0]).toBe("line-50");
  });
});
