import { PrismaService } from '../../prisma/prisma.service';
export declare class MarketsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getTickers(): {
        symbol: string;
        price: number;
    }[];
    getChart(symbol: string): {
        symbol: string;
        data: any[];
    };
    submitMifid(userId: string, data: any): Promise<{
        success: boolean;
        message: string;
        userId: string;
        data: any;
    }>;
    checkEligibility(userId: string): Promise<{
        eligible: boolean;
        userId: string;
    }>;
}
