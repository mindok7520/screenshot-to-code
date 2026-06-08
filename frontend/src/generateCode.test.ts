import toast from "react-hot-toast";
import {
  APP_ERROR_WEB_SOCKET_CODE,
  USER_CLOSE_WEB_SOCKET_CODE,
} from "./constants";
import { generateCode } from "./generateCode";
import { FullGenerationSettings } from "./types";

jest.mock("./config", () => ({
  WS_BACKEND_URL: "ws://backend.test",
}));

jest.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

type FakeWebSocketEvent = {
  code?: number;
  data?: string;
  reason?: string;
};

type FakeWebSocketListener = (event: FakeWebSocketEvent) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  readonly sentMessages: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners: Record<string, FakeWebSocketListener[]> = {};

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: FakeWebSocketListener) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  send(message: string) {
    this.sentMessages.push(message);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSING;
    this.emit("close", { code: code ?? 1000, reason: reason ?? "" });
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(type: string, event: FakeWebSocketEvent) {
    this.listeners[type]?.forEach((listener) => listener(event));
  }
}

const params = {
  generationType: "create",
} as unknown as FullGenerationSettings;

function createCallbacks(isActive: () => boolean = () => true) {
  return {
    isActive,
    onChange: jest.fn(),
    onSetCode: jest.fn(),
    onStatusUpdate: jest.fn(),
    onVariantComplete: jest.fn(),
    onVariantError: jest.fn(),
    onVariantCount: jest.fn(),
    onVariantModels: jest.fn(),
    onThinking: jest.fn(),
    onAssistant: jest.fn(),
    onToolStart: jest.fn(),
    onToolResult: jest.fn(),
    onCancel: jest.fn(),
    onComplete: jest.fn(),
  };
}

describe("generateCode", () => {
  const originalWebSocket = globalThis.WebSocket;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: FakeWebSocket,
    });
  });

  afterEach(() => {
    if (originalWebSocket) {
      Object.defineProperty(globalThis, "WebSocket", {
        configurable: true,
        value: originalWebSocket,
      });
    } else {
      Reflect.deleteProperty(globalThis, "WebSocket");
    }
    consoleLog.mockRestore();
    consoleError.mockRestore();
    jest.clearAllMocks();
  });

  test("closes and ignores a previous connection when a new generation starts", () => {
    let activeGenerationId = 1;
    const wsRef = { current: null as WebSocket | null };
    const firstCallbacks = createCallbacks(() => activeGenerationId === 1);

    generateCode(wsRef, params, firstCallbacks);
    const firstSocket = FakeWebSocket.instances[0];

    activeGenerationId = 2;
    const secondCallbacks = createCallbacks(() => activeGenerationId === 2);
    generateCode(wsRef, params, secondCallbacks);
    const secondSocket = FakeWebSocket.instances[1];

    expect(firstSocket.closeCalls).toEqual([
      { code: USER_CLOSE_WEB_SOCKET_CODE, reason: undefined },
    ]);
    expect(firstCallbacks.onCancel).not.toHaveBeenCalled();
    expect(firstCallbacks.onComplete).not.toHaveBeenCalled();
    expect(wsRef.current).toBe(secondSocket);
  });

  test("does not notify the previous callbacks when superseding a connection", () => {
    const wsRef = { current: null as WebSocket | null };
    const firstCallbacks = createCallbacks();

    generateCode(wsRef, params, firstCallbacks);
    const firstSocket = FakeWebSocket.instances[0];

    generateCode(wsRef, params, createCallbacks());

    expect(firstSocket.closeCalls).toEqual([
      { code: USER_CLOSE_WEB_SOCKET_CODE, reason: undefined },
    ]);
    expect(firstCallbacks.onCancel).not.toHaveBeenCalled();
    expect(firstCallbacks.onComplete).not.toHaveBeenCalled();
  });

  test("ignores stale messages when the active generation changed", () => {
    let isActive = true;
    const wsRef = { current: null as WebSocket | null };
    const callbacks = createCallbacks(() => isActive);

    generateCode(wsRef, params, callbacks);
    const socket = FakeWebSocket.instances[0];

    isActive = false;
    socket.emit("message", {
      data: JSON.stringify({ type: "chunk", value: "hello", variantIndex: 0 }),
    });

    expect(callbacks.onChange).not.toHaveBeenCalled();
  });

  test("clears the active socket ref when the current connection closes", () => {
    const wsRef = { current: null as WebSocket | null };
    const callbacks = createCallbacks();

    generateCode(wsRef, params, callbacks);
    const socket = FakeWebSocket.instances[0];

    socket.close(1000);

    expect(wsRef.current).toBeNull();
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
  });

  test("turns malformed backend messages into a request failure", () => {
    const wsRef = { current: null as WebSocket | null };
    const callbacks = createCallbacks();

    generateCode(wsRef, params, callbacks);
    const socket = FakeWebSocket.instances[0];

    socket.emit("message", { data: "not-json" });

    expect(toast.error).toHaveBeenCalledWith("Invalid backend response.");
    expect(socket.closeCalls).toEqual([
      {
        code: APP_ERROR_WEB_SOCKET_CODE,
        reason: "Invalid backend response.",
      },
    ]);
    expect(callbacks.onCancel).toHaveBeenCalledWith(
      "request_failed",
      "Invalid backend response."
    );
  });
});
