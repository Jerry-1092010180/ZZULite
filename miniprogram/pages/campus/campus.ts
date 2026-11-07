import * as auth from '../../services/auth';
import * as campus from '../../services/campus';
import { isoDate } from '../../services/schedule';
import { officialCardEntry } from '../../services/electricity';
// Official school portal only. This page never creates an order, submits a payment or touches funds.
const RECHARGE_PORTAL = 'https://ecard.v.zzu.edu.cn/';
interface DisplayRoom {
    id: number;
    name: string;
    periods: {
        time: string;
        type: string;
    }[];
}
Page({
    data: { showRechargeTest: false, logged: false, balance: '', balanceError: '', loadingBalance: false, openingRecharge: false, updated: '', campuses: [] as campus.NamedItem[], buildings: [] as campus.NamedItem[], campusIndex: 0, buildingIndex: 0, date: isoDate(new Date()), rooms: [] as DisplayRoom[], loading: false, error: '', queried: false, more: false, rechargePortal: RECHARGE_PORTAL, rechargeHint: '' },
    _account: '', _page: 1, _request: 0, _balanceRequest: 0,
    async onShow() {
        await auth.ready();
        const account = auth.identity();
        if (account !== this._account) {
            this._account = account;
            this._request++;
            this._balanceRequest++;
            this.setData({ balance: '', updated: '', balanceError: '', campuses: [], buildings: [], rooms: [], queried: false, error: '', more: false, loading: false, loadingBalance: false, rechargeHint: '' });
        }
        let showRechargeTest = false;
        try { showRechargeTest = wx.getAccountInfoSync().miniProgram.envVersion === 'develop'; } catch (_) {}
        this.setData({ logged: !!account, showRechargeTest });
    },
    onUnload() { this._request++; this._balanceRequest++; },
    electricity() { wx.navigateTo({url:'/pages/electricity/electricity'}); },
    login() { wx.navigateTo({ url: '/pages/login/login' }); },
    rechargeTest() { wx.navigateTo({ url: '/pages/recharge-test/recharge-test' }); },
    async prepareOfficialRecharge() {
        if (this.data.openingRecharge) return;
        await auth.ready();
        const owner = auth.identity();
        if (!owner) { this.login(); return; }
        this.setData({ openingRecharge: true, rechargeHint: '' });
        try {
            const entry = await officialCardEntry();
            if (auth.identity() !== owner) return;
            await new Promise<void>((resolve, reject) => wx.setClipboardData({ data: entry, success: () => resolve(), fail: () => reject(new Error('复制失败，请重新获取入口')) }));
            if (auth.identity() !== owner) return;
            this.setData({ rechargeHint: '已复制学校充值入口，请立即退出小程序，在微信「文件传输助手」中粘贴发送给自己并打开。由学校网页选择金额与微信支付。链接包含本人一卡通登录会话，仅供本人使用，不要转发；网页载入后会移除地址中的会话参数。失效时重新获取；本次操作没有创建充值订单。' });
        } catch (error) {
            if (auth.identity() === owner) this.setData({ rechargeHint: error instanceof Error ? error.message : '获取学校入口失败，请稍后重试' });
        } finally { this.setData({ openingRecharge: false }); }
    },
    copyRechargeLink() {
        wx.setClipboardData({
            data: RECHARGE_PORTAL,
            success: () => this.setData({ rechargeHint: '已复制。退出小程序，在微信「文件传输助手」中粘贴并发送给自己，再点击链接打开学校入口。若提示登录或无法支付，请回到「豫见郑大 → 一卡通」办理；不要将登录或订单链接发给他人。' }),
            fail: () => this.setData({ rechargeHint: '复制失败，可长按上方地址手动复制' }),
        });
    },
    async balance() {
        if (this.data.loadingBalance)
            return;
        if (!auth.identity()) {
            this.login();
            return;
        }
        const attempt = ++this._balanceRequest;
        this.setData({ loadingBalance: true, balanceError: '', balance: '', updated: '' });
        try {
            const amount = await campus.cardBalance();
            if (attempt === this._balanceRequest)
                this.setData({ balance: amount.toFixed(2), updated: new Date().toLocaleTimeString() });
        }
        catch (error) {
            if (attempt === this._balanceRequest)
                this.setData({ balanceError: error instanceof Error ? error.message : '余额查询失败' });
        }
        finally {
            if (attempt === this._balanceRequest)
                this.setData({ loadingBalance: false });
        }
    },
    async loadCampuses() {
        if (this.data.loading)
            return;
        if (!auth.identity()) {
            this.login();
            return;
        }
        const attempt = ++this._request;
        this.setData({ loading: true, error: '', rooms: [], queried: false, more: false });
        try {
            const items = await campus.campuses();
            if (attempt !== this._request)
                return;
            this.setData({ campuses: items, campusIndex: 0, buildings: [], buildingIndex: 0 });
            if (items.length) {
                const list = await campus.buildings(items[0].id);
                if (attempt === this._request)
                    this.setData({ buildings: list });
            }
        }
        catch (error) {
            if (attempt === this._request)
                this.setData({ error: error instanceof Error ? error.message : '校区查询失败' });
        }
        finally {
            if (attempt === this._request)
                this.setData({ loading: false });
        }
    },
    async changeCampus(event: WechatMiniprogram.PickerChange) {
        const index = Number(event.detail.value), item = this.data.campuses[index];
        if (!item || this.data.loading)
            return;
        const attempt = ++this._request;
        this.setData({ campusIndex: index, buildingIndex: 0, buildings: [], rooms: [], queried: false, more: false, error: '', loading: true });
        try {
            const list = await campus.buildings(item.id);
            if (attempt === this._request)
                this.setData({ buildings: list });
        }
        catch (error) {
            if (attempt === this._request)
                this.setData({ error: error instanceof Error ? error.message : '楼栋查询失败' });
        }
        finally {
            if (attempt === this._request)
                this.setData({ loading: false });
        }
    },
    changeBuilding(event: WechatMiniprogram.PickerChange) { this.setData({ buildingIndex: Number(event.detail.value), rooms: [], queried: false, more: false }); },
    changeDate(event: WechatMiniprogram.PickerChange) { this.setData({ date: String(event.detail.value), rooms: [], queried: false, more: false }); },
    query() { this.fetchRooms(false); },
    next() {
        if (this.data.more)
            this.fetchRooms(true);
    },
    async fetchRooms(append: boolean) {
        if (this.data.loading)
            return;
        if (!auth.identity()) {
            this.login();
            return;
        }
        const building = this.data.buildings[this.data.buildingIndex];
        if (!building) {
            this.setData({ error: '请先加载校区并选择楼栋' });
            return;
        }
        const attempt = ++this._request, page = append ? this._page + 1 : 1;
        this.setData({ loading: true, error: '' });
        try {
            const result = await campus.rooms(building.id, this.data.date, page);
            if (attempt !== this._request)
                return;
            const items = result.data.map(room => ({ id: room.id, name: room.nameZh, periods: (room.roomOccupationInfoVms || []).map(period => ({ time: campus.clock(period.startTime) + '–' + campus.clock(period.endTime), type: ({ Lesson: '课程', Exam: '考试', RoomBorrow: '借用', ScheduleChange: '调课' } as Record<string, string>)[period.activityType || ''] || '占用' })) }));
            this._page = page;
            this.setData({ rooms: append ? this.data.rooms.concat(items) : items, queried: true, more: result._page_ ? page < result._page_.totalPages : items.length === 30 });
        }
        catch (error) {
            if (attempt === this._request)
                this.setData({ error: error instanceof Error ? error.message : '教室查询失败' });
        }
        finally {
            if (attempt === this._request)
                this.setData({ loading: false });
        }
    },
});
