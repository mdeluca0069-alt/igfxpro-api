import { PolicyPrivacyService } from './policy-privacy.service';
export declare class PolicyPrivacyController {
    private readonly policyPrivacyService;
    constructor(policyPrivacyService: PolicyPrivacyService);
    getPolicies(): Promise<{
        policies: any[];
    }>;
}
