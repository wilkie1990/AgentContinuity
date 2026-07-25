import { describe, expect, it } from "vitest";
import {
  detectTailscaleAddress,
  isLoopbackHost,
  isTailscaleAddress,
  listReachableAddressesFor,
  resolveHostList,
  isUnspecifiedHost,
  listExternalIPv4Addresses,
  listReachableAddresses,
  resolveHostAlias,
  type NetworkInterfaces,
} from "../network.js";

const LOOPBACK_ONLY: NetworkInterfaces = {
  lo0: [
    {
      address: "127.0.0.1",
      netmask: "255.0.0.0",
      family: "IPv4",
      mac: "00:00:00:00:00:00",
      internal: true,
      cidr: "127.0.0.1/8",
    },
  ],
};

const LAN_AND_TAILSCALE: NetworkInterfaces = {
  ...LOOPBACK_ONLY,
  en0: [
    {
      address: "192.168.0.134",
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "11:11:11:11:11:11",
      internal: false,
      cidr: "192.168.0.134/24",
    },
  ],
  utun4: [
    {
      address: "100.100.144.100",
      netmask: "255.192.0.0",
      family: "IPv4",
      mac: "22:22:22:22:22:22",
      internal: false,
      cidr: "100.100.144.100/10",
    },
  ],
};

describe("isTailscaleAddress", () => {
  it("accepts addresses inside 100.64.0.0/10", () => {
    expect(isTailscaleAddress("100.64.0.0")).toBe(true);
    expect(isTailscaleAddress("100.100.144.100")).toBe(true);
    expect(isTailscaleAddress("100.127.255.255")).toBe(true);
  });

  it("rejects addresses outside the range, and non-IPv4 input", () => {
    expect(isTailscaleAddress("100.128.0.0")).toBe(false);
    expect(isTailscaleAddress("100.63.255.255")).toBe(false);
    expect(isTailscaleAddress("192.168.0.134")).toBe(false);
    expect(isTailscaleAddress("not-an-ip")).toBe(false);
    expect(isTailscaleAddress("::1")).toBe(false);
  });
});

describe("isLoopbackHost / isUnspecifiedHost", () => {
  it("recognises loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("100.100.144.100")).toBe(false);
  });

  it("recognises the unspecified bind-everything host", () => {
    expect(isUnspecifiedHost("0.0.0.0")).toBe(true);
    expect(isUnspecifiedHost("::")).toBe(true);
    expect(isUnspecifiedHost("127.0.0.1")).toBe(false);
  });
});

describe("listExternalIPv4Addresses", () => {
  it("excludes internal interfaces", () => {
    expect(listExternalIPv4Addresses(LOOPBACK_ONLY)).toEqual([]);
  });

  it("lists every non-internal IPv4 address", () => {
    expect(listExternalIPv4Addresses(LAN_AND_TAILSCALE).sort()).toEqual(
      ["100.100.144.100", "192.168.0.134"].sort(),
    );
  });
});

describe("detectTailscaleAddress", () => {
  it("returns undefined when no interface is in the Tailscale range", () => {
    expect(detectTailscaleAddress(LOOPBACK_ONLY)).toBeUndefined();
  });

  it("finds the Tailscale interface among LAN and loopback addresses", () => {
    expect(detectTailscaleAddress(LAN_AND_TAILSCALE)).toBe("100.100.144.100");
  });
});

describe("listReachableAddresses", () => {
  it("returns the host unchanged when it is a specific address", () => {
    expect(listReachableAddresses("100.100.144.100", LAN_AND_TAILSCALE)).toEqual(["100.100.144.100"]);
  });

  it("expands 0.0.0.0 into loopback plus every external address", () => {
    expect(listReachableAddresses("0.0.0.0", LAN_AND_TAILSCALE)).toEqual([
      "127.0.0.1",
      "192.168.0.134",
      "100.100.144.100",
    ]);
  });
});

describe("resolveHostAlias", () => {
  it("passes non-alias hosts through unchanged", () => {
    expect(resolveHostAlias("127.0.0.1", LAN_AND_TAILSCALE)).toBe("127.0.0.1");
    expect(resolveHostAlias("0.0.0.0", LAN_AND_TAILSCALE)).toBe("0.0.0.0");
  });

  it('resolves "tailscale" (case-insensitively) to the detected interface address', () => {
    expect(resolveHostAlias("tailscale", LAN_AND_TAILSCALE)).toBe("100.100.144.100");
    expect(resolveHostAlias("TAILSCALE", LAN_AND_TAILSCALE)).toBe("100.100.144.100");
  });

  it("throws a clear error when no Tailscale interface can be found", () => {
    expect(() => resolveHostAlias("tailscale", LOOPBACK_ONLY)).toThrow(/No Tailscale interface/);
  });
});

describe("resolveHostList", () => {
  const interfaces = {
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true } as never],
    en0: [{ address: "192.168.0.134", family: "IPv4", internal: false } as never],
    utun4: [{ address: "100.100.144.100", family: "IPv4", internal: false } as never],
  };

  it("defaults to loopback for an empty value", () => {
    expect(resolveHostList("", interfaces)).toEqual(["127.0.0.1"]);
  });

  it("resolves a comma separated list of aliases", () => {
    expect(resolveHostList("loopback,tailscale", interfaces)).toEqual([
      "127.0.0.1",
      "100.100.144.100",
    ]);
  });

  it("tolerates whitespace and removes duplicates", () => {
    expect(resolveHostList(" loopback , 127.0.0.1 ,tailscale ", interfaces)).toEqual([
      "127.0.0.1",
      "100.100.144.100",
    ]);
  });

  it("collapses to 0.0.0.0 when it appears, since it already covers every interface", () => {
    expect(resolveHostList("loopback,0.0.0.0,tailscale", interfaces)).toEqual(["0.0.0.0"]);
  });

  it("throws when the tailscale alias cannot be resolved", () => {
    expect(() => resolveHostList("loopback,tailscale", { lo0: interfaces.lo0 })).toThrow(
      /No Tailscale interface/,
    );
  });
});

describe("listReachableAddressesFor", () => {
  it("lists each bound address once", () => {
    expect(listReachableAddressesFor(["127.0.0.1", "100.100.144.100"])).toEqual([
      "127.0.0.1",
      "100.100.144.100",
    ]);
  });
});
