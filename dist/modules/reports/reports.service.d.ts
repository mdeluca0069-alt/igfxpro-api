import { PrismaService } from '../../prisma/prisma.service';
export declare class ReportsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    companyReport(year: number): Promise<{
        id: string;
        updatedAt: Date;
        year: number;
        activeClients: number;
        totalAccounts: number;
        totalTrades: number;
        totalVolume: import("@prisma/client/runtime/library").Decimal;
        totalCommission: import("@prisma/client/runtime/library").Decimal;
        activeAccounts: number;
    }>;
}
