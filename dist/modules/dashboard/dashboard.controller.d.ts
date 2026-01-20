import { DashboardService } from './dashboard.service';
export declare class DashboardController {
    private readonly dashboardService;
    constructor(dashboardService: DashboardService);
    getDashboard(): Promise<{
        totalUsers: number;
        activeAccounts: number;
        totalVolume: number;
        totalCommissions: number;
    }>;
}
