import { Server } from 'socket.io';
export declare class WebsocketGateway {
    server: Server;
    handlePing(data: any): string;
}
