import { NotificationsService } from './notifications.service';
export declare class NotificationsController {
    private svc;
    constructor(svc: NotificationsService);
    email(body: {
        to: string;
        subject: string;
        body: string;
    }): {
        ok: boolean;
        to: string;
        subject: string;
    };
    sms(body: {
        to: string;
        message: string;
    }): {
        ok: boolean;
        to: string;
        message: string;
    };
}
