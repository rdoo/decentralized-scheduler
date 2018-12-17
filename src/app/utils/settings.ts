import { TimeConstants } from './constants';

export class Settings {
    static VERSION: number = 1;
    static JOB_TRIES_UNTIL_TERMINATE: number = 3;
    static REQUEST_TIMEOUT: number = 10 * TimeConstants.SECOND;
    static HEARTBEAT_INTERVAL_TIME: number = 25 * TimeConstants.MINUTE;
    static VOTING_START_TIME: number = 2 * TimeConstants.MINUTE;
    static VOTING_WINDOW: number = 20 * TimeConstants.SECOND;
    static EXECUTE_WINDOW: number = 20 * TimeConstants.SECOND;
    static EXTRA_VOTE_DELAY: number = 10 * TimeConstants.SECOND;
    static PERSISTENCE_FILE_PATH: string = __dirname + '/db.json';
}
