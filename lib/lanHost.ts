/** LAN / private-IP helpers for Google OAuth (raw IP redirect_uri is rejected). */

const PRIVATE_IPV4 =
  /^(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})$/;

export function splitHostPort(hostHeader: string): { hostname: string; port?: string } {
  const trimmed = hostHeader.trim();
  // [ipv6]:port — not used for LAN OAuth today
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end > 0) {
      const hostname = trimmed.slice(1, end);
      const rest = trimmed.slice(end + 1);
      const port = rest.startsWith(":") ? rest.slice(1) : undefined;
      return { hostname, port: port || undefined };
    }
  }
  const idx = trimmed.lastIndexOf(":");
  if (idx > 0 && trimmed.indexOf(":") === idx) {
    return { hostname: trimmed.slice(0, idx), port: trimmed.slice(idx + 1) || undefined };
  }
  return { hostname: trimmed };
}

export function isPrivateIPv4(hostname: string): boolean {
  return PRIVATE_IPV4.test(hostname);
}

/** Already a public-looking LAN hostname (nip.io / sslip.io). */
export function isLanFriendlyHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.endsWith(".nip.io") || h.endsWith(".sslip.io");
}

/**
 * Google OAuth rejects private-IP redirect_uri.
 * Map `172.17.2.26:3000` → `172.17.2.26.nip.io:3000`.
 */
export function toNipIoHost(hostHeader: string): string | null {
  const { hostname, port } = splitHostPort(hostHeader);
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return null;
  if (isLanFriendlyHost(hostname)) return null;
  if (!isPrivateIPv4(hostname)) return null;
  return port ? `${hostname}.nip.io:${port}` : `${hostname}.nip.io`;
}
