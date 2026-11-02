import { identity, ready } from '../../services/auth';
import { MeterKind, EnergyCache, LocationLevel, readEnergy, locations, queryMeter, canonicalLevel } from '../../services/electricity';
import { syncLabel } from '../../services/schedule-cache';
Page({
    data: { logged: false, busy: false, error: '', meters: [] as { kind: MeterKind; label: string; name: string; value: string; time: string }[], history: [] as { id: string; label: string; time: string; value: string }[], picking: false, pickerLabel: '', nodes: [] as { id: string; name: string }[], index: 0, trail: '', pickerError: '' },
    _kind: 'lighting' as MeterKind, _scope: {} as Record<string, string>, _level: null as LocationLevel | null, _trail: [] as string[], _request: 0, _visible: false,
    onShow() { this._visible = true; this.render(); ready().then(() => { if (!this._visible) return; this.setData({ logged: !!identity() }); this.render(); const cache = readEnergy(); if (identity() && cache && cache.account === identity() && Object.keys(cache.meters).length) this.refresh(); }); },
    onHide() { this._visible = false; this._request++; this.setData({ busy: false, picking: false }); },
    onUnload() { this.onHide(); },
    login() { wx.navigateTo({ url: '/pages/login/login' }); },
    render() {
        const stored = readEnergy(), account = identity();
        const cache: EnergyCache | null = stored && (!account || stored.account === account) ? stored : null;
        const kinds: MeterKind[] = ['lighting', 'ac'];
        const meters = kinds.map(kind => { const meter = cache && cache.meters[kind]; const samples = cache ? cache.samples.filter(s => s.kind === kind && meter && s.room === meter.room) : []; const last = samples[samples.length - 1]; return { kind, label: kind === 'lighting' ? '照明电表' : '空调电表', name: meter ? meter.name : '尚未选择电表', value: last ? last.kwh.toFixed(2) : '—', time: last ? syncLabel(last.at) : '' }; });
        const history = cache ? cache.samples.filter(s => cache.meters[s.kind] && cache.meters[s.kind]!.room === s.room).slice(-20).reverse().map((s, i) => ({ id: String(i), label: s.kind === 'lighting' ? '照明' : '空调', time: syncLabel(s.at), value: s.kwh.toFixed(2) })) : [];
        this.setData({ meters, history });
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
        if (this.data.busy) return;
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
