import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import { Job } from './job';
import { Peer } from './peer';
import { StateHandler } from './state-handler';
import { Endpoints, HTTPCodes, HTTPMethods, IntervalUnit } from './utils/constants';
import { formatHost } from './utils/helpers';
import { Logger } from './utils/logger';
import { NewJobBody, NewRemovePeerBody, RemoveJobBody, SyncBody, VoteOrDoneBody } from './utils/models';
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
            let body: string = '';

            if (request.method === HTTPMethods.POST) {
                request.on('data', data => {
                    body += data;
                });
            }

            switch (url) {
                case Endpoints.HEARTBEAT:
                    response.writeHead(HTTPCodes.OK);
                    response.end(JSON.stringify({ v: this.stateHandler.version, u: this.stateHandler.updateTime }));
                    break;
                case Endpoints.JOB_VOTE:
                    request.on('end', () => {
                        const bodyData: VoteOrDoneBody = JSON.parse(body);
                        const vote: number = this.stateHandler.getJobVote(bodyData.id, bodyData.exe);
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
                        const bodyData: VoteOrDoneBody = JSON.parse(body);
                        const success: boolean = this.stateHandler.getJobDone(bodyData.id, bodyData.exe);
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
                        Logger.log('Getting sync', body);
                        const bodyData: SyncBody = JSON.parse(body);
                        this.stateHandler.syncState(bodyData);
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
                    response.end(JSON.stringify(this.stateHandler.getState()));
                    break;
                case Endpoints.ADD_NEW_PEER:
                    request.on('end', async () => {
                        const bodyData: NewRemovePeerBody = JSON.parse(body);
                        if (this.stateHandler.getPeer(bodyData.host)) {
                            response.writeHead(HTTPCodes.BAD_REQUEST);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                            return;
                        }
                        const newPeer: Peer = new Peer(formatHost(bodyData.host));
                        const success: boolean = await this.stateHandler.addPeer(newPeer, bodyData.updateTime);
                        if (success) {
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                        }
                    });
                    break;
                case Endpoints.REMOVE_PEER:
                    request.on('end', async () => {
                        const bodyData: NewRemovePeerBody = JSON.parse(body);
                        const peerToRemove: Peer = this.stateHandler.getPeer(bodyData.host);
                        if (!peerToRemove) {
                            response.writeHead(HTTPCodes.BAD_REQUEST);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                            return;
                        }
                        const success: boolean = await this.stateHandler.removePeer(peerToRemove, bodyData.updateTime);
                        if (success) {
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                        }
                    });
                    break;
                case Endpoints.ADD_NEW_JOB:
                    request.on('end', async () => {
                        const bodyData: NewJobBody = JSON.parse(body);
                        const success: boolean = await this.stateHandler.addJob(bodyData);
                        if (success) {
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                        }
                    });
                    break;
                case Endpoints.REMOVE_JOB:
                    request.on('end', async () => {
                        const bodyData: RemoveJobBody = JSON.parse(body);
                        const jobToRemove: Job = this.stateHandler.getJob(bodyData.id);
                        if (!jobToRemove) {
                            response.writeHead(HTTPCodes.BAD_REQUEST);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                            return;
                        }
                        const success: boolean = await this.stateHandler.removeJob(jobToRemove, bodyData.updateTime);
                        if (success) {
                            response.writeHead(HTTPCodes.OK);
                            response.end(JSON.stringify(this.stateHandler.getState()));
                        } else {
                            response.writeHead(HTTPCodes.INTERNAL_SERVER_ERROR);
                            response.end(JSON.stringify(this.stateHandler.getState()));
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
