import { CalculatorsService } from './calculators.service';
export declare class CalculatorsController {
    private readonly calculatorsService;
    constructor(calculatorsService: CalculatorsService);
    calculateMargin(body: {
        volume: number;
        leverage: number;
        price: number;
    }): Promise<{
        margin: number;
    }>;
    calculatePnl(body: {
        openPrice: number;
        closePrice: number;
        volume: number;
        type: 'LONG' | 'SHORT';
    }): Promise<{
        pnl: number;
    }>;
}
