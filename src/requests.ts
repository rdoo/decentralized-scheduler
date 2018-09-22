import { ClientRequest, get, request, RequestOptions } from 'http';
import { parse } from 'url';

import { HTTPMethods, ResponseData } from './models';

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

interface ParsedURL {
    isSecured: boolean;
    host: string;
    port?: string;
    path?: string;
}

function parseURL(url: string): ParsedURL {
    const HTTP_STRING: string = 'http://';
    const HTTPS_STRING: string = 'https://';
    const PORT_REGEX: RegExp = /:\d+/;
    let isSecured: boolean;
    let host: string;
    let port: string;
    let path: string;

    if (url.startsWith(HTTP_STRING)) {
        isSecured = false;
        url = url.substring(HTTP_STRING.length);
    } else if (url.startsWith(HTTPS_STRING)) {
        isSecured = true;
        url = url.substring(HTTPS_STRING.length);
    } else {
        throw 'Wrong URL';
    }

    const portMatch: RegExpMatchArray = url.match(PORT_REGEX);
    if (portMatch) {
        // console.log(portMatch);
        port = portMatch[0].substring(1);
        url = url.replace(port, '');
    }
    // console.log(url);

    const firstSlashIndex: number = url.indexOf('/');
    if (firstSlashIndex !== -1) {
        host = url.substring(0, firstSlashIndex);
        path = url.substring(firstSlashIndex);
    } else {
        host = url;
    }

    const parsedURL: ParsedURL = { isSecured, host };

    if (port) {
        parsedURL.port = port;
    }

    if (path) {
        parsedURL.path = path;
    }

    return parsedURL;
}
