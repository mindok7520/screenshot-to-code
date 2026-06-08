import { create } from "zustand";
import {
  AgentEvent,
  Commit,
  CommitHash,
  Variant,
  VariantHistoryMessage,
  VariantStatus,
} from "../components/commits/types";
import { PromptAsset } from "../types";
import {
  readProjectSnapshot,
  writeProjectSnapshot,
} from "./project-persistence";

const PROJECT_SNAPSHOT_KEY = "screenshot-to-code-project-v1";
const PROJECT_SNAPSHOT_VERSION = 1;
const INTERRUPTED_GENERATION_MESSAGE =
  "Generation was interrupted before it finished. Retry to run it again.";
const MAX_PERSISTED_CONSOLE_LINES = 200;

type PersistedProjectState = {
  inputMode: ProjectStore["inputMode"];
  referenceImages: string[];
  initialPrompt: string;
  assetsById: Record<string, PromptAsset>;
  commits: Record<string, Commit>;
  head: CommitHash | null;
  latestCommitHash: CommitHash | null;
  executionConsoles: { [key: number]: string[] };
};

type ProjectSnapshot = {
  version: typeof PROJECT_SNAPSHOT_VERSION;
  savedAt: number;
  state: PersistedProjectState;
};

// Store for app-wide state
interface ProjectStore {
  hasHydrated: boolean;
  hydrateProject: () => Promise<void>;

  // Inputs
  inputMode: "image" | "video" | "text";
  setInputMode: (mode: "image" | "video" | "text") => void;
  referenceImages: string[];
  setReferenceImages: (images: string[]) => void;
  initialPrompt: string;
  setInitialPrompt: (prompt: string) => void;
  assetsById: Record<string, PromptAsset>;
  upsertPromptAssets: (assets: PromptAsset[]) => void;
  resetPromptAssets: () => void;

  // Outputs
  commits: Record<string, Commit>;
  head: CommitHash | null;
  latestCommitHash: CommitHash | null;

  addCommit: (commit: Commit) => void;
  removeCommit: (hash: CommitHash) => void;
  resetCommits: () => void;

  appendCommitCode: (
    hash: CommitHash,
    numVariant: number,
    code: string
  ) => void;
  appendVariantThinking: (
    hash: CommitHash,
    numVariant: number,
    thinking: string
  ) => void;
  setCommitCode: (hash: CommitHash, numVariant: number, code: string) => void;
  appendVariantHistoryMessage: (
    hash: CommitHash,
    numVariant: number,
    message: VariantHistoryMessage
  ) => void;
  updateSelectedVariantIndex: (hash: CommitHash, index: number) => void;
  updateVariantStatus: (
    hash: CommitHash,
    numVariant: number,
    status: VariantStatus,
    errorMessage?: string
  ) => void;
  resizeVariants: (hash: CommitHash, count: number) => void;
  setVariantModels: (hash: CommitHash, models: string[]) => void;

  startAgentEvent: (
    hash: CommitHash,
    numVariant: number,
    event: AgentEvent
  ) => void;
  appendAgentEventContent: (
    hash: CommitHash,
    numVariant: number,
    eventId: string,
    content: string
  ) => void;
  finishAgentEvent: (
    hash: CommitHash,
    numVariant: number,
    eventId: string,
    updates: Partial<AgentEvent>
  ) => void;

  setHead: (hash: CommitHash) => void;
  resetHead: () => void;

