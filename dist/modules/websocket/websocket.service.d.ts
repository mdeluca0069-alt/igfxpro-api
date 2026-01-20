import { Server } from 'socket.io';
export declare class WebsocketService {
    server: Server;
    init(server: Server): void;
    emitPriceUpdate(data: any): void;
}
