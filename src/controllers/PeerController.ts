import { Controller } from '@asenajs/asena/decorators';
import { Get, Post } from '@asenajs/asena/decorators/http';
import { Inject } from '@asenajs/asena/decorators/ioc';
import type { Context } from '@asenajs/ergenecore';
import { PeerDiscoveryService } from '../services/PeerDiscoveryService';
import { ProbePeerContext } from '../contracts/PeerContracts';

@Controller({ path: '/api/peers', description: 'Other asena-peer-pong instances (LAN discovery + manual)' })
export class PeerController {
  @Inject(PeerDiscoveryService)
  private peers: PeerDiscoveryService;

  @Get({ path: '/', summary: 'Known peers' })
  public async list(context: Context) {
    return context.send({ peers: this.peers.list() });
  }

  @Post({ path: '/', summary: 'Add a peer by address and fetch its rooms' })
  public async probe(context: ProbePeerContext) {
    return context.send(await this.peers.probe(context.input.body.address));
  }
}
