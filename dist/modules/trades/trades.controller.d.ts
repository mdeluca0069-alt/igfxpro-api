import { TradesService } from './trades.service';
export declare class TradesController {
    private tradesService;
    constructor(tradesService: TradesService);
    getAll(): Promise<({
        account: {
            id: string;
            status: import(".prisma/client").$Enums.AccountStatus;
            createdAt: Date;
            type: import(".prisma/client").$Enums.AccountType;
            currency: string;
            leverage: number;
            userId: string;
        };
        market: {
            symbol: string;
            id: string;
            name: string | null;
            createdAt: Date;
            updatedAt: Date;
            type: string | null;
            spread: number;
            swapLong: number;
            swapShort: number;
            minVolume: number | null;
            maxVolume: number | null;
        };
    } & {
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
    })[]>;
    getOne(id: string): Promise<{
        account: {
            id: string;
            status: import(".prisma/client").$Enums.AccountStatus;
            createdAt: Date;
            type: import(".prisma/client").$Enums.AccountType;
            currency: string;
            leverage: number;
            userId: string;
        };
        market: {
            symbol: string;
            id: string;
            name: string | null;
            createdAt: Date;
            updatedAt: Date;
            type: string | null;
            spread: number;
            swapLong: number;
            swapShort: number;
            minVolume: number | null;
            maxVolume: number | null;
        };
    } & {
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
    }>;
}
