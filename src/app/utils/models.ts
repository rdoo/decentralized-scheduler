import { Peer, PeerStatus } from '../peer';
import { IntervalUnit } from './constants';

// models transmitted from server to web
export interface StateSerializedForWeb {
    version: number;
    myHost: string;
    updateTime: number;
    serverTime: number;
    peers: PeerSerializedForWeb[];
    jobs: JobSerializedForWeb[];
}

export interface PeerSerializedForWeb {
    host: string;
    status: PeerStatus;
}

export interface JobSerializedForWeb {
    id: number;
    endpoint: string;
    startTime: number;
    intervalValue: number;
    intervalUnit: IntervalUnit;
    executions: number;
    nextExecute: number;
}

// models transmitted from web to server
interface Updatable {
    updateTime: number;
}

export interface NewOrRemovePeerRequestBody extends Updatable {
    host?: string;
}

export interface NewJobRequestBody extends Updatable {
    endpoint?: string;
    startTime?: number;
    intervalValue?: number;
    intervalUnit?: IntervalUnit;
}

export interface RemoveJobRequestBody extends Updatable {
    id: number;
}

// models transmitted between peers
export interface StateSerializedForSync {
    r: string; // receiver
    u: number; // updateTime
    t: number; // sender time
    p: PeerSerializedForSync[]; // peers
    j: JobSerializedForSync[]; // jobs
}

export interface PeerSerializedForSync {
    h: string; // host
    s: PeerStatus; // status
}

export interface JobSerializedForSync {
    i: number; // id
    e: string; // endpoint
    s: number; // startTime
    iv: number; // intervalValue
    iu: IntervalUnit; // intervalUnit
    ex: number; // executions
}

export interface HeartbeatResponse {
    v: number; // version
    u: number; // updateTime
}

export interface VoteOrDoneRequestBody {
    i: number; // id
    e: number; // executions
}

// other
export interface SyncResult {
    success: boolean;
    peer: Peer;
}
