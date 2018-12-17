import { CurrentJob, Job } from './job';
import { Peer, PeerStatus } from './peer';
import { getFromArrayById } from './utils/helpers';
import { Logger } from './utils/logger';
import { JobSerializedForSync, StateSerializedForSync, StateSerializedForWeb, SyncResult } from './utils/models';
import { makeGetRequest } from './utils/requests';
import { Settings } from './utils/settings';

export class StateHandler {
    version: number = Settings.VERSION;
    myHost: string = null;
    singleMode: boolean = false;
    updateTime: number = 0;
    timeDiff: number = 0;
    peers: Peer[] = [];
    jobs: Job[] = [];

    syncState(data: StateSerializedForSync) {
        if (data.u < this.updateTime) {
            return; // dont allow to overwrite from older state
        }

        this.updateTime = data.u;
        this.timeDiff = data.t - Date.now();
        this.myHost = data.r;

        // peers
        this.peers.splice(0, this.peers.length);
        this.peers.push(...data.p.map(peer => new Peer(peer.h, peer.s)));
        this.getPeer(this.myHost).status = PeerStatus.ONLINE;
        this.getUnknownAndDesyncPeers().forEach(peer => peer.heartbeat(this.version, this.updateTime));

        // jobs
        for (let i = 0; i < this.jobs.length; i++) {
            const job: Job = this.jobs[i];
            const newJobSerialized: JobSerializedForSync = getFromArrayById(data.j, job.id);
            if (newJobSerialized === null) {
                // if job doesnt exist with this id then delete
                job.clearCurrentJob();
                this.jobs.splice(i, 1);
            } else if (!job.equal(newJobSerialized) || job.executions < newJobSerialized.ex) {
                // if exists but not equal then delete and make a new one
                job.clearCurrentJob();
                this.jobs.splice(i, 1);
                this.initNewJob(this.getJobFromSerializedJob(newJobSerialized));
            }
        }

        // add missing job
        for (const newJobSerialized of data.j) {
            const job: Job = getFromArrayById(this.jobs, newJobSerialized.i);
            if (job === null) {
                this.initNewJob(this.getJobFromSerializedJob(newJobSerialized));
            }
        }
    }

    getJobFromSerializedJob(jobSerialized: JobSerializedForSync) {
        return new Job(jobSerialized.i, jobSerialized.e, jobSerialized.s, jobSerialized.iv, jobSerialized.iu, jobSerialized.ex);
    }

    getStateForWeb(): StateSerializedForWeb {
        return {
            version: this.version,
            myHost: this.myHost,
            singleMode: this.singleMode,
            updateTime: this.updateTime,
            serverTime: Date.now() + this.timeDiff,
            peers: this.peers.map(peer => peer.serializeForWeb()),
            jobs: this.serializeJobsForWeb()
        };
    }

    async heartbeat() {
        await Promise.all(this.getOtherPeers().map(peer => peer.heartbeat(this.version, this.updateTime)));
        this.syncDesyncPeersWithExistingData();
    }

