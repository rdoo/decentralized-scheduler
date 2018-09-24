import { Job } from './job';
import { Endpoints, HTTPCodes, NodeHttpErrors } from './utils/constants';
import { Logger } from './utils/logger';
import { HeartbeatResponse, PeerSerializedForSync, PeerSerializedForWeb, StateSerializedForSync, SyncResult } from './utils/models';
import { makeGetRequest, makePostRequest, ResponseWrapper } from './utils/requests';
import { Settings } from './utils/settings';

export const enum PeerStatus {
    ONLINE,
    OFFLINE,
    UNKNOWN,
    OLD_VERSION,
    DESYNC
}

export class Peer {
    host: string;
    status: PeerStatus;

    constructor(host: string, status: PeerStatus = PeerStatus.UNKNOWN) {
        this.host = host;
        this.status = status;
    }

    async updateStatus(currentVersion: number, currentUpdateTime: number) {
        try {
            const responseData: ResponseWrapper = await makeGetRequest(this.host + Endpoints.HEARTBEAT);
            if (responseData.code === HTTPCodes.OK) {
                const data: HeartbeatResponse = JSON.parse(responseData.data); // todo try catch
                if (data.v !== undefined && data.v !== currentVersion) {
                    this.status = PeerStatus.OLD_VERSION;
                    return;
                } else if (data.u !== undefined && data.u < currentUpdateTime) {
                    this.status = PeerStatus.DESYNC;
                    return;
                }
                this.status = PeerStatus.ONLINE;
                return;
            }
            this.status = PeerStatus.OFFLINE;
        } catch (error) {
            if (error.code === NodeHttpErrors.ECONNREFUSED || error.code === NodeHttpErrors.ENOTFOUND) {
                this.status = PeerStatus.OFFLINE;
                return;
            } else if (error.code === NodeHttpErrors.ECONNRESET) {
                this.status = PeerStatus.UNKNOWN;
                return;
            }
            Logger.error('nowy error code', error, error.code);
            this.status = PeerStatus.UNKNOWN;
        }
    }

    sync(syncData: StateSerializedForSync): Promise<SyncResult> {
        Logger.log('Syncing peer', this.host);
        return new Promise(async (resolve, reject) => {
            setTimeout(() => {
                // Logger.error('Timeouted');
                resolve({ success: false, peer: this });
            }, Settings.REQUEST_TIMEOUT);

            let responseData: ResponseWrapper;
            try {
                responseData = await makePostRequest(this.host + Endpoints.SYNC_STATE, { p: syncData.p, j: syncData.j, u: syncData.u, t: syncData.t, r: this.host });
                if (responseData.code === HTTPCodes.OK && responseData.data === '') {
                    this.status = PeerStatus.ONLINE;
                    resolve({ success: true, peer: this });
                    return;
                }
            } catch (error) {
                Logger.error(error);
                resolve({ success: false, peer: this });
                return;
            }
            resolve({ success: false, peer: this });
        });
    }

    kill() {
        return makeGetRequest(this.host + Endpoints.FORCE_DEATH).catch(error => Logger.error(error));
    }

    getVoteForJob(job: Job) {
        return makePostRequest(this.host + Endpoints.JOB_VOTE, { i: job.id, e: job.executions });
    }

    serializeForSync(): PeerSerializedForSync {
        return { h: this.host, s: this.status };
    }

    serializeForWeb(): PeerSerializedForWeb {
        return { host: this.host, status: this.status };
    }
}
