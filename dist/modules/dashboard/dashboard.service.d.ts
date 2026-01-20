import { PrismaService } from '../../prisma/prisma.service';
export declare class DashboardService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getDashboardData(): Promise<{
        totalUsers: number;
        activeAccounts: number;
        totalVolume: number;
        totalCommissions: number;
    }>;
}
