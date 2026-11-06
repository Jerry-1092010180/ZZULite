import * as auth from '../../services/auth';
Page({
    demo() { wx.navigateTo({ url: '/pages/demo/demo' }); },
    data: { account: '', password: '', code: '', sms: false, busy: false, error: '', cooldown: 0 },
    _timer: 0,
    input(e: WechatMiniprogram.Input) {
        const key = e.currentTarget.dataset.key as string;
        if (['account', 'password', 'code'].includes(key))
            this.setData({ [key]: e.detail.value });
    },
    onUnload() { clearInterval(this._timer); auth.cancelLogin(); this.setData({ password: '', code: '' }); },
    startCooldown() {
        clearInterval(this._timer);
        this.setData({ cooldown: 60 });
        this._timer = setInterval(() => {
            const n = this.data.cooldown - 1;
            this.setData({ cooldown: n });
            if (n <= 0)
                clearInterval(this._timer);
        }, 1000);
    },
    async login() {
        if (this.data.busy)
            return;
        this.setData({ busy: true, error: '' });
        const password = this.data.password;
        this.setData({ password: '' });
        try {
            const step = await auth.beginLogin(this.data.account, password);
            if (step === 'sms') {
                this.setData({ sms: true });
                this.startCooldown();
            }
            else {
                wx.navigateBack();
            }
        }
        catch (e) {
            this.setData({ error: e instanceof Error ? e.message : '登录失败，请重试' });
        }
        finally {
            this.setData({ busy: false });
        }
    },
    async verify() {
        if (this.data.busy)
            return;
        this.setData({ busy: true, error: '' });
        try {
            await auth.submitSms(this.data.code);
            this.setData({ code: '' });
            wx.navigateBack();
        }
        catch (e) {
            this.setData({ error: e instanceof Error ? e.message : '验证失败' });
        }
        finally {
            this.setData({ busy: false });
        }
    },
    async resend() {
        if (this.data.busy || this.data.cooldown)
            return;
        this.setData({ busy: true, error: '' });
        try {
            await auth.sendSms();
            this.startCooldown();
        }
        catch (e) {
            this.setData({ error: e instanceof Error ? e.message : '发送失败' });
        }
        finally {
            this.setData({ busy: false });
        }
    },
    restart() { auth.cancelLogin(); clearInterval(this._timer); this.setData({ sms: false, code: '', error: '', cooldown: 0 }); }
});
