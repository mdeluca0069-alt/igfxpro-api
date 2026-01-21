import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
export declare class ExecutionService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    executeOrder({ accountId, marketId, volume, type, price, }: {
        accountId: string;
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
            volume: Decimal;
            price: Decimal;
            entryPrice: Decimal | null;
            exitPrice: Decimal | null;
            pnl: Decimal;
            openedAt: Date;
            closedAt: Date | null;
            marketId: string | null;
        };
    }>;
    closeTrade(tradeId: string): Promise<{
        success: boolean;
        tradeId: string;
        pnl: number;
    }>;
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
        volume: Decimal;
        price: Decimal;
        entryPrice: Decimal | null;
        exitPrice: Decimal | null;
        pnl: Decimal;
        openedAt: Date;
        closedAt: Date | null;
        marketId: string | null;
    })[]>;
}
