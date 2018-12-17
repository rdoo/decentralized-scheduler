import { Job } from '../job';
import { Peer, PeerStatus } from '../peer';
import { Endpoints, HTTPMethods, TimeConstants } from '../utils/constants';
import { NewJobRequestBody, NewOrRemovePeerRequestBody, StateSerializedForWeb } from '../utils/models';

let timeDiff: number = 0;

window.onload = () => {
    const timeElement: HTMLHeadingElement = <HTMLHeadingElement>document.getElementById('time');
    timeElement.innerText = new Date(Date.now() + timeDiff).toLocaleTimeString();
    setInterval(() => (timeElement.innerText = new Date(Date.now() + timeDiff).toLocaleTimeString()), TimeConstants.SECOND);
};

fetch(window.location.origin + Endpoints.GET_STATE)
    .then(response => response.json())
    .then(data => updateView(data));

function updateView(data: StateSerializedForWeb) {
    document.body.style.display = 'block';

    timeDiff = data.serverTime - Date.now();

    if (data.updateTime === 0) {
        document.getElementById('updateTime').innerText = 'No updates or not synced';
    } else {
        document.getElementById('updateTime').innerText = new Date(data.updateTime).toLocaleString();
    }

    if (data.singleMode) {
        document.getElementById('title').innerText = 'Centralized Scheduler';
        document.getElementById('peers-section').style.display = 'none';
    } else {
        const peersElement: HTMLDivElement = <HTMLDivElement>document.getElementById('peers');
        peersElement.innerHTML = '';
        if (data.peers.length === 0) {
            peersElement.appendChild(createTable([], [(dataCell: HTMLTableDataCellElement, item: Peer) => (dataCell.innerText = 'No peers added or not synced')], [1]));
        } else {
            peersElement.appendChild(
                createTable(
                    ['Host', 'Status', 'Actions'],
                    [
                        (dataCell: HTMLTableDataCellElement, item: Peer) => (dataCell.innerText = item.host),
                        (dataCell: HTMLTableDataCellElement, item: Peer) => (dataCell.innerText = getStatusName(item.status)),
                        (dataCell: HTMLTableDataCellElement, item: Peer) => {
                            const button: HTMLButtonElement = document.createElement('button');
                            button.onclick = () => removePeer(item);
                            button.innerText = 'X';
                            dataCell.appendChild(button);
                        }
                    ],
                    data.peers
                )
            );
        }
    }

    const jobsElement: HTMLDivElement = <HTMLDivElement>document.getElementById('jobs');
    jobsElement.innerHTML = '';
    if (data.jobs.length === 0) {
        jobsElement.appendChild(createTable([], [(dataCell: HTMLTableDataCellElement, item: Job) => (dataCell.innerText = 'No jobs added or not synced')], [1]));
    } else {
        jobsElement.appendChild(
            createTable(
                ['Endpoint', 'Interval', 'Start time', 'Next execute', 'Actions'],
                [
                    (dataCell: HTMLTableDataCellElement, item: Job) => (dataCell.innerText = item.endpoint),
                    (dataCell: HTMLTableDataCellElement, item: Job) => (dataCell.innerText = item.intervalValue.toString() + item.intervalUnit),
                    (dataCell: HTMLTableDataCellElement, item: Job) => (dataCell.innerText = new Date(item.startTime).toLocaleString()),
                    (dataCell: HTMLTableDataCellElement, item: Job) => (dataCell.innerText = new Date(item.nextExecute).toLocaleString()),
                    (dataCell: HTMLTableDataCellElement, item: Job) => {
                        const button: HTMLButtonElement = document.createElement('button');
                        button.onclick = () => removeJob(item);
                        button.innerText = 'X';
                        dataCell.appendChild(button);
                    }
                ],
                data.jobs
            )
        );
    }
}

function createTable(columns: string[], transforms: ((dataCell: HTMLTableDataCellElement, item: any) => void)[], data: any[]) {
    const table: HTMLTableElement = document.createElement('table');
    const headerRow: HTMLTableRowElement = document.createElement('tr');
    for (const column of columns) {
        const headerCell: HTMLTableHeaderCellElement = document.createElement('th');
        headerCell.innerText = column;
        headerRow.appendChild(headerCell);
    }
    table.appendChild(headerRow);

    for (const item of data) {
        const row: HTMLTableRowElement = document.createElement('tr');
        for (const transform of transforms) {
            const dataCell: HTMLTableDataCellElement = document.createElement('td');
            transform(dataCell, item);
            row.appendChild(dataCell);
        }
        table.appendChild(row);
    }
    return table;
}

function addNewPeer(form: HTMLFormElement) {
    const newPeer: NewOrRemovePeerRequestBody = { updateTime: Date.now() };
    new FormData(form).forEach((value, key) => (newPeer[key] = value));

    fetch(window.location.origin + Endpoints.ADD_NEW_PEER, {
        method: HTTPMethods.POST,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(newPeer)
    })
        .then(response => response.json())
        .then(data => {
            form.reset();
            updateView(data);
        });

    return false;
}

function removePeer(peer: Peer) {
    fetch(window.location.origin + Endpoints.REMOVE_PEER, {
        method: HTTPMethods.POST,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ host: peer.host, updateTime: Date.now() })
    })
        .then(response => response.json())
        .then(data => updateView(data));
}

function addNewJob(form: HTMLFormElement) {
    const newJob: NewJobRequestBody = { updateTime: Date.now() };
    new FormData(form).forEach((value, key) => {
        switch (key) {
            case 'startTime':
                newJob.startTime = new Date(value as string).getTime();
                break;
            case 'intervalValue':
                newJob.intervalValue = Number(value);
                break;
            default:
                newJob[key] = value;
        }
    });

    if (newJob.startTime === undefined) {
        newJob.startTime = newJob.updateTime;
    }

    fetch(window.location.origin + Endpoints.ADD_NEW_JOB, {
        method: HTTPMethods.POST,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(newJob)
    })
        .then(response => response.json())
        .then(data => {
            form.reset();
            updateView(data);
        });

    return false;
}

function removeJob(job: Job) {
    fetch(window.location.origin + Endpoints.REMOVE_JOB, {
        method: HTTPMethods.POST,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: job.id, updateTime: Date.now() })
    })
        .then(response => response.json())
        .then(data => updateView(data));
}

function getStatusName(status: PeerStatus) {
    switch (status) {
        case PeerStatus.ONLINE:
            return 'Online';
        case PeerStatus.OFFLINE:
            return 'Offline';
        case PeerStatus.UNKNOWN:
            return 'Unknown';
        case PeerStatus.DESYNC:
            return 'Desync';
        case PeerStatus.ERRORED:
            return 'Errored';
    }
    return '';
}

function toggleNewJobStartTime(checkbox: HTMLInputElement) {
    const inputStartTimeElement: HTMLInputElement = <HTMLInputElement>document.getElementById('newJobStartTime');

    if (checkbox.checked) {
        inputStartTimeElement.value = new Date().toISOString().substring(0, 10) + 'T00:00';
        inputStartTimeElement.disabled = false;
    } else {
        inputStartTimeElement.value = '';
        inputStartTimeElement.disabled = true;
    }
}
