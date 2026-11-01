import { expect, it } from 'vitest';
import { serverAddress } from './serverAddress';
it('accepts IPv4 and IPv6 literals with valid ports and normalizes current origins', () => {
  expect(serverAddress(' 192.168.1.10 ', '8080')).toBe('http://192.168.1.10:8080');
  expect(serverAddress('[::1]', '80')).toBe('http://[::1]');
  expect(serverAddress('2001:db8::1', '443', 'https:')).toBe('https://[2001:db8::1]');
  expect(serverAddress('127.000.000.001', '65535')).toBe('http://127.0.0.1:65535');
});
it('rejects invalid IPs, URL injection, hostnames and out of range ports', () => {
  for (const ip of ['256.1.1.1', '1.2.3', 'localhost', 'a:b', '::1/path', 'user@127.0.0.1', 'javascript:alert(1)', '']) expect(() => serverAddress(ip, '8080')).toThrow();
  for (const port of ['0', '-1', '65536', '1.5', '8080/path', '']) expect(() => serverAddress('127.0.0.1', port)).toThrow();
});
