import { TimeConstants } from './constants';

export class Settings {
    static VERSION: number = 1;
    static HEARTBEAT_INTERVAL_TIME: number = 15 * TimeConstants.SECOND;
    static REQUEST_TIMEOUT: number = 10 * TimeConstants.SECOND;
    static VOTING_START_TIME: number = 1 * TimeConstants.MINUTE;
    static VOTING_WINDOW: number = 20 * TimeConstants.SECOND;
    static EXECUTE_WINDOW: number = 20 * TimeConstants.SECOND;
    static EXTRA_TIME: number = 3 * TimeConstants.MINUTE;
}
