import { ClientRequest, request, RequestOptions } from 'http';
import { parse } from 'url';

import { HTTPMethods } from './constants';
import { ResponseData } from './models';

export function makeGetRequest(url: string): Promise<ResponseData> {
    return makeRequest(HTTPMethods.GET, url);
}

export function makePostRequest(url: string, body?: any): Promise<ResponseData> {
    return makeRequest(HTTPMethods.POST, url, body);
}

export function makeRequest(method: HTTPMethods, url: string, body?: any): Promise<ResponseData> {
    return new Promise((resolve, reject) => {
        const options: RequestOptions = Object.assign({ method }, parse(url));
        // console.log(options);
        const req: ClientRequest = request(options, response => {
            let data: string = '';

            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                // console.log(url, { code: response.statusCode, data: data.substring(0, 30) });
                resolve({ code: response.statusCode, data });
            });
        }).on('error', (error: any) => {
            // console.log(url, { code: error.code });
            reject(error);
        });

        if (method === HTTPMethods.POST && body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}
