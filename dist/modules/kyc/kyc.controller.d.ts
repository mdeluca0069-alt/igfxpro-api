import { KycService } from './kyc.service';
export declare class KycController {
    private readonly kycService;
    constructor(kycService: KycService);
    submit(body: any): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.KYCStatus;
        userId: string;
        documentId: string;
        reviewedAt: Date | null;
    }>;
    review(userId: string, body: {
        status: 'APPROVED' | 'REJECTED';
        reviewerId: string;
    }): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.KYCStatus;
        userId: string;
        documentId: string;
        reviewedAt: Date | null;
    }>;
}
