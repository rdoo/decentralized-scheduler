import { CurrentJob, Job, JobInterface } from './job';
import { Peer, PeerStatus, syncPeers } from './peer';
import { Endpoints } from './utils/constants';
import { NewJobBody, RequestResponseData, SyncBody } from './utils/models';
import { makeGetRequest, makePostRequest } from './utils/requests';
import { Settings } from './utils/settings';

export interface State {
    version: number;
    myHost: string;
    updateTime: number;
    timeDiff: number;
    peers: Peer[];
    jobs: Job[];
}

export class StateHandler implements State {
    version: number = Settings.VERSION;
    myHost: string = null;
    updateTime: number = 0;
    timeDiff: number = 0;
    peers: Peer[] = [];
    jobs: Job[] = [];

    syncState(data: SyncBody) {
        this.peers.splice(0, this.peers.length);
        this.peers.push(...data.p.map(peer => new Peer(peer.host, peer.status)));
        this.getUnknownAndDesyncPeers().forEach(peer => peer.updateStatus(this.version, this.updateTime));
        // todo lepiej porownywac joby i usuwac tylko niepotrzebne
        this.jobs.splice(0, this.jobs.length);
        this.jobs.push(
            ...data.j.map(job => {
                const newJob: Job = new Job(job.id, job.endpoint, job.startTime, job.intervalValue, job.intervalUnit, job.nextExecute);
                newJob.currentJob = this.createCurrentJob(newJob);
                return newJob;
            })
        );
        this.updateTime = data.u;
        this.timeDiff = data.t - Date.now();
        this.myHost = data.r;
        this.getPeer(this.myHost).status = PeerStatus.ONLINE;
    }

    getState() {
        return { version: this.version, myHost: this.myHost, updateTime: this.updateTime, peers: this.peers, jobs: this.serializeJobs() };
    }

    async heartbeat() {
        // console.log('Checking peers');
        await Promise.all(this.getOtherPeers().map(peer => peer.updateStatus(this.version, this.updateTime)));
        // console.log('Peers after checking');
        // console.log(this.peers);

        const syncData: SyncBody = { p: this.peers, j: this.serializeJobs(), u: this.updateTime, t: Date.now() + this.timeDiff, r: null };
        this.getDesyncPeers().forEach(peer => peer.sync(syncData));
    }

    async addPeer(newPeer: Peer, updateTime: number) {
        const newPeers: Peer[] = [...this.peers, newPeer];
        const peersToSend: Peer[] = [...this.getOnlineAndDesyncPeers(), newPeer];
        const success: boolean = await syncPeers(peersToSend, this.myHost, { p: newPeers, j: this.serializeJobs(), u: updateTime, t: Date.now(), r: null }); // todo serializowac jobs
        if (success) {
            if (!this.getPeer(newPeer.host)) {
                this.peers.push(newPeer);
            }
            this.updateTime = updateTime;
            this.timeDiff = 0;
        }
        return success;
    }

    async removePeer(peerToRemove: Peer, updateTime: number) {
        const newPeers: Peer[] = this.peers.filter(peer => peer !== peerToRemove);
        const success: boolean = await syncPeers(this.getOnlineAndDesyncPeers().filter(peer => peer !== peerToRemove), this.myHost, {
            p: newPeers,
            j: this.serializeJobs(),
            u: updateTime,
            t: Date.now(),
            r: null
        });
        if (success) {
            peerToRemove.kill(); // todo co jesli sie nie uda?
            this.peers.splice(this.peers.indexOf(peerToRemove), 1);
            this.updateTime = updateTime;
            this.timeDiff = 0;
        }
        return success;
    }

    async addJob(data: NewJobBody) {
        const newJob: Job = new Job(this.getNewJobId(), data.endpoint, data.startTime, data.intervalValue, data.intervalUnit);
        const newJobs: JobInterface[] = [...this.serializeJobs(), newJob.serialize()];
        const success: boolean = await syncPeers(this.getOnlineAndDesyncPeers(), this.myHost, {
            p: this.peers,
            j: newJobs,
            u: data.updateTime,
            t: Date.now(),
            r: null
        });
        if (success) {
            newJob.currentJob = this.createCurrentJob(newJob);
            this.jobs.push(newJob);
            this.updateTime = data.updateTime;
            this.timeDiff = 0;
        }
        return success;
    }

