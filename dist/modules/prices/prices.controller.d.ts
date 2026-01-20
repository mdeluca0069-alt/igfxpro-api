import { PricesService } from './prices.service';
export declare class PricesController {
    private readonly pricesService;
    constructor(pricesService: PricesService);
    getPrices(): {
        symbol: string;
        price: number;
    }[];
}
