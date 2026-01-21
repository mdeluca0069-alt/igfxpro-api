import { TermsConditionsService } from './terms-conditions.service';
export declare class TermsConditionsController {
    private readonly service;
    constructor(service: TermsConditionsService);
    getTerms(): Promise<{
        id: string;
        createdAt: Date;
        type: string;
        updatedAt: Date;
        title: string;
        content: string;
        version: number;
    }>;
}
