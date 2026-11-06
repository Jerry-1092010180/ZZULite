// First render depends only on local storage, never auth restoration or network.
import { campusDate, todayCache, coursesOn, coversDate, nextDayDelay, syncLabel } from '../../services/schedule-cache';
import type { Session } from '../../services/schedule';
Page({
    demo() { wx.navigateTo({ url: '/pages/demo/demo' }); },
    data: { date: '', courses: [] as Session[], hasCache: false, hasToday: false, updated: '', cacheHint: '', emptyMessage: '正在读取本机课表' },
    _midnightTimer: 0,
    onLoad() { this.renderToday(); },
    onShow() { this.renderToday(); this.scheduleMidnight(); },
    onHide() { clearTimeout(this._midnightTimer); },
    onUnload() { clearTimeout(this._midnightTimer); },
    renderToday() {
        const date = campusDate(), cache = todayCache(date);
        const hasToday = !!cache && coversDate(cache, date);
        this.setData({
            date, hasCache: !!cache, hasToday,
            courses: cache && hasToday ? coursesOn(cache, date) : [],
            updated: cache ? syncLabel(cache.updated) : '',
            cacheHint: cache ? '本机课表 · 无需联网查看' : '',
            emptyMessage: !cache ? '还没有本机课表，请在有网络时同步一次' : !hasToday ? '本机尚未缓存今天所属学期的课表，请联网同步当前学期' : '今天没有已缓存的课程安排',
        });
    },
    scheduleMidnight() {
        clearTimeout(this._midnightTimer);
        this._midnightTimer = setTimeout(() => { this.renderToday(); this.scheduleMidnight(); }, nextDayDelay());
    },
    grades() { wx.navigateTo({ url: '/pages/grades/grades' }); },
    schedule() { wx.switchTab({ url: '/pages/schedule/schedule' }); },
});
