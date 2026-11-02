import { ready } from './services/auth';
App<IAppOption>({ globalData: {}, onLaunch() { ready(); } });
