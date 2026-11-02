let unauthorizedHandler: ((failedToken: string) => void) | null = null;
export function onUnauthorized(handler: (failedToken: string) => void): void { unauthorizedHandler = handler; }
export function request<T>(url: string, method: 'GET' | 'POST' = 'GET', data?: object | string, header: Record<string, string> = {}): Promise<T> {
    return new Promise((resolve, reject) => wx.request<T>({
        url, method, data, header, timeout: 15000,
        success: response => {
            if (response.statusCode === 401) {
                const authKey = Object.keys(header).find(key => /^(authorization|x-id-token)$/i.test(key));
                if (unauthorizedHandler && authKey)
                    unauthorizedHandler(header[authKey]);
                return reject(new Error('登录状态失效，请重新登录'));
            }
            if (response.statusCode === 403)
                return reject(new Error('该账号无此系统访问权限；研究生课表需使用独立系统'));
            if (response.statusCode < 200 || response.statusCode >= 300)
                return reject(new Error(`学校服务返回 HTTP ${response.statusCode}`));
            resolve(response.data);
        },
        fail: error => reject(new Error(error.errMsg.includes('domain') ? '该服务域名尚未配置，请在后台添加后重新打开项目' : '无法连接学校服务，请检查网络后重试')),
    }));
}
export function randomBytes(length: number): Promise<Uint8Array> {
    if (typeof wx.getRandomValues !== 'function')
        return Promise.reject(new Error('当前微信不支持安全随机数，请升级微信后重试'));
    return new Promise((resolve, reject) => wx.getRandomValues({ length,
        success: result => resolve(new Uint8Array(result.randomValues)),
        fail: () => reject(new Error('当前微信不支持安全随机数，请升级微信后重试')),
    }));
}
export function query(values: Record<string, string>): string {
    return Object.keys(values).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(values[key])}`).join('&');
}