  executionConsoles: { [key: number]: string[] };
  appendExecutionConsole: (variantIndex: number, line: string) => void;
  resetExecutionConsoles: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoreHistoryMessage(
  message: unknown
): VariantHistoryMessage | null {
  if (!isRecord(message)) return null;
  if (message.role !== "user" && message.role !== "assistant") return null;

  return {
    role: message.role,
    text: typeof message.text === "string" ? message.text : "",
    imageAssetIds: Array.isArray(message.imageAssetIds)
      ? message.imageAssetIds.filter((assetId): assetId is string => typeof assetId === "string")
      : [],
    videoAssetIds: Array.isArray(message.videoAssetIds)
      ? message.videoAssetIds.filter((assetId): assetId is string => typeof assetId === "string")
      : [],
  };
}

function restoreAgentEvent(event: unknown, now: number): AgentEvent | null {
  if (!isRecord(event)) return null;
  if (typeof event.id !== "string") return null;
  if (
    event.type !== "thinking" &&
    event.type !== "assistant" &&
    event.type !== "tool"
  ) {
    return null;
  }
  if (
    event.status !== "running" &&
    event.status !== "complete" &&
    event.status !== "error"
  ) {
    return null;
  }

  const wasRunning = event.status === "running";
  return {
    id: event.id,
    type: event.type,
    status: wasRunning ? "error" : event.status,
    content: typeof event.content === "string" ? event.content : undefined,
    toolName: typeof event.toolName === "string" ? event.toolName : undefined,
    input: event.input,
    output: event.output,
    startedAt: typeof event.startedAt === "number" ? event.startedAt : now,
    endedAt: wasRunning
      ? typeof event.endedAt === "number"
        ? event.endedAt
        : now
      : typeof event.endedAt === "number"
        ? event.endedAt
        : undefined,
  };
}

function isVariantStatus(status: unknown): status is VariantStatus {
  return (
    status === "generating" ||
    status === "complete" ||
    status === "cancelled" ||
    status === "error"
  );
}

function restoreVariant(variant: unknown): Variant | null {
  if (!isRecord(variant)) return null;

  const wasGenerating = variant.status === "generating";
  const restoredStatus: VariantStatus | undefined = wasGenerating
    ? "error"
    : isVariantStatus(variant.status)
      ? variant.status
      : undefined;
  const now = Date.now();
  return {
    code: typeof variant.code === "string" ? variant.code : "",
    history: Array.isArray(variant.history)
      ? variant.history.flatMap((message) => {
          const restoredMessage = restoreHistoryMessage(message);
          return restoredMessage ? [restoredMessage] : [];
        })
      : [],
    requestStartedAt:
      typeof variant.requestStartedAt === "number"
        ? variant.requestStartedAt
        : undefined,
    completedAt: wasGenerating
      ? now
      : typeof variant.completedAt === "number"
        ? variant.completedAt
        : undefined,
    status: restoredStatus,
    errorMessage: wasGenerating
      ? INTERRUPTED_GENERATION_MESSAGE
      : typeof variant.errorMessage === "string"
        ? variant.errorMessage
        : undefined,
    thinking: typeof variant.thinking === "string" ? variant.thinking : undefined,
    thinkingStartTime:
      typeof variant.thinkingStartTime === "number"
        ? variant.thinkingStartTime
        : undefined,
    thinkingDuration:
      typeof variant.thinkingDuration === "number"
        ? variant.thinkingDuration
        : undefined,
    agentEvents: Array.isArray(variant.agentEvents)
      ? variant.agentEvents.flatMap((event) => {
          const restoredEvent = restoreAgentEvent(event, now);
          return restoredEvent ? [restoredEvent] : [];
        })
      : [],
    model: typeof variant.model === "string" ? variant.model : undefined,
  };
}

function restoreCommit(commit: unknown): Commit | null {
  if (!isRecord(commit) || !Array.isArray(commit.variants)) {
    return null;
  }

  const rawVariants = commit.variants;
  const commitRecord = commit as Partial<Commit>;
  const dateCreated = new Date(commitRecord.dateCreated || "");
  if (Number.isNaN(dateCreated.getTime())) {
    return null;
  }

  const variants = rawVariants.flatMap((variant) => {
    const restoredVariant = restoreVariant(variant);
    return restoredVariant ? [restoredVariant] : [];
  });
  if (variants.length === 0) return null;

  const selectedVariantIndex =
    typeof commitRecord.selectedVariantIndex === "number"
      ? Math.min(
          Math.max(0, Math.floor(commitRecord.selectedVariantIndex)),
          variants.length - 1
        )
      : 0;

  return {
    ...(commitRecord as Commit),
    dateCreated,
    variants,
    selectedVariantIndex,
  };
}

function pruneExecutionConsoles(
  executionConsoles: unknown
): ProjectStore["executionConsoles"] {
  if (!isRecord(executionConsoles)) return {};

  return Object.fromEntries(
    Object.entries(executionConsoles).flatMap(([variantIndex, lines]) => {
      if (!Array.isArray(lines)) return [];
      return [
        [
          variantIndex,
          lines
            .filter((line): line is string => typeof line === "string")
            .slice(-MAX_PERSISTED_CONSOLE_LINES),
        ],
      ];
    })
  );
}

function buildSnapshot(state: ProjectStore): ProjectSnapshot {
  return {
    version: PROJECT_SNAPSHOT_VERSION,
    savedAt: Date.now(),
    state: {
      inputMode: state.inputMode,
      referenceImages: state.referenceImages,
      initialPrompt: state.initialPrompt,
      assetsById: state.assetsById,
      commits: state.commits,
      head: state.head,
      latestCommitHash: state.latestCommitHash,
      executionConsoles: pruneExecutionConsoles(state.executionConsoles),
    },
  };
}

function parseSnapshot(raw: string | null): PersistedProjectState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ProjectSnapshot>;
    if (parsed.version !== PROJECT_SNAPSHOT_VERSION || !parsed.state) {
      return null;
    }

