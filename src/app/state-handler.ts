import { CurrentJob, Job, JobSerialized } from './job';
import { Peer, PeerStatus } from './peer';
import { Endpoints } from './utils/constants';
import { randomInteger } from './utils/helpers';
import { NewJobBody, ResponseWrapper, SyncBody, SyncResponse } from './utils/models';
import { makeGetRequest, makePostRequest } from './utils/requests';
import { Settings } from './utils/settings';

export interface StateSerialized {
    version: number;
    myHost: string;
    updateTime: number;
    time: number;
    peers: Peer[];
    jobs: JobSerialized[];
}

export class StateHandler {
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
                const newJob: Job = new Job(job.id, job.endpoint, job.startTime, job.intervalValue, job.intervalUnit, job.executions);
                // newJob.currentJob = this.createCurrentJob(newJob);
                return newJob;
            })
        );
        this.updateTime = data.u;
        this.timeDiff = data.t - Date.now();
        this.myHost = data.r;
        this.getPeer(this.myHost).status = PeerStatus.ONLINE;
    }

    getState(): StateSerialized {
        return { version: this.version, myHost: this.myHost, updateTime: this.updateTime, time: Date.now() + this.timeDiff, peers: this.peers, jobs: this.serializeJobs() };
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
        const success: boolean = await this.syncPeers(peersToSend, { p: newPeers, j: this.serializeJobs(), u: updateTime, t: Date.now(), r: null });
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
        const success: boolean = await this.syncPeers(this.getOnlineAndDesyncPeers().filter(peer => peer !== peerToRemove), {
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
        const newJobs: JobSerialized[] = [...this.serializeJobs(), newJob.serialize()];
        const success: boolean = await this.syncPeers(this.getOnlineAndDesyncPeers(), {
            p: this.peers,
            j: newJobs,
            u: data.updateTime,
            t: Date.now(),
            r: null
        });
        if (success) {
            // newJob.currentJob = this.createCurrentJob(newJob);
            this.initJob(newJob);
            this.jobs.push(newJob);
            this.updateTime = data.updateTime;
            this.timeDiff = 0;
        }
        return success;
    }

    async removeJob(jobToRemove: Job, updateTime: number) {
        const newJobs: JobSerialized[] = this.jobs.filter(job => job !== jobToRemove).map(job => job.serialize());
        const success: boolean = await this.syncPeers(this.getOnlineAndDesyncPeers(), {
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

    async syncPeers(peers: Peer[], syncData: SyncBody): Promise<boolean> {
        const responses: SyncResponse[] = await Promise.all(peers.map(peer => peer.sync(syncData)));
        // return true if at least one other peer responded OK or it wasnt send to any peer
        return responses.some(item => item.success && item.peer.host !== this.myHost) || responses.length === 0;
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

    initJob(job: Job) {
        const now: number = Date.now() + this.timeDiff;
        job.currentJob.jobTimeout = setTimeout(() => this.getVotes(job), job.nextExecute - now - Settings.VOTING_START_TIME);
    }

    // createCurrentJob(job: Job) {

    //     job.createCurrentJob();

    // }

    async getVotes(job: Job) {
        console.log('Voting', job.endpoint);
        console.log('My vote', job.currentJob.myVote);
        // job.currentJob.tries++;
        if (job.currentJob.tries > 5) {
            console.log('Terminating job', job.endpoint);
            return;
        }
        // job.getMyVote();

        job.currentJob.jobTimeout = setTimeout(() => this.chooseWinner(job), Settings.VOTING_WINDOW);

        const data: ResponseWrapper[] = await Promise.all(this.getOnlinePeers().map(peer => peer.getVoteForJob(job).catch(error => error)));
        console.log(data);
        for (const item of data) {
            const vote: number = parseInt(item.data, 10);
            if (!isNaN(vote)) {
                job.currentJob.votes.push(vote);
            }
        }
    }

    chooseWinner(job: Job) {
        console.log('Lista votow', job.endpoint, job.currentJob.votes);
        const winnerVote: number = job.getWinnerVote();
        if (winnerVote === null) {
            console.log('No winner');
            job.vote();
            job.currentJob.jobTimeout = setTimeout(() => this.getVotes(job), Settings.NEXT_VOTE_DELAY);
        } else {
            const executeTime: number = job.nextExecute - Date.now() - this.timeDiff;
            if (job.currentJob.myVote === winnerVote) {
                console.log('Zwyciestwo');
                job.currentJob.jobTimeout = setTimeout(() => this.executeJob(job), executeTime);
            } else {
                const jobExecutions: number = job.executions;
                job.currentJob.jobTimeout = setTimeout(() => this.checkIfExecuted(job, jobExecutions), executeTime + Settings.EXECUTE_WINDOW);
            }
        }
    }

    async executeJob(job: Job) {
        console.log('Executing job', job.endpoint);
        try {
            await makeGetRequest(job.endpoint);
        } catch (error) {
            console.error(error);
            return;
        }

        // wyslanie musi byc wczesniej niz zwiekszenie  executions
        // todo przeniesc do innego pliku?
        this.getOnlinePeers().forEach(peer => {
            makePostRequest(peer.host + Endpoints.JOB_DONE, { id: job.id, exe: job.executions });
        });

        this.handleJobDone(job, 1); // todo moze robic to po poinformowaniu, trzeba podac ktore wykonanie
    }

    checkIfExecuted(job: Job, executions: number) {
        console.log('Check execution', job.endpoint);
        const currentJob: CurrentJob = job.currentJob;
        if (job.executions === executions + 1) {
            console.log('Job was executed');
        } else {
            console.log('Trying once again');
            // job.clearCurrentJob();
            // currentJob.myVote = null;
            // currentJob.votes = [];
            job.vote();
            currentJob.jobTimeout = setTimeout(() => this.getVotes(job), Settings.NEXT_VOTE_DELAY);
        }
    }

    handleJobDone(job: Job, timesDone: number) {
        job.markDone(timesDone);
        job.createCurrentJob();
        // job.currentJob = this.createCurrentJob(job);
    }

    getJobVote(id: number, executions: number): number {
        const job: Job = this.getJob(id);
        if (job) {
            if (job.executions === executions) {
                return job.currentJob.myVote;
            } else if (job.executions < executions) {
                this.handleJobDone(job, executions - job.executions); // todo przemyslec
                return job.currentJob.myVote;
            }
        }
        return null;
    }

    getJobDone(id: number, executions: number): boolean {
        const job: Job = this.getJob(id);
        if (job) {
            if (job.executions === executions) {
                this.handleJobDone(job, 1);
                return true;
            } else if (job.executions < executions) {
                this.handleJobDone(job, executions - job.executions + 1); // todo przemyslec +1
                return true;
            }
        }
        return false;
    }
}
