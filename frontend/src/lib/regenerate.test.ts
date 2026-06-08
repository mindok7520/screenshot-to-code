import { AiCreateCommit } from "../components/commits/types";
import { buildRegenerateRequest } from "./regenerate";

function createAiCreateCommit(
  inputs: AiCreateCommit["inputs"]
): AiCreateCommit {
  return {
    hash: "commit-1",
    parentHash: null,
    dateCreated: new Date("2026-06-08T10:00:00.000Z"),
    isCommitted: false,
    selectedVariantIndex: 0,
    type: "ai_create",
    inputs,
    variants: [{ code: "", history: [] }],
  };
}

describe("buildRegenerateRequest", () => {
  test("preserves image inputs and text prompt", () => {
    const commit = createAiCreateCommit({
      text: "Make it look like a billing dashboard",
      images: ["data:image/png;base64,one", "data:image/png;base64,two"],
      videos: [],
    });

    expect(buildRegenerateRequest(commit)).toEqual({
      inputMode: "image",
      media: ["data:image/png;base64,one", "data:image/png;base64,two"],
      textPrompt: "Make it look like a billing dashboard",
    });
  });

  test("preserves video input and text prompt", () => {
    const commit = createAiCreateCommit({
      text: "Recreate the animated menu",
      images: [],
      videos: ["data:video/webm;base64,clip"],
    });

    expect(buildRegenerateRequest(commit)).toEqual({
      inputMode: "video",
      media: ["data:video/webm;base64,clip"],
      textPrompt: "Recreate the animated menu",
    });
  });

  test("retries text-only create requests as text", () => {
    const commit = createAiCreateCommit({
      text: "Create a pricing page",
      images: [],
      videos: [],
    });

    expect(buildRegenerateRequest(commit)).toEqual({
      inputMode: "text",
      text: "Create a pricing page",
    });
  });
});
