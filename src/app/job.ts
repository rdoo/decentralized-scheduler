import { IntervalUnit, TimeConstants } from './utils/constants';
import { randomInteger } from './utils/helpers';
import { JobSerializedForSync, JobSerializedForWeb } from './utils/models';

export interface CurrentJob {
    jobTimeout?: any;
    tries: number;
    votes?: number[];
    myVote?: number;
}

export class Job {
    id: number;
    endpoint: string;
    startTime: number;
    intervalValue: number;
    intervalUnit: IntervalUnit;
    executions: number;
    nextExecute: number;
    currentJob: CurrentJob;

    constructor(id: number, endpoint: string, startTime: number, intervalValue: number, intervalUnit: IntervalUnit, executions: number = 0) {
        this.id = id;
        this.endpoint = endpoint;
        this.startTime = startTime;
        this.intervalValue = intervalValue;
        this.intervalUnit = intervalUnit;
        this.executions = executions;
        this.nextExecute = this.calculateExecuteTime();
        this.createCurrentJob();
    }

    calculateExecuteTime() {
        let value: number = this.intervalValue * (this.executions + 1);
        switch (this.intervalUnit) {
            case IntervalUnit.MINUTE:
                value *= TimeConstants.MINUTE;
                break;
            case IntervalUnit.HOUR:
                value *= TimeConstants.HOUR;
                break;
            case IntervalUnit.DAY:
                value *= TimeConstants.DAY;
                break;
            case IntervalUnit.MONTH:
                value *= TimeConstants.MONTH;
                break;
        }

        return this.startTime + value;
    }

    markDone(timesDone: number) {
        this.executions += timesDone;
        this.nextExecute = this.calculateExecuteTime();
        this.clearCurrentJob();
        this.createCurrentJob();
    }

    clearCurrentJob() {
        clearTimeout(this.currentJob.jobTimeout);
    }

    createCurrentJob() {
        this.currentJob = { tries: 0 };
        this.vote();
    }

    vote() {
        const vote: number = randomInteger();
        this.currentJob.myVote = vote;
        this.currentJob.votes = [vote];
        this.currentJob.tries++;
    }

    getWinnerVote() {
        if (this.currentJob.votes.length < 2) {
            return null;
        }

        const winnerVote: number = Math.max(...this.currentJob.votes);

        const numberOfWinners: number = this.currentJob.votes.filter(vote => vote === winnerVote).length;
        if (numberOfWinners !== 1) {
            return null;
        }

        return winnerVote;
    }

    equal(job: JobSerializedForSync) {
        if (this.id === job.i && this.endpoint === job.e && this.startTime === job.s && this.intervalValue === job.iv && this.intervalUnit === job.iu) {
            return true;
        }
        return false;
    }

    serializeForSync(): JobSerializedForSync {
        return {
            i: this.id,
            e: this.endpoint,
            s: this.startTime,
            iv: this.intervalValue,
            iu: this.intervalUnit,
            ex: this.executions
        };
    }

    serializeForWeb(): JobSerializedForWeb {
        return {
            id: this.id,
            endpoint: this.endpoint,
            startTime: this.startTime,
            intervalValue: this.intervalValue,
            intervalUnit: this.intervalUnit,
            executions: this.executions,
            nextExecute: this.nextExecute
        };
    }
}
