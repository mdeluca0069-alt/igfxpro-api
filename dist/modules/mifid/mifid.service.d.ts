import { PrismaService } from '../../prisma/prisma.service';
export declare class MifidService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    submitMifid(userId: string, data: any): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        experience: string;
        objectives: string;
        riskClass: import(".prisma/client").$Enums.RiskClass;
        eligible: boolean;
    }>;
    getMifid(userId: string): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        experience: string;
        objectives: string;
        riskClass: import(".prisma/client").$Enums.RiskClass;
        eligible: boolean;
    }>;
}
