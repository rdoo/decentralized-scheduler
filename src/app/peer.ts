import { Endpoints, HTTPCodes, NodeHttpErrors } from './utils/constants';
import { BodySync, Job, ResponseData, ResponseHeartbeat, ResponseSync } from './utils/models';
import { makeGetRequest, makePostRequest } from './utils/requests';
import { Settings } from './utils/settings';

export const enum PeerStatus {
    ONLINE,
    OFFLINE,
    UNKNOWN,
    OLD_VERSION,
    DESYNC
}

export interface Peer {
    host: string;
    status: PeerStatus;
}

export async function updatePeerStatus(peer: Peer, currentVersion: number, currentUpdateTime: number) {
    try {
        const responseData: ResponseData = await makeGetRequest(peer.host + Endpoints.HEARTBEAT);
        if (responseData.code === HTTPCodes.OK) {
            const data: ResponseHeartbeat = JSON.parse(responseData.data); // todo try catch
            if (data.v !== undefined && data.v !== currentVersion) {
                peer.status = PeerStatus.OLD_VERSION;
                return;
            } else if (data.u !== undefined && data.u < currentUpdateTime) {
                peer.status = PeerStatus.DESYNC;
                return;
            }
            peer.status = PeerStatus.ONLINE;
            return;
        }
        peer.status = PeerStatus.OFFLINE;
    } catch (error) {
        if (error.code === NodeHttpErrors.ECONNREFUSED || error.code === NodeHttpErrors.ENOTFOUND) {
            peer.status = PeerStatus.OFFLINE;
            return;
        } else if (error.code === NodeHttpErrors.ECONNRESET) {
            peer.status = PeerStatus.UNKNOWN;
            return;
        }
        console.error('nowy error code', error, error.code);
        peer.status = PeerStatus.UNKNOWN;
    }
}

export async function syncPeers(peers: Peer[], myHost: string, syncData: BodySync): Promise<boolean> {
    const responses: ResponseSync[] = await Promise.all(peers.map(peer => syncPeer(peer, syncData)));
    return responses.some(item => item.success && item.peer.host !== myHost); // return true if at least one other peer responded OK
}

export function syncPeer(desyncedPeer: Peer, syncData: BodySync): Promise<ResponseSync> {
    console.log('Syncing peer', desyncedPeer.host);
    return new Promise(async (resolve, reject) => {
        setTimeout(() => {
            // console.error('Timeouted');
            resolve({ success: false, peer: desyncedPeer });
        }, Settings.REQUEST_TIMEOUT);

        let responseData: ResponseData;
        try {
            // responseData = await makePostRequest(syncedPeer.host + Endpoints.SYNC, { p: syncData.p.filter(peer => peer !== syncedPeer), j: syncData.j, u: syncData.u });
            responseData = await makePostRequest(desyncedPeer.host + Endpoints.SYNC_STATE, { p: syncData.p, j: syncData.j, u: syncData.u, r: desyncedPeer.host });
            if (responseData.code === HTTPCodes.OK && responseData.data === '') {
                desyncedPeer.status = PeerStatus.ONLINE;
                resolve({ success: true, peer: desyncedPeer });
            }
        } catch (error) {
            console.error(error);
            resolve({ success: false, peer: desyncedPeer });
            return;
        }
        resolve({ success: false, peer: desyncedPeer });
    });
}

export function killPeer(peer: Peer) {
    return makeGetRequest(peer.host + Endpoints.FORCE_DEATH).catch(error => console.error(error));
}

export function getVote(peer: Peer, job: Job) {
    return makePostRequest(peer.host + Endpoints.JOB_VOTE, { id: job.id, exe: job.nextExecute });
}
