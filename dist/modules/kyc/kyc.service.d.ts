import { PrismaService } from '../../prisma/prisma.service';
export declare class KycService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    submitKyc(userId: string, data: any): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.KYCStatus;
        userId: string;
        documentId: string;
        reviewedAt: Date | null;
    }>;
    reviewKyc(userId: string, status: 'APPROVED' | 'REJECTED', reviewerId: string): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.KYCStatus;
        userId: string;
        documentId: string;
        reviewedAt: Date | null;
    }>;
}
