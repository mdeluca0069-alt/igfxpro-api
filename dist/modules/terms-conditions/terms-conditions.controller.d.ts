import { TermsConditionsService } from './terms-conditions.service';
export declare class TermsConditionsController {
    private readonly service;
    constructor(service: TermsConditionsService);
    getTerms(): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        type: string;
        title: string;
        content: string;
        version: number;
    }>;
}
