import { PlatformsService } from './platforms.service';
export declare class PlatformsController {
    private readonly platformsService;
    constructor(platformsService: PlatformsService);
    list(): {
        name: string;
        type: string;
        status: string;
    }[];
}
