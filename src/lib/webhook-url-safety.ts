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

  const [a, b, c] = match.slice(1, 5).map((value) => Number(value));
  if ([a, b, c, Number(match[4])].some((value) => value > 255)) return false;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 relay anycast
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255
  return false;
}

/** Expand an IPv6 literal (incl. `::` compression and embedded IPv4) to 16 bytes. */
function ipv6ToBytes(ip: string): number[] | null {
  let value = normalizeHostname(ip);

  // Embedded IPv4 in the final group, e.g. ::ffff:127.0.0.1 → ::ffff:7f00:1
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon === -1) return null;
    const v4 = value.slice(lastColon + 1);
    const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    const o = m.slice(1, 5).map((x) => Number(x));
    if (o.some((x) => x > 255)) return null;
    const h1 = ((o[0] << 8) | o[1]).toString(16);
    const h2 = ((o[2] << 8) | o[3]).toString(16);
    value = `${value.slice(0, lastColon + 1)}${h1}:${h2}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;

  let groups: string[];
  if (tail === null) {
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const word = parseInt(group, 16);
    bytes.push((word >> 8) & 0xff, word & 0xff);
  }
  return bytes;
}

export function isPrivateOrReservedIPv6(ip: string): boolean {
  const b = ipv6ToBytes(ip);
  if (!b) return false;

  // ::/128 unspecified, ::1 loopback
  if (b.slice(0, 15).every((x) => x === 0) && (b[15] === 0 || b[15] === 1)) {
    return true;
  }
  if (b[0] === 0xff) return true; // ff00::/8 multicast
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 doc

  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 → classify the embedded IPv4
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  const compatible = b.slice(0, 12).every((x) => x === 0);
  if (mapped || compatible) {
    return isPrivateOrReservedIPv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
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

export type DnsLookupAll = (
  hostname: string,
  options: { all: true }
) => Promise<Array<{ address: string; family?: number }>>;

const defaultLookup: DnsLookupAll = (host, options) => dns.lookup(host, options);

/**
 * Dispatch-time guard: resolve the host and ensure every resolved address is a
 * public unicast address, then return the concrete IP to connect to. Callers
 * must connect to this exact IP (e.g. via the `lookup` option of node:http) so
 * the request can't be re-resolved to an internal address (DNS rebinding).
 */
export async function resolveWebhookTarget(
  hostname: string,
  lookup: DnsLookupAll = defaultLookup
): Promise<{ address: string; family: number }> {
  const host = normalizeHostname(hostname);

  if (isBlockedHostname(host)) {
    throw new WebhookUrlError("Webhook host is blocked.");
  }

  const literalFamily = net.isIP(host);
  if (literalFamily) {
    if (isPrivateOrReservedIp(host)) {
      throw new WebhookUrlError(
        "Webhook host is a private or reserved IP address."
      );
    }
    return { address: host, family: literalFamily };
  }

  let results: Array<{ address: string; family?: number }>;
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

  const chosen = results[0];
  return { address: chosen.address, family: net.isIP(chosen.address) || 4 };
}

/** Back-compat assertion wrapper (throws if the host is not safely public). */
export async function assertWebhookHostResolvesPublic(
  hostname: string,
  lookup: DnsLookupAll = defaultLookup
): Promise<void> {
  await resolveWebhookTarget(hostname, lookup);
}
