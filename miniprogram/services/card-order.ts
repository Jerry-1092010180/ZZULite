import { identity } from './auth';
import { ecardToken } from './electricity';
import { queryRechargeCapabilities, RechargeCapabilities } from './card-recharge';
import { request } from './network';
import { isCashierOrderPaid, querySchoolOrder, SchoolOrderStatus } from './card-order-status';
import { supportsEncryptedStorage } from './session-storage';

const BASE = 'https://ecard.v.zzu.edu.cn';
export interface SchoolOrder { amountYuan: number; reference: string; checkoutUrl: string }
export function schoolCashierPreviewUrl(order: SchoolOrder | null): string {
    const url = order?.checkoutUrl || '';
    return /^https:\/\/payment\.v\.zzu\.edu\.cn\/WapCashDesk\/e-pay\/payways\.html\?orderInfo=/.test(url) ? url : '';
}
function cashierOrderInfo(url: string): Record<string, unknown> | null {
    const match = url.match(/^https:\/\/payment\.v\.zzu\.edu\.cn\/WapCashDesk\/e-pay\/(?:payways|wechat)\.html\?orderInfo=([^&]+)/);
    if (!match) return null;
    try { return JSON.parse(decodeURIComponent(match[1])); } catch (_) { return null; }
}

export function knownSchoolCashierMethods(order: SchoolOrder): string[] {
    const info = cashierOrderInfo(schoolCashierPreviewUrl(order));
    if (info?.partnerid === 'PT000008' && String(info.merchantno) === '20180600021'
        && String(info.channelno) === '103' && !order.checkoutUrl.includes('&projectPaywayList=')) {
        return ['微信支付', '支付宝'];
    }
    return [];
}
let busy = false;
let submitted = false;
let pending: SchoolOrder | null = null;
let pendingOwner = '';
const LOCK_KEY = 'zzu.cardOrder.pending';
const CHECKOUT_KEY = 'zzu.cardOrder.checkout.v1';
const HISTORY_KEY = 'zzu.cardOrder.history';
const CHECKOUT_TTL = 30 * 60 * 1000;
export interface LocalSchoolOrder { account: string; amountYuan: number; at: number; state: string; reference?: string; payCode?: string; issue?: string }
class CheckoutFormatError extends Error {}
interface RechargeResponse {
    success?: boolean;
    code?: unknown;
    message?: unknown;
    msg?: unknown;
    resultMsg?: unknown;
    resultData?: unknown;
}

