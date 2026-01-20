import { PrismaService } from '../../prisma/prisma.service';
export declare class PolicyPrivacyService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getPolicies(): Promise<{
        policies: any[];
    }>;
    updatePolicy(id: string, content: string): Promise<{
        id: string;
        content: string;
    }>;
}
