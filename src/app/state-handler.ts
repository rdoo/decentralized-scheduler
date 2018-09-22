import { AppState, calculateNewExecuteTime, generateVote, getWinnerVote } from './app';
import { getVote, killPeer, Peer, PeerStatus, syncPeers } from './peer';
import { Endpoints } from './utils/constants';
import { BodyNewJob, BodySync, CurrentJob, Job } from './utils/models';
import { makeGetRequest, makePostRequest } from './utils/requests';
import { Settings } from './utils/settings';

export class StateHandler implements AppState {
    version: number = Settings.VERSION;
    myHost: string = null;
    updateTime: number = 0;
    peers: Peer[] = [];
    jobs: Job[] = [];

    syncState(data: BodySync) {
        this.peers.splice(0, this.peers.length);
        this.peers.push(...data.p);
        // todo odswiezenie uknown i desync?
        // todo lepiej porownywac joby i usuwac tylko niepotrzebne
        this.jobs.splice(0, this.jobs.length);
        this.jobs.push(...data.j);
        this.updateTime = data.u;
        this.myHost = data.r;
        this.getPeer(this.myHost).status = PeerStatus.ONLINE;
    }

    async addPeer(newPeer: Peer, updateTime: number) {
        const newPeers: Peer[] = [...this.peers, newPeer];
        const peersToSend: Peer[] = [...this.getOnlineAndDesyncPeers(), newPeer];
        const success: boolean = await syncPeers(peersToSend, this.myHost, { p: newPeers, j: this.jobs, u: updateTime, r: null }); // todo serializowac jobs
        if (success) {
            if (!this.getPeer(newPeer.host)) {
                this.peers.push(newPeer);
            }
            this.updateTime = updateTime;
        }
        return success;
    }

    async removePeer(peerToRemove: Peer, updateTime: number) {
        const newPeers: Peer[] = this.peers.filter(peer => peer !== peerToRemove);
        const success: boolean = await syncPeers(this.getOnlineAndDesyncPeers().filter(peer => peer !== peerToRemove), this.myHost, {
            p: newPeers,
            j: this.jobs,
            u: updateTime,
            r: null
        });
        if (success) {
            killPeer(peerToRemove); // todo co jesli sie nie uda?
            this.peers.splice(this.peers.indexOf(peerToRemove), 1);
            this.updateTime = updateTime;
        }
        return success;
    }

    async addJob(data: BodyNewJob) {
        const newJob: Job = {
            id: this.getNewJobId(),
            endpoint: data.endpoint,
            startTime: data.startTime,
            nextExecute: calculateNewExecuteTime(data.startTime, data.intervalValue, data.intervalUnit),
            intervalValue: data.intervalValue,
            intervalUnit: data.intervalUnit
        };
        const newJobs: Job[] = [...this.jobs, newJob];
        const success: boolean = await syncPeers(this.getOnlineAndDesyncPeers(), this.myHost, {
            p: this.peers,
            j: newJobs,
            u: data.updateTime,
            r: null
        });
        if (success) {
            newJob.currentJob = this.createCurrentJob(newJob);
            this.jobs.push(newJob);
            this.updateTime = data.updateTime;
        }
        return success;
    }

    async removeJob(jobToRemove: Job, updateTime: number) {
        const newJobs: Job[] = this.jobs.filter(peer => peer !== jobToRemove);
        const success: boolean = await syncPeers(this.getOnlineAndDesyncPeers(), this.myHost, {
            p: this.peers,
            j: newJobs,
            u: updateTime,
            r: null
        });
        if (success) {
            this.clearCurrentJob(jobToRemove);
            this.jobs.splice(this.jobs.indexOf(jobToRemove), 1);
            this.updateTime = updateTime;
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

    getJob(id: number) {
        for (const job of this.jobs) {
            if (id === job.id) {
                return job;
            }
        }
        return null;
    }

    serializeJobs() {}

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
        const now: number = Date.now();
        return {
            // id: job.id,
            votes: [],
            myVote: null,
            votingTimeout: setTimeout(() => this.getVotes(job), job.nextExecute - now - Settings.VOTING_TIME),
            executeTimeout: setTimeout(() => this.executeJob(job), job.nextExecute - now),
            extraTimeout: setTimeout(() => this.extraJob(job), job.nextExecute - now + Settings.EXTRA_TIME)
        };
    }

    async getVotes(job: Job) {
        console.log('Voting');
        const currentJob: CurrentJob = job.currentJob;
        if (!currentJob.myVote) {
            currentJob.myVote = generateVote();
        }

        const votes: number[] = await Promise.all(this.getOnlinePeers().map(peer => getVote(peer, job).catch(error => error)));

        for (const vote of votes) {
            if (Number.isInteger(vote)) {
                currentJob.votes.push(vote);
            }
        }
    }

    async executeJob(job: Job) {
        console.log('Executing job');
        const currentJob: CurrentJob = job.currentJob;
        if (currentJob.myVote === getWinnerVote(currentJob.votes)) {
            try {
                await makeGetRequest(job.endpoint);
            } catch (error) {
                console.error(error);
                return;
            }
            this.handleJobDone(job); // todo moze robic to po poinformowaniu
            // todo przeniesc do innego pliku?
            this.getOnlinePeers().forEach(peer => {
                makePostRequest(peer.host + Endpoints.JOB_DONE, { id: job.id, exe: job.nextExecute });
            });
        }
    }

    extraJob(job: Job) {
        console.log('Extra job');
        const currentJob: CurrentJob = job.currentJob;
        // todo moze jakis status
        if (currentJob.myVote !== null) {
            this.clearCurrentJob(job);
            currentJob.myVote = null;
            currentJob.votes = [];
            currentJob.votingTimeout = setTimeout(() => this.getVotes(job), 0); // todo
            currentJob.executeTimeout = setTimeout(() => this.executeJob(job), Settings.EXTRA_TIME); // todo
            currentJob.extraTimeout = setTimeout(() => this.extraJob(job), 2 * Settings.EXTRA_TIME); // todo
        }
    }

    handleJobDone(job: Job) {
        job.nextExecute = calculateNewExecuteTime(job.nextExecute, job.intervalValue, job.intervalUnit);
        this.clearCurrentJob(job);
        job.currentJob = this.createCurrentJob(job);
    }

    clearCurrentJob(job: Job) {
        const currentJob: CurrentJob = job.currentJob;
        if (currentJob) {
            clearTimeout(currentJob.votingTimeout);
            clearTimeout(currentJob.executeTimeout);
            clearTimeout(currentJob.extraTimeout);
        }
    }
}