function rechargeRejection(result: RechargeResponse): string {
    const detail = result.resultData as RechargeResponse | null;
    const message = [result.message, result.msg, result.resultMsg, detail?.message, detail?.msg, detail?.resultMsg, result.resultData]
        .filter((value): value is string => typeof value === 'string').join(' ');
    let reason = '下单失败';
    if (/金额|amount/i.test(message)) {
        reason = '金额校验失败';
        if (/最低|低于|最小|下限/.test(message)) reason = '充值金额低于学校要求';
        else if (/最高|超过|最大|上限/.test(message)) reason = '充值金额超过学校限额';
    } else if (/过于频繁|太频繁|操作频繁|请求频繁|提交频繁|频率限制|限流|次数(?:过多|超限|已达)|超过.{0,8}次数|too many requests|rate limit/i.test(message)) {
        reason = '提交频率或次数受限';
    } else if (/交易授权|交易凭证|交易令牌/.test(message)) reason = '交易授权校验失败';
    else if (/维护|暂停|关闭/.test(message)) reason = '充值服务暂不可用';
    else if (/稍后(?:再试|重试)|try again later/i.test(message)) reason = '下单失败并提示稍后再试，具体原因未明确';

    const code = result.code ?? detail?.code;
    const safeCode = (typeof code === 'string' || typeof code === 'number') && /^-?\d{1,8}$/.test(String(code)) ? String(code) : '';
    return '学校返回' + reason + '，未提供支付路由' + (safeCode ? '（学校响应码 ' + safeCode + '）' : '');
}
// Developer diagnostics deliberately expose structure and payment routing
// identifiers only, never accessToken/openid/order numbers or raw JSON.
export async function schoolOrderRouteDiagnostics(): Promise<string> {
    const owner = identity(), before = localSchoolOrder();
    if (!owner || !before) return '当前账号没有已提交的充值记录。';
    const lines = [
        '提交金额：' + before.amountYuan + ' 元',
        '提交渠道 payCode：' + (before.payCode && /^[A-Za-z0-9_-]{1,32}$/.test(before.payCode) ? before.payCode : '未保存'),
    ];
    if (before.issue) {
        lines.push('本次提交结果：' + before.issue);
        if (before.issue.startsWith('学校返回暂时限制提交')) {
            lines.push('旧版也会把「稍后再试」归为暂时限制提交。这笔记录无法确认具体原因。');
        }
    }
    if (!supportsEncryptedStorage()) return lines.concat('当前微信不支持读取加密的收银台响应。').join('\n');
    const value = await new Promise<unknown>(resolve => {
        const timer = setTimeout(() => resolve(null), 3000);
        wx.getStorage({ key: CHECKOUT_KEY, encrypt: true, success: res => { clearTimeout(timer); resolve(res.data); }, fail: () => { clearTimeout(timer); resolve(null); } });
    });
    const saved = value as { account?: string; at?: number; raw?: unknown } | null, after = localSchoolOrder();
    if (identity() !== owner || !after || after.at !== before.at) return '订单记录已变化，请重新查看。';
    if (!saved || saved.account !== owner || saved.at !== before.at || saved.raw == null) {
        return lines.concat('本机没有保存这笔订单的收银台响应，暂无支付路由可显示。').join('\n');
    }
    const kind = (v: unknown): string => v === null ? 'null' : Array.isArray(v) ? 'array[' + v.length + ']' : typeof v;
    const inspect = (name: string, value: unknown) => {
        lines.push(name + '：' + kind(value));
        if (value && typeof value === 'object' && !Array.isArray(value)) Object.keys(value).filter(key => /^[A-Za-z0-9_]{1,50}$/.test(key)).slice(0,40).forEach(key => lines.push(name + '.' + key + '：' + kind((value as Record<string,unknown>)[key])));
    };
    const raw = saved.raw as Record<string,unknown> | undefined;
    const wap = raw && raw.wapPayInfo as Record<string,unknown> | undefined;
    const order = wap && wap.orderInfo as Record<string,unknown> | undefined;
    const routingValue = (v: unknown): string => {
        if (v === '') return '空字符串';
        if (typeof v === 'string') return /^\d{1,32}$/.test(v) ? v : '非数字字符串（长度 ' + v.length + '）';
        if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
        return kind(v);
    };
    lines.push('响应 payCode：' + routingValue(raw && raw.payCode));
    lines.push('指定支付方式 callPaywayid：' + routingValue(wap && wap.callPaywayid));
    lines.push('渠道编号 channelno：' + routingValue(order && order.channelno));
    lines.push('支付方式列表：' + kind(wap && (wap.projectPaywayList || order && order.projectPaywayList)));
    inspect('result', raw);
    inspect('wapPayInfo', wap);
    inspect('orderInfo', wap && wap.orderInfo);
    inspect('extend', wap && wap.extend);
    return lines.join('\n');
}
export function localSchoolOrder(): LocalSchoolOrder | null {
    try {
        const record = wx.getStorageSync(LOCK_KEY) as LocalSchoolOrder;
        return record && record.account === identity() && Number.isFinite(record.at) && Number.isFinite(record.amountYuan) ? record : null;
    } catch (_) { return null; }
}
export function hasUnresolvedSchoolOrder(): boolean {
    try { const record = wx.getStorageSync(LOCK_KEY); return submitted || !!record && record.state !== 'resolved' && record.state !== 'archived_unpaid'; } catch (_) { return true; }
}
// Archiving is a user's decision to abandon an unpaid test, not a school-side
// cancellation or a claim about payment status. Keep the metadata for checking.
export function archiveUnpaidSchoolOrder(expected: LocalSchoolOrder, confirmedUnpaid: boolean): void {
    const current = localSchoolOrder();
    if (!confirmedUnpaid || busy || !current || current.account !== identity() || current.account !== expected.account || current.at !== expected.at || current.reference !== expected.reference || current.state !== expected.state || current.amountYuan !== expected.amountYuan) throw new Error('提交记录已变化或正在处理，请重新检查后操作');
    const saved = wx.getStorageSync(HISTORY_KEY);
    const history = Array.isArray(saved) ? saved : [];
    const archived = { ...current, state: 'archived_unpaid', archivedAt: Date.now() };
    // Write history before releasing the lock; a failed write must leave it locked.
    wx.setStorageSync(HISTORY_KEY, history.concat(archived).slice(-50));
    wx.removeStorageSync(LOCK_KEY);
    if (wx.getStorageSync(LOCK_KEY)) throw new Error('旧提交标记未能清除，请重试');
    submitted = false;
    pending = null;
    pendingOwner = '';
    try { wx.removeStorageSync(CHECKOUT_KEY); } catch (_) { /* restored data must also match current state */ }
}
async function saveCheckout(order: { raw?: unknown; checkoutUrl?: string; amountYuan: number; reference?: string }, account: string, at: number): Promise<void> {
    if (!supportsEncryptedStorage()) return;
    await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 3000);
        wx.setStorage({ key: CHECKOUT_KEY, encrypt: true, data: { ...order, account, at, expiresAt: at + CHECKOUT_TTL }, success: () => { clearTimeout(timer); resolve(); }, fail: () => { clearTimeout(timer); resolve(); } });
    });
}
export async function restoreSchoolOrder(): Promise<SchoolOrder | null> {
    const owner = identity(), before = localSchoolOrder();
    if (!owner || !before || (before.state !== 'created' && before.state !== 'unresolved')) return null;
    const active = pendingSchoolOrder();
    if (active && active.reference === before.reference) return active;
    if (!supportsEncryptedStorage()) return null;
    const value = await new Promise<unknown>(resolve => {
        const timer = setTimeout(() => resolve(null), 3000);
        wx.getStorage({ key: CHECKOUT_KEY, encrypt: true, success: res => { clearTimeout(timer); resolve(res.data); }, fail: () => { clearTimeout(timer); resolve(null); } });
    });
    const saved = value as SchoolOrder & { raw?: unknown; account: string; at: number; expiresAt: number } | null, after = localSchoolOrder();
    if (identity() !== owner || !after || after.state !== before.state || after.at !== before.at || !saved || saved.account !== owner || saved.at !== after.at || saved.reference !== after.reference || saved.amountYuan !== after.amountYuan || !Number.isFinite(saved.expiresAt) || saved.expiresAt > saved.at + CHECKOUT_TTL || saved.expiresAt <= Date.now()) return null;
    if (saved.raw !== undefined) {
        const restored = parseSchoolOrder(saved.raw, saved.amountYuan);
        if (after.reference && restored.reference !== after.reference) return null;
        wx.setStorageSync(LOCK_KEY, { ...after, state: 'created', reference: restored.reference, issue: '' });
        pending = restored;
    } else {
        if (after.state !== 'created' || typeof saved.checkoutUrl !== 'string' || !/^https:\/\/payment\.v\.zzu\.edu\.cn\/WapCashDesk\/e-pay\/(?:payways|wechat)\.html\?orderInfo=/.test(saved.checkoutUrl)) return null;
        // Older generated links lost SDK routing metadata. Do not restore a
        // known-broken null-channel selector as if it were a repaired link.
        if (saved.checkoutUrl.indexOf('/payways.html?') >= 0 && saved.checkoutUrl.indexOf('&projectPaywayList=') < 0) {
            const encoded = saved.checkoutUrl.match(/[?&]orderInfo=([^&]+)/);
            let orderInfo: { channelno?: unknown };
            try { orderInfo = JSON.parse(decodeURIComponent(encoded ? encoded[1] : '')); }
            catch (_) { return null; }
            if (!orderInfo || !orderInfo.channelno) throw new CheckoutFormatError('旧版缓存缺少官方 SDK 支付方式信息，无法修复这条空渠道链接；不会重新下单');
        }
        pending = { amountYuan: saved.amountYuan, reference: saved.reference, checkoutUrl: saved.checkoutUrl };
    }
    pendingOwner = owner;
    return pending;
}
export async function queryAndReconcileSchoolOrder(reference: string): Promise<SchoolOrderStatus & { resolvedLocal: boolean }> {
    const owner = identity(), before = localSchoolOrder();
    const result = await querySchoolOrder(reference, before && before.reference === reference ? before.payCode : undefined);
    const after = localSchoolOrder();
    const same = before && after && before.account === owner && identity() === owner && before.at === after.at && before.reference === reference && after.reference === reference;
    if (result.code === '1' && same && !busy) {
        wx.setStorageSync(LOCK_KEY, { ...after, state: 'resolved' });
        submitted = false;
        return { ...result, resolvedLocal: true };
    }
    if (before && same && (result.code === '-1' || result.code === '2')) {
        let order = pendingSchoolOrder();
        try {
            if (!order && supportsEncryptedStorage()) {
                // The checkout link may be too old to reopen. The identifiers
                // in its matching record can still be used for a read-only lookup.
                const saved = await new Promise<unknown>(resolve => {
                    const timer = setTimeout(() => resolve(null), 3000);
                    wx.getStorage({ key: CHECKOUT_KEY, encrypt: true, success: res => { clearTimeout(timer); resolve(res.data); }, fail: () => { clearTimeout(timer); resolve(null); } });
                }) as { account?: string; at?: number; reference?: string; amountYuan?: number; raw?: unknown; checkoutUrl?: string } | null;
                if (saved?.account === owner && saved.at === before.at && saved.reference === reference && saved.amountYuan === before.amountYuan) {
                    order = saved.raw !== undefined ? parseSchoolOrder(saved.raw, before.amountYuan)
                        : { reference, amountYuan: before.amountYuan, checkoutUrl: saved.checkoutUrl || '' };
                }
            }
            if (identity() !== owner || localSchoolOrder()?.at !== before.at) throw new Error('订单记录已变化');
            const info = order?.reference === reference ? cashierOrderInfo(order.checkoutUrl) : null;
            const merchantno = String(info?.merchantno || ''), orderno = info?.journo;
            if (/^\d{1,32}$/.test(merchantno) && typeof orderno === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(orderno)
                && await isCashierOrderPaid({ merchantno, orderno, amountYuan: before.amountYuan })
                && identity() === owner && localSchoolOrder()?.at === before.at) {
                return { ...result, description: '学校收银台确认这笔款项已支付。校园卡到账仍待核对，请查看官方充值流水。', resolvedLocal: false };
            }
        } catch (error) {
            if (identity() === owner && localSchoolOrder()?.at === before.at && error instanceof Error && error.message.includes('域名尚未配置')) {
                return { ...result, description: result.description + ' 收银台查单还需要配置 payment.v.zzu.edu.cn 请求域名。请在官方充值流水核对到账。', resolvedLocal: false };
            }
        }
    }
    if (identity() !== owner) throw new Error('账号已变化，请重新查询');
    return { ...result, resolvedLocal: false };
}
export function isRechargeAmount(amount: number): boolean {
    return amount >= 5 && amount <= 1000 && Math.round(amount * 100) / 100 === amount;
}
export function validateOrderAmount(amount: number, config: RechargeCapabilities): void {
    if (!isRechargeAmount(amount)) throw new Error('请输入 5 至 1000 元的充值金额，最多两位小数');
    if (!config.wapEnabled || !config.webPayCode) throw new Error('学校没有返回完整的网页收银台渠道配置');
}
export function parseSchoolOrder(data: unknown, amountYuan: number): SchoolOrder {
    const result = data as { payCode?: unknown; partnerJourno?: unknown; wapPayInfo?: { orderInfo?: Record<string, unknown>; extend?: Record<string, unknown>; callAccountid?: unknown; callPaywayid?: unknown; projectPaywayList?: unknown } } | null;
    const wap = result && result.wapPayInfo, order = wap && wap.orderInfo, extend = wap && wap.extend;
    if (!wap || !order || !extend) throw new CheckoutFormatError('缺少收银台结构 wapPayInfo / orderInfo / extend');
    const fields = ['partnerid','journo','merchantno','payResultUrl','goodsname','txamt','openid'];
    const numericFields = ['partnerid','merchantno','channelno','txamt'];
    const invalid = fields.filter(key => typeof order[key] !== 'string' && !(numericFields.indexOf(key) >= 0 && typeof order[key] === 'number' && Number.isSafeInteger(order[key])));
    if (invalid.length) throw new CheckoutFormatError('收银台字段缺失或类型不兼容：' + invalid.join('、'));
    if (Number(order.txamt) !== Math.round(amountYuan * 100)) throw new CheckoutFormatError('收银台金额与确认的充值金额不一致');
    if (!order.journo || typeof extend.accessToken !== 'string' || !extend.accessToken) throw new CheckoutFormatError('收银台流水或临时登录信息缺失');
    const callAccountid = wap.callAccountid;
    if (callAccountid !== undefined && callAccountid !== null && typeof callAccountid !== 'string' && !(typeof callAccountid === 'number' && Number.isSafeInteger(callAccountid))) throw new CheckoutFormatError('收银台渠道账号类型不兼容');
    if (!/^https:\/\/(?:ecard|payment)\.v\.zzu\.edu\.cn(?:\/|$)/.test(order.payResultUrl as string)) throw new CheckoutFormatError('学校订单返回了未验证的回调地址');
    const info: Record<string, unknown> = { ...order };
    if (order.channelno !== undefined) {
        if (order.channelno !== null && typeof order.channelno !== 'string' && !(typeof order.channelno === 'number' && Number.isSafeInteger(order.channelno))) throw new CheckoutFormatError('收银台 channelno 类型不兼容（' + typeof order.channelno + '）');
        info.channelno = order.channelno;
    }
    info.extend = { ...extend };
    // Reproduce the school's cap-epay-sdk-min.js routing. Do not discard its
    // preselected way or project-specific ways and force a generic way lookup.
    let projectWays = wap.projectPaywayList || order.projectPaywayList;
    delete info.projectPaywayList;
    if (typeof projectWays === 'string') { try { projectWays = JSON.parse(projectWays); } catch (_) { throw new CheckoutFormatError('学校支付方式列表不是有效 JSON'); } }
    if (projectWays != null && !Array.isArray(projectWays)) throw new CheckoutFormatError('学校支付方式列表格式不兼容');
    const ways = projectWays as { paywayid?: unknown; accountid?: unknown }[] | null | undefined;
    const single = ways && ways.length === 1 ? ways[0] : undefined;
    const way = wap.callPaywayid || (single && single.paywayid);
    const account = wap.callPaywayid ? callAccountid : single && single.paywayid ? single.accountid : callAccountid;
    let route = 'payways.html';
    if (way) {
        if (typeof way !== 'string' || !/^\d{4}$/.test(way)) throw new CheckoutFormatError('学校指定支付方式编号格式异常');
        if (['0201','0204','0209','0210','0211'].indexOf(way) < 0) throw new CheckoutFormatError('学校指定的支付方式不是当前支持的微信网页支付');
        route = 'wechat.html';
    } else if ((order.channelno === null || order.channelno === undefined || order.channelno === '') && (!ways || !ways.length)) {
        // Observed in the official App's recharge response on 2026-11-06 and
        // confirmed with the school's payWays endpoint for this exact tuple.
        if (result?.payCode !== '07' || order.partnerid !== 'PT000008' || String(order.merchantno) !== '20180600021') {
            throw new CheckoutFormatError('学校未提供渠道编号或可用支付方式，无法打开收银台');
        }
        info.channelno = '103';
    }
    // The school result page queries resultData.partnerJourno. The cashier's
    // orderInfo.journo belongs to its checkout payload and may be different.
    const partnerJourno = result && result.partnerJourno;
    if (partnerJourno !== undefined && partnerJourno !== null && (typeof partnerJourno !== 'string' && typeof partnerJourno !== 'number' || typeof partnerJourno === 'number' && !Number.isSafeInteger(partnerJourno) || !/^\d{10,64}$/.test(String(partnerJourno)))) throw new Error('学校查单流水号格式异常，请保留订单记录');
    const checkoutUrl = 'https://payment.v.zzu.edu.cn/WapCashDesk/e-pay/' + route + '?orderInfo=' + encodeURIComponent(JSON.stringify(info)) + (way ? '&callPaywayid=' + encodeURIComponent(String(way)) : '') + '&callAccountid=' + encodeURIComponent(account == null ? '' : String(account)) + (!way && ways ? '&projectPaywayList=' + encodeURIComponent(JSON.stringify(ways)) : '');
    return { amountYuan, reference: partnerJourno !== undefined && partnerJourno !== null ? String(partnerJourno) : order.journo as string, checkoutUrl };
}
// Development test adapter. The caller must obtain explicit
// user confirmation of the card, amount and school payee before invoking it.
// No retries: a timeout after submission means an unknown order outcome.
export async function createSchoolOrder(amountYuan: number): Promise<SchoolOrder> {
    if (busy || hasUnresolvedSchoolOrder()) throw new Error('已有下单请求，请先核对学校订单，勿重复提交');
    const owner = identity();
    if (!owner) throw new Error('请先登录学校账号');
    busy = true;
    try {
        const config = await queryRechargeCapabilities();
        validateOrderAmount(amountYuan, config);
        const access = await ecardToken();
        const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,19).replace('T',' ');
        const transaction = await request<{ success: boolean; resultData?: unknown }>(BASE + '/server/consume/transaction', 'POST', { datetime: date }, { Authorization: access });
        if (!transaction || !transaction.success || typeof transaction.resultData !== 'string' || !transaction.resultData) throw new Error('学校未返回有效交易授权，尚未下单');
        if (identity() !== owner) throw new Error('账号已变化，尚未下单');
        // A durable non-credential marker prevents a restart from silently
        // repeating a request whose server-side outcome is unknown.
        const at = Date.now();
        wx.setStorageSync(LOCK_KEY, { account: owner, amountYuan, at, payCode: config.webPayCode, state: 'unresolved' });
        submitted = true;
        pendingOwner = owner;
        let issue = '未取得可确认下单结果的学校响应';
        try {
            const result = await request<RechargeResponse>(BASE + '/server/recharge/pay', 'POST', { payCode: config.webPayCode!, amt: String(amountYuan), returnUrl: BASE + '/', timestamp: Date.now() }, { Authorization: access, transactionId: transaction.resultData });
            if (identity() !== owner) throw new Error('账号已变化，请在学校渠道核对原账号订单');
            if (result?.success === false) {
                issue = rechargeRejection(result);
                throw new Error(issue);
            }
            if (result?.success !== true) throw new Error(issue);
            if (result.resultData == null) throw new CheckoutFormatError('学校未返回收银台数据');
            const data = result.resultData as { partnerJourno?: unknown; wapPayInfo?: { orderInfo?: { journo?: unknown } } } | null;
            const reference = data && (data.partnerJourno || (data.wapPayInfo && data.wapPayInfo.orderInfo && data.wapPayInfo.orderInfo.journo));
            if ((typeof reference === 'string' || typeof reference === 'number') && /^\d{10,64}$/.test(String(reference))) wx.setStorageSync(LOCK_KEY, { account: owner, amountYuan, at, payCode: config.webPayCode, state: 'unresolved', reference: String(reference) });
            // Save before parsing so a parser fix can recover this response
            // without creating another financial order. Encrypted storage only.
            try { await saveCheckout({ raw: result.resultData, amountYuan, reference: localSchoolOrder()?.reference }, owner, at); } catch (_) {}
            if (identity() !== owner) throw new Error('账号已变化');
            pending = parseSchoolOrder(result.resultData, amountYuan);
            try { wx.setStorageSync(LOCK_KEY, { account: owner, amountYuan, at, payCode: config.webPayCode, state: 'created', reference: pending.reference }); } catch (_) { /* initial unresolved marker remains */ }
            const order = pending;
            try { await saveCheckout({ ...order, raw: result.resultData }, owner, at); } catch (_) { /* memory link still available; no plaintext fallback */ }
            if (identity() !== owner) throw new Error('账号已变化，请在学校渠道核对原账号订单');
            return order;
        } catch (error) {
            if (error instanceof CheckoutFormatError) issue = error.message;
            const saved = localSchoolOrder();
            if (identity() === owner && saved && saved.at === at) {
                try { wx.setStorageSync(LOCK_KEY, { ...saved, issue }); } catch (_) { /* keep the existing submission marker */ }
            }
            if (error instanceof CheckoutFormatError) {
                throw new Error('学校已响应，但未取得可用付款链接：' + error.message + '。已保留提交记录，请勿直接重试。');
            }
            throw new Error(issue + '。已保留提交记录，请先在学校渠道核对，勿重复提交。');
        }
    } finally { busy = false; }
}
// Temporary credentials are kept in memory and, when supported, encrypted
// storage for short-lived restart recovery. Never log or persist as plaintext.
export function pendingSchoolOrder(): SchoolOrder | null {
    const record = localSchoolOrder();
    return identity() === pendingOwner && record && record.state === 'created' && pending && pending.reference === record.reference ? pending : null;
}
