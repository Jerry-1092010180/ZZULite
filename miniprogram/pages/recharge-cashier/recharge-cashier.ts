import { knownSchoolCashierMethods, pendingSchoolOrder, schoolCashierPreviewUrl } from '../../services/card-order';

Page({
    data: { url: '', message: '', methods: [] as string[], amount: '', canCopy: false },
    onLoad() {
        const order = pendingSchoolOrder();
        const url = schoolCashierPreviewUrl(order);
        const methods = order ? knownSchoolCashierMethods(order) : [];
        this.setData({
            url: methods.length ? '' : url,
            methods,
            amount: order ? order.amountYuan.toFixed(2) : '',
            canCopy: !!url,
            message: url ? '' : '当前订单没有可预览的收银台。请返回充值页核对订单。',
        });
    },
    onCashierError() {
        this.setData({
            url: '',
            message: '收银台网页暂时无法加载。可复制本单链接到手机浏览器继续付款。',
        });
    },
    copyCheckout() {
        const url = schoolCashierPreviewUrl(pendingSchoolOrder());
        if (!url) {
            this.setData({ canCopy: false, message: '本单付款链接已不可用，请返回充值页核对订单。' });
            return;
        }
        wx.setClipboardData({
            data: url,
            success: () => wx.showModal({
                title: '链接已复制',
                content: '请打开 Safari 或手机自带浏览器，在地址栏粘贴链接，再选择学校收银台提供的付款方式。付款后可返回充值页查单。',
                showCancel: false,
                confirmText: '知道了',
            }),
            fail: () => this.setData({ message: '复制失败，请重试。' }),
        });
    },
    back() {
        wx.navigateBack();
    },
});
