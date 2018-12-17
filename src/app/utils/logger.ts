export class Logger {
    static log(...messages: any[]) {
        if (!IS_PRODUCTION_BUILD) {
            console.log(new Date().toLocaleTimeString(), ...messages);
        }
    }

    static error(...messages: any[]) {
        console.error(new Date().toLocaleTimeString(), ...messages);
    }
}
