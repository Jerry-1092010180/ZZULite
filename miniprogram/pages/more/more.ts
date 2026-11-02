import { identity, logout, ready, sessionNotice } from '../../services/auth';
import { cached } from '../../services/schedule';
import { readEnergy } from '../../services/electricity';
Page({ data: { account: '', cache: false, notice: '' }, async onShow() { await ready(); const a = identity(); this.setData({ account: a ? '账号尾号 ' + a.slice(-4) : '', cache: !!cached() || !!readEnergy(), notice: sessionNotice() }); }, login() { wx.navigateTo({ url: '/pages/login/login' }); }, electricity() { wx.navigateTo({url:'/pages/electricity/electricity'}); }, grades() { wx.navigateTo({ url: '/pages/grades/grades' }); }, campus() { wx.navigateTo({ url: '/pages/campus/campus' }); }, diagnostics() { wx.navigateTo({ url: '/pages/diagnostics/diagnostics' }); }, logout() {
        wx.showModal({ title: '退出学校账号', content: '将清除本机课表、电表选择、最近电量读数和当前登录状态。', success: r => {
                if (r.confirm) {
                    logout();
                    this.onShow();
                }
            } });
    } });
