export function formatHost(host: string) {
    return host.replace(/\/$/, '');
}

export function randomInteger() {
    return Math.floor(Math.random() * 1e9);
}
