import { PrismaService } from '../prisma/prisma.service';
export declare class CompanyController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getCompanyStats(): Promise<{
        activeClients: number;
        totalAccounts: number;
        totalVolume: number | import("@prisma/client/runtime/library").Decimal;
        totalTrades: number;
    }>;
    getCompanyHistory(): Promise<{
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
}
