import { AiCreateCommit } from "../components/commits/types";

export type RegenerateRequest =
  | {
      inputMode: "image" | "video";
      media: string[];
      textPrompt: string;
    }
  | {
      inputMode: "text";
      text: string;
    };

export function buildRegenerateRequest(
  commit: AiCreateCommit
): RegenerateRequest {
  const videos = commit.inputs.videos ?? [];

  if (videos.length > 0) {
    return {
      inputMode: "video",
      media: videos,
      textPrompt: commit.inputs.text,
    };
  }

  if (commit.inputs.images.length > 0) {
    return {
      inputMode: "image",
      media: commit.inputs.images,
      textPrompt: commit.inputs.text,
    };
  }

  return {
    inputMode: "text",
    text: commit.inputs.text,
  };
}
