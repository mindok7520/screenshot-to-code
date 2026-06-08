export function extractApiErrorMessage(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;

  if (Array.isArray(record.detail)) {
    const messages = record.detail.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const msg = (item as Record<string, unknown>).msg;
      return typeof msg === "string" ? [msg] : [];
    });
    if (messages.length > 0) return messages.join("; ");
  }

  return null;
}

export async function readApiErrorMessage(
  response: Response,
  fallbackMessage = `Request failed with status ${response.status}`
): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return fallbackMessage;

  try {
    return extractApiErrorMessage(JSON.parse(text)) || text;
  } catch {
    return text;
  }
}

export function formatErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (error instanceof Error && error.message.trim()) {
    return `${fallbackMessage} ${error.message}`;
  }
  return fallbackMessage;
}
