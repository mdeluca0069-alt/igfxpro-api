import { PrismaService } from '../../prisma/prisma.service';
export declare class TradesService {
    private prisma;
    constructor(prisma: PrismaService);
    getAllTrades(): Promise<({
        account: {
            id: string;
            status: import(".prisma/client").$Enums.AccountStatus;
            createdAt: Date;
            userId: string;
            type: import(".prisma/client").$Enums.AccountType;
            currency: string;
            leverage: number;
        };
        market: {
            symbol: string;
            id: string;
            createdAt: Date;
            type: string | null;
            name: string | null;
            updatedAt: Date;
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
    getTradeById(id: string): Promise<{
        account: {
            id: string;
            status: import(".prisma/client").$Enums.AccountStatus;
            createdAt: Date;
            userId: string;
            type: import(".prisma/client").$Enums.AccountType;
            currency: string;
            leverage: number;
        };
        market: {
            symbol: string;
            id: string;
            createdAt: Date;
            type: string | null;
            name: string | null;
            updatedAt: Date;
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
