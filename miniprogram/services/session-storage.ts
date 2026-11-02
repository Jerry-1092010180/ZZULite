// Use WeChat encrypted storage; never fall back to persisting plaintext tokens.
const KEY = 'zzu.session.v1';
export interface SavedSession {
    token: string;
    account: string;
    expires: number;
}
export function supportsEncryptedStorage(): boolean {
    try {
        const api = wx as typeof wx & {
            getAppBaseInfo?: () => {
                SDKVersion: string;
            };
        };
        const version = api.getAppBaseInfo ? api.getAppBaseInfo().SDKVersion : wx.getSystemInfoSync().SDKVersion;
        const parts = version.split('.').map(Number);
        return parts[0] > 2 || parts[0] === 2 && (parts[1] > 21 || parts[1] === 21 && parts[2] >= 3);
    }
    catch (_) {
        return false;
    }
}
export function readSession(): Promise<unknown> {
    if (!supportsEncryptedStorage())
        return Promise.resolve(null);
    return new Promise(resolve => {
        const options = { key: KEY, encrypt: true, success: (res: WechatMiniprogram.GetStorageSuccessCallbackResult) => resolve(res.data), fail: () => resolve(null) };
        wx.getStorage(options);
    });
}
export function saveSession(value: SavedSession): Promise<void> {
    if (!supportsEncryptedStorage())
        return Promise.reject(new Error('当前微信不支持加密登录保持，请升级微信'));
    return new Promise((resolve, reject) => {
        const options = { key: KEY, data: value, encrypt: true, success: () => {
                readSession().then(saved => {
                    const restored = saved as SavedSession | null;
                    if (restored && restored.token === value.token && restored.account === value.account)
                        resolve();
                    else {
                        eraseSession();
                        reject(new Error('加密登录状态未能读取，本次仍可使用'));
                    }
                });
            }, fail: () => reject(new Error('登录保持未能保存，本次仍可使用')) };
        wx.setStorage(options);
    });
}
export function eraseSession(): void { wx.removeStorageSync(KEY); }
