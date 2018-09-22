export const enum HTTPCodes {
    OK = 200,
    BAD_REQUEST = 400,
    NOT_FOUND = 404,
    INTERNAL_SERVER_ERROR = 500
}

export const enum HTTPMethods {
    GET = 'GET',
    POST = 'POST'
}

export const enum NodeHttpErrors {
    ECONNREFUSED = 'ECONNREFUSED',
    ENOTFOUND = 'ENOTFOUND',
    ECONNRESET = 'ECONNRESET'
}

export const enum Endpoints {
    INDEX = '/',
    GET_STATE = '/gs',
    SYNC_STATE = '/ss',
    HEARTBEAT = '/hb',
    FORCE_DEATH = '/fd',
    ADD_NEW_PEER = '/ap',
    REMOVE_PEER = '/rp',
    ADD_NEW_JOB = '/aj',
    REMOVE_JOB = '/rj',
    JOB_VOTE = '/jv',
    JOB_DONE = '/jd'
}

export const enum IntervalUnit {
    MINUTE = 'm',
    HOUR = 'h',
    DAY = 'D',
    MONTH = 'M'
}
