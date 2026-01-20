import { PrismaService } from '../../prisma/prisma.service';
import { RiskEventType } from '@prisma/client';
export declare class RiskService {
    private prisma;
    constructor(prisma: PrismaService);
    createRiskEvent(accountId: string, type: RiskEventType, level: number): Promise<{
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.RiskEventType;
        accountId: string | null;
        severity: string;
        message: string;
        resolved: boolean;
        resolvedAt: Date | null;
    }>;
    checkAccountRisk(accountId: string): Promise<{
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.RiskEventType;
        accountId: string | null;
        severity: string;
        message: string;
        resolved: boolean;
        resolvedAt: Date | null;
    }>;
}
