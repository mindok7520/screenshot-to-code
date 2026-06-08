import toast from "react-hot-toast";
import { WS_BACKEND_URL } from "./config";
import {
  APP_ERROR_WEB_SOCKET_CODE,
  USER_CLOSE_WEB_SOCKET_CODE,
} from "./constants";
import {
  GENERATION_ERROR_MESSAGE,
  resolveGenerationFailureMessage,
} from "./lib/generation-errors";
import { FullGenerationSettings } from "./types";

const CANCEL_MESSAGE = "Code generation cancelled";
const INVALID_BACKEND_RESPONSE_MESSAGE = "Invalid backend response.";

type WebSocketResponseData = {
  models?: string[];
  name?: string;
  input?: unknown;
  output?: unknown;
  ok?: boolean;
};

type WebSocketResponse = {
  type:
    | "chunk"
    | "status"
    | "setCode"
    | "error"
    | "variantComplete"
    | "variantError"
    | "variantCount"
    | "variantModels"
    | "thinking"
    | "assistant"
    | "toolStart"
    | "toolResult";
  value?: string;
  data?: WebSocketResponseData;
  eventId?: string;
  variantIndex: number;
};

interface CodeGenerationCallbacks {
  isActive?: () => boolean;
  onChange: (chunk: string, variantIndex: number) => void;
  onSetCode: (code: string, variantIndex: number) => void;
  onStatusUpdate: (status: string, variantIndex: number) => void;
  onVariantComplete: (variantIndex: number) => void;
  onVariantError: (variantIndex: number, error: string) => void;
  onVariantCount: (count: number) => void;
  onVariantModels: (models: string[]) => void;
  onThinking: (content: string, variantIndex: number, eventId?: string) => void;
  onAssistant: (content: string, variantIndex: number, eventId?: string) => void;
  onToolStart: (
    data: WebSocketResponseData | undefined,
    variantIndex: number,
    eventId?: string
  ) => void;
  onToolResult: (
    data: WebSocketResponseData | undefined,
    variantIndex: number,
    eventId?: string
  ) => void;
  onCancel: (
    reason: "user_cancelled" | "request_failed" | "connection_error",
    errorMessage?: string
  ) => void;
  onComplete: () => void;
}

export function generateCode(
  wsRef: React.MutableRefObject<WebSocket | null>,
  params: FullGenerationSettings,
  callbacks: CodeGenerationCallbacks
) {
  const wsUrl = `${WS_BACKEND_URL}/generate-code`;
  console.log("Connecting to backend @ ", wsUrl);

  const previousWs = wsRef.current;
  wsRef.current = null;
  if (
    previousWs &&
    previousWs.readyState !== WebSocket.CLOSING &&
    previousWs.readyState !== WebSocket.CLOSED
  ) {
    previousWs.close(USER_CLOSE_WEB_SOCKET_CODE);
  }

  const ws = new WebSocket(wsUrl);
  wsRef.current = ws;
  let lastServerErrorMessage: string | undefined;
  const isCurrentConnection = () =>
    wsRef.current === ws && (callbacks.isActive?.() ?? true);

  ws.addEventListener("open", () => {
    if (!isCurrentConnection()) return;
    ws.send(JSON.stringify(params));
  });

  ws.addEventListener("message", async (event: MessageEvent) => {
    if (!isCurrentConnection()) return;

    let response: WebSocketResponse;
    try {
      response = JSON.parse(event.data) as WebSocketResponse;
    } catch (error) {
      console.error("Invalid WebSocket response", error);
      lastServerErrorMessage = INVALID_BACKEND_RESPONSE_MESSAGE;
      toast.error(INVALID_BACKEND_RESPONSE_MESSAGE);
      ws.close(APP_ERROR_WEB_SOCKET_CODE, INVALID_BACKEND_RESPONSE_MESSAGE);
      return;
    }

    if (response.type === "chunk") {
      callbacks.onChange(response.value || "", response.variantIndex);
    } else if (response.type === "status") {
      callbacks.onStatusUpdate(response.value || "", response.variantIndex);
    } else if (response.type === "setCode") {
      callbacks.onSetCode(response.value || "", response.variantIndex);
    } else if (response.type === "variantComplete") {
      callbacks.onVariantComplete(response.variantIndex);
    } else if (response.type === "variantError") {
      callbacks.onVariantError(response.variantIndex, response.value || "");
    } else if (response.type === "variantCount") {
      callbacks.onVariantCount(parseInt(response.value || "1"));
    } else if (response.type === "variantModels") {
      callbacks.onVariantModels(response.data?.models || []);
    } else if (response.type === "thinking") {
      callbacks.onThinking(response.value || "", response.variantIndex, response.eventId);
    } else if (response.type === "assistant") {
      callbacks.onAssistant(response.value || "", response.variantIndex, response.eventId);
    } else if (response.type === "toolStart") {
      callbacks.onToolStart(response.data, response.variantIndex, response.eventId);
    } else if (response.type === "toolResult") {
      callbacks.onToolResult(response.data, response.variantIndex, response.eventId);
    } else if (response.type === "error") {
      console.error("Error generating code", response.value);
      lastServerErrorMessage = response.value;
      toast.error(resolveGenerationFailureMessage({
        serverErrorMessage: lastServerErrorMessage,
      }));
    }
  });

  ws.addEventListener("close", (event) => {
    const wasCurrentConnection = wsRef.current === ws;
    if (wasCurrentConnection) {
      wsRef.current = null;
    }

    if (!wasCurrentConnection || !(callbacks.isActive?.() ?? true)) {
      return;
    }

    console.log("Connection closed", event.code, event.reason);
    if (event.code === USER_CLOSE_WEB_SOCKET_CODE) {
      toast.success(CANCEL_MESSAGE);
      callbacks.onCancel("user_cancelled");
    } else if (event.code === APP_ERROR_WEB_SOCKET_CODE) {
      console.error("Known server error", event);
      const errorMessage = resolveGenerationFailureMessage({
        closeReason: event.reason,
        serverErrorMessage: lastServerErrorMessage,
      });
      if (!lastServerErrorMessage) {
        toast.error(errorMessage);
      }
      callbacks.onCancel("request_failed", errorMessage);
    } else if (event.code !== 1000) {
      console.error("Unknown server or connection error", event);
      const errorMessage = resolveGenerationFailureMessage({
        closeReason: event.reason,
        serverErrorMessage: lastServerErrorMessage,
      });
      toast.error(errorMessage);
      callbacks.onCancel("connection_error", errorMessage);
    } else {
      callbacks.onComplete();
    }
  });

  ws.addEventListener("error", (error) => {
    if (!isCurrentConnection()) return;

    console.error("WebSocket error", error);
    toast.error(GENERATION_ERROR_MESSAGE);
  });
}
