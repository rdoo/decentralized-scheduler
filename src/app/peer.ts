import { Job } from './job';
import { CustomErrors, Endpoints, HTTPCodes, NodeHttpErrors } from './utils/constants';
import { Logger } from './utils/logger';
import { PeerSerializedForSync, PeerSerializedForWeb, StateSerializedForSync, SyncResult } from './utils/models';
import { makeGetRequest, makePostRequest, ResponseWrapper } from './utils/requests';

export const enum PeerStatus {
    ONLINE,
    OFFLINE,
    UNKNOWN,
    DESYNC,
    ERRORED
}

export class Peer {
    host: string;
    status: PeerStatus;

    constructor(host: string, status: PeerStatus = PeerStatus.UNKNOWN) {
        this.host = host;
        this.status = status;
    }

    async heartbeat(currentUpdateTime: number) {
        try {
            const responseData: ResponseWrapper = await makeGetRequest(this.host + Endpoints.HEARTBEAT);
            if (responseData.code === HTTPCodes.OK) {
                const updateTime: number = parseInt(responseData.data, 10);
                if (isNaN(updateTime)) {
                    this.status = PeerStatus.ERRORED;
                } else if (updateTime < currentUpdateTime) {
                    this.status = PeerStatus.DESYNC;
                } else {
                    this.status = PeerStatus.ONLINE;
                }
            } else {
                this.status = PeerStatus.ERRORED;
            }
        } catch (error) {
            Logger.error(error);
            this.setStatusFromError(error);
        }
    }

    async sync(syncData: StateSerializedForSync): Promise<SyncResult> {
        Logger.log('Sending sync data to peer', this.host);
        try {
            const responseData: ResponseWrapper = await makePostRequest(this.host + Endpoints.SYNC_STATE, {
                p: syncData.p,
                j: syncData.j,
                u: syncData.u,
                t: syncData.t,
                r: this.host
            });
            if (responseData.code === HTTPCodes.OK && responseData.data === '') {
                this.status = PeerStatus.ONLINE;
                return { success: true, peer: this };
            } else {
                this.status = PeerStatus.ERRORED;
                return { success: false, peer: this };
            }
        } catch (error) {
            Logger.error(error);
            this.setStatusFromError(error);
            return { success: false, peer: this };
        }
    }

    async kill() {
        // no need to set a status because peer will be removed right away
        try {
            await makeGetRequest(this.host + Endpoints.FORCE_DEATH);
        } catch (error) {
            Logger.error(error);
        }
    }

    async getVoteForJob(job: Job) {
        try {
            const responseData: ResponseWrapper = await makePostRequest(this.host + Endpoints.JOB_VOTE, { i: job.id, e: job.executions });
            if (responseData.code === HTTPCodes.OK) {
                const vote: number = parseInt(responseData.data, 10);
                if (!isNaN(vote)) {
                    this.status = PeerStatus.ONLINE;
                    return vote;
                }
            } else if (responseData.code === HTTPCodes.NOT_IMPLEMENTED) {
                this.status = PeerStatus.DESYNC;
                return null;
            }

            this.status = PeerStatus.ERRORED;
            return null;
        } catch (error) {
            Logger.error(error);
            this.setStatusFromError(error);
            return null;
        }
    }

    async informJobDone(job: Job, executions: number) {
        try {
            const responseData: ResponseWrapper = await makePostRequest(this.host + Endpoints.JOB_DONE, { i: job.id, e: executions });
            if (responseData.code === HTTPCodes.OK && responseData.data === '') {
                this.status = PeerStatus.ONLINE;
            } else if (responseData.code === HTTPCodes.NOT_IMPLEMENTED && responseData.data === '') {
                this.status = PeerStatus.DESYNC;
            } else {
                this.status = PeerStatus.ERRORED;
            }
        } catch (error) {
            Logger.error(error);
            this.setStatusFromError(error);
        }
    }

    setStatusFromError(error: any) {
        if (error.code === NodeHttpErrors.ECONNREFUSED || error.code === NodeHttpErrors.ENOTFOUND || error.code === CustomErrors.TIMEOUTED) {
            this.status = PeerStatus.OFFLINE;
        } else if (error.code === NodeHttpErrors.ECONNRESET) {
            this.status = PeerStatus.UNKNOWN;
        } else {
            Logger.error('New error code', error.code, error);
            this.status = PeerStatus.UNKNOWN;
        }
    }

    serializeForSync(): PeerSerializedForSync {
        return { h: this.host, s: this.status };
    }

    serializeForWeb(): PeerSerializedForWeb {
        return { host: this.host, status: this.status };
    }
}
