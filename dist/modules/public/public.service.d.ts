import { PrismaService } from '../../prisma/prisma.service';
export declare class PublicService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getCompanyStats(): Promise<{
        id: string;
        updatedAt: Date;
        year: number;
        activeClients: number;
        totalAccounts: number;
        totalTrades: number;
        totalVolume: import("@prisma/client/runtime/library").Decimal;
        totalCommission: import("@prisma/client/runtime/library").Decimal;
        activeAccounts: number;
    }[]>;
    getMarkets(): Promise<{
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
    }[]>;
}
