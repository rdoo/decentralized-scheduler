import { CurrentJob, Job } from './job';
import { Peer, PeerStatus } from './peer';
import { Endpoints } from './utils/constants';
import { getFromArrayById } from './utils/helpers';
import { Logger } from './utils/logger';
import { JobSerializedForSync, NewJobRequestBody, StateSerializedForSync, StateSerializedForWeb, SyncResult } from './utils/models';
import { makeGetRequest, makePostRequest, ResponseWrapper } from './utils/requests';
import { Settings } from './utils/settings';

export class StateHandler {
    version: number = Settings.VERSION;
    myHost: string = null;
    updateTime: number = 0;
    timeDiff: number = 0;
    peers: Peer[] = [];
    jobs: Job[] = [];

    syncState(data: StateSerializedForSync) {
        this.updateTime = data.u;
        this.timeDiff = data.t - Date.now();
        this.myHost = data.r;

        this.peers.splice(0, this.peers.length);
        this.peers.push(...data.p.map(peer => new Peer(peer.h, peer.s)));
        this.getPeer(this.myHost).status = PeerStatus.ONLINE;
        this.getUnknownAndDesyncPeers().forEach(peer => peer.updateStatus(this.version, this.updateTime));

        for (let i = 0; i < this.jobs.length; i++) {
            const job: Job = this.jobs[i];
            const newJobSerialized: JobSerializedForSync = getFromArrayById(data.j, job.id);
            if (newJobSerialized === null) {
                // jesli nie ma nowego joba z takim id to usun
                job.clearCurrentJob();
                this.jobs.splice(i, 1);
            } else if (!job.equal(newJobSerialized) || job.executions < newJobSerialized.ex) {
                // jesli jest ale inny to usun i stworz nowego
                job.clearCurrentJob();
                this.jobs.splice(i, 1);
                this.initNewJob(newJobSerialized);
            }
        }

        // dodaj brakujace joby
        for (const newJobSerialized of data.j) {
            const job: Job = getFromArrayById(this.jobs, newJobSerialized.i);
            if (job === null) {
                this.initNewJob(newJobSerialized);
            }
        }
    }

    getStateForWeb(): StateSerializedForWeb {
        return {
            version: this.version,
            myHost: this.myHost,
            updateTime: this.updateTime,
            serverTime: Date.now() + this.timeDiff,
            peers: this.peers.map(peer => peer.serializeForWeb()),
            jobs: this.serializeJobsForWeb()
        };
    }

    async heartbeat() {
        // Logger.log('Checking peers');
        await Promise.all(this.getOtherPeers().map(peer => peer.updateStatus(this.version, this.updateTime)));
        // Logger.log('Peers after checking');
        // Logger.log(this.peers);

        const syncData: StateSerializedForSync = {
            p: this.peers.map(peer => peer.serializeForSync()),
            j: this.serializeJobsForSync(),
            u: this.updateTime,
            t: Date.now() + this.timeDiff,
            r: null
        };
        this.getDesyncPeers().forEach(peer => peer.sync(syncData));
    }

