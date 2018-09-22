import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import {
    BodyNewJob, BodyNewRemovePeer, BodyRemoveJob, BodySync, CurrentJob, Endpoints, HTTPCodes, HTTPMethods, IntervalUnit, Job, NodeHttpErrors, Peer, PeerStatus, RequestVoteOrDone,
    ResponseData, ResponseHeartbeat, ResponseSync
} from './utils/models';
import { makeGetRequest, makePostRequest } from './utils/requests';
import { Settings } from './utils/settings';

let html: string = require('./client/client.html');
html = html.replace(/\s*<!--\s*/g, '').replace(/\s*-->\s*/g, '');

export interface AppState {
    version: number;
    myHost: string;
    peers: Peer[];
    jobs: Job[];
    updateTime: number;
}

export class ServerApp {
    port: string;
    server: Server;
    // socketHandler: SocketHandler = new SocketHandler();
    state: AppState = {
        version: Settings.VERSION,
        myHost: null,
        peers: [],
        jobs: [],
        updateTime: 0
    };
    currentJobs: CurrentJob[] = [];

    constructor(port: string) {
        this.port = port;

        // this.state.peers.push({
        //     host: 'http://localhost:8081',
        //     status: PeerStatus.UNKNOWN
        // });
        // this.state.peers.push({
        //     host: 'http://localhost:8082',
        //     status: PeerStatus.UNKNOWN
        // });
        // this.state.peers.push({
        //     host: 'http://lasdasdasdtasdaasdssdads.com',
        //     status: PeerStatus.UNKNOWN
        // });
        // this.state.peers.push({
        //     host: 'http://www.onet.pl',
        //     status: PeerStatus.UNKNOWN
        // });

        // this.state.jobs.push({
        //     id: 1,
        //     endpoint: 'http://www.onet.pl',
        //     startTime: 1231,
        //     nextExecute: 3434534,
        //     intervalValue: 10,
        //     intervalUnit: IntervalUnit.MINUTE
        // });

        this.server = createServer((request, response) => {
            const url: string = request.url;
            let body: string = '';

            if (request.method === HTTPMethods.POST) {
                request.on('data', data => {
                    body += data;
                });
            }
            console.log(url);
            // console.log('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%');
            // console.log((request.connection as any).encrypted);
            // console.log(request.connection.remoteAddress, request.connection.remotePort, request.socket.remoteAddress, request.socket.remotePort);
            // console.log('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%');

            switch (url) {
                case Endpoints.HEARTBEAT:
                    response.writeHead(HTTPCodes.OK);
                    response.end(JSON.stringify(this.createHeartbeatReponse()));
                    break;
                case Endpoints.VOTE:
                    request.on('end', async () => {
                        const bodyData: RequestVoteOrDone = JSON.parse(body);
                        const job: Job = this.getJob(bodyData.id);
                        if (job.nextExecute === bodyData.exe) {
                            const currentJob: CurrentJob = this.getCurrentJob(bodyData.id);
                            if (currentJob.myVote === null) {
                                currentJob.myVote = generateVote();
                            }
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify({ v: currentJob.myVote }));
                        }
                        // todo co robic jak desync
                        response.writeHead(HTTPCodes.OK);
                        response.end();
                    });
                    break;
                case Endpoints.DONE:
                    request.on('end', async () => {
                        const bodyData: RequestVoteOrDone = JSON.parse(body);
                        const job: Job = this.getJob(bodyData.id);
                        if (job.nextExecute === bodyData.exe) {
                            this.handleJobDone(job);
                            response.writeHead(HTTPCodes.OK);
                            response.end();
                        }
                        // todo co robic jak desync
                        response.writeHead(HTTPCodes.OK);
                        response.end();
                    });
                    break;
                case Endpoints.SYNC:
                    request.on('end', () => {
                        // TODO sprawdzic czy otrzymailimsy peery ktore sa unkonown i je sync
                        console.log('Receiving sync');
                        const bodyData: BodySync = JSON.parse(body);
                        // console.error(bodyData, request.headers, request.headers.host);
                        this.state.peers.splice(0, this.state.peers.length);
                        this.state.peers.push(...bodyData.p);
                        // this.state.peers.push({ host: createHost(request.connection.remoteAddress, request.connection.remotePort), status: PeerStatus.ONLINE });
                        this.state.jobs.splice(0, this.state.jobs.length);
                        this.state.jobs.push(...bodyData.j);
                        this.state.updateTime = bodyData.u;
                        this.state.myHost = bodyData.r;
                        for (const peer of this.state.peers) {
                            if (peer.host === this.state.myHost) {
                                peer.status = PeerStatus.ONLINE;
                            }
                        }
                        response.writeHead(HTTPCodes.OK);
                        response.end();
                    });
                    break;
                case Endpoints.INDEX:
                    response.writeHead(HTTPCodes.OK, { 'Content-Type': 'text/html' });
                    response.end(html);
                    break;
                case Endpoints.GET_STATE:
                    response.writeHead(HTTPCodes.OK);
                    response.end(JSON.stringify(this.state));
                    break;
                case Endpoints.ADD_NEW_PEER:
                    request.on('end', async () => {
                        const bodyData: BodyNewRemovePeer = JSON.parse(body);
                        const newPeer: Peer = { host: bodyData.host, status: PeerStatus.UNKNOWN };
                        if (this.state.peers.some(peer => peer.host === newPeer.host)) {
                            // peer exists
                            response.writeHead(HTTPCodes.OK); // todo zmienic kod
                            response.end(JSON.stringify(this.state));
                            return;
                        }
                        const newPeers: Peer[] = [...this.state.peers, newPeer];
                        const success: boolean = await this.syncPeers(newPeers, { p: newPeers, j: this.state.jobs, u: bodyData.updateTime, r: null });
                        if (success) {
                            if (!this.state.peers.some(peer => peer.host === newPeer.host)) {
                                // todo uporzadkowac
                                this.state.peers.push(newPeer);
                            }
                            this.state.updateTime = bodyData.updateTime;
                        }
                        response.writeHead(HTTPCodes.OK);
                        response.end(JSON.stringify(this.state));
                    });
                    break;
                case Endpoints.REMOVE_PEER:
                    request.on('end', async () => {
                        const bodyData: BodyNewRemovePeer = JSON.parse(body);
                        let peerToRemove: Peer;
                        const newPeers: Peer[] = this.state.peers.filter(peer => {
                            const shouldRemove: boolean = peer.host === bodyData.host;
                            if (shouldRemove) {
                                peerToRemove = peer;
                                return false;
                            }
                            return true;
                        });
                        this.kill(peerToRemove);
                        const success: boolean = await this.syncPeers(newPeers, { p: newPeers, j: this.state.jobs, u: bodyData.updateTime, r: null });
                        if (success) {
                            this.state.peers.splice(this.state.peers.indexOf(peerToRemove), 1);
                            this.state.updateTime = bodyData.updateTime;
                        }
                        response.writeHead(HTTPCodes.OK);
                        response.end(JSON.stringify(this.state));
                    });
                    break;
                case Endpoints.ADD_NEW_JOB:
                    request.on('end', async () => {
                        const bodyData: BodyNewJob = JSON.parse(body);
                        const newJob: Job = {
                            id: this.chooseNewJobId(),
                            endpoint: bodyData.endpoint,
                            startTime: bodyData.startTime,
                            nextExecute: calculateNewExecuteTime(bodyData.startTime, bodyData.intervalValue, bodyData.intervalUnit),
                            intervalValue: bodyData.intervalValue,
                            intervalUnit: bodyData.intervalUnit
                        };
                        const newJobs: Job[] = [...this.state.jobs, newJob];
                        const success: boolean = await this.syncPeers(this.getPeers(), { p: this.state.peers, j: newJobs, u: bodyData.updateTime, r: null });
                        if (success) {
                            // if (!this.state.peers.some(peer => peer.host === newJob.host)) {
                            // todo uporzadkowac
                            this.state.jobs.push(newJob); // todo uwazac na duplikacje przy braku myhost
                            // }
                            this.state.updateTime = bodyData.updateTime;
                            this.currentJobs.push(this.createCurrentJob(newJob));
                        }
                        response.writeHead(HTTPCodes.OK);
                        response.end(JSON.stringify(this.state));
                    });
                    break;
                case Endpoints.REMOVE_JOB:
                    request.on('end', async () => {
                        const bodyData: BodyRemoveJob = JSON.parse(body);
                        let jobToRemove: Job;
                        const newJobs: Job[] = this.state.jobs.filter(job => {
                            const shouldRemove: boolean = job.id === bodyData.id;
                            if (shouldRemove) {
                                jobToRemove = job;
                                return false;
                            }
                            return true;
                        });
                        const success: boolean = await this.syncPeers(this.getPeers(), { p: this.state.peers, j: newJobs, u: bodyData.updateTime, r: null });
                        if (success) {
                            this.state.jobs.splice(this.state.jobs.indexOf(jobToRemove), 1);
                            this.state.updateTime = bodyData.updateTime;
                        }
                        response.writeHead(HTTPCodes.OK);
                        response.end(JSON.stringify(this.state));
                    });
                    break;
                case Endpoints.FORCE_DEATH:
                    response.writeHead(HTTPCodes.OK);
                    response.end();
                    process.exit();
                    break;
                default:
                    response.writeHead(HTTPCodes.NOT_FOUND);
                    response.end();
            }
        });

