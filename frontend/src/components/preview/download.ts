import { HTTP_BACKEND_URL } from "../../config";
import toast from "react-hot-toast";

const DEFAULT_EXPORT_FILENAME = "screenshot-to-code-export.zip";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function filenameFromContentDisposition(
  contentDisposition: string | null
) {
  const encodedMatch = contentDisposition?.match(
    /filename\*=(?:UTF-8'')?([^;]+)/i
  );
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].replace(/^"|"$/g, "")).replace(
        /[\\/]/g,
        "-"
      );
    } catch {
      return DEFAULT_EXPORT_FILENAME;
    }
  }

  const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1].replace(/[\\/]/g, "-") ?? DEFAULT_EXPORT_FILENAME;
}

export const downloadCode = async (code: string) => {
  try {
    const response = await fetch(`${HTTP_BACKEND_URL}/api/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        baseUrl: window.location.href,
      }),
    });

    if (!response.ok) {
      throw new Error(`Export failed with status ${response.status}`);
    }

    const blob = await response.blob();
    downloadBlob(
      blob,
      filenameFromContentDisposition(response.headers.get("Content-Disposition"))
    );
  } catch (error) {
    console.warn("Falling back to downloading index.html", error);
    toast.error("Could not export a zip. Downloaded index.html instead.");
    downloadBlob(new Blob([code], { type: "text/html" }), "index.html");
  }
};
