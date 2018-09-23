import { IntervalUnit, TimeConstants } from './utils/constants';

export interface JobInterface {
    id: number;
    endpoint: string;
    startTime: number;
    intervalValue: number;
    intervalUnit: IntervalUnit;
    nextExecute: number;
}

export interface CurrentJob {
    timeout: any;
    // executeTimeout: any;
    // extraTimeout: any;
    votes: number[];
    myVote: number;
}

export class Job implements JobInterface {
    id: number;
    endpoint: string;
    startTime: number;
    intervalValue: number;
    intervalUnit: IntervalUnit;
    nextExecute: number;
    currentJob: CurrentJob;

    constructor(id: number, endpoint: string, startTime: number, intervalValue: number, intervalUnit: IntervalUnit, nextExecute?: number) {
        this.id = id;
        this.endpoint = endpoint;
        this.startTime = startTime;
        this.intervalValue = intervalValue;
        this.intervalUnit = intervalUnit;
        this.nextExecute = nextExecute || this.calculateExecuteTime(this.startTime);
    }

    calculateExecuteTime(startTime: number) {
        let value: number = this.intervalValue;
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

        return startTime + value;
    }

    // co jesli jest 2 winnerow
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

    getMyVote() {
        if (this.currentJob.myVote === null) {
            this.currentJob.myVote = Math.floor(Math.random() * 1e9);
            console.log('Wylosowano', this.currentJob.myVote);
            this.currentJob.votes.push(this.currentJob.myVote);
        }
        return this.currentJob.myVote;
    }

    clearCurrentJob() {
        clearTimeout(this.currentJob.timeout);
        // clearTimeout(this.currentJob.executeTimeout);
        // clearTimeout(this.currentJob.extraTimeout);
    }

    serialize(): JobInterface {
        return {
            id: this.id,
            endpoint: this.endpoint,
            startTime: this.startTime,
            intervalValue: this.intervalValue,
            intervalUnit: this.intervalUnit,
            nextExecute: this.nextExecute
        };
    }
}
