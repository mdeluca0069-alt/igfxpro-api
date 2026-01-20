import { CompanyService } from './company.service';
export declare class CompanyController {
    private readonly companyService;
    constructor(companyService: CompanyService);
    getStats(year?: number): Promise<{
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
    addStats(body: any): Promise<{
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
