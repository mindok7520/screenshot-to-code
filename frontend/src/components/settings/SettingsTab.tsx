import React, { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { LuLogIn, LuLogOut, LuRefreshCw } from "react-icons/lu";
import { AppTheme, EditorTheme, Settings } from "../../types";
import { capitalize } from "../../lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { HTTP_BACKEND_URL } from "../../config";
import { Button } from "../ui/button";

interface Props {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  appTheme: AppTheme;
  setAppTheme: React.Dispatch<React.SetStateAction<AppTheme>>;
}

interface CodexAuthStatus {
  authenticated: boolean;
  codex_home: string;
  email: string | null;
  account_id: string | null;
  plan_type: string | null;
  error: string | null;
}

interface CodexLoginStart {
  login_id: string;
  auth_url: string;
  port: number;
}

interface CodexReasoningLevel {
  effort: string;
  description: string | null;
}

interface CodexModelOption {
  slug: string;
  display_name: string;
  description: string | null;
  default_reasoning_effort: string | null;
  supported_reasoning_levels: CodexReasoningLevel[];
}

interface CodexModelsResponse {
  models: CodexModelOption[];
}

const FALLBACK_CODEX_MODEL = "gpt-5.5";
const FALLBACK_REASONING_EFFORT = "high";

function buildCodexModelValue(slug: string, effort: string) {
  if (effort === "none") {
    return `${slug} (no thinking)`;
  }
  return `${slug} (${effort} thinking)`;
}

function parseCodexModelValue(value: string | null | undefined) {
  if (!value) {
    return { slug: FALLBACK_CODEX_MODEL, effort: FALLBACK_REASONING_EFFORT };
  }
  const match = value.match(/^(.+) \((.+) thinking\)$/);
  if (!match) {
    return { slug: FALLBACK_CODEX_MODEL, effort: FALLBACK_REASONING_EFFORT };
  }
  return {
    slug: match[1],
    effort: match[2] === "no" ? "none" : match[2],
  };
}

function getReasoningEfforts(model: CodexModelOption | undefined) {
  return model?.supported_reasoning_levels.map((level) => level.effort) ?? [];
}

function pickReasoningEffort(
  model: CodexModelOption,
  preferredEffort?: string
) {
  const efforts = getReasoningEfforts(model);
  if (preferredEffort && efforts.includes(preferredEffort)) {
    return preferredEffort;
  }
  if (efforts.includes(FALLBACK_REASONING_EFFORT)) {
    return FALLBACK_REASONING_EFFORT;
  }
  if (
    model.default_reasoning_effort &&
    efforts.includes(model.default_reasoning_effort)
  ) {
    return model.default_reasoning_effort;
  }
  return efforts[0] ?? FALLBACK_REASONING_EFFORT;
}

function reasoningLabel(effort: string) {
  if (effort === "xhigh") return "XHigh";
  if (effort === "none") return "None";
  return capitalize(effort);
}

function SettingsTab({ settings, setSettings, appTheme, setAppTheme }: Props) {
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [codexModels, setCodexModels] = useState<CodexModelOption[]>([]);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isModelsLoading, setIsModelsLoading] = useState(false);
  const [isLoginPending, setIsLoginPending] = useState(false);

  const handleThemeChange = (theme: EditorTheme) => {
    setSettings((s) => ({
      ...s,
      editorTheme: theme,
    }));
  };

  const loadCodexStatus = useCallback(
    async (quiet = false): Promise<CodexAuthStatus | null> => {
      if (!quiet) {
        setIsAuthLoading(true);
      }
      try {
        const response = await fetch(`${HTTP_BACKEND_URL}/api/codex-auth/status`);
        if (!response.ok) {
          throw new Error(`Status request failed: ${response.status}`);
        }
        const status = (await response.json()) as CodexAuthStatus;
        setCodexStatus(status);
        return status;
      } catch (error) {
        console.error("Failed to load Codex auth status", error);
        if (!quiet) {
          toast.error("Could not read Codex account status.");
        }
        return null;
      } finally {
        if (!quiet) {
          setIsAuthLoading(false);
        }
      }
    },
    []
  );

  const loadCodexModels = useCallback(
    async (quiet = false): Promise<CodexModelOption[]> => {
      if (!quiet) {
        setIsModelsLoading(true);
      }
      try {
        const response = await fetch(`${HTTP_BACKEND_URL}/api/codex-auth/models`);
        if (!response.ok) {
          throw new Error(`Model list request failed: ${response.status}`);
        }
        const payload = (await response.json()) as CodexModelsResponse;
        const models = payload.models || [];
        setCodexModels(models);

        if (models.length > 0) {
          const current = parseCodexModelValue(settings.codeGenerationModel);
          const currentModel = models.find((model) => model.slug === current.slug);
          const currentEfforts = getReasoningEfforts(currentModel);
          if (!currentModel || !currentEfforts.includes(current.effort)) {
            const nextModel =
              models.find((model) => model.slug === FALLBACK_CODEX_MODEL) || models[0];
            const nextEffort = pickReasoningEffort(nextModel, current.effort);
            setSettings((prev) => ({
              ...prev,
              codeGenerationModel: buildCodexModelValue(nextModel.slug, nextEffort),
            }));
          }
        }

        return models;
      } catch (error) {
        console.error("Failed to load Codex models", error);
        if (!quiet) {
          toast.error("Could not load Codex model list.");
        }
        setCodexModels([]);
        return [];
      } finally {
        if (!quiet) {
          setIsModelsLoading(false);
        }
      }
    },
    [setSettings, settings.codeGenerationModel]
  );

  useEffect(() => {
    void loadCodexStatus();
  }, [loadCodexStatus]);

  useEffect(() => {
    if (codexStatus?.authenticated) {
      void loadCodexModels(true);
    } else {
      setCodexModels([]);
    }
  }, [codexStatus?.authenticated, loadCodexModels]);

  useEffect(() => {
    if (!isLoginPending) {
      return;
    }

    const startedAt = Date.now();
    const interval = window.setInterval(async () => {
      const status = await loadCodexStatus(true);
      if (status?.authenticated || Date.now() - startedAt > 120_000) {
        setIsLoginPending(false);
        window.clearInterval(interval);
      }
    }, 2_000);

    return () => window.clearInterval(interval);
  }, [isLoginPending, loadCodexStatus]);

  const handleCodexLogin = async () => {
    const loginWindow = window.open("about:blank", "_blank");
    if (loginWindow) {
      loginWindow.opener = null;
    }
    setIsAuthLoading(true);
    try {
      const response = await fetch(
        `${HTTP_BACKEND_URL}/api/codex-auth/login/start`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(`Login request failed: ${response.status}`);
      }
      const login = (await response.json()) as CodexLoginStart;
      if (loginWindow) {
        loginWindow.location.href = login.auth_url;
      } else {
        window.open(login.auth_url, "_blank", "noopener,noreferrer");
      }
      setIsLoginPending(true);
    } catch (error) {
      loginWindow?.close();
      console.error("Failed to start Codex login", error);
      toast.error("Could not start ChatGPT sign-in.");
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleCodexLogout = async () => {
    setIsAuthLoading(true);
    try {
      const response = await fetch(`${HTTP_BACKEND_URL}/api/codex-auth/logout`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Logout request failed: ${response.status}`);
      }
      await loadCodexStatus(true);
    } catch (error) {
      console.error("Failed to sign out of Codex", error);
      toast.error("Could not sign out.");
    } finally {
      setIsAuthLoading(false);
      setIsLoginPending(false);
    }
  };

  const selectedModel = parseCodexModelValue(settings.codeGenerationModel);
  const selectedModelOption =
    codexModels.find((model) => model.slug === selectedModel.slug) || codexModels[0];
  const selectedEfforts = getReasoningEfforts(selectedModelOption);
  const selectedEffort = selectedEfforts.includes(selectedModel.effort)
    ? selectedModel.effort
    : selectedModelOption
      ? pickReasoningEffort(selectedModelOption, selectedModel.effort)
      : selectedModel.effort;

  const handleCodexModelChange = (slug: string) => {
    const nextModel = codexModels.find((model) => model.slug === slug);
    if (!nextModel) {
      return;
    }
    const nextEffort = pickReasoningEffort(nextModel, selectedEffort);
    setSettings((prev) => ({
      ...prev,
      codeGenerationModel: buildCodexModelValue(nextModel.slug, nextEffort),
    }));
  };

  const handleReasoningEffortChange = (effort: string) => {
    const nextModel = selectedModelOption;
    if (!nextModel) {
      return;
    }
    setSettings((prev) => ({
      ...prev,
      codeGenerationModel: buildCodexModelValue(nextModel.slug, effort),
    }));
  };

  const handleRefreshCodex = async () => {
    const status = await loadCodexStatus();
    if (status?.authenticated) {
      await loadCodexModels();
    }
  };

  const authStatusLabel = codexStatus?.authenticated
    ? "Connected"
    : codexStatus?.error
      ? "Invalid"
      : isLoginPending
        ? "Waiting for login"
        : "Not connected";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-4 lg:px-6 lg:py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            Settings
          </h1>
        </div>

        <div className="mx-auto max-w-lg space-y-6">
          {/* Theme */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                Theme
              </h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-700">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm text-gray-700 dark:text-zinc-300">
                    App Theme
                  </span>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
                    System default, with optional light/dark override
                  </p>
                </div>
                <Select
                  name="app-theme"
                  value={appTheme}
                  onValueChange={(value) => setAppTheme(value as AppTheme)}
                >
                  <SelectTrigger className="w-[140px]">
                    {capitalize(appTheme)}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AppTheme.SYSTEM}>System</SelectItem>
                    <SelectItem value={AppTheme.LIGHT}>Light</SelectItem>
                    <SelectItem value={AppTheme.DARK}>Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm text-gray-700 dark:text-zinc-300">
                    Code Editor Theme
                  </span>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
                    Requires page refresh to update
                  </p>
                </div>
                <Select
                  name="editor-theme"
                  value={settings.editorTheme}
                  onValueChange={(value) =>
                    handleThemeChange(value as EditorTheme)
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <span className="notranslate" translate="no">
                      {capitalize(settings.editorTheme)}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cobalt">
                      <span className="notranslate" translate="no">Cobalt</span>
                    </SelectItem>
                    <SelectItem value="espresso">
                      <span className="notranslate" translate="no">Espresso</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Codex Account */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                Codex Account
              </h2>
            </div>
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        codexStatus?.authenticated
                          ? "bg-emerald-500"
                          : codexStatus?.error
                            ? "bg-red-500"
                            : "bg-gray-300 dark:bg-zinc-600"
                      }`}
                    />
                    <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                      {authStatusLabel}
                    </p>
                  </div>
                  {codexStatus?.authenticated && (
                    <div className="mt-2 space-y-1 text-xs text-gray-500 dark:text-zinc-400">
                      <p>{codexStatus.email || "ChatGPT account"}</p>
                      {codexStatus.plan_type && (
                        <p className="capitalize">{codexStatus.plan_type}</p>
                      )}
                      <p className="max-w-[18rem] truncate font-mono">
                        {codexStatus.account_id}
                      </p>
                    </div>
                  )}
                  {codexStatus?.error && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      {codexStatus.error}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void handleRefreshCodex()}
                  disabled={isAuthLoading || isModelsLoading}
                  title="Refresh"
                  aria-label="Refresh Codex account status"
                >
                  <LuRefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {codexStatus?.authenticated && (
                <div className="space-y-3 rounded-md border border-gray-100 p-3 dark:border-zinc-700">
                  <div className="grid grid-cols-3 items-center gap-3">
                    <span className="text-sm text-gray-700 dark:text-zinc-300">
                      Model
                    </span>
                    <Select
                      value={selectedModelOption?.slug ?? ""}
                      onValueChange={handleCodexModelChange}
                      disabled={isModelsLoading || codexModels.length === 0}
                    >
                      <SelectTrigger className="col-span-2">
                        <SelectValue placeholder="Load models" />
                      </SelectTrigger>
                      <SelectContent>
                        {codexModels.map((model) => (
                          <SelectItem key={model.slug} value={model.slug}>
                            {model.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 items-center gap-3">
                    <span className="text-sm text-gray-700 dark:text-zinc-300">
                      Reasoning
                    </span>
                    <Select
                      value={selectedEffort}
                      onValueChange={handleReasoningEffortChange}
                      disabled={isModelsLoading || selectedEfforts.length === 0}
                    >
                      <SelectTrigger className="col-span-2">
                        <SelectValue placeholder="Select effort" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedModelOption?.supported_reasoning_levels.map((level) => (
                          <SelectItem key={level.effort} value={level.effort}>
                            {reasoningLabel(level.effort)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleCodexLogin}
                  disabled={isAuthLoading || isLoginPending}
                  className="gap-2"
                >
                  <LuLogIn className="h-4 w-4" />
                  Sign in with ChatGPT
                </Button>
                {codexStatus?.authenticated && (
                  <Button
                    variant="outline"
                    onClick={handleCodexLogout}
                    disabled={isAuthLoading}
                    className="gap-2"
                  >
                    <LuLogOut className="h-4 w-4" />
                    Sign out
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Image Generation */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                Image Generation
              </h2>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-700 dark:text-zinc-300">
                    Placeholder Images
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                    More fun with it but if you want to save money, turn it off.
                  </p>
                </div>
                <Switch
                  id="image-generation"
                  checked={settings.isImageGenerationEnabled}
                  onCheckedChange={() =>
                    setSettings((s) => ({
                      ...s,
                      isImageGenerationEnabled: !s.isImageGenerationEnabled,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Screenshot by URL */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                Screenshot by URL
              </h2>
            </div>
            <div className="p-4">
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                If you want to use URLs directly instead of taking the screenshot
                yourself, add a ScreenshotOne API key.{" "}
                <a
                  href="https://screenshotone.com?via=screenshot-to-code"
                  className="text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
                  target="_blank"
                >
                  Get 100 screenshots/mo for free.
                </a>
              </p>
              <Input
                id="screenshot-one-api-key"
                className="mt-3"
                placeholder="ScreenshotOne API key"
                value={settings.screenshotOneApiKey || ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    screenshotOneApiKey: e.target.value,
                  }))
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsTab;
