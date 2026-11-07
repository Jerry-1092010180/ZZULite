// The eCard recharge configuration expresses balance in yuan.
// Portal card arrays are ambiguous and must not be selected by position.
export function parseBalance(data: unknown): number {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('学校一卡通余额格式异常');
    const value = (data as { balance?: unknown }).balance;
    if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && !/^-?\d+(?:\.\d{1,2})?$/.test(value.trim()))) throw new Error('学校一卡通未返回有效余额');
    const amount = Number(value), cents = amount * 100;
    if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(cents)) || Math.abs(cents - Math.round(cents)) > 0.000001) throw new Error('学校一卡通余额数值无效');
    return amount;
}
