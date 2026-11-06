import { identity } from './auth';
import { ecardToken } from './electricity';
import { request } from './network';
import { parseBalance } from './card-balance';

export interface RechargeCapabilities {
    amounts: string[];
    channels: { code: string; name: string; tradeType: string }[];
    wapEnabled: boolean;
    channelSelectionEnabled: boolean;
    webPayCode?: string;
    balance?: number;
    sdkUrl?: string;
}
type Config = { wapPaySdkJsUrl?: unknown; amtGroupList?: { amt?: unknown }[]; daLianPayList?: { code?: unknown; name?: unknown; tradeType?: unknown }[]; wapPayEnable?: unknown; daLianPayEnable?: unknown; wapPayCode?: unknown };
export function parseRechargeConfig(value: unknown): RechargeCapabilities {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('学校充值配置格式异常');
    const data = value as Config;
    if (!('amtGroupList' in data || 'wapPayEnable' in data || 'daLianPayEnable' in data)) throw new Error('学校未返回充值渠道配置');
    const amounts = (Array.isArray(data.amtGroupList) ? data.amtGroupList : []).filter(item => item && (typeof item.amt === 'number' || typeof item.amt === 'string') && Number.isFinite(Number(item.amt)) && Number(item.amt) > 0).map(item => String(item.amt));
    const channels = (Array.isArray(data.daLianPayList) ? data.daLianPayList : []).filter(item => item && typeof item.code === 'string' && item.code).map(item => ({ code: item.code as string, name: typeof item.name === 'string' ? item.name.slice(0,80) : '未命名渠道', tradeType: typeof item.tradeType === 'string' ? item.tradeType : '' }));
    const enabled = (flag: unknown) => flag === true || flag === 1 || flag === '1' || flag === 'true';
    const webPayCode = typeof data.wapPayCode === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(data.wapPayCode) ? data.wapPayCode : undefined;
    const balance = 'balance' in data ? parseBalance(data) : undefined;
    const sdkUrl = typeof data.wapPaySdkJsUrl === 'string' && /^https:\/\/(?:ecard|payment)\.v\.zzu\.edu\.cn\/[A-Za-z0-9_./-]+\.js(?:\?[A-Za-z0-9_=&.-]*)?$/.test(data.wapPaySdkJsUrl) ? data.wapPaySdkJsUrl : undefined;
    return { amounts: amounts.filter((item,index) => amounts.indexOf(item) === index), channels, wapEnabled: enabled(data.wapPayEnable), channelSelectionEnabled: enabled(data.daLianPayEnable), webPayCode, balance, sdkUrl };
}
// Read configuration only. No order creation, payment submission or stored card data.
export async function queryRechargeCapabilities(): Promise<RechargeCapabilities> {
    const owner = identity();
    if (!owner) throw new Error('请先登录学校账号');
    const access = await ecardToken();
    const result = await request<{ success: boolean; resultData?: unknown }>('https://ecard.v.zzu.edu.cn/server/recharge/config', 'POST', {}, { Authorization: access });
    if (identity() !== owner) throw new Error('账号已变化，请重新检测');
    if (!result || result.success !== true) throw new Error('学校未提供可用的充值配置');
    return parseRechargeConfig(result.resultData);
}
