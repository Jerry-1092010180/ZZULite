const services = [
    { name: '认证公钥接口', url: 'https://cas.s.zzu.edu.cn/token/jwt/publicKey' },
    { name: '统一认证', url: 'https://cas.s.zzu.edu.cn/' },
    { name: '教务系统', url: 'https://jwxt.zzu.edu.cn/' },
    { name: '一卡通', url: 'https://ecard.v.zzu.edu.cn/' },
    { name: '校园门户', url: 'https://info.s.zzu.edu.cn/' },
    { name: '图书馆 HTTPS', url: 'https://order.lib.zzu.edu.cn/' },
];
Page({
    data: {
        running: false,
        services: services.map(item => ({ ...item, result: '尚未检测' })),
    },
    async checkNetwork() {
        if (this.data.running)
            return;
        this.setData({ running: true });
        for (let index = 0; index < services.length; index++) {
            this.setData({ [`services[${index}].result`]: '检测中…' });
            await new Promise<void>(resolve => {
                wx.request({
                    url: services[index].url,
                    method: 'GET', timeout: 10000,
                    success: response => {
                        this.setData({ [`services[${index}].result`]: `收到 HTTP ${response.statusCode}；未验证登录及业务接口` });
                    },
                    fail: error => {
                        this.setData({ [`services[${index}].result`]: error.errMsg });
                    },
                    complete: () => resolve(),
                });
            });
        }
        this.setData({ running: false });
    },
});
