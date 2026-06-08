import {
  extractApiErrorMessage,
  formatErrorMessage,
  readApiErrorMessage,
} from "./api-errors";

describe("api error helpers", () => {
  test("extracts common API error shapes", () => {
    expect(extractApiErrorMessage({ detail: "Invalid URL" })).toBe(
      "Invalid URL"
    );
    expect(extractApiErrorMessage({ message: "Not found" })).toBe(
      "Not found"
    );
    expect(extractApiErrorMessage({ error: "Provider failed" })).toBe(
      "Provider failed"
    );
    expect(
      extractApiErrorMessage({
        detail: [{ msg: "Field required" }, { msg: "Invalid value" }],
      })
    ).toBe("Field required; Invalid value");
  });

  test("reads response error details", async () => {
    await expect(
      readApiErrorMessage(
        new Response(JSON.stringify({ detail: "Unsupported protocol: ftp" }), {
          status: 400,
        })
      )
    ).resolves.toBe("Unsupported protocol: ftp");
  });

  test("falls back to status when the response body is empty", async () => {
    await expect(
      readApiErrorMessage(new Response(null, { status: 502 }))
    ).resolves.toBe("Request failed with status 502");
  });

  test("formats user-facing fallback messages", () => {
    expect(
      formatErrorMessage(
        new Error("Screenshot provider returned 401"),
        "Failed to capture screenshot."
      )
    ).toBe("Failed to capture screenshot. Screenshot provider returned 401");

    expect(formatErrorMessage("failed", "Failed to capture screenshot.")).toBe(
      "Failed to capture screenshot."
    );
  });
});