    async removeJob(jobToRemove: Job, updateTime: number) {
        const newJobs: JobInterface[] = this.jobs.filter(job => job !== jobToRemove).map(job => job.serialize());
        const success: boolean = await syncPeers(this.getOnlineAndDesyncPeers(), this.myHost, {
            p: this.peers,
            j: newJobs,
            u: updateTime,
            t: Date.now(),
            r: null
        });
        if (success) {
            jobToRemove.clearCurrentJob();
            this.jobs.splice(this.jobs.indexOf(jobToRemove), 1);
            this.updateTime = updateTime;
            this.timeDiff = 0;
        }
        return success;
    }

    getPeer(host: string) {
        for (const peer of this.peers) {
            if (peer.host === host) {
                return peer;
            }
        }
        return null;
    }

    getOtherPeers() {
        return this.peers.filter(peer => peer.host !== this.myHost);
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

    getUnknownAndDesyncPeers() {
        return this.getOtherPeers().filter(peer => peer.status === PeerStatus.UNKNOWN || peer.status === PeerStatus.DESYNC);
    }

    getJob(id: number) {
        for (const job of this.jobs) {
            if (id === job.id) {
                return job;
            }
        }
        return null;
    }

    serializeJobs() {
        return this.jobs.map(job => job.serialize());
    }

    getNewJobId() {
        let id: number = 1;
        while (true) {
            if (!this.jobs.some(job => job.id === id)) {
                return id;
            }
            id++;
        }
    }

    createCurrentJob(job: Job): CurrentJob {
        const now: number = Date.now() + this.timeDiff;
        return {
            votes: [],
            myVote: null,
            timeout: setTimeout(() => this.getVotes(job), job.nextExecute - now - Settings.VOTING_START_TIME)
        };
    }

    async getVotes(job: Job) {
        console.log('Voting');
        job.getMyVote();

        job.currentJob.timeout = setTimeout(() => this.chooseWinner(job), Settings.VOTING_WINDOW);

        const data: RequestResponseData[] = await Promise.all(this.getOnlinePeers().map(peer => peer.getVoteForJob(job).catch(error => error)));
        console.log(data);
        for (const item of data) {
            const vote: number = parseInt(item.data, 10);
            if (!isNaN(vote)) {
                job.currentJob.votes.push(vote);
            }
        }
    }

    chooseWinner(job: Job) {
        console.log('Lista votow', job.currentJob.votes);
        const winnerVote: number = job.getWinnerVote();
        if (winnerVote === null) {
            console.log('No winner');
            job.currentJob.timeout = setTimeout(() => this.getVotes(job), 0);
        } else {
            const executeTime: number = job.nextExecute - Date.now() - this.timeDiff;
            if (job.currentJob.myVote === winnerVote) {
                console.log('Zwyciestwo');
                job.currentJob.timeout = setTimeout(() => this.executeJob(job), executeTime);
            } else {
                job.currentJob.timeout = setTimeout(() => this.checkIfExecuted(job), executeTime + Settings.EXECUTE_WINDOW);
            }
        }
    }

    async executeJob(job: Job) {
        console.log('Executing job');
        try {
            await makeGetRequest(job.endpoint);
        } catch (error) {
            console.error(error);
            return;
        }

        // wyslanie musi byc wczesniej niz calculateExecuteTime
        this.getOnlinePeers().forEach(peer => {
            makePostRequest(peer.host + Endpoints.JOB_DONE, { id: job.id, exe: job.nextExecute });
        });

        this.handleJobDone(job); // todo moze robic to po poinformowaniu, trzeba podac ktore wykonanie
        // todo przeniesc do innego pliku?
    }

    checkIfExecuted(job: Job) {
        console.log('Check execution');
        const currentJob: CurrentJob = job.currentJob;
        // todo moze jakis status
        if (currentJob.myVote === null) {
            console.log('Job was executed');
        } else {
            job.clearCurrentJob();
            currentJob.myVote = null;
            currentJob.votes = [];
            currentJob.timeout = setTimeout(() => this.getVotes(job), 0);
        }
    }

    handleJobDone(job: Job) {
        job.nextExecute = job.calculateExecuteTime(job.nextExecute);
        job.clearCurrentJob();
        job.currentJob = this.createCurrentJob(job);
    }

    getJobVote(id: number, nextExecute: number): number {
        const job: Job = this.getJob(id);
        if (job && job.nextExecute === nextExecute) {
            // todo jak nextExecute sie nie zgadza to usunac?
            return job.getMyVote();
        }
        return null;
    }

    getJobDone(id: number, nextExecute: number): boolean {
        const job: Job = this.getJob(id);
        if (job && job.nextExecute === nextExecute) {
            // todo jak nextExecute sie nie zgadza to usunac?
            this.handleJobDone(job);
            return true;
        }
        return false;
    }
}
