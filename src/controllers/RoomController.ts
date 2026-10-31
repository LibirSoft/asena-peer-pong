import { Controller } from '@asenajs/asena/decorators';
import { Get, Post } from '@asenajs/asena/decorators/http';
import { Inject } from '@asenajs/asena/decorators/ioc';
import type { Context } from '@asenajs/ergenecore';
import { RoomService } from '../services/RoomService';
import { CreateRoomContext, RoomCodeContext } from '../contracts/RoomContracts';

/** Thin controller: shape in → service → shape out. */
@Controller({ path: '/api/rooms', description: 'Create, find and list game rooms' })
export class RoomController {
  @Inject(RoomService)
  private rooms: RoomService;

  @Get({ path: '/', summary: 'List public rooms' })
  public async list(context: Context) {
    return context.send({ rooms: this.rooms.listPublic() });
  }

  @Post({ path: '/', summary: 'Create a room' })
  public async create(context: CreateRoomContext) {
    const room = this.rooms.create(context.input.body);
    return context.send({ room: this.rooms.toView(room) }, 201);
  }

  @Post({ path: '/quick-match', summary: 'Join a waiting public room or open a new one' })
  public async quickMatch(context: Context) {
    return context.send({ room: this.rooms.toView(this.rooms.quickMatch()) });
  }

  @Get({ path: '/:code', summary: 'Get a room by code' })
  public async get(context: RoomCodeContext) {
    return context.send({ room: this.rooms.toView(this.rooms.get(context.input.params.code)) });
  }
}
