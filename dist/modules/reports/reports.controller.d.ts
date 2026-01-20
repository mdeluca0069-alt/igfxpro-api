import { ReportsService } from './reports.service';
export declare class ReportsController {
    private readonly reportsService;
    constructor(reportsService: ReportsService);
    company(year: string): Promise<{
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
