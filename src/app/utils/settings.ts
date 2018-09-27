import { TimeConstants } from './constants';

export class Settings {
    static VERSION: number = 1;
    static HEARTBEAT_INTERVAL_TIME: number = 25 * TimeConstants.MINUTE;
    static REQUEST_TIMEOUT: number = 10 * TimeConstants.SECOND;
    static VOTING_START_TIME: number = 2 * TimeConstants.MINUTE;
    static VOTING_WINDOW: number = 20 * TimeConstants.SECOND;
    static EXECUTE_WINDOW: number = 20 * TimeConstants.SECOND;
    static NEXT_VOTE_DELAY: number = 10 * TimeConstants.SECOND;
    static JOB_TRIES_UNTIL_TERMINATE: number = 5;
}
