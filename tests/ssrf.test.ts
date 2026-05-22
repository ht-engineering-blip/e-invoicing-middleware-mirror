import { describe, it, expect } from 'bun:test';
import { isSafeUrl } from '../src/@lib/utils/ssrf';

describe('SSRF Guard isSafeUrl Helper Tests', () => {
  it('should enforce https:// scheme only', async () => {
    // Valid domain but insecure scheme
    expect(await isSafeUrl('http://google.com')).toBe(false);
    expect(await isSafeUrl('ftp://google.com')).toBe(false);
    expect(await isSafeUrl('gopher://google.com')).toBe(false);
    expect(await isSafeUrl('http://1.1.1.1')).toBe(false);

    // Secure scheme
    expect(await isSafeUrl('https://google.com')).toBe(true);
  });

  it('should reject known cloud metadata hostnames', async () => {
    expect(await isSafeUrl('https://metadata.google.internal')).toBe(false);
    expect(await isSafeUrl('https://metadata')).toBe(false);
    expect(await isSafeUrl('https://my-server.local')).toBe(false);
  });

  it('should reject IPv4 loopback and link-local ranges', async () => {
    // Loopback
    expect(await isSafeUrl('https://127.0.0.1')).toBe(false);
    expect(await isSafeUrl('https://127.255.0.1')).toBe(false);
    expect(await isSafeUrl('https://localhost')).toBe(false);

    // Link-local / AWS metadata IP
    expect(await isSafeUrl('https://169.254.169.254')).toBe(false);
    expect(await isSafeUrl('https://169.254.1.2')).toBe(false);
  });

  it('should reject RFC 1918 Private IPv4 address spaces', async () => {
    // 10.0.0.0/8
    expect(await isSafeUrl('https://10.0.0.1')).toBe(false);
    expect(await isSafeUrl('https://10.255.255.255')).toBe(false);

    // 172.16.0.0/12
    expect(await isSafeUrl('https://172.16.0.1')).toBe(false);
    expect(await isSafeUrl('https://172.31.255.255')).toBe(false);

    // 192.168.0.0/16
    expect(await isSafeUrl('https://192.168.0.1')).toBe(false);
    expect(await isSafeUrl('https://192.168.255.254')).toBe(false);
  });

  it('should reject reserved and unspecified IPv4 addresses', async () => {
    expect(await isSafeUrl('https://0.0.0.0')).toBe(false);
    expect(await isSafeUrl('https://224.0.0.1')).toBe(false); // Multicast
    expect(await isSafeUrl('https://255.255.255.255')).toBe(false); // Broadcast
  });

  it('should reject unsafe IPv6 addresses', async () => {
    // Loopback & Unspecified
    expect(await isSafeUrl('https://[::1]')).toBe(false);
    expect(await isSafeUrl('https://[::]')).toBe(false);

    // Link-local fe80::/10
    expect(await isSafeUrl('https://[fe80::1]')).toBe(false);
    expect(await isSafeUrl('https://[febf::ffff]')).toBe(false);

    // Unique Local Addresses fc00::/7
    expect(await isSafeUrl('https://[fc00::1]')).toBe(false);
    expect(await isSafeUrl('https://[fd00:ec2::254]')).toBe(false); // AWS metadata IPv6

    // Multicast ff00::/8
    expect(await isSafeUrl('https://[ff02::1]')).toBe(false);
  });

  it('should allow secure, public domains and IP addresses', async () => {
    expect(await isSafeUrl('https://google.com')).toBe(true);
    expect(await isSafeUrl('https://github.com')).toBe(true);
    expect(await isSafeUrl('https://1.1.1.1')).toBe(true); // Public Cloudflare DNS
    expect(await isSafeUrl('https://8.8.8.8')).toBe(true); // Public Google DNS
  });

  it('should handle malformed URLs gracefully', async () => {
    expect(await isSafeUrl('not-a-url')).toBe(false);
    expect(await isSafeUrl('')).toBe(false);
    expect(await isSafeUrl('https://')).toBe(false);
  });
});