    async addPeer(newPeer: Peer, updateTime: number) {
        const newPeers: Peer[] = [...this.peers, newPeer];
        const peersToSend: Peer[] = [...this.getOnlineAndDesyncPeers(), newPeer];
        const success: boolean = await this.syncPeers(peersToSend, {
            p: newPeers.map(peer => peer.serializeForSync()),
            j: this.serializeJobsForSync(),
            u: updateTime,
            t: Date.now(),
            r: null
        });
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
            p: newPeers.map(peer => peer.serializeForSync()),
            j: this.serializeJobsForSync(),
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

    async addJob(newJob: Job, updateTime: number) {
        const newJobs: JobSerializedForSync[] = [...this.serializeJobsForSync(), newJob.serializeForSync()];
        const success: boolean = await this.syncPeers(this.getOnlineAndDesyncPeers(), {
            p: this.peers.map(peer => peer.serializeForSync()),
            j: newJobs,
            u: updateTime,
            t: Date.now(),
            r: null
        });
        if (success) {
            this.jobs.push(newJob);
            newJob.currentJob.jobTimeout = setTimeout(() => this.getVotes(newJob), newJob.nextExecute - Date.now() - this.timeDiff - Settings.VOTING_START_TIME);
            this.updateTime = updateTime;
            this.timeDiff = 0;
        }
        return success;
    }

    async removeJob(jobToRemove: Job, updateTime: number) {
        const newJobs: JobSerializedForSync[] = this.jobs.filter(job => job !== jobToRemove).map(job => job.serializeForSync());
        const success: boolean = await this.syncPeers(this.getOnlineAndDesyncPeers(), {
            p: this.peers.map(peer => peer.serializeForSync()),
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

    async syncPeers(peers: Peer[], syncData: StateSerializedForSync): Promise<boolean> {
        const responses: SyncResult[] = await Promise.all(peers.map(peer => peer.sync(syncData)));
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

    serializeJobsForSync() {
        return this.jobs.map(job => job.serializeForSync());
    }

    serializeJobsForWeb() {
        return this.jobs.map(job => job.serializeForWeb());
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

    initNewJob(newJobSerialized: JobSerializedForSync) {
        const newJob: Job = new Job(newJobSerialized.i, newJobSerialized.e, newJobSerialized.s, newJobSerialized.iv, newJobSerialized.iu, newJobSerialized.ex);
        let voteTimeout: number = newJob.nextExecute - Date.now() - this.timeDiff - Settings.VOTING_START_TIME;
        while (voteTimeout < 0) {
            newJob.markDone(1);
            voteTimeout = newJob.nextExecute - Date.now() - this.timeDiff - Settings.VOTING_START_TIME;
        }
        newJob.currentJob.jobTimeout = setTimeout(() => this.getVotes(newJob), voteTimeout);
        this.jobs.push(newJob);
    }

    async getVotes(job: Job) {
        Logger.log('Voting', job.endpoint);
        Logger.log('My vote', job.currentJob.myVote);

        if (job.currentJob.tries > 5) {
            Logger.log('Terminating job', job.endpoint);
            return;
        }

        job.currentJob.jobTimeout = setTimeout(() => this.chooseWinner(job), Settings.VOTING_WINDOW);

        const data: ResponseWrapper[] = await Promise.all(this.getOnlinePeers().map(peer => peer.getVoteForJob(job).catch(error => error)));
        Logger.log(data);
        for (const item of data) {
            const vote: number = parseInt(item.data, 10);
            if (!isNaN(vote)) {
                job.currentJob.votes.push(vote);
            }
        }
    }

    chooseWinner(job: Job) {
        Logger.log('Lista votow', job.endpoint, job.currentJob.votes);
        const winnerVote: number = job.getWinnerVote();
        if (winnerVote === null) {
            Logger.log('No winner');
            job.vote();
            job.currentJob.jobTimeout = setTimeout(() => this.getVotes(job), Settings.NEXT_VOTE_DELAY);
        } else {
            let executeTime: number = job.nextExecute - Date.now() - this.timeDiff;
            if (executeTime < 0) {
                executeTime = 0;
            }
            if (job.currentJob.myVote === winnerVote) {
                Logger.log('Zwyciestwo');
                job.currentJob.jobTimeout = setTimeout(() => this.executeJob(job), executeTime);
            } else {
                const jobExecutions: number = job.executions;
                job.currentJob.jobTimeout = setTimeout(() => this.checkIfExecuted(job, jobExecutions), executeTime + Settings.EXECUTE_WINDOW);
            }
        }
    }

    async executeJob(job: Job) {
        Logger.log('Executing job', job.endpoint);
        try {
            await makeGetRequest(job.endpoint);
        } catch (error) {
            Logger.error(error);
            return;
        }

        // wyslanie musi byc wczesniej niz zwiekszenie  executions
        // todo przeniesc do innego pliku?
        this.getOnlinePeers().forEach(peer => {
            makePostRequest(peer.host + Endpoints.JOB_DONE, { i: job.id, e: job.executions });
        });

        this.handleJobDone(job, 1); // todo moze robic to po poinformowaniu, trzeba podac ktore wykonanie
    }

    checkIfExecuted(job: Job, executions: number) {
        Logger.log('Check execution', job.endpoint);
        const currentJob: CurrentJob = job.currentJob;
        if (job.executions === executions + 1) {
            Logger.log('Job was executed');
        } else {
            Logger.log('Trying once again');
            job.vote();
            currentJob.jobTimeout = setTimeout(() => this.getVotes(job), Settings.NEXT_VOTE_DELAY);
        }
    }

    handleJobDone(job: Job, timesDone: number) {
        Logger.log('Job done', job.endpoint);
        job.markDone(timesDone);
        job.currentJob.jobTimeout = setTimeout(() => this.getVotes(job), job.nextExecute - Date.now() - this.timeDiff - Settings.VOTING_START_TIME);
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
