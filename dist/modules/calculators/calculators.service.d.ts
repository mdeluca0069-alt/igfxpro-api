export declare class CalculatorsService {
    calculateMargin(volume: number, leverage: number, price: number): number;
    calculatePnl(openPrice: number, closePrice: number, volume: number, type: 'LONG' | 'SHORT'): number;
}