    const restoredCommitEntries = Object.entries(
      parsed.state.commits || {}
    ).flatMap(([hash, commit]) => {
      const restoredCommit = restoreCommit(commit);
      return restoredCommit ? ([[hash, restoredCommit]] as const) : [];
    });
    const restoredCommits: Record<string, Commit> = Object.fromEntries(
      restoredCommitEntries
    );
    const latestCommitHashCandidate =
      parsed.state.latestCommitHash &&
      restoredCommits[parsed.state.latestCommitHash]
        ? parsed.state.latestCommitHash
        : null;
    const head =
      parsed.state.head && restoredCommits[parsed.state.head]
        ? parsed.state.head
        : latestCommitHashCandidate;
    const latestCommitHash = latestCommitHashCandidate ?? head;

    return {
      inputMode: parsed.state.inputMode || "image",
      referenceImages: parsed.state.referenceImages || [],
      initialPrompt: parsed.state.initialPrompt || "",
      assetsById: parsed.state.assetsById || {},
      commits: restoredCommits,
      head,
      latestCommitHash,
      executionConsoles: pruneExecutionConsoles(
        parsed.state.executionConsoles || {}
      ),
    };
  } catch (error) {
    console.warn("Failed to parse project snapshot", error);
    return null;
  }
}

let saveTimeoutId: number | null = null;
let hydrationPromise: Promise<void> | null = null;

