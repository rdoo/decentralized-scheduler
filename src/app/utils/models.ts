import { Peer } from '../peer';
import { IntervalUnit } from './constants';

export interface Job {
    id: number;
    endpoint: string;
    startTime: number;
    nextExecute: number;
    intervalValue: number;
    intervalUnit: IntervalUnit;
    currentJob?: CurrentJob;
}

export interface CurrentJob {
    id?: number;
    votingTimeout: any;
    executeTimeout: any;
    extraTimeout: any;
    votes: number[];
    myVote: number;
}

export interface ResponseData {
    code: number;
    data: string;
}

export interface ResponseHeartbeat {
    v: number; // version
    u: number; // updateTime
}

export interface BodySync {
    p: Peer[]; // peers
    j: Job[]; // jobs
    u: number; // updateTime
    r: string; // receiver
}

export interface ResponseSync {
    success: boolean;
    peer: Peer;
}

interface Updatable {
    updateTime: number;
}

export interface BodyNewRemovePeer extends Updatable {
    host?: string;
}

export interface BodyNewJob extends Updatable {
    endpoint?: string;
    startTime?: number;
    intervalValue?: number;
    intervalUnit?: IntervalUnit;
}

export interface BodyRemoveJob extends Updatable {
    id: number;
}

export interface RequestVoteOrDone {
    id: number;
    exe: number; // next execute time
}

export interface ResponseVote {
    v: number; // vote
}
