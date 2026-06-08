import {
  createHttpDesignSystemsRequest,
  formatDesignSystemsError,
} from "./design-systems";

jest.mock("../config", () => ({
  HTTP_BACKEND_URL: "http://backend.test",
}));

describe("design systems API client", () => {
  test("sends JSON requests and parses successful responses", async () => {
    const fetcher = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "design-system-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const request = createHttpDesignSystemsRequest(
      "http://backend.test/",
      fetcher as typeof fetch
    );

    await expect(
      request<{ id: string }>("/api/design-systems", {
        method: "POST",
        body: { name: "Brand", content: "# Tokens" },
      })
    ).resolves.toEqual({ id: "design-system-1" });

    expect(fetcher).toHaveBeenCalledWith(
      "http://backend.test/api/design-systems",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Brand", content: "# Tokens" }),
      }
    );
  });

  test("extracts FastAPI detail errors", async () => {
    const fetcher = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "Design system not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const request = createHttpDesignSystemsRequest(
      "http://backend.test",
      fetcher as typeof fetch
    );

    await expect(request("/api/design-systems/missing")).rejects.toThrow(
      "Design system not found"
    );
  });

  test("extracts FastAPI validation messages", async () => {
    const fetcher = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            detail: [
              { msg: "Field required", loc: ["body", "name"] },
              { msg: "String should have at least 1 character" },
            ],
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
    const request = createHttpDesignSystemsRequest(
      "http://backend.test",
      fetcher as typeof fetch
    );

    await expect(request("/api/design-systems")).rejects.toThrow(
      "Field required; String should have at least 1 character"
    );
  });

  test("returns undefined for successful empty responses", async () => {
    const fetcher = jest.fn(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    const request = createHttpDesignSystemsRequest(
      "http://backend.test",
      fetcher as typeof fetch
    );

    await expect(request<void>("/api/design-systems/1")).resolves.toBe(
      undefined
    );
  });

  test("formats user-facing error messages", () => {
    expect(
      formatDesignSystemsError(
        new Error("Design systems storage is not valid JSON"),
        "Could not load design systems from the backend."
      )
    ).toBe(
      "Could not load design systems from the backend. Design systems storage is not valid JSON"
    );

    expect(formatDesignSystemsError("failed", "Could not save.")).toBe(
      "Could not save."
    );
  });
});
