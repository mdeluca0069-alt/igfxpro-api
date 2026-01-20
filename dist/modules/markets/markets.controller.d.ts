import { MarketsService } from './markets.service';
export declare class MarketsController {
    private readonly marketsService;
    constructor(marketsService: MarketsService);
    submit(body: any): Promise<{
        success: boolean;
        message: string;
        userId: string;
        data: any;
    }>;
    eligibility(userId: string): Promise<{
        eligible: boolean;
        userId: string;
    }>;
}
