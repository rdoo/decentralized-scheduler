import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import { getVote, killPeer, Peer, PeerStatus, syncPeer, syncPeers, updatePeerStatus } from './peer';
import { StateHandler } from './state-handler';
import { Endpoints, HTTPCodes, HTTPMethods, IntervalUnit } from './utils/constants';
import { BodyNewJob, BodyNewRemovePeer, BodyRemoveJob, BodySync, CurrentJob, Job, RequestVoteOrDone } from './utils/models';
import { makeGetRequest, makePostRequest } from './utils/requests';
import { Settings } from './utils/settings';

let html: string = require('./client/client.html');
html = html.replace(/\s*<!--\s*/g, '').replace(/\s*-->\s*/g, '');

export interface AppState {
    version: number;
    myHost: string;
    updateTime: number;
    peers: Peer[];
    jobs: Job[];
}

export class ServerApp {
    port: string;
    server: Server;
    stateHandler: StateHandler = new StateHandler();
    state: AppState = {
        version: Settings.VERSION,
        myHost: null,
        peers: [],
        jobs: [],
        updateTime: 0
    };

    constructor(port: string) {
        this.port = port;

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
                    response.end(JSON.stringify({ v: this.state.version, u: this.state.updateTime }));
                    break;
                case Endpoints.JOB_VOTE:
                    request.on('end', () => {
                        const bodyData: RequestVoteOrDone = JSON.parse(body);
                        const job: Job = this.getJob(bodyData.id);
                        if (job.nextExecute === bodyData.exe) {
                            const currentJob: CurrentJob = this.getJob(bodyData.id).currentJob;
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
                case Endpoints.JOB_DONE:
                    request.on('end', () => {
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
                case Endpoints.SYNC_STATE:
                    request.on('end', () => {
                        // TODO sprawdzic czy otrzymailimsy peery ktore sa unkonown i je sync
                        console.log('Receiving sync', body);
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
                        if (this.getPeer(bodyData.host)) {
                            response.writeHead(HTTPCodes.BAD_REQUEST);
                            response.end(JSON.stringify(this.state));
                            return;
                        }
                        const newPeer: Peer = { host: bodyData.host, status: PeerStatus.UNKNOWN };
                        const newPeers: Peer[] = [...this.state.peers, newPeer];
                        const peersToSend: Peer[] = [...this.getOnlineAndDesyncPeers(), newPeer];
                        const success: boolean = await syncPeers(peersToSend, this.state.myHost, { p: newPeers, j: this.state.jobs, u: bodyData.updateTime, r: null });
                        if (success) {
                            if (!this.getPeer(bodyData.host)) {
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
                        const peerToRemove: Peer = this.getPeer(bodyData.host);
                        if (!peerToRemove) {
                            response.writeHead(HTTPCodes.BAD_REQUEST);
                            response.end(JSON.stringify(this.state));
                            return;
                        }
                        const newPeers: Peer[] = this.state.peers.filter(peer => peer !== peerToRemove);
                        const success: boolean = await syncPeers(this.getOnlineAndDesyncPeers().filter(peer => peer !== peerToRemove), this.state.myHost, {
                            p: newPeers,
                            j: this.state.jobs,
                            u: bodyData.updateTime,
                            r: null
                        });
                        if (success) {
                            killPeer(peerToRemove); // todo co jesli sie nie uda?
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
                        const success: boolean = await syncPeers(this.getOnlineAndDesyncPeers(), this.state.myHost, {
                            p: this.state.peers,
                            j: newJobs,
                            u: bodyData.updateTime,
                            r: null
                        });
                        if (success) {
                            // if (!this.state.peers.some(peer => peer.host === newJob.host)) {
                            // todo uporzadkowac
                            newJob.currentJob = this.createCurrentJob(newJob);
                            this.state.jobs.push(newJob); // todo uwazac na duplikacje przy braku myhost
                            // }
                            this.state.updateTime = bodyData.updateTime;
                            // this.currentJobs.push(this.createCurrentJob(newJob));
                        }
                        response.writeHead(HTTPCodes.OK);
                        response.end(JSON.stringify(this.state));
                    });
                    break;
                case Endpoints.REMOVE_JOB:
                    request.on('end', async () => {
                        const bodyData: BodyRemoveJob = JSON.parse(body);
                        const jobToRemove: Job = this.getJob(bodyData.id);
                        if (!jobToRemove) {
                            response.writeHead(HTTPCodes.BAD_REQUEST);
                            response.end(JSON.stringify(this.state));
                            return;
                        }
                        const newJobs: Job[] = this.state.jobs.filter(peer => peer !== jobToRemove);
                        const success: boolean = await syncPeers(this.getOnlineAndDesyncPeers(), this.state.myHost, {
                            p: this.state.peers,
                            j: newJobs,
                            u: bodyData.updateTime,
                            r: null
                        });
                        if (success) {
                            this.clearCurrentJob(jobToRemove.id);
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
    }

    run() {
        this.server.listen(this.port, () => {
            console.log(new Date().toString().split(' ')[4] + ' - Server is listening on port ' + (this.server.address() as AddressInfo).port);

            setInterval(async () => {
                console.log('Checking peers');
                await Promise.all(this.getOtherPeers().map(peer => updatePeerStatus(peer, this.state.version, this.state.updateTime)));
                console.log('Peers after checking');
                console.log(this.state.peers);

                const syncData: BodySync = { p: this.state.peers, j: this.state.jobs, u: this.state.updateTime, r: null };
                this.getDesyncPeers().forEach(peer => syncPeer(peer, syncData));
            }, Settings.HEARTBEAT_INTERVAL_TIME);
        });
    }

    getPeer(host: string) {
        for (const peer of this.state.peers) {
            if (peer.host === host) {
                return peer;
            }
        }
        return null;
    }

    getOtherPeers() {
        return this.state.peers.filter(peer => peer.host !== this.state.myHost);
    }

    getOnlinePeers() {
        return this.getOtherPeers().filter(peer => peer.status === PeerStatus.ONLINE);
    }

    getDesyncPeers() {
        return this.getOtherPeers().filter(peer => peer.status === PeerStatus.DESYNC);
    }

    getOnlineAndDesyncPeers() {
        return this.getOtherPeers().filter(peer => peer.status === PeerStatus.ONLINE || peer.status === PeerStatus.DESYNC);
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

    getJob(id: number) {
        for (const job of this.state.jobs) {
            if (id === job.id) {
                return job;
            }
        }
        return null;
    }

    async getVotes(job: Job) {
        console.log('voting');
        const currentJob: CurrentJob = job.currentJob;
        currentJob.myVote = generateVote(); // todo jesli nie ma vote

        const votes: number[] = await Promise.all(this.getOnlinePeers().map(peer => getVote(peer, job).catch(error => error)));

        for (const vote of votes) {
            if (Number.isInteger(vote)) {
                currentJob.votes.push(vote);
            }
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

    async executeJob(job: Job) {
        console.log('executing');
        const currentJob: CurrentJob = job.currentJob;
        if (currentJob.myVote === getWinnerVote(currentJob.votes)) {
            try {
                await makeGetRequest(job.endpoint);
            } catch (error) {
                console.error(error);
                return;
            }
            this.handleJobDone(job);
            this.getOnlinePeers().forEach(peer => {
                makePostRequest(peer.host + Endpoints.JOB_DONE, { id: job.id, exe: job.nextExecute });
            });
        }
    }

    extraJob(job: Job) {
        console.log('extra job');
        const currentJob: CurrentJob = job.currentJob;
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
        const currentJob: CurrentJob = this.getJob(id).currentJob;
        if (currentJob) {
            clearTimeout(currentJob.votingTimeout);
            clearTimeout(currentJob.executeTimeout);
            clearTimeout(currentJob.extraTimeout);
        }
    }

    handleJobDone(job: Job) {
        job.nextExecute = calculateNewExecuteTime(job.nextExecute, job.intervalValue, job.intervalUnit);
        this.clearCurrentJob(job.id);
        const currentJob: CurrentJob = job.currentJob; // todo
        // this.currentJobs.splice(this.currentJobs.indexOf(currentJob), 1);
        // this.currentJobs.push(this.createCurrentJob(job));
    }
}

export function getWinnerVote(votes: number[]) {
    const winnerVote: number = Math.max(...votes);

    return winnerVote;
}

export function calculateNewExecuteTime(startTime: number, intervalValue: number, intervalUnit: IntervalUnit) {
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

export function generateVote() {
    return Math.floor(Math.random() * 1e9);
}
