import toast from "react-hot-toast";
import {
  downloadBlob,
  downloadCode,
  filenameFromContentDisposition,
} from "./download";

jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://backend.test",
}));

jest.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
  },
}));

describe("preview download helpers", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  let consoleWarn: jest.SpyInstance;
  let anchor: {
    click: jest.Mock;
    download: string;
    href: string;
  };
  let appendChild: jest.Mock;
  let removeChild: jest.Mock;
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;

  beforeEach(() => {
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    anchor = {
      click: jest.fn(),
      download: "",
      href: "",
    };
    appendChild = jest.fn();
    removeChild = jest.fn();
    createObjectURL = jest.fn(() => "blob:export");
    revokeObjectURL = jest.fn();

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: {
          appendChild,
          removeChild,
        },
        createElement: jest.fn(() => anchor),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { href: "http://app.test/current" },
        setTimeout: jest.fn((callback: () => void) => {
          callback();
          return 1;
        }),
      },
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  afterEach(() => {
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }

    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }

    if (originalFetch) {
      Object.defineProperty(globalThis, "fetch", originalFetch);
    } else {
      Reflect.deleteProperty(globalThis, "fetch");
    }

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
    consoleWarn.mockRestore();
    jest.clearAllMocks();
  });

  test("parses content disposition filenames", () => {
    expect(
      filenameFromContentDisposition(
        'attachment; filename="screenshot-to-code-export.zip"'
      )
    ).toBe("screenshot-to-code-export.zip");

    expect(
      filenameFromContentDisposition(
        "attachment; filename*=UTF-8''Project%20Export.zip"
      )
    ).toBe("Project Export.zip");

    expect(
      filenameFromContentDisposition(
        "attachment; filename*=UTF-8''Project%ZZExport.zip"
      )
    ).toBe("screenshot-to-code-export.zip");

    expect(filenameFromContentDisposition("attachment")).toBe(
      "screenshot-to-code-export.zip"
    );
  });

  test("sanitizes path separators in downloaded filenames", () => {
    expect(
      filenameFromContentDisposition('attachment; filename="../escape.zip"')
    ).toBe("..-escape.zip");
  });

  test("triggers a download and revokes the object URL after the click", () => {
    const blob = new Blob(["<html></html>"], { type: "text/html" });

    downloadBlob(blob, "index.html");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:export");
    expect(anchor.download).toBe("index.html");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledWith(anchor);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  test("downloads the backend zip export when it succeeds", async () => {
    const fetcher = jest.fn(() =>
      Promise.resolve(
        new Response("zip-bytes", {
          status: 200,
          headers: {
            "Content-Disposition": 'attachment; filename="project.zip"',
          },
        })
      )
    );
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetcher,
    });

    await downloadCode("<html>Generated</html>");

    expect(fetcher).toHaveBeenCalledWith("http://backend.test/api/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: "<html>Generated</html>",
        baseUrl: "http://app.test/current",
      }),
    });
    expect(anchor.download).toBe("project.zip");
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("falls back to index.html and notifies the user when zip export fails", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: jest.fn(() => Promise.resolve(new Response("Nope", { status: 500 }))),
    });

    await downloadCode("<html>Generated</html>");

    expect(anchor.download).toBe("index.html");
    expect(toast.error).toHaveBeenCalledWith(
      "Could not export a zip. Downloaded index.html instead."
    );
  });
});
