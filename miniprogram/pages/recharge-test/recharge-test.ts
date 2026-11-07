import { ready, identity } from '../../services/auth';
import { parseBalance } from '../../services/card-balance';
import { queryRechargeCapabilities } from '../../services/card-recharge';
import { syncLabel } from '../../services/schedule-cache';
import { isRechargeAmount, schoolCashierPreviewUrl, schoolOrderRouteDiagnostics, createSchoolOrder, pendingSchoolOrder, restoreSchoolOrder, archiveUnpaidSchoolOrder, hasUnresolvedSchoolOrder, localSchoolOrder, queryAndReconcileSchoolOrder } from '../../services/card-order';
Page({
    data: { recovering: false, hasCheckout: false, canPreviewCheckout: false, recoveryMessage: '', localHint: '', queryReference: '', statusMessage: '', statusBusy: false, busy: false, checked: false, balance: '', amounts: '', channels: '', error: '', account: '', time: '', choices: [] as number[], selected: 0, customAmount: '', canOrder: false, locked: false, reference: '', orderMessage: '' },
    _attempt: 0, _owner: '', _checkoutOwner: '', _checkoutReference: '', _resumeCheckout: false, _openingCheckout: false,
    inputReference(event: WechatMiniprogram.Input) { this.setData({ queryReference: event.detail.value.trim(), statusMessage: '' }); },
    async queryOrder() {
        if (this.data.busy || this.data.statusBusy || this.data.recovering) { this.setData({ statusMessage: '正在处理上一项操作，请等待；若长时间无响应，请返回本页重试只读查询。' }); return; }
        const saved = localSchoolOrder();
        const reference = (this.data.queryReference || this.data.reference || (saved && saved.reference) || '').trim();
        if (!/^\d{10,64}$/.test(reference)) { this.setData({ statusMessage: '没有可用的订单流水号。请在上方输入框填写官方结果链接 partnerjourno= 后的完整数字；不要粘贴登录链接。' }); return; }
        const attempt = this._attempt;
        const matching = !saved ? '本机没有本人订单记录。' : !saved.reference ? '本机提交记录没有流水号，无法判断是否为这笔订单。' : saved.reference === reference ? '查询流水号与本机提交记录一致。' : '查询的是另一笔订单，不对应本机锁定的提交记录。';
        this.setData({ statusBusy: true, queryReference: reference, statusMessage: matching + '\n正在恢复登录并查询学校订单，最长等待 35 秒…' });
        let timer = 0;
        try {
            const result = await Promise.race([
                (async () => { await ready(); return queryAndReconcileSchoolOrder(reference); })(),
                new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('查询等待超时，尚不能确认订单结果。请返回页面重试只读查询，不要重新下单。')), 35000); }),
            ]);
            if (attempt === this._attempt) this.setData({ locked: hasUnresolvedSchoolOrder(), statusMessage: result.description + '（学校状态码：' + result.code + '）\n' + matching + (result.resolvedLocal ? '\n本机同一笔订单已核对成功，已解除该笔重复提交保护。' : '\n本机待核对记录未解除；查询其他订单不会解除当前记录。') });
        } catch (error) { if (attempt === this._attempt) this.setData({ statusMessage: error instanceof Error ? error.message : '查单失败，尚不能确认订单结果' }); }
        finally { clearTimeout(timer); if (attempt === this._attempt) this.setData({ statusBusy: false }); }
    },
    onShow() {
        const saved = localSchoolOrder();
        const order = pendingSchoolOrder();
        this.setData({ hasCheckout: !!order, canPreviewCheckout: !!schoolCashierPreviewUrl(order), locked: hasUnresolvedSchoolOrder(), queryReference: saved && saved.reference ? saved.reference : '', reference: saved && saved.reference ? saved.reference : '', localHint: saved ? (saved.issue ? '未取得付款链接：' + saved.issue + '。' : '') + (saved.state === 'resolved' ? '本机已核对金额：' : saved.state === 'archived_unpaid' ? '本人确认未付款并归档的测试金额：' : '本机待核对金额：') + saved.amountYuan + ' 元；提交时间：' + syncLabel(saved.at) + '；' + (saved.reference ? '已恢复保存的订单号。' : '提交时未取得流水号；旧版本没有保存可恢复的付款链接。') : '' });
        const resume = this._resumeCheckout && this._checkoutOwner === identity() && saved && saved.reference === this._checkoutReference;
        this._resumeCheckout = false;
        if (this._checkoutOwner !== identity()) { this._checkoutOwner = ''; this._checkoutReference = ''; }
        // Returning from the browser is not evidence of payment. Only
        // perform a read-only query, once, for the same account and order.
        if (resume) { this._checkoutOwner = ''; this._checkoutReference = ''; return this.queryOrder(); }
    },
    onHide() { this._resumeCheckout = !!this._checkoutReference; this._attempt++; this.setData({ recovering: false, hasCheckout: false, recoveryMessage: '', queryReference: '', statusMessage: '', statusBusy: false, reference: '', orderMessage: '', busy: false, checked: false, balance: '', amounts: '', channels: '', account: '', time: '', error: '' }); },
    onUnload() { this._attempt++; this._checkoutOwner = ''; this._checkoutReference = ''; this._resumeCheckout = false; },
    login() { wx.navigateTo({ url: '/pages/login/login' }); },
    async routeDiagnostics() {
        if (this.data.busy || this.data.statusBusy || this.data.recovering) return;
        const attempt = this._attempt;
        this.setData({ recovering: true, recoveryMessage: '' });
        try { await ready(); const summary = await schoolOrderRouteDiagnostics(); if (attempt === this._attempt) this.setData({ recoveryMessage: summary }); }
        catch (_) { if (attempt === this._attempt) this.setData({ recoveryMessage: '读取本机诊断失败；没有向学校发送请求' }); }
        finally { if (attempt === this._attempt) this.setData({ recovering: false }); }
    },
    async recoverCheckout() {
        if (this.data.busy || this.data.statusBusy || this.data.recovering) return;
        const attempt = this._attempt;
        this.setData({ recovering: true, recoveryMessage: '' });
        try {
            await ready();
            const order = await restoreSchoolOrder();
            if (attempt !== this._attempt) return;
            this.setData({ hasCheckout: !!order, canPreviewCheckout: !!schoolCashierPreviewUrl(order), recoveryMessage: order ? '已恢复本单链接。尚未确认付款。' : '没有可恢复的链接：旧版本只保存了提交标记，或链接已超过本地恢复期限。不能用订单号拼出付款链接。若确认旧单未付款且不再支付，可使用下方归档入口开始新测试。' });
        } catch (error) { if (attempt === this._attempt) this.setData({ recoveryMessage: '恢复失败，没有重新下单。' + (error instanceof Error ? error.message : '请检查登录后重试恢复。') }); }
        finally { if (attempt === this._attempt) this.setData({ recovering: false }); }
    },
    async archiveUnpaid() {
        try { if (wx.getAccountInfoSync().miniProgram.envVersion !== 'develop') return; } catch (_) { return; }
        if (this.data.busy || this.data.statusBusy || this.data.recovering) return;
        const saved = localSchoolOrder(), attempt = this._attempt;
        if (!saved) { this.setData({ recoveryMessage: '当前登录账号没有可归档的有效提交记录，请先登录原学校账号。' }); return; }
        let cleared = false;
        this.setData({ busy: true, recoveryMessage: '' });
        try {
            const confirmed = await new Promise<boolean>((resolve, reject) => wx.showModal({ title: '清除未付款测试记录', content: '账号尾号 ' + saved.account.slice(-4) + '，旧提交金额 ' + saved.amountYuan + ' 元。确认未付款、未扣款且不再支付旧链接后，可清除本机待处理标记。历史元数据保留，不取消学校端订单，也不创建新订单。', confirmText: '清除记录', cancelText: '取消', success: result => resolve(result.confirm), fail: () => reject(new Error('确认弹窗未能打开，请重新进入此页重试')) }));
            if (!confirmed || attempt !== this._attempt) return;
            archiveUnpaidSchoolOrder(saved, true);
            cleared = true;
            this._checkoutOwner = ''; this._checkoutReference = ''; this._resumeCheckout = false;
            this.setData({ locked: hasUnresolvedSchoolOrder(), hasCheckout: false, checked: false, canOrder: false, balance: '', reference: '', queryReference: '', orderMessage: '', statusMessage: '', localHint: '旧测试记录已保留在本机归档中，未标记为学校已取消或支付成功。', recoveryMessage: '已归档旧测试记录。请重新点击第一步「读取本人余额与充值配置」，再选择金额并确认创建新订单；不要再支付旧链接。' });
        } catch (error) { if (attempt === this._attempt) this.setData({ recoveryMessage: error instanceof Error ? error.message : '归档失败，原提交保护仍保留' }); }
        finally { if (attempt === this._attempt) this.setData({ busy: false }); }
        if (cleared && attempt === this._attempt) await this.check();
    },
    select(event: WechatMiniprogram.PickerChange) {
        if (!this.data.busy && !this.data.locked) this.setData({ selected: Number(event.detail.value), customAmount: '', error: '' });
    },
    inputAmount(event: WechatMiniprogram.Input) {
        if (!this.data.busy && !this.data.locked) this.setData({ customAmount: event.detail.value, error: '' });
    },
    async create() {
        try { if (wx.getAccountInfoSync().miniProgram.envVersion !== 'develop') return; } catch (_) { return; }
        if (this.data.statusBusy || this.data.busy || this.data.recovering || !this.data.checked || !this.data.canOrder || this.data.locked) return;
        const owner = identity(), attempt = this._attempt;
        if (!owner || owner !== this._owner) return;
        const custom = this.data.customAmount.trim();
        const amount = custom ? (/^\d+(?:\.\d{1,2})?$/.test(custom) ? Number(custom) : NaN) : this.data.choices[this.data.selected];
        if (!isRechargeAmount(amount)) {
            this.setData({ error: '请输入 5 至 1000 元的充值金额，最多两位小数。' });
            return;
        }
        this.setData({ busy: true, error: '', orderMessage: '' });
        try {
            const confirmed = await new Promise<boolean>(resolve => wx.showModal({ title: '创建真实校园卡充值订单', content: '学校账号尾号 ' + owner.slice(-4) + '，充值 ' + amount + ' 元；学校一卡通余额 ¥' + this.data.balance + '，请与官方 App 核对，不一致请取消。将向学校提交真实订单并取得官方收银台链接；此步骤不扣款，不会在本小程序内弹出微信付款。请确认是本人校园卡。', confirmText: '确认下单', success: result => resolve(result.confirm), fail: () => resolve(false) }));
            if (!confirmed || attempt !== this._attempt || identity() !== owner) return;
            const order = await createSchoolOrder(amount);
            if (attempt === this._attempt && identity() === owner) this.setData({ hasCheckout: true, canPreviewCheckout: !!schoolCashierPreviewUrl(order), reference: order.reference, locked: true, orderMessage: '学校已返回订单和收银台链接。付款、校园卡到账均未确认。' });
        } catch (error) { if (attempt === this._attempt) this.setData({ error: error instanceof Error ? error.message : '下单未能确认，请在学校渠道核对订单，勿重复提交' }); }
        finally { if (attempt === this._attempt) this.setData({ busy: false, locked: hasUnresolvedSchoolOrder() }); }
    },
    openCheckout() {
        if (this.data.busy || this.data.statusBusy || this.data.recovering || this._openingCheckout) return;
        if (!schoolCashierPreviewUrl(pendingSchoolOrder())) {
            this.setData({ canPreviewCheckout: false, orderMessage: '本单收银台暂时无法预览，请先核对订单。' });
            return;
        }
        this._openingCheckout = true;
        wx.navigateTo({
            url: '/pages/recharge-cashier/recharge-cashier',
            fail: () => this.setData({ orderMessage: '未能打开收银台页面。请重试，或点「去浏览器付款」。' }),
            complete: () => { this._openingCheckout = false; },
        });
    },
    async copyCheckout() {
        if (this.data.busy || this.data.statusBusy || this.data.recovering) return;
        const owner = identity(), attempt = this._attempt;
        if (!owner) return;
        const isCurrent = () => attempt === this._attempt && identity() === owner;
        try {
            const order = pendingSchoolOrder() || await restoreSchoolOrder();
            if (!isCurrent()) return;
            if (!order) {
                this.setData({ hasCheckout: false, recoveryMessage: '没有可复制的收银台链接。请先尝试「恢复本单付款链接」。' });
                return;
            }
            const confirmed = await new Promise<boolean>((resolve, reject) => wx.showModal({
                title: '在浏览器继续付款',
                content: '这笔校园卡充值为 ' + order.amountYuan + ' 元。点「复制链接」后，小程序会自动复制学校收银台链接。接下来需要你打开手机浏览器，付款由你在收银台确认。',
                confirmText: '复制链接',
                success: result => resolve(result.confirm),
                fail: () => reject(new Error('未能打开复制提示，请重试。')),
            }));
            if (!confirmed || !isCurrent()) return;
            if (pendingSchoolOrder()?.reference !== order.reference) {
                this.setData({ hasCheckout: !!pendingSchoolOrder(), orderMessage: '本单状态已变化，请先核对订单。' });
                return;
            }
            await new Promise<void>((resolve, reject) => wx.setClipboardData({
                data: order.checkoutUrl,
                success: () => resolve(),
                fail: () => reject(new Error('复制失败，请再点一次「去浏览器付款」。')),
            }));
            if (!isCurrent()) return;
            this._checkoutOwner = owner;
            this._checkoutReference = order.reference;
            const instructions = '1. 切换到 Safari 或手机自带浏览器。\n2. 在浏览器地址栏粘贴链接，点「前往」。\n3. 在学校收银台核对金额和收款方，再选择付款方式。';
            this.setData({ orderMessage: '收银台链接已复制。\n' + instructions + '\n返回本页会自动查询这笔订单。' });
            wx.showModal({
                title: '链接已复制',
                content: instructions,
                showCancel: false,
                confirmText: '知道了',
            });
        } catch (error) {
            if (isCurrent()) this.setData({ orderMessage: error instanceof Error ? error.message : '无法复制本单链接，请先恢复链接。' });
        }
    },
    async check() {
        if (this.data.busy || this.data.statusBusy || this.data.recovering) return;
        const attempt = ++this._attempt;
        this.setData({ busy: true, checked: false, balance: '', amounts: '', channels: '', account: '', time: '', error: '', choices: [], canOrder: false, selected: 0, customAmount: '', reference: '', orderMessage: '' });
        try {
            await ready();
            const account = identity();
            if (!account) throw new Error('请先登录学校账号，再读取本人的充值配置');
            const config = await queryRechargeCapabilities();
            const balance = parseBalance({ balance: config.balance });
            if (attempt !== this._attempt) return;
            if (identity() !== account) throw new Error('账号已变化，请重新检查');
            this._owner = account;
            const choices = config.amounts.map(Number).filter(isRechargeAmount);
            const existing = pendingSchoolOrder();
            const saved = localSchoolOrder(), reference = existing ? existing.reference : saved && saved.state !== 'archived_unpaid' && saved.reference ? saved.reference : '';
            this.setData({ choices, canOrder: !!config.wapEnabled && !!config.webPayCode, locked: hasUnresolvedSchoolOrder(), reference, queryReference: this.data.queryReference || reference });
            this.setData({ checked: true, account: account.slice(-4), balance: balance.toFixed(2), amounts: config.amounts.join('、') || '学校未提供预设金额', channels: config.channels.map(item => item.name + ' / ' + item.tradeType).join('\n') || (config.wapEnabled ? '学校提供网页收银台配置，未返回可选渠道' : '未返回可用渠道') + (config.sdkUrl ? '\n官方 SDK：' + config.sdkUrl : ''), time: new Date().toLocaleString() });
        } catch (error) { if (attempt === this._attempt) this.setData({ error: error instanceof Error ? error.message : '接入检查失败' }); }
        finally { if (attempt === this._attempt) this.setData({ busy: false }); }
    },
});