        // this.server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
        //     this.socketHandler.handle(socket, request);
        // });

        // this.socketHandler.emitter.on('data', data => {
        //     console.log('otrzymane date', data);
        // });
    }

    run() {
        this.server.listen(this.port, () => {
            console.log(new Date().toString().split(' ')[4] + ' - Server is listening on port ' + (this.server.address() as AddressInfo).port);
            // this.sendHeartBeats();
            setInterval(() => this.sendHeartBeats(), Settings.HEARTBEAT_INTERVAL_TIME);
        });
    }

    getPeers() {
        return this.state.peers.filter(peer => peer.host !== this.state.myHost);
    }

    async sendHeartBeats() {
        console.log('Checking peers');
        await Promise.all(this.getPeers().map(peer => this.updatePeerStatus(peer)));

        for (const peer of this.state.peers) {
            if (peer.status === PeerStatus.DESYNC) {
                this.syncPeer(peer, this.createSyncBody());
            }
        }
        // console.log(statuses);
        console.log(this.state.peers);
        // for (const peer of peers) {
        //     try {
        //         const responseData = await makeGetRequest(peer.host);
        //     }
        // }
    }

    async updatePeerStatus(peer: Peer) {
        try {
            const responseData: ResponseData = await makeGetRequest(peer.host + Endpoints.HEARTBEAT);
            if (responseData.code === HTTPCodes.OK) {
                const data: ResponseHeartbeat = JSON.parse(responseData.data); // todo try catch
                if (data.v !== undefined && data.v !== this.state.version) {
                    peer.status = PeerStatus.OLD_VERSION;
                    return;
                } else if (data.u !== undefined && data.u < this.state.updateTime) {
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
            console.error('nowy error code', error.code);
            peer.status = PeerStatus.UNKNOWN;
        }
    }

    syncPeer(syncedPeer: Peer, syncData: BodySync): Promise<ResponseSync> {
        console.log('updating peer', syncedPeer.host);
        return new Promise(async (resolve, reject) => {
            setTimeout(() => reject('Timeouted'), Settings.REQUEST_TIMEOUT);

            let responseData: ResponseData;
            try {
                // responseData = await makePostRequest(syncedPeer.host + Endpoints.SYNC, { p: syncData.p.filter(peer => peer !== syncedPeer), j: syncData.j, u: syncData.u });
                responseData = await makePostRequest(syncedPeer.host + Endpoints.SYNC, { p: syncData.p, j: syncData.j, u: syncData.u, r: syncedPeer.host });
                if (responseData.code === HTTPCodes.OK && responseData.data === '') {
                    syncedPeer.status = PeerStatus.ONLINE;
                    resolve({ success: true, peer: syncedPeer });
                }
            } catch (error) {
                reject(error);
                return;
            }
            resolve({ success: false, peer: syncedPeer });
        });
    }

    async syncPeers(peers: Peer[], syncData: BodySync): Promise<boolean> {
        const data: ResponseSync[] = await Promise.all(peers.filter(peer => peer.host !== this.state.myHost).map(peer => this.syncPeer(peer, syncData).catch(error => error)));
        // return data.some(item => (item.success && item.peer.host !== this.state.myHost) || (peers.length === 1 && item.success && item.peer.host === this.state.myHost)); // return true if at least one responded OK
        return data.some(item => item.success && item.peer.host !== this.state.myHost); // return true if at least one other peer responded OK
    }

    kill(peer: Peer) {
        return makeGetRequest(peer.host + Endpoints.FORCE_DEATH).catch(error => console.error(error));
    }

    createSyncBody(): BodySync {
        return { p: this.state.peers, j: this.state.jobs, u: this.state.updateTime, r: null };
    }

    createHeartbeatReponse(): ResponseHeartbeat {
        return { v: this.state.version, u: this.state.updateTime };
    }

    chooseNewJobId() {
        let id: number = 1;
        while (true) {
            if (!this.state.jobs.some(job => job.id === id)) {
                return id;
            }
            id++;
        }
    }

    createCurrentJob(job: Job): CurrentJob {
        const now: number = Date.now();
        return {
            id: job.id,
            votes: [],
            myVote: null,
            votingTimeout: setTimeout(() => this.getVotes(job), job.nextExecute - now - Settings.VOTING_TIME),
            executeTimeout: setTimeout(() => this.executeJob(job), job.nextExecute - now),
            extraTimeout: setTimeout(() => this.extraJob(job), job.nextExecute - now + Settings.EXTRA_TIME)
        };
    }

    getCurrentJob(id: number) {
        for (const currentJob of this.currentJobs) {
            if (id === currentJob.id) {
                return currentJob;
            }
        }
    }

    getJob(id: number) {
        for (const job of this.state.jobs) {
            if (id === job.id) {
                return job;
            }
        }
    }

    async getVotes(job: Job) {
        console.log('voting');
        const currentJob: CurrentJob = this.getCurrentJob(job.id);
        currentJob.myVote = generateVote();

        const votes: number[] = await Promise.all(this.getPeers().map(peer => this.getVote(peer, job).catch(error => error)));

        for (const vote of votes) {
            if (Number.isInteger(vote)) {
                currentJob.votes.push(vote);
            }
        }
    }

    getVote(peer: Peer, job: Job) {
        return makePostRequest(peer.host + Endpoints.VOTE, { id: job.id, exe: job.nextExecute });
    }

    async executeJob(job: Job) {
        console.log('executing');
        const currentJob: CurrentJob = this.getCurrentJob(job.id);
        if (currentJob.myVote === getWinnerVote(currentJob.votes)) {
            try {
                await makeGetRequest(job.endpoint);
            } catch (error) {
                console.error(error);
                return;
            }
            this.handleJobDone(job);
            this.getPeers().forEach(peer => {
                makePostRequest(peer.host + Endpoints.DONE, { id: job.id, exe: job.nextExecute });
            });
        }
    }

    extraJob(job: Job) {
        console.log('extra job');
        const currentJob: CurrentJob = this.getCurrentJob(job.id);
        if (currentJob.myVote !== null) {
            currentJob.myVote = null;
            currentJob.votes = [];
            this.clearCurrentJob(currentJob.id);
            currentJob.votingTimeout = setTimeout(() => this.getVotes(job), 0);
            currentJob.executeTimeout = setTimeout(() => this.executeJob(job), Settings.EXTRA_TIME);
            currentJob.extraTimeout = setTimeout(() => this.extraJob(job), 2 * Settings.EXTRA_TIME);
        }
    }

    clearCurrentJob(id: number) {
        const currentJob: CurrentJob = this.getCurrentJob(id);
        if (currentJob) {
            clearTimeout(currentJob.votingTimeout);
            clearTimeout(currentJob.executeTimeout);
            clearTimeout(currentJob.extraTimeout);
        }
    }

    handleJobDone(job: Job) {
        job.nextExecute = calculateNewExecuteTime(job.nextExecute, job.intervalValue, job.intervalUnit);
        this.clearCurrentJob(job.id);
        const currentJob: CurrentJob = this.getCurrentJob(job.id); // todo
        this.currentJobs.splice(this.currentJobs.indexOf(currentJob), 1);
        this.currentJobs.push(this.createCurrentJob(job));
    }
}

function createHost(remoteAddress: string, remotePort: number) {
    let host: string;
    const ipv6Prefix: string = '::ffff:';
    if (remoteAddress.startsWith(ipv6Prefix)) {
        host = remoteAddress.substring(ipv6Prefix.length);
    }

    return 'http://' + host; // reverse dns
}

function getWinnerVote(votes: number[]) {
    const winnerVote: number = Math.max(...votes);

    return winnerVote;
}

function calculateNewExecuteTime(startTime: number, intervalValue: number, intervalUnit: IntervalUnit) {
    switch (intervalUnit) {
        case IntervalUnit.MINUTE:
            intervalValue *= 1000 * 60;
            break;
        case IntervalUnit.HOUR:
            intervalValue *= 1000 * 60 * 60;
            break;
        case IntervalUnit.DAY:
            intervalValue *= 1000 * 60 * 60 * 24;
            break;
        case IntervalUnit.MONTH:
            intervalValue *= 1000 * 60 * 60 * 24 * 30;
            break;
    }

    return startTime + intervalValue;
}

function generateVote() {
    return Math.floor(Math.random() * 1e9);
}
