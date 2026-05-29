import net from "node:net";
import dns from "node:dns/promises";

/**
 * Guards the webhook delivery path against SSRF. Project managers control the
 * webhook URL, and the server fetches it (and stores the response), so without
 * these checks a manager could point a webhook at loopback / private / cloud
 * metadata addresses and read internal responses back.
 */
export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookUrlError";
  }
}

const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".lan"];

function normalizeHostname(hostname: string): string {
  // URL.hostname keeps IPv6 literals wrapped in [ ]; strip them, drop a zone id
  // and any trailing dot, and lowercase.
  return hostname
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/%.*$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

export function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (host === "localhost") return true;
  if (host === "metadata.google.internal") return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function isPrivateOrReservedIPv4(ip: string): boolean {
  const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const octets = match.slice(1, 5).map((value) => Number(value));
  if (octets.some((value) => value > 255)) return false;

  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255
  return false;
}

export function isPrivateOrReservedIPv6(ip: string): boolean {
  const host = normalizeHostname(ip);
  if (host === "::1" || host === "::") return true; // loopback, unspecified

  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]); // IPv4-mapped IPv6

  if (/^f[cd]/.test(host)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateOrReservedIPv4(ip);
  if (family === 6) return isPrivateOrReservedIPv6(ip);
  return false;
}

/**
 * Validate a webhook URL at create/update time: must be http(s), must not be an
 * internal hostname, and must not be a literal private/reserved IP. Public
 * hostnames pass here and are re-checked (via DNS) at dispatch time.
 */
export function parsePublicWebhookUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookUrlError("Webhook URL is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebhookUrlError("Webhook URL must use http or https.");
  }

  const host = normalizeHostname(url.hostname);
  if (!host) {
    throw new WebhookUrlError("Webhook URL has no host.");
  }
  if (isBlockedHostname(host)) {
    throw new WebhookUrlError("Webhook URL points to a blocked internal host.");
  }
  if (net.isIP(host) && isPrivateOrReservedIp(host)) {
    throw new WebhookUrlError(
      "Webhook URL points to a private or reserved IP address."
    );
  }

  return url;
}

/**
 * Dispatch-time guard: resolve the host and ensure every resolved address is a
 * public unicast address. This defeats DNS rebinding (a public hostname that
 * resolves to an internal IP) which the create-time check can't catch.
 */
export type DnsLookupAll = (
  hostname: string,
  options: { all: true }
) => Promise<Array<{ address: string }>>;

export async function assertWebhookHostResolvesPublic(
  hostname: string,
  lookup: DnsLookupAll = (host, options) => dns.lookup(host, options)
): Promise<void> {
  const host = normalizeHostname(hostname);

  if (isBlockedHostname(host)) {
    throw new WebhookUrlError("Webhook host is blocked.");
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new WebhookUrlError(
        "Webhook host is a private or reserved IP address."
      );
    }
    return;
  }

  let results: Array<{ address: string }>;
  try {
    results = await lookup(host, { all: true });
  } catch {
    throw new WebhookUrlError("Webhook host could not be resolved.");
  }

  if (results.length === 0) {
    throw new WebhookUrlError("Webhook host did not resolve to any address.");
  }

  for (const { address } of results) {
    if (isPrivateOrReservedIp(address)) {
      throw new WebhookUrlError(
        "Webhook host resolves to a private or reserved IP address."
      );
    }
  }
}
