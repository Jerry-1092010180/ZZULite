import { identity, token } from './auth';
import { request, query } from './network';
export type MeterKind = 'lighting' | 'ac';
export interface Meter { room: string; name: string }
export interface Sample { kind: MeterKind; room: string; at: number; kwh: number }
export interface EnergyCache { account: string; meters: Partial<Record<MeterKind, Meter>>; samples: Sample[] }
export interface LocationLevel { locationType: string; nextLocationType?: string; end: boolean; locationList: { id: string; name: string }[] }
export const ENERGY_KEY = 'zzu.electricity';
const BASE = 'https://ecard.v.zzu.edu.cn';
let access: { owner: string; cas: string; value: string; until: number } | null = null;
let pending: { cas: string; promise: Promise<string> } | null = null;
export function readEnergy(): EnergyCache | null {
    try {
        const value = wx.getStorageSync(ENERGY_KEY) as EnergyCache;
        if (!value || !value.account || typeof value.account !== 'string' || !value.meters || !Array.isArray(value.samples)) return null;
        const meters: EnergyCache['meters'] = {};
        (['lighting', 'ac'] as MeterKind[]).forEach(kind => {
            const meter = value.meters[kind];
            if (meter && typeof meter.room === 'string' && typeof meter.name === 'string') meters[kind] = meter;
        });
        const samples = value.samples.filter(item => item && (item.kind === 'lighting' || item.kind === 'ac') && typeof item.room === 'string' && typeof item.kwh === 'number' && Number.isFinite(item.kwh) && Number.isFinite(item.at) && item.at > 0).sort((a, b) => a.at - b.at).slice(-1000);
        return { account: value.account, meters, samples };
    }
    catch (_) { return null; }
}
export function tidFromLocation(value: unknown): string {
    if (typeof value !== 'string') return '';
    if (!/^https:\/\/ecard\.v\.zzu\.edu\.cn(?:[/?#]|$)/i.test(value) && !/^\/(?!\/)/.test(value)) return '';
    const match = /[?&]tid=([^&#\s]+)/.exec(value);
    try { return match ? decodeURIComponent(match[1]) : ''; } catch (_) { return ''; }
}
// Diagnostic metadata only: never include response bodies, cookies or ticket values.
export function ticketSummary(headers: Record<string, unknown>, body: unknown): string {
    const find = (name: string) => headers[Object.keys(headers).find(key => key.toLowerCase() === name) || ''];
    const location = find('location');
    const destination = typeof location === 'string' ? (/^https:\/\/([^/?#]+)/.exec(location) || [])[1] || '相对地址' : '无';
    const type = String(find('content-type') || '未知').split(';')[0].replace(/[^a-zA-Z0-9/+.-]/g, '').slice(0,60);
    const text = typeof body === 'string' ? body : '';
    const format = /<html|<!doctype/i.test(text) ? 'HTML页面' : text.trim().startsWith('{') || typeof body === 'object' ? 'JSON响应' : '其他响应';
    const title = /<title[^>]*>([^<]{0,100})<\/title>/i.exec(text);
    const page = title ? title[1].replace(/[^\u4e00-\u9fa5a-zA-Z -]/g, '').slice(0,40) : '无标题';
    const message = /<div\s+class=["']txt["'][^>]*>([^<]{0,200})<\/div>/i.exec(text);
    const hint = message ? message[1].replace(/[^\u4e00-\u9fa5，。；：、（） ]/g, '').slice(0,80) : '';
    return `类型=${type}，内容=${format}，页面=${page}${hint ? '，学校提示=' + hint : ''}，跳转目标=${destination}，含tid=${typeof location === 'string' && /[?&]tid=/.test(location) ? '是' : '否'}`;
}
function ticket(cas: string): Promise<string> {
    const params: Record<string, string> = { host: '11', org: '2', token: cas };
    return new Promise((resolve, reject) => {
        let done = false;
        let observed = '';
        const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('一卡通登录跳转超时，学校登录仍保留，请稍后重试')); } }, 16000);
        const accept = (headers: Record<string, unknown>): boolean => {
            const key = Object.keys(headers).find(key => key.toLowerCase() === 'location');
            const value = tidFromLocation(key && headers[key]);
            if (!value || done) return false;
            done = true; clearTimeout(timer); resolve(value); return true;
        };
        const task = wx.request<string>({
            url: BASE + '/server/auth/host/open?' + query(params),
            method: 'GET', dataType: '其他', timeout: 15000,
            // Newer WeChat supports this; bundled legacy typings omit it.
            ...{ redirect: 'manual' as const },
            success: response => {
                if (done || accept(response.header)) return;
                done = true; clearTimeout(timer);
                reject(new Error('一卡通票据未取得（HTTP ' + response.statusCode + '；' + ticketSummary(response.header, response.data) + '；首部事件=' + observed + '）。学校登录仍保留，请勿反复登录。'));
            },
            fail: error => { if (!done) { done = true; clearTimeout(timer); reject(new Error(error.errMsg && error.errMsg.includes('domain') ? '请先在小程序后台的 request 合法域名中添加 https://ecard.v.zzu.edu.cn' : '无法连接一卡通登录服务，请检查网络或重新登录学校账号')); } },
        });
        // Capture the redirect header before following it when supported by the client.
        if (task && typeof task.onHeadersReceived === 'function') task.onHeadersReceived(result => {
            observed = ticketSummary(result.header, '');
            if (accept(result.header)) task.abort();
        });
    });
}
// The official H5 router supports singleAppId + accessToken and removes the
// credential from location.search after importing it. singleAppId=recharge is
// its published route-map key; it also replaces a stale H5 session. Never use
// the CAS idToken here, or return the one-use tid to a router that may redeem
// it repeatedly. No order or payment request is made by this method.
export async function officialCardEntry(): Promise<string> {
    const owner = identity(), cas = token();
    if (!owner || !cas) throw new Error('请先登录学校账号');
    const credential = await ecardToken();
    const verified = await request<{ success?: boolean }>(BASE + '/server/recharge/config', 'POST', {}, { Authorization: credential });
    if (identity() !== owner || token() !== cas) throw new Error('账号已变化，请重新获取官方入口');
    if (!verified || verified.success !== true) {
        if (access && access.value === credential) access = null;
        throw new Error('学校未确认一卡通会话有效，请重新获取入口');
    }
    return BASE + '/?' + query({ singleAppId: 'recharge', accessToken: credential }) + '#/pages_home/home';
}
export async function ecardToken(): Promise<string> {
    const owner = identity(), cas = token();
    if (access && access.owner === owner && access.cas === cas && access.until > Date.now()) return access.value;
    if (pending && pending.cas === cas) return pending.promise;
    const promise = (async () => {
        const tid = await ticket(cas);
        const result = await request<{ resultData?: { accessToken?: string } }>(BASE + '/server/auth/getToken', 'POST', { tid });
        const value = result && result.resultData && result.resultData.accessToken;
        if (!value || typeof value !== 'string') throw new Error('一卡通未返回有效会话，请重新登录学校账号');
        if (identity() !== owner || token() !== cas) throw new Error('账号已变化，请重新查询');
        access = { owner, cas, value, until: Date.now() + 40 * 60000 };
        return value;
    })();
    pending = { cas, promise };
    try { return await promise; } finally { if (pending && pending.promise === promise) pending = null; }
}
async function post<T>(path: string, body: object): Promise<T> {
    const owner = identity();
    const credential = await ecardToken();
    try {
        const result = await request<{ success: boolean; resultData?: T }>(BASE + '/server/utilities/' + path, 'POST', body, { Authorization: credential });
        if (identity() !== owner) throw new Error('账号已变化，请重新查询');
        if (!result || result.success !== true || result.resultData == null) throw new Error('一卡通查询失败，请重新选择电表或刷新登录状态');
        return result.resultData;
    } catch (error) { if (access && access.value === credential) access = null; throw error; }
}
const FIELDS = ['bigArea', 'area', 'building', 'unit', 'level', 'room', 'subArea'];
export function canonicalLevel(value: string): string {
    const field = FIELDS.find(item => item.toLowerCase() === value.toLowerCase());
    if (!field) throw new Error('学校返回了无法识别的房间层级');
    return field;
}
export async function locations(level: string, scope: Record<string, string>): Promise<LocationLevel> {
    const locationType = canonicalLevel(level);
    const body: Record<string, string> = { utilityType: 'electric', locationType };
    FIELDS.forEach(field => { body[field] = scope[field] || ''; });
    const result = await post<LocationLevel>('location', body);
    if (!Array.isArray(result.locationList)) throw new Error('学校电表列表格式发生变化');
    return { ...result, locationType: canonicalLevel(result.locationType || locationType) };
}
export function roomBody(room: string): object {
    const parts = room.split('-');
    if (parts.length !== 5 || parts[2] !== '' || ![0, 1, 3, 4].every(i => parts[i])) throw new Error('电表编号格式异常，请从学校列表重新选择');
    return { utilityType: 'electric', bigArea: '', area: parts[0], building: parts[1], unit: '', level: parts[3], room, subArea: '' };
}
export function parseKwh(data: { templateList?: { code: string; value: unknown }[] }): number {
    const item = data && Array.isArray(data.templateList) && data.templateList.find(entry => entry.code === 'quantity');
    const value = item && item.value;
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('学校未返回有效剩余电量');
    return Number(value);
}
export function addSample(cache: EnergyCache, sample: Sample): EnergyCache {
    const samples = cache.samples.filter(item => !(item.kind === sample.kind && item.room === sample.room && Math.abs(item.at - sample.at) < 60000));
    samples.push(sample);
    samples.sort((a, b) => a.at - b.at);
    return { ...cache, samples: samples.slice(-1000) };
}
export async function queryMeter(kind: MeterKind, chosen?: Meter): Promise<EnergyCache> {
    const owner = identity();
    if (!owner) throw new Error('请先登录学校账号');
    const existing = readEnergy();
    const meter = chosen || (existing && existing.account === owner && existing.meters[kind]);
    if (!meter) throw new Error('请先选择电表');
    const kwh = parseKwh(await post<{ templateList: { code: string; value: unknown }[] }>('account', roomBody(meter.room)));
    if (identity() !== owner) throw new Error('账号已变化，请重新查询');
    // Re-read after awaiting so two independent meter queries do not overwrite one another.
    const latest = readEnergy();
    const cache = latest && latest.account === owner ? latest : { account: owner, meters: {}, samples: [] };
    const updated = addSample({ ...cache, meters: { ...cache.meters, [kind]: meter } }, { kind, room: meter.room, kwh, at: Date.now() });
    wx.setStorageSync(ENERGY_KEY, updated);
    return updated;
}
