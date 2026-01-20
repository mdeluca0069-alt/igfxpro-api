import { MifidService } from './mifid.service';
export declare class MifidController {
    private readonly mifidService;
    constructor(mifidService: MifidService);
    submit(req: any, body: any): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        experience: string;
        objectives: string;
        riskClass: import(".prisma/client").$Enums.RiskClass;
        eligible: boolean;
    }>;
    get(req: any): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        experience: string;
        objectives: string;
        riskClass: import(".prisma/client").$Enums.RiskClass;
        eligible: boolean;
    }>;
}
