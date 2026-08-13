import dns from "node:dns";
import net from "node:net";

/**
 * Checks if a URL is safe from SSRF by:
 * 1. Enforcing 'https:' protocol only.
 * 2. Rejecting known metadata/local hostnames.
 * 3. Resolving the hostname to its IP addresses and rejecting:
 *    - RFC1918 (Private IP space)
 *    - Loopback address space (127.0.0.0/8, ::1)
 *    - Link-local address space (169.254.0.0/16, fe80::/10)
 *    - IPv6 Unique Local Address space (fc00::/7)
 *    - Multicast & Broadcast/Reserved spaces
 */
export async function isSafeUrl(urlString: string): Promise<boolean> {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname;
    if (!hostname) return false;

    // Check known cloud metadata/local hostnames
    const lowerHost = hostname.toLowerCase();
    if (
      lowerHost === "metadata.google.internal" ||
      lowerHost === "metadata" ||
      lowerHost.endsWith(".local")
    ) {
      return false;
    }

    // Resolve DNS (handles hostname or IP literals directly)
    const result = await dns.promises.lookup(hostname, { all: true });
    for (const entry of result) {
      if (isPrivateOrReservedIp(entry.address)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates whether an IP address belongs to a private, loopback, link-local,
 * ULA, multicast, or reserved/unspecified range.
 */
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    const [p0, p1] = parts;

    // RFC 1918 Private Address Space
    if (p0 === 10) return true;
    if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
    if (p0 === 192 && p1 === 168) return true;

    // Loopback
    if (p0 === 127) return true;

    // Link-local
    if (p0 === 169 && p1 === 254) return true;

    // Unspecified, broadcast, and multicast / Class E reserved
    if (p0 === 0 || p0 >= 224) return true;
  } else if (net.isIPv6(ip)) {
    const lowerIp = ip.toLowerCase();

    // Loopback & Unspecified
    if (lowerIp === "::1" || lowerIp === "::") return true;

    // Link-local (fe80::/10)
    if (
      lowerIp.startsWith("fe8") ||
      lowerIp.startsWith("fe9") ||
      lowerIp.startsWith("fea") ||
      lowerIp.startsWith("feb")
    ) {
      return true;
    }

    // IPv6 Unique Local Address (fc00::/7)
    if (lowerIp.startsWith("fc") || lowerIp.startsWith("fd")) {
      return true;
    }

    // Multicast (ff00::/8)
    if (lowerIp.startsWith("ff")) {
      return true;
    }
  }

  return false;
}
