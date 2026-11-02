import { SavedSession, readSession, saveSession, eraseSession } from './session-storage';
// Protocol adapted from ZZUPocket (MIT), see vendor/ZZUPocket-LICENSE.txt.
import { request, randomBytes, query, onUnauthorized } from './network';
const BASE = 'https://cas.s.zzu.edu.cn';
// WeChat controls User-Agent; the verified login works with the platform header.
const UA: Record<string, string> = {};
interface Envelope<T> {
    code: number;
    data: T;
}
interface Detection {
    state: string;
    need: boolean;
    mfaTypeSecurePhone: boolean;
}
interface Challenge {
    gid: string;
    attestServerUrl?: string;
}
interface Tokens {
    idToken: string;
    refreshToken: string;
}
let session: SavedSession | null = null;
let restoreTask: Promise<void> | null = null;
let storageQueue = Promise.resolve();
let persistenceMessage = '';
function discardSession(): void {
    session = null;
    eraseSession();
    storageQueue = storageQueue.catch(() => undefined).then(() => { eraseSession(); });
}
export function sessionNotice(): string { return persistenceMessage; }
export function ready(): Promise<void> {
    if (!restoreTask) {
        const attempt = generation;
        restoreTask = readSession().then(value => {
            if (attempt !== generation)
                return;
            const saved = value as SavedSession | null;
            if (saved && typeof saved.token === 'string' && typeof saved.account === 'string' && saved.account && jwtExpiry(saved.token) > Date.now() + 900000) {
                session = { token: saved.token, account: saved.account, expires: jwtExpiry(saved.token) };
            }
            else {
                discardSession();
            }
        }).catch(() => { persistenceMessage = '无法读取登录保持，请重新登录'; discardSession(); });
    }
    return restoreTask;
}
export function invalidateSession(): void { generation++; flow = null; discardSession(); }
onUnauthorized(failedToken => {
    if (session && session.token === failedToken)
        invalidateSession();
});
let flow: {
    username: string;
    password: string;
    deviceId: string;
    state: string;
    gid: string;
    attest: string;
    account: string;
} | null = null;
let busy = false;
let generation = 0;
function checked<T>(env: Envelope<T>, label: string): T {
    if (!env || env.code !== 0 || !env.data)
        throw new Error(`${label}未通过，请检查账号、密码或验证码后重试`);
    return env.data;
}
function jwtExpiry(token: string): number {
    try {
        const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const bytes = new Uint8Array(wx.base64ToArrayBuffer(encoded + '='.repeat((4 - encoded.length % 4) % 4)));
        const exp = JSON.parse(String.fromCharCode(...Array.from(bytes))).exp;
        return typeof exp === 'number' ? exp * 1000 : 0;
    }
    catch (_) {
        return 0;
    }
}
export function identity(): string {
    if (session && session.expires <= Date.now() + 900000)
        invalidateSession();
    return session ? session.account : '';
}
export function token(): string {
    if (!identity() || !session) {
        session = null;
        throw new Error('请先登录学校账号');
    }
    return session.token;
}
export function cancelLogin(): void { flow = null; generation++; }
export function logout(): void { invalidateSession(); wx.removeStorageSync('zzu.schedule'); wx.removeStorageSync('zzu.schedule.active'); wx.removeStorageSync('zzu.electricity'); }
async function deviceId(): Promise<string> {
    const cached = wx.getStorageSync('zzu.device');
    if (typeof cached === 'string' && /^[a-f0-9]{32}$/.test(cached))
        return cached;
    const id = Array.from(await randomBytes(16)).map(b => b.toString(16).padStart(2, '0')).join('');
    wx.setStorageSync('zzu.device', id);
    return id;
}
export async function beginLogin(account: string, password: string): Promise<'sms' | 'success'> {
    if (busy)
        throw new Error('正在登录，请稍候');
    if (!account.trim() || !password)
        throw new Error('请输入学号和密码');
    busy = true;
    const attempt = ++generation;
    flow = null;
    try {
        await ready();
        if (attempt !== generation)
            throw new Error('登录已取消');
        const pem = await request<string>(BASE + '/token/jwt/publicKey', 'GET', undefined, {});
        if (typeof pem !== 'string' || !pem.includes('PUBLIC KEY'))
            throw new Error('学校认证公钥格式异常');
        const { createEncryptor } = require('../vendor/jsencrypt.js');
        const rsa = createEncryptor(await randomBytes(1024));
        rsa.setPublicKey(pem);
        const username = rsa.encrypt(account.trim()), encrypted = rsa.encrypt(password);
        if (!username || !encrypted)
            throw new Error('登录信息加密失败，请检查输入长度');
        const device = await deviceId();
        const user = '__RSA__' + username, pass = '__RSA__' + encrypted;
        const detected = checked(await request<Envelope<Detection>>(BASE + '/token/mfa/detect?' + query({ username: user, password: pass, deviceId: device }), 'POST', '', UA), '账号验证');
        if (!detected.state)
            throw new Error('学校认证未返回登录状态，请重试');
        if (attempt !== generation)
            throw new Error('登录已取消');
        flow = { username: user, password: pass, deviceId: device, state: detected.state, gid: '', attest: '', account: account.trim() };
        if (!detected.need) {
            await completeLogin();
            return 'success';
        }
        if (!detected.mfaTypeSecurePhone)
            throw new Error('账号需要其他验证方式，请先在学校统一认证中心处理');
        const init = checked(await request<Envelope<Challenge>>(BASE + '/token/mfa/initByType/securephone?' + query({ state: detected.state }), 'GET', undefined, UA), '短信初始化');
        const attest = (init.attestServerUrl || BASE + '/attest/api/guard').replace(/\/$/, '');
        // Only send a login challenge to the known school's authentication origin.
        if (!/^https:\/\/cas\.s\.zzu\.edu\.cn(?:\/|$)/.test(attest) || !init.gid)
            throw new Error('学校返回了新的验证服务地址，需要核验并配置后才能继续');
        flow.gid = init.gid;
        flow.attest = attest;
        await sendSms();
        return 'sms';
    }
    catch (error) {
        flow = null;
        throw error;
    }
    finally {
        busy = false;
    }
}
export async function sendSms(): Promise<void> {
    if (!flow || !flow.gid)
        throw new Error('验证流程已失效，请重新登录');
    const env = await request<Envelope<unknown>>(flow.attest + '/api/guard/securephone/send', 'POST', { gid: flow.gid }, { ...UA, 'content-type': 'application/json' });
    if (env.code !== 0)
        throw new Error('短信发送失败，请稍后重试');
}
export async function submitSms(code: string): Promise<void> {
    if (busy)
        throw new Error('正在验证，请稍候');
    if (!flow || !/^\d{4,8}$/.test(code.trim()))
        throw new Error('请输入有效短信验证码');
    busy = true;
    try {
        const data = checked(await request<Envelope<{
            status: number;
        }>>(flow.attest + '/api/guard/securephone/valid', 'POST', { gid: flow.gid, code: code.trim() }, { ...UA, 'content-type': 'application/json' }), '短信验证');
        if (data.status !== 2)
            throw new Error('验证码错误或已过期');
        await completeLogin();
    }
    finally {
        busy = false;
    }
}
async function completeLogin(): Promise<void> {
    if (!flow)
        throw new Error('请重新开始登录');
    const current = flow;
    const result = checked(await request<Envelope<Tokens>>(BASE + '/token/password/passwordLogin?' + query({ username: current.username, password: current.password, appId: 'com.supwisdom.zzu', osType: 'android', geo: '', deviceId: current.deviceId, clientId: '', mfaState: current.state }), 'POST', '', UA), '登录');
    const expires = jwtExpiry(result.idToken);
    if (!expires || expires < Date.now() + 900000)
        throw new Error('学校返回的登录状态无效或即将过期');
    const cache = wx.getStorageSync('zzu.schedule');
    const active = wx.getStorageSync('zzu.schedule.active');
    const energy = wx.getStorageSync('zzu.electricity');
    if ((cache && cache.account !== current.account) || (active && active.account !== current.account) || (energy && energy.account !== current.account)) {
        wx.removeStorageSync('zzu.schedule');
        wx.removeStorageSync('zzu.schedule.active'); wx.removeStorageSync('zzu.electricity');
    }
    if (flow !== current)
        throw new Error('登录已取消');
    session = { token: result.idToken, account: current.account, expires };
    const saved = session, attempt = generation;
    persistenceMessage = '';
    storageQueue = storageQueue.catch(() => undefined).then(async () => {
        if (attempt !== generation)
            return;
        try {
            await saveSession(saved);
        }
        catch (error) {
            persistenceMessage = error instanceof Error ? error.message : '登录保持未能保存';
        }
        if (attempt !== generation)
            eraseSession();
    });
    await storageQueue;
    if (attempt !== generation)
        throw new Error('登录已取消');
    flow = null;
}
