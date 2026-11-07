import { identity, ready } from '../../services/auth';
import { MeterKind, EnergyCache, LocationLevel, readEnergy, locations, queryMeter, canonicalLevel, officialElectricityEntry } from '../../services/electricity';
import { syncLabel } from '../../services/schedule-cache';
Page({
    data: { logged: false, busy: false, error: '', paymentKind: '', paymentHint: '', meters: [] as { kind: MeterKind; label: string; name: string; value: string; time: string; selected: boolean }[], history: [] as { id: string; label: string; time: string; value: string }[], picking: false, pickerLabel: '', nodes: [] as { id: string; name: string }[], index: 0, trail: '', pickerError: '' },
    _kind: 'lighting' as MeterKind, _scope: {} as Record<string, string>, _level: null as LocationLevel | null, _trail: [] as string[], _request: 0, _visible: false,
    onShow() { this._visible = true; this.render(); ready().then(() => { if (!this._visible) return; this.setData({ logged: !!identity() }); this.render(); const cache = readEnergy(); if (identity() && cache && cache.account === identity() && Object.keys(cache.meters).length) this.refresh(); }); },
    onHide() { this._visible = false; this._request++; this.setData({ busy: false, picking: false, paymentHint: '' }); },
    onUnload() { this.onHide(); },
    login() { wx.navigateTo({ url: '/pages/login/login' }); },
    render() {
        const stored = readEnergy(), account = identity();
        const cache: EnergyCache | null = stored && (!account || stored.account === account) ? stored : null;
        const kinds: MeterKind[] = ['lighting', 'ac'];
        const meters = kinds.map(kind => { const meter = cache && cache.meters[kind]; const samples = cache ? cache.samples.filter(s => s.kind === kind && meter && s.room === meter.room) : []; const last = samples[samples.length - 1]; return { kind, label: kind === 'lighting' ? '照明电表' : '空调电表', name: meter ? meter.name : '尚未选择电表', value: last ? last.kwh.toFixed(2) : '—', time: last ? syncLabel(last.at) : '', selected: !!meter }; });
        const history = cache ? cache.samples.filter(s => cache.meters[s.kind] && cache.meters[s.kind]!.room === s.room).slice(-20).reverse().map((s, i) => ({ id: String(i), label: s.kind === 'lighting' ? '照明' : '空调', time: syncLabel(s.at), value: s.kwh.toFixed(2) })) : [];
        this.setData({ meters, history });
    },
    async prepareElectricityPayment(event: WechatMiniprogram.TouchEvent) {
        const kind: unknown = event.currentTarget.dataset.kind;
        if ((kind !== 'lighting' && kind !== 'ac') || this.data.paymentKind || this.data.picking) return;
        const owner = identity();
        if (!owner) { this.login(); return; }
        const cache = readEnergy();
        const meter = cache?.account === owner ? cache.meters[kind] : undefined;
        if (!meter) { this.setData({ paymentHint: '请先选择要缴费的电表。' }); return; }
        const label = kind === 'ac' ? '空调' : '照明';
        this.setData({ paymentKind: kind, paymentHint: '' });
        try {
            const confirmed = await new Promise<boolean>((resolve, reject) => wx.showModal({
                title: label + '电费',
                content: '当前电表为 ' + meter.name + '。复制入口后，请在手机浏览器打开，并在学校页面选择同一电表、核对金额后付款。',
                confirmText: '复制入口',
                success: result => resolve(result.confirm),
                fail: reject,
            }));
            if (!confirmed || !this._visible || identity() !== owner) return;
            const entry = await officialElectricityEntry();
            const current = readEnergy();
            if (!this._visible || identity() !== owner || current?.account !== owner || current.meters[kind]?.room !== meter.room) return;
            await new Promise<void>((resolve, reject) => wx.setClipboardData({
                data: entry,
                success: () => resolve(),
                fail: () => reject(new Error('复制失败，请重试。')),
            }));
            if (!this._visible || identity() !== owner) return;
            const guide = '打开 Safari 或手机自带浏览器，在地址栏粘贴链接。请在学校页面核对' + label + '电表「' + meter.name + '」。链接含登录会话，请仅本人使用。';
            this.setData({ paymentHint: '已复制学校缴电费入口。' + guide });
            wx.showModal({ title: '缴费入口已复制', content: guide, showCancel: false, confirmText: '知道了' });
        } catch (error) {
            if (this._visible && identity() === owner) this.setData({ paymentHint: error instanceof Error ? error.message : '暂时无法获取缴费入口，可在「豫见郑大 → 一卡通 → 电费充值」办理。' });
        } finally { this.setData({ paymentKind: '' }); }
    },
    async refresh() {
        if (this.data.busy) return;
        if (!identity()) { this.login(); return; }
        const cache = readEnergy();
        if (!cache || cache.account !== identity() || !Object.keys(cache.meters).length) { this.setData({ error: '请先选择照明或空调电表' }); return; }
        const attempt = ++this._request;
        this.setData({ busy: true, error: '' });
        const errors: string[] = [];
        await Promise.all((['lighting', 'ac'] as MeterKind[]).filter(kind => cache.meters[kind]).map(kind => queryMeter(kind).catch(error => { errors.push((kind === 'lighting' ? '照明：' : '空调：') + (error instanceof Error ? error.message : '查询失败')); })));
        if (attempt === this._request) { this.setData({ busy: false, error: errors.join('\n') }); this.render(); }
    },
    async choose(event: WechatMiniprogram.TouchEvent) {
        if (this.data.busy || this.data.paymentKind) return;
        if (!identity()) { this.login(); return; }
        this._kind = event.currentTarget.dataset.kind === 'ac' ? 'ac' : 'lighting';
        this._scope = {}; this._trail = []; this._level = null;
        this.setData({ picking: true, pickerLabel: this._kind === 'ac' ? '选择空调电表' : '选择照明电表', pickerError: '', trail: '' });
        await this.loadLevel('area');
    },
    async loadLevel(type: string) {
        const attempt = ++this._request;
        this.setData({ busy: true, pickerError: '', nodes: [], index: 0 });
        try { const level = await locations(type, this._scope); if (attempt !== this._request) return; this._level = level; this.setData({ nodes: level.locationList }); }
        catch (error) { if (attempt === this._request) this.setData({ pickerError: error instanceof Error ? error.message : '读取电表列表失败' }); }
        finally { if (attempt === this._request) this.setData({ busy: false }); }
    },
    pick(event: WechatMiniprogram.PickerChange) { this.setData({ index: Number(event.detail.value) }); },
    async next() {
        if (this.data.busy || !this._level) return;
        const node = this.data.nodes[this.data.index]; if (!node) return;
        this._trail.push(node.name || node.id);
        this.setData({ trail: this._trail.join(' / ') });
        if (this._level.end) {
            const attempt = ++this._request;
            this.setData({ busy: true, pickerError: '' });
            try { await queryMeter(this._kind, { room: node.id, name: this._trail.join(' / ') }); if (attempt === this._request) { this.setData({ picking: false }); this.render(); } }
            catch (error) { if (attempt === this._request) { this._trail.pop(); this.setData({ trail: this._trail.join(' / '), pickerError: error instanceof Error ? error.message : '电量查询失败' }); } }
            finally { if (attempt === this._request) this.setData({ busy: false }); }
        } else {
            this._scope[canonicalLevel(this._level.locationType)] = node.id;
            if (!this._level.nextLocationType || this._trail.length > 8) { this.setData({ pickerError: '学校房间层级不完整，请重新选择' }); return; }
            await this.loadLevel(this._level.nextLocationType);
        }
    },
    cancel() { this._request++; this.setData({ picking: false, busy: false }); },
});
