export class Logger {
    static log(...messages) {
        if (!IS_PRODUCTION_BUILD) {
            console.log(new Date().toLocaleTimeString(), ...messages);
        }
    }

    static error(...messages) {
        console.error(new Date().toLocaleTimeString(), ...messages);
    }
}
