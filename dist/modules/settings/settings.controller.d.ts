import { SettingsService } from './settings.service';
export declare class SettingsController {
    private s;
    constructor(s: SettingsService);
    get(key: string): any;
    set(key: string, body: {
        value: any;
    }): any;
}
