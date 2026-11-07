import { ready } from '../../services/auth';
import { queryRechargeCapabilities } from '../../services/card-recharge';
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
        checkingRecharge: false, rechargeResult: '',
        services: services.map(item => ({ ...item, result: '尚未检测' })),
    },
    async checkRecharge() {
        if (this.data.checkingRecharge) return;
        this.setData({ checkingRecharge: true, rechargeResult: '' });
        try {
            await ready();
            const result = await queryRechargeCapabilities();
            this.setData({ rechargeResult: '学校充值配置已返回。\n预设金额：' + (result.amounts.join('、') || '未提供') + '\n渠道：' + (result.channels.map(item => item.name + '（' + item.code + ' / ' + item.tradeType + '）').join('、') || '未提供可选渠道') + '\n网页收银台：' + (result.wapEnabled ? '学校已启用' : '未启用') + '\n仅代表配置可读，尚未验证当前 AppID 的支付授权，未创建订单或付款。' });
        } catch (error) { this.setData({ rechargeResult: error instanceof Error ? error.message : '充值渠道检测失败' }); }
        finally { this.setData({ checkingRecharge: false }); }
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