    async addPeer(newPeer: Peer, updateTime: number) {
        const newPeers: Peer[] = [...this.peers, newPeer];
        const peersToSend: Peer[] = [...this.getOnlineAndDesyncPeers(), newPeer];
        const success: boolean = await this.syncAllPeersWithNewData(peersToSend, {
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
        const success: boolean = await this.syncAllPeersWithNewData(this.getOnlineAndDesyncPeers().filter(peer => peer !== peerToRemove), {
            p: newPeers.map(peer => peer.serializeForSync()),
            j: this.serializeJobsForSync(),
            u: updateTime,
            t: Date.now(),
            r: null
        });

        if (success) {
            peerToRemove.kill();
            this.peers.splice(this.peers.indexOf(peerToRemove), 1);
            this.updateTime = updateTime;
            this.timeDiff = 0;
        }
        return success;
    }

    async addJob(newJob: Job, updateTime: number) {
        const newJobs: JobSerializedForSync[] = [...this.serializeJobsForSync(), newJob.serializeForSync()];
        const success: boolean = await this.syncAllPeersWithNewData(this.getOnlineAndDesyncPeers(), {
            p: this.peers.map(peer => peer.serializeForSync()),
            j: newJobs,
            u: updateTime,
            t: Date.now(),
            r: null
        });

        if (success) {
            this.initNewJob(newJob);
            this.updateTime = updateTime;
            this.timeDiff = 0;
        }
        return success;
    }

    async removeJob(jobToRemove: Job, updateTime: number) {
        const newJobs: JobSerializedForSync[] = this.jobs.filter(job => job !== jobToRemove).map(job => job.serializeForSync());
        const success: boolean = await this.syncAllPeersWithNewData(this.getOnlineAndDesyncPeers(), {
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

    async syncAllPeersWithNewData(peers: Peer[], syncData: StateSerializedForSync): Promise<boolean> {
        const responses: SyncResult[] = await Promise.all(peers.map(peer => peer.sync(syncData)));
        // return true if at least one other peer responded OK or it wasnt send to any peer
        return responses.some(item => item.success && item.peer.host !== this.myHost) || responses.length === 0;
    }

    syncDesyncPeersWithExistingData() {
        const syncData: StateSerializedForSync = {
            p: this.peers.map(peer => peer.serializeForSync()),
            j: this.serializeJobsForSync(),
            u: this.updateTime,
            t: Date.now() + this.timeDiff,
            r: null
        };

        this.getDesyncPeers().forEach(peer => peer.sync(syncData));
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

    initNewJob(newJob: Job) {
        let voteTimeout: number = newJob.nextExecute - Date.now() - this.timeDiff - Settings.VOTING_START_TIME;

        while (voteTimeout < 0) {
            newJob.markDone(1);
            voteTimeout = newJob.nextExecute - Date.now() - this.timeDiff - Settings.VOTING_START_TIME;
        }

        Logger.log('Initiating job', newJob.endpoint, 'with vote timeout', voteTimeout);
        newJob.currentJob.jobTimeout = setTimeout(() => this.getVotesFromPeers(newJob), voteTimeout);
        this.jobs.push(newJob);
    }

    async getVotesFromPeers(job: Job) {
        Logger.log('Voting', job.endpoint);
        Logger.log('My vote', job.currentJob.myVote);

        job.currentJob.jobTimeout = setTimeout(() => this.chooseWinner(job), Settings.VOTING_WINDOW);

        const votes: number[] = await Promise.all(this.getOnlinePeers().map(peer => peer.getVoteForJob(job)));
        for (const vote of votes) {
            if (vote !== null) {
                job.currentJob.votes.push(vote);
            }
        }

        this.syncDesyncPeersWithExistingData();
    }

    chooseWinner(job: Job) {
        Logger.log('List of votes:', job.endpoint, job.currentJob.votes);
        const winnerVote: number = job.getWinnerVote();
        if (winnerVote === null) {
            Logger.log('Multiple max votes');
            job.vote();
            job.currentJob.jobTimeout = setTimeout(() => this.getVotesFromPeers(job), Settings.EXTRA_VOTE_DELAY);
        } else {
            let executeTime: number = job.nextExecute - Date.now() - this.timeDiff;
            if (executeTime < 0) {
                executeTime = 0;
            }
            if (job.currentJob.myVote === winnerVote) {
                Logger.log('Victory');

                if (job.currentJob.tries > Settings.JOB_TRIES_UNTIL_TERMINATE) {
                    Logger.log('Terminating job', job.endpoint);
                    this.handleJobDone(job);
                } else if (job.currentJob.votes.length > 1 || this.singleMode) {
                    job.currentJob.jobTimeout = setTimeout(() => this.executeJob(job), executeTime);
                } else {
                    job.currentJob.jobTimeout = setTimeout(() => this.checkIfExecuted(job, job.executions), executeTime + Settings.EXECUTE_WINDOW);
                }
            } else {
                job.currentJob.jobTimeout = setTimeout(() => this.checkIfExecuted(job, job.executions), executeTime + Settings.EXECUTE_WINDOW);
            }
        }
    }

    async executeJob(job: Job) {
        Logger.log('Executing job', job.endpoint);
        try {
            await makeGetRequest(job.endpoint);
        } catch (error) {
            Logger.error(error);
            let executeTime: number = job.nextExecute - Date.now() - this.timeDiff;
            if (executeTime < 0) {
                executeTime = 0;
            }

            job.currentJob.jobTimeout = setTimeout(() => this.checkIfExecuted(job, job.executions), executeTime + Settings.EXECUTE_WINDOW);
            return;
        }

        this.handleJobDone(job);
    }

    checkIfExecuted(job: Job, executions: number) {
        Logger.log('Checking execution', job.endpoint);
        const currentJob: CurrentJob = job.currentJob;
        if (job.executions === executions + 1) {
            Logger.log('Job was executed');
        } else {
            Logger.log('Trying once again', job.currentJob.tries + 1);
            job.vote();
            currentJob.jobTimeout = setTimeout(() => this.getVotesFromPeers(job), Settings.EXTRA_VOTE_DELAY);
        }
    }

    handleJobDone(job: Job) {
        const executions = job.executions; // local variable for copying executions value
        this.handleLocalJobDone(job, 1);
        this.getOnlinePeers().forEach(peer => peer.informJobDone(job, executions));

        this.syncDesyncPeersWithExistingData();
    }

    handleLocalJobDone(job: Job, timesDone: number) {
        Logger.log('Job done', job.endpoint);
        job.markDone(timesDone);
        job.currentJob.jobTimeout = setTimeout(() => this.getVotesFromPeers(job), job.nextExecute - Date.now() - this.timeDiff - Settings.VOTING_START_TIME);
    }

    getJobVote(id: number, executions: number): number {
        const job: Job = this.getJob(id);
        if (job) {
            if (job.executions === executions) {
                return job.currentJob.myVote;
            } else if (job.executions < executions) {
                this.handleLocalJobDone(job, executions - job.executions);
                return job.currentJob.myVote;
            }
        }
        return -1;
    }

    getJobDone(id: number, executions: number): boolean {
        const job: Job = this.getJob(id);
        if (job) {
            if (job.executions === executions) {
                this.handleLocalJobDone(job, 1);
                return true;
            } else if (job.executions < executions) {
                this.handleLocalJobDone(job, executions - job.executions + 1);
                return true;
            }
        }
        return false;
    }
}
