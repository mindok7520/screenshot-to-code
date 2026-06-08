import { resolveGenerationFailureMessage } from "./generation-errors";

describe("resolveGenerationFailureMessage", () => {
  test("prefers a WebSocket close reason", () => {
    expect(
      resolveGenerationFailureMessage({
        closeReason: "keepalive ping timeout",
        serverErrorMessage: "Backend request failed",
      })
    ).toBe("keepalive ping timeout");
  });

  test("falls back to the last server error message", () => {
    expect(
      resolveGenerationFailureMessage({
        closeReason: "   ",
        serverErrorMessage: "Sign in with ChatGPT before generating code.",
      })
    ).toBe("Sign in with ChatGPT before generating code.");
  });

  test("uses a generic message when no specific failure is available", () => {
    expect(resolveGenerationFailureMessage({})).toMatch(
      /^Error generating code\./
    );
  });
});
