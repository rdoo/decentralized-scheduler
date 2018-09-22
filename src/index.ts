import { ServerApp } from './app/app';

const port: string = process.env.PORT || '8080';

const app: ServerApp = new ServerApp(port);
app.run();
