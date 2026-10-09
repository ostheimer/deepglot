import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

import { getProjectUrl } from "@/lib/project-url";
import { parsePublicWebhookUrl, resolveWebhookTarget } from "@/lib/webhook-url-safety";

const MAX_HTML_BYTES = 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 8000;

export class VisualPreviewError extends Error {}

/** Only a path is accepted: callers cannot choose a host, port, scheme, or credentials. */
export function projectPreviewUrl(domain: string, path: string): URL {
  const base = parsePublicWebhookUrl(getProjectUrl(domain));
  if (base.username || base.password || base.search || base.hash) {
    throw new VisualPreviewError("Invalid project domain");
  }
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/u.test(path)) {
    throw new VisualPreviewError("Enter a path on this project");
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin || url.pathname.length > 1024 || url.search.length > 512) {
    throw new VisualPreviewError("Path is outside this project");
  }
  url.hash = "";
  return url;
}

/**
 * Fetch once, without redirects, from the exact public IP resolved above.
 * The response is only returned inside a script-free sandboxed srcdoc iframe.
 */
export async function fetchProjectPreview(domain: string, path: string): Promise<{ url: string; html: string }> {
  const started = Date.now();
  const url = projectPreviewUrl(domain, path);
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const target = await Promise.race([
    resolveWebhookTarget(url.hostname),
    new Promise<never>((_resolve, reject) => {
      dnsTimer = setTimeout(() => reject(new VisualPreviewError("Page preview timed out")), PREVIEW_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  const remainingMs = PREVIEW_TIMEOUT_MS - (Date.now() - started);
  if (remainingMs <= 0) throw new VisualPreviewError("Page preview timed out");
  return requestPinnedPreview(url, target, remainingMs);
}

/** Low-level pinned fetch. Callers must validate the public host before supplying its target. */
export function requestPinnedPreview(url: URL, target: { address: string; family: number }, timeoutMs = PREVIEW_TIMEOUT_MS): Promise<{ url: string; html: string }> {
  const transport = url.protocol === "https:" ? https : http;
  const lookup = ((_host: string, optionsOrCallback: unknown, callback?: unknown) => {
    const cb = (typeof optionsOrCallback === "function" ? optionsOrCallback : callback) as (
      error: Error | null, address: string | Array<{ address: string; family: number }>, family?: number
    ) => void;
    if (typeof optionsOrCallback === "object" && optionsOrCallback !== null && (optionsOrCallback as { all?: boolean }).all) {
      cb(null, [target]);
    } else {
      cb(null, target.address, target.family);
    }
  }) as LookupFunction;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: { url: string; html: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(result!);
    };
    const request = transport.request(url, {
      method: "GET",
      lookup,
      headers: { Accept: "text/html", "Accept-Encoding": "identity", "User-Agent": "DeepglotVisualExclusionPreview/1.0" },
    }, (response) => {
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (response.statusCode !== 200 || !contentType.includes("text/html")) {
        response.resume();
        request.destroy();
        finish(new VisualPreviewError("Page did not return HTML (redirects are not followed)"));
        return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_HTML_BYTES) {
          request.destroy(new VisualPreviewError("Page exceeds the 1 MiB preview limit"));
        } else {
          chunks.push(chunk);
        }
      });
      response.on("error", finish);
      response.on("end", () => finish(undefined, { url: url.toString(), html: Buffer.concat(chunks).toString("utf8") }));
    });
    const deadline = setTimeout(() => request.destroy(new VisualPreviewError("Page preview timed out")), timeoutMs);
    request.on("error", finish);
    request.end();
  });
}
