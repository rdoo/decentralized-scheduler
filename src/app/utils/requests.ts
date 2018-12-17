import { ClientRequest, request, RequestOptions } from 'http';
import { parse } from 'url';

import { CustomErrors, HTTPMethods } from './constants';
import { Settings } from './settings';

export interface ResponseWrapper {
    code: number;
    data: string;
}

export function makeGetRequest(url: string): Promise<ResponseWrapper> {
    return makeRequest(HTTPMethods.GET, url);
}

export function makePostRequest(url: string, body?: any): Promise<ResponseWrapper> {
    return makeRequest(HTTPMethods.POST, url, body);
}

export function makeRequest(method: HTTPMethods, url: string, body?: any): Promise<ResponseWrapper> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject({ code: CustomErrors.TIMEOUTED }), Settings.REQUEST_TIMEOUT);

        const options: RequestOptions = Object.assign({ method }, parse(url));
        const req: ClientRequest = request(options, response => {
            let data: string = '';

            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                clearTimeout(timeout);
                resolve({ code: response.statusCode, data });
            });
        }).on('error', error => {
            clearTimeout(timeout);
            reject(error);
        });

        if (method === HTTPMethods.POST && body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}
