import { ClientRequest, request, RequestOptions } from 'http';
import { parse } from 'url';

import { HTTPMethods } from './constants';
import { ResponseWrapper } from './models';

export function makeGetRequest(url: string): Promise<ResponseWrapper> {
    return makeRequest(HTTPMethods.GET, url);
}

export function makePostRequest(url: string, body?: any): Promise<ResponseWrapper> {
    return makeRequest(HTTPMethods.POST, url, body);
}

export function makeRequest(method: HTTPMethods, url: string, body?: any): Promise<ResponseWrapper> {
    return new Promise((resolve, reject) => {
        const options: RequestOptions = Object.assign({ method }, parse(url));
        const req: ClientRequest = request(options, response => {
            let data: string = '';

            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                resolve({ code: response.statusCode, data });
            });
        }).on('error', (error: any) => {
            reject(error);
        });

        if (method === HTTPMethods.POST && body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}
