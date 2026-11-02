import { identity, ready } from '../../services/auth';
import { Grade, queryGrades } from '../../services/grades';
Page({
    data: { logged: false, loading: false, loaded: false, error: '', terms: ['全部学期'], termIndex: 0, keyword: '', grades: [] as Grade[], shown: [] as Grade[], updated: '' },
    _account: '', _request: 0,
    async onShow() {
        await ready();
        const account = identity();
        if (account !== this._account) {
            this._account = account;
            this._request++;
            this.setData({ grades: [], shown: [], terms: ['全部学期'], termIndex: 0, loaded: false, loading: false, error: '', updated: '' });
        }
        this.setData({ logged: !!account });
    },
    onHide() { this._request++; this.setData({ grades: [], shown: [], loaded: false, loading: false, updated: '', terms: ['全部学期'], termIndex: 0 }); },
    onUnload() { this._request++; },
    login() { wx.navigateTo({ url: '/pages/login/login' }); },
    async refresh() {
        if (this.data.loading)
            return;
        if (!identity()) {
            this.login();
            return;
        }
        const attempt = ++this._request;
        this.setData({ loading: true, error: '' });
        try {
            const grades = await queryGrades();
            if (attempt !== this._request)
                return;
            const terms = ['全部学期', ...Array.from(new Set(grades.map(grade => grade.term))).sort().reverse()];
            this.setData({ grades, terms, termIndex: 0, loaded: true, updated: new Date().toLocaleTimeString() });
            this.filter();
        }
        catch (error) {
            if (attempt === this._request)
                this.setData({ error: error instanceof Error ? error.message : '成绩查询失败' });
        }
        finally {
            if (attempt === this._request)
                this.setData({ loading: false });
        }
    },
    chooseTerm(event: WechatMiniprogram.PickerChange) { this.setData({ termIndex: Number(event.detail.value) }); this.filter(); },
    search(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }); this.filter(); },
    filter() {
        const term = this.data.terms[this.data.termIndex], keyword = this.data.keyword.trim().toLowerCase();
        this.setData({ shown: this.data.grades.filter(grade => (!this.data.termIndex || grade.term === term) && (!keyword || (grade.name + ' ' + grade.code).toLowerCase().includes(keyword))) });
    },
});
