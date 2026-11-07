import { identity } from './auth';
import { ecardToken } from './electricity';
import { queryRechargeCapabilities } from './card-recharge';
import { request } from './network';
export interface SchoolOrderStatus { code: string; description: string }
export interface CashierOrderQuery { merchantno: string; orderno: string; amountYuan: number }

export async function isCashierOrderPaid(order: CashierOrderQuery): Promise<boolean> {
    const result = await request<{ returncode?: string; data?: unknown; tradestate?: string }>(
        'https://payment.v.zzu.edu.cn/WapCashDesk/queryOrder', 'POST',
        { merchantno: order.merchantno, orderno: order.orderno, ordernotype: '1' }
    );
    if (result?.returncode !== 'SUCCESS') return false;
    const raw = result.tradestate ? result : typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
    const payment = raw as { tradestate?: string; txamt?: unknown; partnerjourno?: unknown; merchantno?: unknown } | null;
    return payment?.tradestate === 'SUCCESS'
        && (typeof payment.txamt === 'string' || typeof payment.txamt === 'number')
        && Number(payment.txamt) === Math.round(order.amountYuan * 100)
        && (payment.partnerjourno == null || String(payment.partnerjourno) === order.orderno)
        && (payment.merchantno == null || String(payment.merchantno) === order.merchantno);
}
export function parseOrderStatus(value: unknown): SchoolOrderStatus {
    const result = value as { success?: unknown; code?: unknown } | null;
    if (!result || result.success !== true || (typeof result.code !== 'string' && typeof result.code !== 'number')) throw new Error('学校未返回可确认的订单状态');
    const code = String(result.code);
    if (!/^-?\d{1,8}$/.test(code)) throw new Error('学校订单状态格式发生变化');
    return { code, description: code === '1' ? '学校返回充值成功状态；请再核对校园卡余额或充值流水。' : code === '0' ? '学校显示“支付中”，尚未确认充值成功。这不代表已扣款；若尚未付款，请回到创建该笔订单时的学校收银台继续操作，结果回跳页不能代替收银台。' : code === '2' ? '学校显示“未查询到支付结果，请稍后在消费/交易记录中查询”。这不证明订单已取消或可以重复下单。' : code === '-1' ? '学校返回查询异常，尚不能确认订单结果。' : '学校状态码 ' + code + '，尚未确认充值成功；请勿据此直接重复下单。' };
}
// Same read-only query contract used by the school's webSuccess page.
export async function querySchoolOrder(reference: string, savedPayCode?: string): Promise<SchoolOrderStatus> {
    if (!/^\d{10,64}$/.test(reference)) throw new Error('请输入学校返回的完整数字订单流水号，不要粘贴含登录令牌的链接');
    const owner = identity();
    if (!owner) throw new Error('请先登录本人学校账号');
    const payCode = savedPayCode || (await queryRechargeCapabilities()).webPayCode;
    if (!payCode || !/^[A-Za-z0-9_-]{1,32}$/.test(payCode)) throw new Error('学校未返回有效支付渠道代码，暂不能查询此笔订单');
    const access = await ecardToken();
    if (identity() !== owner) throw new Error('账号已变化，请重新查询');
    const result = await request<unknown>('https://ecard.v.zzu.edu.cn/server/recharge/orderStatus', 'POST', { payCode, partnerJourno: reference }, { Authorization: access });
    if (identity() !== owner) throw new Error('账号已变化，请重新查询');
    return parseOrderStatus(result);
}
