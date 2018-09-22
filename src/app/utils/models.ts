export const enum HTTPCodes {
    OK = 200,
    NOT_FOUND = 404
}

export const enum HTTPMethods {
    GET = 'GET',
    POST = 'POST'
}

export const enum NodeHttpErrors {
    ECONNREFUSED = 'ECONNREFUSED',
    ENOTFOUND = 'ENOTFOUND',
    ECONNRESET = 'ECONNRESET'
}

export const enum Endpoints {
    INDEX = '/',
    GET_STATE = '/gs',
    ADD_NEW_PEER = '/ap',
    REMOVE_PEER = '/rp',
    ADD_NEW_JOB = '/aj',
    REMOVE_JOB = '/rj',
    HEARTBEAT = '/hb',
    FORCE_DEATH = '/fd',
    VOTE = '/v',
    DONE = '/d',
    SYNC = '/sy'
}

export const enum PeerStatus {
    ONLINE,
    OFFLINE,
    UNKNOWN,
    OLD_VERSION,
    DESYNC
}

export const enum IntervalUnit {
    MINUTE = 'm',
    HOUR = 'h',
    DAY = 'D',
    MONTH = 'M'
}

export interface Peer {
    host: string;
    status: PeerStatus;
}

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
    id: number;
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
