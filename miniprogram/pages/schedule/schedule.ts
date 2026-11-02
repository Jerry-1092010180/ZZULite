import * as auth from '../../services/auth';
import { cached, sync, weekNow, forWeek } from '../../services/schedule';
Page({
    data: { logged: false, busy: false, error: '', name: '尚未同步课表', updated: '', week: 1, maxWeek: 30, semesters: [] as {
            id: number;
            nameZh: string;
        }[], semesterIndex: 0, groups: [] as {
            day: string;
            items: ReturnType<typeof forWeek>;
        }[], hasCache: false },
    onShow() { this.render(); auth.ready().then(() => this.setData({ logged: !!auth.identity() })); },
    login() { wx.navigateTo({ url: '/pages/login/login' }); },
    render(week?: number) {
        const cache = cached();
        if (!cache) {
            this.setData({ hasCache: false, groups: [] });
            return;
        }
        const current = week || weekNow(cache.semester);
        const sessions = forWeek(cache, current);
        const groups = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day, i) => ({ day, items: sessions.filter(s => s.day === i + 1 || ((s.day < 1 || s.day > 7) && s.date && ((new Date(s.date + 'T12:00:00+08:00').getDay() + 6) % 7) === i)) }));
        this.setData({ hasCache: true, name: cache.semester.nameZh, week: current, maxWeek: Math.max(30, ...cache.sessions.map(s => s.week)), groups, semesters: cache.semesters, semesterIndex: Math.max(0, cache.semesters.findIndex(s => s.id === cache.semester.id)), updated: new Date(cache.updated).toLocaleString() });
    },
    async refresh() { await this.load(); },
    async load(id?: number) {
        if (this.data.busy)
            return;
        if (!auth.identity()) {
            this.login();
            return;
        }
        this.setData({ busy: true, error: '' });
        try {
            await sync(id);
            this.render();
        }
        catch (e) {
            this.setData({ error: e instanceof Error ? e.message : '课表同步失败' });
        }
        finally {
            this.setData({ busy: false });
        }
    },
    previous() {
        if (this.data.week > 1)
            this.render(this.data.week - 1);
    }, next() {
        if (this.data.week < this.data.maxWeek)
            this.render(this.data.week + 1);
    }, current() { this.render(); },
    chooseWeek(e: WechatMiniprogram.PickerChange) { this.render(Number(e.detail.value) + 1); },
    changeSemester(e: WechatMiniprogram.PickerChange) {
        const item = this.data.semesters[Number(e.detail.value)];
        if (item)
            this.load(item.id);
    },
});
