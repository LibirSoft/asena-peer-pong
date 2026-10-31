import os from 'node:os';
import { Service } from '@asenajs/asena/decorators';
import { Value } from '@asenajs/asena/decorators/ioc';

const pkg = { name: 'asena-peer-pong', version: '1.0.0' };

/**
 * Identity of THIS running instance. Every player who runs the app on their own
 * machine is an "instance"; peers find each other by this information.
 *
 * Shows: @Value for environment configuration (parse + default).
 */
@Service('InstanceService')
export class InstanceService {
  @Value('PORT', { parse: Number, default: 3000 })
  public port: number;

  @Value('INSTANCE_NAME', { default: '' })
  private configuredName: string;

  @Value('PUBLIC_URL', { default: '' })
  private publicUrl: string;

  /** Random per-process id — lets discovery ignore its own beacons. */
  public readonly id = crypto.randomUUID().slice(0, 8);
  public readonly startedAt = Date.now();

  get name(): string {
    return this.configuredName || os.hostname();
  }

  get version(): string {
    return pkg.version;
  }

  /**
   * Real IPv4 interfaces of this machine (what LAN peers can reach).
   * Container / VM bridges (docker0, br-*, veth*, virbr*…) are skipped — nobody else
   * can reach those. VPN interfaces such as tailscale0 / zt* are kept on purpose.
   */
  private interfaces(): os.NetworkInterfaceInfoIPv4[] {
    const virtual = /^(docker|br-|veth|virbr|vboxnet|vmnet|cni|flannel|podman|lxc|lxdbr)/;
    return Object.entries(os.networkInterfaces())
      .filter(([name]) => !virtual.test(name))
      .flatMap(([, list]) => list ?? [])
      .filter((n): n is os.NetworkInterfaceInfoIPv4 => n.family === 'IPv4' && !n.internal);
  }

  public lanAddresses(): string[] {
    return this.interfaces().map((n) => n.address);
  }

  /** Directed broadcast addresses (e.g. 192.168.1.255) for every LAN interface. */
  public broadcastAddresses(): string[] {
    const result = new Set<string>(['255.255.255.255']);
    for (const n of this.interfaces()) {
      const ip = n.address.split('.').map(Number);
      const mask = n.netmask.split('.').map(Number);
      result.add(ip.map((octet, i) => (octet & mask[i]!) | (~mask[i]! & 255)).join('.'));
    }
    return [...result];
  }

  /** URLs other people can use to open this instance. */
  public shareUrls(): string[] {
    const urls = this.lanAddresses().map((ip) => `http://${ip}:${this.port}`);
    return this.publicUrl ? [this.publicUrl.replace(/\/$/, ''), ...urls] : urls;
  }

  public info() {
    return {
      app: pkg.name,
      id: this.id,
      name: this.name,
      version: this.version,
      port: this.port,
      publicUrl: this.publicUrl || null,
      shareUrls: this.shareUrls(),
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }
}
