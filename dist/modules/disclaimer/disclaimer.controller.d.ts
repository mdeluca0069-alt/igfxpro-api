import { DisclaimerService } from './disclaimer.service';
export declare class DisclaimerController {
    private readonly disclaimerService;
    constructor(disclaimerService: DisclaimerService);
    get(): {
        text: string;
    };
}
