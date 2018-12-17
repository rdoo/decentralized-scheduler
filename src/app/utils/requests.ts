import { ClientRequest, IncomingMessage, request as httpRequest, RequestOptions } from 'http';
import { request as httpsRequest } from 'https';
import { parse, UrlWithStringQuery } from 'url';

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

        const parsedUrl: UrlWithStringQuery = parse(url);
        const options: RequestOptions = Object.assign({ method }, parsedUrl);

        function responseHandler(response: IncomingMessage) {
            let data: string = '';

            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                clearTimeout(timeout);
                resolve({ code: response.statusCode, data });
            });
        }

        let req: ClientRequest;
        if (parsedUrl.protocol === 'http:') {
            req = httpRequest(options, responseHandler);
        } else {
            req = httpsRequest(options, responseHandler);
        }

        req.on('error', error => {
            clearTimeout(timeout);
            reject(error);
        });

        if (method === HTTPMethods.POST && body) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}
