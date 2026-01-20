import { PrismaService } from '../../prisma/prisma.service';
import { TradeType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
export declare class TradingService {
    private prisma;
    constructor(prisma: PrismaService);
    openTrade(accountId: string, marketId: string, symbol: string, type: TradeType, volume: number, price: number): Promise<{
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
    }>;
    closeTrade(tradeId: string, exitPrice: number): Promise<{
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
    }>;
}