function scheduleProjectSnapshotSave() {
  if (typeof window === "undefined") return;
  if (!useProjectStore.getState().hasHydrated) return;

  if (saveTimeoutId) {
    window.clearTimeout(saveTimeoutId);
  }

  saveTimeoutId = window.setTimeout(() => {
    saveTimeoutId = null;
    const state = useProjectStore.getState();
    const snapshot = buildSnapshot(state);
    void writeProjectSnapshot(PROJECT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  }, 300);
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  hasHydrated: false,
  hydrateProject: async () => {
    if (get().hasHydrated) return;
    if (hydrationPromise) return hydrationPromise;

    hydrationPromise = (async () => {
      try {
        const snapshot = parseSnapshot(
          await readProjectSnapshot(PROJECT_SNAPSHOT_KEY)
        );

        if (!snapshot) {
          set({ hasHydrated: true });
          return;
        }

        set({
          ...snapshot,
          hasHydrated: true,
        });
      } catch (error) {
        console.warn("Failed to hydrate project snapshot", error);
        set({ hasHydrated: true });
      } finally {
        hydrationPromise = null;
      }
    })();

    return hydrationPromise;
  },

  // Inputs and their setters
  inputMode: "image",
  setInputMode: (mode) => set({ inputMode: mode }),
  referenceImages: [],
  setReferenceImages: (images) => set({ referenceImages: images }),
  initialPrompt: "",
  setInitialPrompt: (prompt) => set({ initialPrompt: prompt }),
  assetsById: {},
  upsertPromptAssets: (assets) =>
    set((state) => {
      if (assets.length === 0) return state;
      const merged = { ...state.assetsById };
      for (const asset of assets) {
        merged[asset.id] = asset;
      }
      return { assetsById: merged };
    }),
  resetPromptAssets: () => set({ assetsById: {} }),

  // Outputs
  commits: {},
  head: null,
  latestCommitHash: null,

  addCommit: (commit: Commit) => {
    const requestStartedAt = new Date(commit.dateCreated).getTime();
    // Initialize variant statuses as 'generating' and start thinking timer
    const commitsWithStatus = {
      ...commit,
      variants: commit.variants.map((variant) => ({
        ...variant,
        history: variant.history || [],
        requestStartedAt:
          variant.requestStartedAt ?? requestStartedAt,
        status: variant.status || ("generating" as VariantStatus),
        thinkingStartTime: Date.now(),
        agentEvents: [],
      })),
    };

    // When adding a new commit, make sure all existing commits are marked as committed
    set((state) => ({
      commits: {
        ...Object.fromEntries(
          Object.entries(state.commits).map(([hash, existingCommit]) => [
            hash,
            { ...existingCommit, isCommitted: true },
          ])
        ),
        [commitsWithStatus.hash]: commitsWithStatus,
      },
      latestCommitHash: commitsWithStatus.hash,
    }));
  },
  removeCommit: (hash: CommitHash) => {
    set((state) => {
      const removedCommit = state.commits[hash];
      const newCommits = { ...state.commits };
      delete newCommits[hash];

      // If removing the latest commit, fall back to its parent
      const newLatestCommitHash =
        state.latestCommitHash === hash
          ? (removedCommit?.parentHash ?? null)
          : state.latestCommitHash;

      return { commits: newCommits, latestCommitHash: newLatestCommitHash };
    });
  },
  resetCommits: () => set({ commits: {}, latestCommitHash: null }),

  appendCommitCode: (hash: CommitHash, numVariant: number, code: string) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit) {
        return state;
      }
      // Don't update if the commit is already committed
      if (commit.isCommitted) {
        return state;
      }
      const variant = commit.variants[numVariant];
      const isFirstCode = !variant.code && variant.thinkingStartTime;
      const duration = isFirstCode
        ? Math.round((Date.now() - variant.thinkingStartTime!) / 1000)
        : variant.thinkingDuration;
      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((v, index) =>
              index === numVariant
                ? { ...v, code: v.code + code, thinkingDuration: duration }
                : v
            ),
          },
        },
      };
    }),
  appendVariantThinking: (hash: CommitHash, numVariant: number, thinking: string) =>
    set((state) => {
      const commit = state.commits[hash];
      // Don't update if the commit is already committed
      if (commit.isCommitted) {
        throw new Error("Attempted to append thinking to a committed commit");
      }
      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((v, index) =>
              index === numVariant
                ? {
                    ...v,
                    thinking: (v.thinking || "") + thinking,
                  }
                : v
            ),
          },
        },
      };
    }),
  setCommitCode: (hash: CommitHash, numVariant: number, code: string) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit) {
        return state;
      }
      // Don't update if the commit is already committed
      if (commit.isCommitted) {
        return state;
      }
      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((variant, index) =>
              index === numVariant ? { ...variant, code } : variant
            ),
          },
        },
      };
    }),
  appendVariantHistoryMessage: (hash, numVariant, message) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => {
        if (index !== numVariant) return variant;
        const history = variant.history || [];
        const last = history[history.length - 1];
        const isDuplicate =
          last &&
          last.role === message.role &&
          last.text === message.text &&
          last.imageAssetIds.join("|") === message.imageAssetIds.join("|") &&
          last.videoAssetIds.join("|") === message.videoAssetIds.join("|");
        if (isDuplicate) return variant;
        return { ...variant, history: [...history, message] };
      });
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),
  updateSelectedVariantIndex: (hash: CommitHash, index: number) =>
    set((state) => {
      const commit = state.commits[hash];
      // Don't update if the commit is already committed
      if (commit.isCommitted) {
        throw new Error(
          "Attempted to update selected variant index of a committed commit"
        );
      }

      // Just update the selected variant index without canceling other variants
      // This allows users to switch between variants even while they're still generating
      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            selectedVariantIndex: index,
          },
        },
      };
    }),
  updateVariantStatus: (
    hash: CommitHash,
    numVariant: number,
    status: VariantStatus,
    errorMessage?: string
  ) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit) return state; // No change if commit doesn't exist

      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((variant, index) =>
              index === numVariant 
                ? {
                    ...variant,
                    status,
                    completedAt:
                      status === "generating"
                        ? undefined
                        : variant.completedAt ?? Date.now(),
                    errorMessage: status === "error" ? errorMessage : undefined,
                  }
                : variant
            ),
          },
        },
      };
    }),
  resizeVariants: (hash: CommitHash, count: number) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit) return state; // No change if commit doesn't exist

      // Resize variants array to match backend count
      const currentVariants = commit.variants;
      const requestStartedAt = new Date(commit.dateCreated).getTime();
      const seedHistory = currentVariants[0]?.history || [];
      const newVariants = Array(count).fill(null).map((_, index) => 
        currentVariants[index] || {
          code: "",
          history: seedHistory.map((message) => ({
            ...message,
            imageAssetIds: [...message.imageAssetIds],
            videoAssetIds: [...message.videoAssetIds],
          })),
          requestStartedAt,
          status: "generating" as VariantStatus,
          agentEvents: [],
        }
      );

      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: newVariants,
            selectedVariantIndex: Math.min(commit.selectedVariantIndex, count - 1),
          },
        },
      };
    }),
  setVariantModels: (hash: CommitHash, models: string[]) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => ({
        ...variant,
        model: models[index] ?? variant.model,
      }));
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),

  startAgentEvent: (hash, numVariant, event) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => {
        if (index !== numVariant) return variant;
        const events = variant.agentEvents || [];
        const existingIndex = events.findIndex((e) => e.id === event.id);
        if (existingIndex === -1) {
          return { ...variant, agentEvents: [...events, event] };
        }
        const updatedEvents = events.map((e) =>
          e.id === event.id
            ? {
                ...e,
                ...event,
                content: event.content ? event.content : e.content,
                startedAt: e.startedAt || event.startedAt,
              }
            : e
        );
        return { ...variant, agentEvents: updatedEvents };
      });
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),

  appendAgentEventContent: (hash, numVariant, eventId, content) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => {
        if (index !== numVariant) return variant;
        const events = variant.agentEvents || [];
        const updatedEvents = events.map((event) =>
          event.id === eventId
            ? { ...event, content: (event.content || "") + content }
            : event
        );
        return { ...variant, agentEvents: updatedEvents };
      });
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),

  finishAgentEvent: (hash, numVariant, eventId, updates) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => {
        if (index !== numVariant) return variant;
        const events = variant.agentEvents || [];
        const updatedEvents = events.map((event) =>
          event.id === eventId
            ? {
                ...event,
                ...updates,
                // Preserve the original terminal timestamp/status once set.
                endedAt:
                  event.endedAt !== undefined ? event.endedAt : updates.endedAt,
                status:
                  event.status !== "running" ? event.status : updates.status ?? event.status,
              }
            : event
        );
        return { ...variant, agentEvents: updatedEvents };
      });
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),

  setHead: (hash: CommitHash) => set({ head: hash }),
  resetHead: () => set({ head: null }),

  executionConsoles: {},
  appendExecutionConsole: (variantIndex: number, line: string) =>
    set((state) => ({
      executionConsoles: {
        ...state.executionConsoles,
        [variantIndex]: [
          ...(state.executionConsoles[variantIndex] || []),
          line,
        ],
      },
    })),
  resetExecutionConsoles: () => set({ executionConsoles: {} }),
}));

if (typeof window !== "undefined") {
  useProjectStore.subscribe(scheduleProjectSnapshotSave);

  window.addEventListener("pagehide", () => {
    if (saveTimeoutId) {
      window.clearTimeout(saveTimeoutId);
      saveTimeoutId = null;
    }

    const state = useProjectStore.getState();
    if (!state.hasHydrated) return;

    const snapshot = buildSnapshot(state);
    void writeProjectSnapshot(PROJECT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  });
}
