export function formatHost(host: string) {
    return host.replace(/\/$/, '');
}

export function randomInteger() {
    return Math.floor(Math.random() * 1e3);
}

export function getFromArrayById(array: any[], id: number) {
    for (const item of array) {
        if (item.id === id) {
            return item;
        }
    }
    return null;
}
