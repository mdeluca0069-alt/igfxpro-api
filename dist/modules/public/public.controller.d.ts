import { PublicService } from './public.service';
export declare class PublicController {
    private readonly publicService;
    constructor(publicService: PublicService);
    companyStats(): Promise<{
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
    markets(): Promise<{
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
    }[]>;
}
