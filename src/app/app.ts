import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import { Job } from './job';
import { Peer } from './peer';
import { StateHandler } from './state-handler';
import { Endpoints, HTTPCodes, HTTPMethods } from './utils/constants';
import { formatHost } from './utils/helpers';
import { Logger } from './utils/logger';
import { NewJobRequestBody, NewOrRemovePeerRequestBody, RemoveJobRequestBody, StateSerializedForSync, VoteOrDoneRequestBody } from './utils/models';
import { Settings } from './utils/settings';

let html: string = require('./client/client.html');
html = html.replace(/\s*<!--\s*/g, '').replace(/\s*-->\s*/g, '');

export class ServerApp {
    port: string;
    server: Server;
    stateHandler: StateHandler = new StateHandler();

    constructor(port: string) {
        this.port = port;

        this.server = createServer((request, response) => {
            const url: string = request.url;
            let bodyString: string = '';

            if (request.method === HTTPMethods.POST) {
                request.on('data', data => {
                    bodyString += data;
                });
            }

            switch (url) {
                case Endpoints.HEARTBEAT:
                    response.writeHead(HTTPCodes.OK);
                    response.end(JSON.stringify({ v: this.stateHandler.version, u: this.stateHandler.updateTime }));
                    break;
                case Endpoints.JOB_VOTE:
                    request.on('end', () => {
                        const body: VoteOrDoneRequestBody = JSON.parse(bodyString);
                        const vote: number = this.stateHandler.getJobVote(body.i, body.e);
                        if (vote) {
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify(vote));
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end();
                        }
                    });
                    break;
                case Endpoints.JOB_DONE:
                    request.on('end', () => {
                        const body: VoteOrDoneRequestBody = JSON.parse(bodyString);
                        const success: boolean = this.stateHandler.getJobDone(body.i, body.e);
                        if (success) {
                            response.writeHead(HTTPCodes.OK);
                            response.end();
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end();
                        }
                    });
                    break;
                case Endpoints.SYNC_STATE:
                    request.on('end', () => {
                        Logger.log('Getting sync', bodyString);
                        const body: StateSerializedForSync = JSON.parse(bodyString);
                        this.stateHandler.syncState(body);
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
                    response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                    break;
                case Endpoints.ADD_NEW_PEER:
                    request.on('end', async () => {
                        const body: NewOrRemovePeerRequestBody = JSON.parse(bodyString);
                        body.host = formatHost(body.host);
                        if (this.stateHandler.getPeer(body.host)) {
                            response.writeHead(HTTPCodes.BAD_REQUEST);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                            return;
                        }
                        const newPeer: Peer = new Peer(body.host);
                        const success: boolean = await this.stateHandler.addPeer(newPeer, body.updateTime);
                        if (success) {
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                        }
                    });
                    break;
                case Endpoints.REMOVE_PEER:
                    request.on('end', async () => {
                        const body: NewOrRemovePeerRequestBody = JSON.parse(bodyString);
                        const peerToRemove: Peer = this.stateHandler.getPeer(body.host);
                        if (!peerToRemove) {
                            response.writeHead(HTTPCodes.BAD_REQUEST);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                            return;
                        }
                        const success: boolean = await this.stateHandler.removePeer(peerToRemove, body.updateTime);
                        if (success) {
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                        }
                    });
                    break;
                case Endpoints.ADD_NEW_JOB:
                    request.on('end', async () => {
                        const body: NewJobRequestBody = JSON.parse(bodyString);
                        const newJob: Job = new Job(this.stateHandler.getNewJobId(), body.endpoint, body.startTime, body.intervalValue, body.intervalUnit);
                        const success: boolean = await this.stateHandler.addJob(newJob, body.updateTime);
                        if (success) {
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                        }
                    });
                    break;
                case Endpoints.REMOVE_JOB:
                    request.on('end', async () => {
                        const body: RemoveJobRequestBody = JSON.parse(bodyString);
                        const jobToRemove: Job = this.stateHandler.getJob(body.id);
                        if (!jobToRemove) {
                            response.writeHead(HTTPCodes.BAD_REQUEST);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                            return;
                        }
                        const success: boolean = await this.stateHandler.removeJob(jobToRemove, body.updateTime);
                        if (success) {
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end(JSON.stringify(this.stateHandler.getStateForWeb()));
                        }
                    });
                    break;
                case Endpoints.FORCE_DEATH:
                    response.writeHead(HTTPCodes.OK);
                    response.end();
                    process.exit();
                    break;
                default:
                    Logger.log(url);
                    response.writeHead(HTTPCodes.NOT_FOUND);
                    response.end();
            }
        });
    }

    run() {
        this.server.listen(this.port, () => {
            console.log(new Date().toString().split(' ')[4] + ' - Server is listening on port ' + (this.server.address() as AddressInfo).port);
            setInterval(() => this.stateHandler.heartbeat(), Settings.HEARTBEAT_INTERVAL_TIME);
        });
    }
}
