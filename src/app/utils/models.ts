import { JobInterface } from '../job';
import { Peer } from '../peer';
import { IntervalUnit } from './constants';

export interface RequestResponseData {
    code: number;
    data: string;
}

export interface HeartbeatResponse {
    v: number; // version
    u: number; // updateTime
}

export interface SyncBody {
    p: Peer[]; // peers
    j: JobInterface[]; // jobs
    u: number; // updateTime
    t: number; // sender time
    r: string; // receiver
}

export interface SyncResponse {
    success: boolean;
    peer: Peer;
}

export interface VoteOrDoneBody {
    id: number;
    exe: number; // next execute time
}

// export interface VoteResponse {
//     v: number; // vote
// }

interface Updatable {
    updateTime: number;
}

export interface NewRemovePeerBody extends Updatable {
    host?: string;
}

export interface NewJobBody extends Updatable {
    endpoint?: string;
    startTime?: number;
    intervalValue?: number;
    intervalUnit?: IntervalUnit;
}

export interface RemoveJobBody extends Updatable {
    id: number;
}
