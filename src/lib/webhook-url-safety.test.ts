import test from "node:test";
import assert from "node:assert/strict";

import {
  assertWebhookHostResolvesPublic,
  isBlockedHostname,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  parsePublicWebhookUrl,
  WebhookUrlError,
} from "@/lib/webhook-url-safety";

test("flags private/reserved IPv4 ranges, allows public ones", () => {
  for (const ip of [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254", // cloud metadata
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1", // CGNAT
    "192.0.0.1", // IETF protocol assignments
    "192.0.2.7", // TEST-NET-1
    "198.51.100.7", // TEST-NET-2
    "203.0.113.9", // TEST-NET-3
    "198.18.0.1", // benchmarking
    "192.88.99.1", // 6to4 relay anycast
    "224.0.0.1", // multicast
    "255.255.255.255",
  ]) {
    assert.equal(isPrivateOrReservedIPv4(ip), true, `${ip} should be blocked`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "9.9.9.9"]) {
    assert.equal(isPrivateOrReservedIPv4(ip), false, `${ip} should be allowed`);
  }
});

test("flags private/reserved IPv6, including IPv4-mapped loopback", () => {
  for (const ip of [
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // hexadecimal IPv4-mapped loopback (the P1 bypass)
    "ff02::1", // multicast
    "2001:db8::1", // documentation
  ]) {
    assert.equal(isPrivateOrReservedIPv6(ip), true, `${ip} should be blocked`);
  }
  for (const ip of ["2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateOrReservedIPv6(ip), false, `${ip} should be allowed`);
  }
});

test("blocks internal hostnames", () => {
  for (const host of ["localhost", "app.localhost", "db.internal", "x.local", "y.lan", "metadata.google.internal"]) {
    assert.equal(isBlockedHostname(host), true, `${host} should be blocked`);
  }
  for (const host of ["example.com", "hooks.example.com"]) {
    assert.equal(isBlockedHostname(host), false, `${host} should be allowed`);
  }
});

test("parsePublicWebhookUrl accepts public http(s) URLs", () => {
  assert.equal(parsePublicWebhookUrl("https://hooks.example.com/dg").hostname, "hooks.example.com");
  assert.equal(parsePublicWebhookUrl("http://hooks.example.com/dg").protocol, "http:");
  assert.equal(parsePublicWebhookUrl("https://8.8.8.8/hook").hostname, "8.8.8.8");
});

test("parsePublicWebhookUrl rejects internal/loopback/metadata/non-http URLs", () => {
  for (const raw of [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/x",
    "https://[::1]/x",
    "https://[::ffff:7f00:1]/x", // hex IPv4-mapped loopback
    "http://db.internal/x",
    "ftp://example.com/x",
    "file:///etc/passwd",
    "gopher://example.com/x",
    "not-a-url",
  ]) {
    assert.throws(() => parsePublicWebhookUrl(raw), WebhookUrlError, `expected ${raw} to be rejected`);
  }
});

test("assertWebhookHostResolvesPublic blocks IP-literal private hosts without DNS", async () => {
  await assert.rejects(() => assertWebhookHostResolvesPublic("127.0.0.1"), WebhookUrlError);
  await assertWebhookHostResolvesPublic("8.8.8.8"); // public literal → resolves fine
});

test("assertWebhookHostResolvesPublic defeats DNS rebinding (host resolves to private IP)", async () => {
  const rebinding = async () => [{ address: "10.0.0.7" }];
  await assert.rejects(
    () => assertWebhookHostResolvesPublic("evil.example.com", rebinding),
    WebhookUrlError
  );

  const publicResolve = async () => [{ address: "93.184.216.34" }];
  await assertWebhookHostResolvesPublic("good.example.com", publicResolve);
});
