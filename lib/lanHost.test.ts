import { describe, expect, it } from "vitest";
import { isPrivateIPv4, splitHostPort, toNipIoHost } from "./lanHost";

describe("lanHost", () => {
  it("detects private IPv4", () => {
    expect(isPrivateIPv4("172.17.2.26")).toBe(true);
    expect(isPrivateIPv4("192.168.0.1")).toBe(true);
    expect(isPrivateIPv4("10.0.0.2")).toBe(true);
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateIPv4("localhost")).toBe(false);
  });

  it("maps private IP host to nip.io", () => {
    expect(toNipIoHost("172.17.2.26:3000")).toBe("172.17.2.26.nip.io:3000");
    expect(toNipIoHost("172.17.2.26")).toBe("172.17.2.26.nip.io");
    expect(toNipIoHost("172.17.2.26.nip.io:3000")).toBeNull();
    expect(toNipIoHost("localhost:3000")).toBeNull();
  });

  it("splits host:port", () => {
    expect(splitHostPort("172.17.2.26:3000")).toEqual({ hostname: "172.17.2.26", port: "3000" });
    expect(splitHostPort("example.com")).toEqual({ hostname: "example.com", port: undefined });
  });
});
