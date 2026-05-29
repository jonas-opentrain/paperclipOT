import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { setHostedUiCorsHeaders, shouldServeViteDevHtml } from "../app.js";

function createRequest(path: string, acceptsResult: string | false): Request {
  return {
    path,
    accepts: () => acceptsResult,
  } as unknown as Request;
}

describe("shouldServeViteDevHtml", () => {
  it("serves HTML shell for document requests", () => {
    expect(shouldServeViteDevHtml(createRequest("/", "html"))).toBe(true);
    expect(shouldServeViteDevHtml(createRequest("/issues/abc", "html"))).toBe(true);
  });

  it("skips public assets even when the client accepts */*", () => {
    expect(shouldServeViteDevHtml(createRequest("/sw.js", "html"))).toBe(false);
    expect(shouldServeViteDevHtml(createRequest("/site.webmanifest", "html"))).toBe(false);
  });

  it("skips vite asset requests", () => {
    expect(shouldServeViteDevHtml(createRequest("/@vite/client", "html"))).toBe(false);
    expect(shouldServeViteDevHtml(createRequest("/src/main.tsx", "html"))).toBe(false);
  });
});

describe("setHostedUiCorsHeaders", () => {
  it("allows static UI assets to load after public router redirects", () => {
    const headers = new Map<string, string | number | readonly string[]>();

    setHostedUiCorsHeaders({
      setHeader(name, value) {
        headers.set(name.toLowerCase(), value);
        return this;
      },
    });

    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });
});
