export declare class NotificationsService {
    sendEmail(to: string, subject: string, body: string): {
        ok: boolean;
        to: string;
        subject: string;
    };
    sendSms(to: string, message: string): {
        ok: boolean;
        to: string;
        message: string;
    };
}
