import { ExecutionService } from './execution.service';
export declare class ExecutionController {
    private readonly executionService;
    constructor(executionService: ExecutionService);
    placeOrder(req: any, body: {
        marketId: string;
        volume: number;
        type: 'BUY' | 'SELL';
        price?: number;
    }): Promise<{
        success: boolean;
        trade: {
            symbol: string;
            id: string;
            status: import(".prisma/client").$Enums.TradeStatus;
            createdAt: Date;
            type: import(".prisma/client").$Enums.TradeType;
            accountId: string;
            volume: import("@prisma/client/runtime/library").Decimal;
            price: import("@prisma/client/runtime/library").Decimal;
            entryPrice: import("@prisma/client/runtime/library").Decimal | null;
            exitPrice: import("@prisma/client/runtime/library").Decimal | null;
            pnl: import("@prisma/client/runtime/library").Decimal;
            openedAt: Date;
            closedAt: Date | null;
            marketId: string | null;
        };
    }>;
}
