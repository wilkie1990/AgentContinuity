import { networkInterfaces as osNetworkInterfaces } from "node:os";

/** Shape returned by `node:os` `networkInterfaces()`, accepted here so tests can inject a fixture. */
export type NetworkInterfaces = ReturnType<typeof osNetworkInterfaces>;

/** Hosts that never leave this machine. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/** "Bind everything" hosts — real for `listen()`, meaningless as a URL a client can open. */
export function isUnspecifiedHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number.parseInt(part, 10);
    if (octet > 255) return undefined;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

// Tailscale addresses come from the CGNAT range 100.64.0.0/10 (100.64.0.0 - 100.127.255.255).
const TAILSCALE_BASE = ipv4ToInt("100.64.0.0")!;
const TAILSCALE_MASK = (0xffffffff << (32 - 10)) >>> 0;

/** True for IPv4 addresses in the 100.64.0.0/10 range that Tailscale assigns to tailnet devices. */
export function isTailscaleAddress(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === undefined) return false;
  return (value & TAILSCALE_MASK) === TAILSCALE_BASE;
}

/** Every non-internal IPv4 address bound to this machine, in the order the OS reports them. */
export function listExternalIPv4Addresses(interfaces: NetworkInterfaces = osNetworkInterfaces()): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

/** The machine's Tailscale interface address, if Tailscale is running, detected without shelling out. */
export function detectTailscaleAddress(interfaces: NetworkInterfaces = osNetworkInterfaces()): string | undefined {
  return listExternalIPv4Addresses(interfaces).find(isTailscaleAddress);
}

/**
 * The concrete addresses a client could use to reach a server bound to `host`. For a specific
 * host this is just that host; for the unspecified "bind everything" host it is loopback plus
 * every external IPv4 address, since "0.0.0.0" itself is never a URL anyone can open.
 */
export function listReachableAddresses(
  host: string,
  interfaces: NetworkInterfaces = osNetworkInterfaces(),
): string[] {
  if (!isUnspecifiedHost(host)) return [host];
  return ["127.0.0.1", ...listExternalIPv4Addresses(interfaces)];
}

/**
 * Resolves the "tailscale" host alias to the machine's actual Tailscale address. Any other host
 * value passes through unchanged. Throws when the alias is used but no Tailscale interface can be
 * found, so a misconfiguration fails loudly instead of silently binding somewhere unexpected.
 */
export function resolveHostAlias(host: string, interfaces: NetworkInterfaces = osNetworkInterfaces()): string {
  const alias = host.trim().toLowerCase();
  if (alias === "loopback") return "127.0.0.1";
  if (alias !== "tailscale") return host.trim();

  const address = detectTailscaleAddress(interfaces);
  if (!address) {
    throw new Error(
      'No Tailscale interface was found (looked for an IPv4 address in 100.64.0.0/10). ' +
        "Make sure Tailscale is running and connected, or bind an explicit address with --host.",
    );
  }
  return address;
}

/**
 * Resolves a host setting into the concrete list of addresses to bind.
 *
 * A single socket can only bind one address, so reaching the workspace from both this
 * machine and a tailnet peer means listening on several. The value accepts a
 * comma-separated list — `"loopback,tailscale"` — with each entry alias-resolved.
 *
 * `0.0.0.0` already covers every interface, so if it appears anywhere it collapses the
 * list to itself rather than binding an address twice.
 */
export function resolveHostList(
  host: string,
  interfaces: NetworkInterfaces = osNetworkInterfaces(),
): string[] {
  const requested = host
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (requested.length === 0) return ["127.0.0.1"];

  const resolved = requested.map((entry) => resolveHostAlias(entry, interfaces));
  const unspecified = resolved.find(isUnspecifiedHost);
  if (unspecified) return [unspecified];

  return [...new Set(resolved)];
}

/** Every concrete URL a client could open, given the list of addresses actually bound. */
export function listReachableAddressesFor(
  hosts: string[],
  interfaces: NetworkInterfaces = osNetworkInterfaces(),
): string[] {
  return [...new Set(hosts.flatMap((host) => listReachableAddresses(host, interfaces)))];
}
