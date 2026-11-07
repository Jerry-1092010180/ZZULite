// Run: node tests/run.cjs [path-to-typescript.js]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const explicitTs = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null) || process.env.ZZULITE_TYPESCRIPT_PATH;
let ts;
for (const candidate of explicitTs ? [explicitTs] : ['typescript', '/Applications/wechatwebdevtools.app/Contents/Resources/vsextensions/node_modules/typescript/lib/typescript.js']) {
  try { ts = require(candidate); break; } catch (error) { if (explicitTs || error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!ts) throw new Error('TypeScript not found. Set ZZULITE_TYPESCRIPT_PATH or run node tests/run.cjs /path/to/typescript.js.');
const root = path.resolve(__dirname, '..');
const pair = crypto.generateKeyPairSync('rsa', {modulusLength:2048});
const pem = pair.publicKey.export({type:'spki',format:'pem'});
function decrypt(cipher) {
  const padded = crypto.privateDecrypt({key:pair.privateKey,padding:crypto.constants.RSA_NO_PADDING},Buffer.from(cipher.replace('__RSA__',''),'base64'));
  assert.equal(padded[0],0); assert.equal(padded[1],2);
  const separator = padded.indexOf(0,2); assert.ok(separator>=10);
  return padded.subarray(separator+1).toString('utf8');
}
function harness(mfa=false) {
  const memory={};const secure={};const requests=[];const cache={};const pages=[];let mode=mfa;
  const token='header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
  const wx={getSystemInfoSync:()=>({SDKVersion:'3.17.6'}),
    getStorage:o=>{assert.equal(o.encrypt,true);queueMicrotask(()=>secure[o.key]?o.success({data:secure[o.key]}):o.fail({}));},
    setStorage:o=>{assert.equal(o.encrypt,true);secure[o.key]=JSON.parse(JSON.stringify(o.data));queueMicrotask(()=>o.success({}));},
    getStorageSync:k=>memory[k],setStorageSync:(k,v)=>memory[k]=v,removeStorageSync:k=>{delete memory[k];delete secure[k]},base64ToArrayBuffer:s=>Uint8Array.from(Buffer.from(s,'base64')).buffer,
    getRandomValues:o=>{const bytes=crypto.randomBytes(o.length);o.success({randomValues:Uint8Array.from(bytes).buffer})},
    request:o=>{requests.push(o);const url=new URL(o.url);let data;
      if(url.pathname.endsWith('/publicKey'))data=pem;
      else if(url.pathname.endsWith('/detect')){assert.equal(decrypt(url.searchParams.get('username')),'20260001');assert.equal(decrypt(url.searchParams.get('password')),'测试密码123!');data={code:0,data:{state:'server-state',need:mode,mfaTypeSecurePhone:true}}}
      else if(url.pathname.includes('initByType'))data={code:0,data:{gid:'challenge-id',attestServerUrl:'https://cas.s.zzu.edu.cn/attest/api/guard'}};
      else if(url.pathname.endsWith('/send'))data={code:0};
      else if(url.pathname.endsWith('/valid'))data={code:0,data:{status:o.data.code==='123456'?2:1}};
      else if(url.pathname.endsWith('/passwordLogin')){assert.equal(url.searchParams.get('mfaState'),'server-state');assert.equal(decrypt(url.searchParams.get('password')),'测试密码123!');data={code:0,data:{idToken:token,refreshToken:'unused'}}}
      else if(url.pathname.endsWith('/grade/student/grades')) { assert.equal(o.header.Authorization,token); data={result:0,data:[{courseName:'测试课程',semester:{nameZh:'2025-2026-1'},finalGrade:0,credits:2,gp:null,passed:false}]}; }
      else throw new Error('Unexpected request');
      queueMicrotask(()=>o.success({statusCode:200,data}));
    }};
  function load(filename){filename=path.resolve(filename);if(cache[filename])return cache[filename].exports;const module={exports:{}};cache[filename]=module;let code=fs.readFileSync(filename,'utf8');if(filename.endsWith('.ts'))code=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const localRequire=s=>s.startsWith('.')?load(path.resolve(path.dirname(filename),s.endsWith('.js')?s:s+'.ts')):require(s);vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{wx,Page:page=>pages.push(page),Uint8Array,Uint32Array,ArrayBuffer,console,setTimeout,clearTimeout,Date,Promise})(localRequire,module,module.exports);return module.exports}
  return {load:p=>load(path.join(root,'miniprogram',p)),reloadAuth:()=>{delete cache[path.join(root,'miniprogram/services/auth.ts')];return load(path.join(root,'miniprogram/services/auth.ts'));},memory,secure,requests,wx,pages};
}
async function verifyOfficialGuide(){
  const h=harness();h.load('pages/campus/campus.ts');
  const page=h.pages[0],view={...page,data:JSON.parse(JSON.stringify(page.data)),setData(v){Object.assign(this.data,v)}};
  h.wx.request=()=>{throw new Error('Guide must not request a school service')};
  h.wx.setClipboardData=o=>{assert.equal(o.data,'https://ecard.v.zzu.edu.cn/');o.success({});};
  view.copyRechargeLink();assert.ok(view.data.rechargeHint.includes('已复制'));
  h.wx.setClipboardData=o=>o.fail({});view.copyRechargeLink();assert.ok(view.data.rechargeHint.includes('长按'));
  assert.equal(h.requests.length,0);
  h.load('pages/more/more.ts');const more=h.pages[1];
  const mv={...more,data:JSON.parse(JSON.stringify(more.data)),setData(v){Object.assign(this.data,v)}};
  for(const version of ['develop','trial','release']){h.wx.getAccountInfoSync=()=>({miniProgram:{envVersion:version}});await mv.onShow();assert.equal(mv.data.showDiagnostics,version==='develop');}
  h.wx.getAccountInfoSync=()=>{throw new Error('Unsupported')};await mv.onShow();assert.equal(mv.data.showDiagnostics,false);
}
async function verifyOfficialEntry(){
  const h=harness(),auth=h.load('services/auth.ts');
  await auth.beginLogin('20260001','测试密码123!');
  const energy=h.load('services/electricity.ts');
  const target='https://ecard.v.zzu.edu.cn/?singleAppId=recharge&accessToken=ecard-session-fixture#/pages_home/home';
  let calls=0,deliver;
  h.wx.request=o=>{
    calls++;
    const url=new URL(o.url);
    assert.equal(url.origin,'https://ecard.v.zzu.edu.cn');
    let response;
    if(url.pathname==='/server/auth/host/open') {
      assert.equal(url.searchParams.get('token'),auth.token());
      response={statusCode:302,header:{Location:'https://ecard.v.zzu.edu.cn/?tid=one-use-fixture'},data:''};
    } else if(url.pathname==='/server/auth/getToken') {
      assert.equal(o.data.tid,'one-use-fixture');
      response={statusCode:200,data:{success:true,resultData:{accessToken:'ecard-session-fixture'}}};
    } else {
      assert.equal(url.pathname,'/server/recharge/config');
      assert.equal(o.header.Authorization,'ecard-session-fixture');
      response={statusCode:200,data:{success:true}};
    }
    queueMicrotask(()=>o.success(response)); return {};
  };
  assert.equal(await energy.officialCardEntry(),target);
  assert.equal(calls,3);
  assert.ok(!target.includes(auth.token()));
  for(const store of [h.memory,h.secure]) {
    assert.ok(!JSON.stringify(store).includes('one-use-fixture'));
    assert.ok(!JSON.stringify(store).includes('ecard-session-fixture'));
  }
  assert.equal(h.memory['zzu.cardOrder.pending'],undefined);
  h.load('pages/campus/campus.ts');
  const page=h.pages[0],view={...page,data:JSON.parse(JSON.stringify(page.data)),setData(v){Object.assign(this.data,v)}};
  h.wx.setClipboardData=o=>{assert.equal(o.data,target);o.success({});};
  await view.prepareOfficialRecharge();
  assert.ok(view.data.rechargeHint.includes('已复制学校充值入口'));
  assert.equal(view.data.openingRecharge,false);
  assert.ok(!JSON.stringify(view.data).includes('ecard-session-fixture'));
  h.wx.setClipboardData=o=>o.fail({});
  await view.prepareOfficialRecharge();
  assert.ok(view.data.rechargeHint.includes('复制失败'));
  h.memory[energy.ENERGY_KEY]={account:'20260001',meters:{ac:{room:'01-02--03-04',name:'测试楼 / 空调 / 04'}},samples:[]};
  h.load('pages/electricity/electricity.ts');
  const electricPage=h.pages[1],electricView={...electricPage,_visible:true,data:{...electricPage.data},setData(v){Object.assign(this.data,v)}};
  h.wx.showModal=o=>{if(o.showCancel!==false){assert.match(o.content,/测试楼 \/ 空调 \/ 04/);o.success({confirm:true});}};
  h.wx.setClipboardData=o=>{assert.equal(o.data,target.replace('singleAppId=recharge','singleAppId=electric'));o.success({});};
  await electricView.prepareElectricityPayment({currentTarget:{dataset:{kind:'ac'}}});
  assert.match(electricView.data.paymentHint,/已复制学校缴电费入口/);
  assert.doesNotMatch(JSON.stringify(electricView.data),/ecard-session-fixture/);
  h.wx.request=o=>{deliver=()=>o.success({statusCode:200,data:{success:true}});return {};};
  const inFlight=energy.officialCardEntry();await Promise.resolve();auth.logout();deliver();
  await assert.rejects(()=>inFlight,/账号已变化/);
}
async function verifyRechargePreparation(){
  const h=harness();const auth=h.load('services/auth.ts');await auth.beginLogin('20260001','测试密码123!');
  h.load('services/campus.ts').cardBalance=async()=>12.34;
  const recharge=h.load('services/card-recharge.ts');recharge.queryRechargeCapabilities=async()=>({balance:12.34,amounts:['10','50'],channels:[{name:'微信支付',tradeType:'JSAPI'}],wapEnabled:false});
  h.load('pages/recharge-test/recharge-test.ts');const page=h.pages[0],view={...page,data:JSON.parse(JSON.stringify(page.data)),setData(v){Object.assign(this.data,v)}};
  h.wx.request=()=>{throw new Error('Preparation page must not create an order')};
  await view.check();assert.equal(view.data.balance,'12.34');assert.equal(view.data.account,'0001');assert.equal(view.data.checked,true);assert.ok(view.data.channels.includes('JSAPI'));
  recharge.queryRechargeCapabilities=async()=>{throw new Error('service unavailable')};await view.check();assert.equal(view.data.checked,false);assert.equal(view.data.balance,'');assert.ok(view.data.error);
  view.onHide();assert.equal(view.data.error,'');assert.equal(view.data.account,'');
  auth.logout();await view.check();assert.ok(view.data.error.includes('登录'));assert.equal(view.data.checked,false);
}
async function verifyPreparedOrderAdapter(){
  const cases=[
    {amount:10},
    {amount:5.25},
    {amount:10,fail:true},
    {amount:88,rejection:'充值金额超过上限',expected:/充值金额超过学校限额/},
    {amount:55,rejection:'提交失败，请稍后再试',expected:/具体原因未明确/},
    {amount:55,rejection:'请求过于频繁，请稍后再试',expected:/频率或次数受限/},
  ];
  for(const {amount,fail,rejection,expected} of cases){
    const h=harness();await h.load('services/auth.ts').beginLogin('20260001','测试密码123!');
    h.load('services/electricity.ts').ecardToken=async()=>'test-card-token';
    const config={amounts:['10','20'],wapEnabled:true,webPayCode:'07'};
    h.load('services/card-recharge.ts').queryRechargeCapabilities=async()=>config;
    const service=h.load('services/card-order.ts');
    for(const invalid of [4.99,5.001,1000.01,NaN])assert.throws(()=>service.validateOrderAmount(invalid,config));
    service.validateOrderAmount(5,config);
    assert.throws(()=>service.parseSchoolOrder({},10));
    let orders=0;
    h.wx.request=o=>{
      assert.equal(o.header.Authorization,'test-card-token');
      if(o.url.endsWith('/consume/transaction')){queueMicrotask(()=>o.success({statusCode:200,data:{success:true,resultData:'test-transaction'}}));return;}
      assert.ok(o.url.endsWith('/recharge/pay'));orders++;
      assert.equal(o.header.transactionId,'test-transaction');assert.equal(o.data.amt,String(amount));assert.equal(o.data.payCode,'07');
      if(fail){queueMicrotask(()=>o.fail({errMsg:'timeout'}));return;}
      if(rejection){queueMicrotask(()=>o.success({statusCode:200,data:{success:false,resultData:{code:-12,message:rejection+' PRIVATE-FIXTURE'}}}));return;}
      queueMicrotask(()=>o.success({statusCode:200,data:{success:true,resultData:{partnerJourno:'123456789012345',wapPayInfo:{callAccountid:'fixture',orderInfo:{partnerid:'fixture',journo:'fixture-order',merchantno:'fixture',channelno:'fixture',payResultUrl:'https://ecard.v.zzu.edu.cn/',goodsname:'fixture',txamt:String(Math.round(amount*100)),openid:'fixture'},extend:{accessToken:'temporary-fixture'}}}}}));
    };
    if(rejection){
      await assert.rejects(()=>service.createSchoolOrder(amount),expected);
      const diagnosis=await service.schoolOrderRouteDiagnostics();
      assert.ok(diagnosis.includes('提交金额：'+amount+' 元'));
      assert.match(diagnosis,expected);
      assert.match(diagnosis,/学校响应码 -12/);
      assert.doesNotMatch(diagnosis,/PRIVATE-FIXTURE/);
      assert.equal(service.pendingSchoolOrder(),null);
    }
    else if(fail)await assert.rejects(()=>service.createSchoolOrder(amount));
    else {
      const order=await service.createSchoolOrder(amount);assert.equal(order.reference,'123456789012345');assert.equal(order.amountYuan,amount);assert.equal(JSON.parse(new URL(order.checkoutUrl).searchParams.get('orderInfo')).journo,'fixture-order');assert.ok(order.checkoutUrl.startsWith('https://payment.v.zzu.edu.cn/'));assert.equal(service.pendingSchoolOrder().reference,'123456789012345');assert.equal(h.memory['zzu.cardOrder.pending'].reference,'123456789012345');
      assert.ok(h.secure['zzu.cardOrder.checkout.v1'].checkoutUrl.includes('temporary-fixture'));
      const info=JSON.parse(new URL(order.checkoutUrl).searchParams.get('orderInfo'));
      const variant={partnerJourno:'123456789012345',wapPayInfo:{orderInfo:{...info,merchantno:123,channelno:7,txamt:1000},extend:info.extend}};
      assert.throws(()=>service.parseSchoolOrder(variant,5.25),/金额不一致/);
      const parsedVariant=service.parseSchoolOrder(variant,10);assert.equal(new URL(parsedVariant.checkoutUrl).searchParams.get('callAccountid'),'');assert.equal(JSON.parse(new URL(parsedVariant.checkoutUrl).searchParams.get('orderInfo')).txamt,1000);
      variant.wapPayInfo.orderInfo.merchantno=true;assert.throws(()=>service.parseSchoolOrder(variant,10),/merchantno/);
      const restart=harness();Object.assign(restart.memory,h.memory);Object.assign(restart.secure,h.secure);await restart.load('services/auth.ts').ready();
      assert.equal((await restart.load('services/card-order.ts').restoreSchoolOrder()).reference,order.reference);
    }
    await assert.rejects(()=>service.createSchoolOrder(10));assert.equal(orders,1);
    assert.ok(!JSON.stringify(h.memory).includes('temporary-fixture'));assert.ok(h.memory['zzu.cardOrder.pending']);
  }
}
async function verifyOrderPageConfirmation(){
  const h=harness();await h.load('services/auth.ts').beginLogin('20260001','测试密码123!');
  h.load('services/campus.ts').cardBalance=async()=>12.34;
  h.load('services/card-recharge.ts').queryRechargeCapabilities=async()=>({balance:12.34,amounts:['10','20'],channels:[],wapEnabled:true,webPayCode:'07'});
  const orders=h.load('services/card-order.ts');let creates=0;
  orders.createSchoolOrder=async amount=>{creates++;assert.equal(amount,10);return {amountYuan:10,reference:'fixture',checkoutUrl:'https://payment.v.zzu.edu.cn/fixture'};};
  h.load('pages/recharge-test/recharge-test.ts');const p=h.pages[0],v={...p,data:JSON.parse(JSON.stringify(p.data)),setData(x){Object.assign(this.data,x)}};
  await v.check();h.wx.getAccountInfoSync=()=>({miniProgram:{envVersion:'release'}});await v.create();assert.equal(creates,0);
  h.wx.getAccountInfoSync=()=>({miniProgram:{envVersion:'develop'}});
  h.wx.showModal=o=>{assert.ok(o.content.includes('0001'));assert.ok(o.content.includes('10'));o.success({confirm:false});};await v.create();assert.equal(creates,0);
  h.wx.showModal=o=>o.success({confirm:true});await v.create();assert.equal(creates,1);assert.equal(v.data.reference,'fixture');assert.ok(v.data.orderMessage.includes('未确认'));
  const restarted=harness();restarted.memory['zzu.cardOrder.pending']={account:'20260001',amountYuan:10,state:'unresolved',at:Date.now()};assert.equal(restarted.load('services/card-order.ts').hasUnresolvedSchoolOrder(),true);
}
async function verifySchoolOrderQuery(){
  const h=harness();const auth=h.load('services/auth.ts');await auth.beginLogin('20260001','测试密码123!');
  h.load('services/electricity.ts').ecardToken=async()=>'fixture-token';
  h.load('services/card-recharge.ts').queryRechargeCapabilities=async()=>({webPayCode:'07'});
  const query=h.load('services/card-order-status.ts');
  assert.equal(query.parseOrderStatus({success:true,code:'1'}).code,'1');assert.ok(query.parseOrderStatus({success:true,code:0}).description.includes('尚未确认'));assert.ok(query.parseOrderStatus({success:true,code:'-1'}).description.includes('异常'));
  for(const value of [null,{success:false,code:1},{success:true,code:true},{success:true,code:'SUCCESS'}])assert.throws(()=>query.parseOrderStatus(value));
  let calls=0;h.wx.request=o=>{calls++;assert.ok(o.url.endsWith('/recharge/orderStatus'));assert.equal(o.method,'POST');assert.equal(o.data.partnerJourno,'123456789012345');assert.equal(o.data.payCode,'07');assert.equal(o.header.Authorization,'fixture-token');queueMicrotask(()=>o.success({statusCode:200,data:{success:true,code:'1'}}));};
  await assert.rejects(()=>query.querySchoolOrder('https://invalid/?token=fixture'));assert.equal(calls,0);
  assert.equal((await query.querySchoolOrder('123456789012345')).code,'1');assert.equal(calls,1);
  auth.logout();await assert.rejects(()=>query.querySchoolOrder('123456789012345'));assert.equal(calls,1);
}
async function verifyOrderQueryRecovery(){
  const h=harness();await h.load('services/auth.ts').beginLogin('20260001','测试密码123!');
  const ref='123456789012345';h.memory['zzu.cardOrder.pending']={account:'20260001',amountYuan:10,at:123,state:'unresolved',reference:ref,payCode:'07'};
  const status=h.load('services/card-order-status.ts');
  h.wx.request=()=>{throw new Error('Recovery test must never create an order')};
  h.load('pages/recharge-test/recharge-test.ts');const p=h.pages[0],v={...p,data:JSON.parse(JSON.stringify(p.data)),setData(x){Object.assign(this.data,x)}};
  v.onShow();assert.equal(v.data.queryReference,ref);assert.equal(v.data.locked,true);
  let finish;status.querySchoolOrder=async(r,code)=>{assert.equal(r,ref);assert.equal(code,'07');return new Promise(resolve=>finish=resolve)};
  const running=v.queryOrder();await new Promise(resolve=>setImmediate(resolve));assert.equal(v.data.statusBusy,true);assert.ok(v.data.statusMessage.includes('35'));
  const attempt=v._attempt;await v.check();assert.equal(v._attempt,attempt);assert.equal(v.data.statusBusy,true);
  finish({code:'0',description:'pending'});await running;assert.equal(v.data.statusBusy,false);assert.equal(v.data.locked,true);
  status.querySchoolOrder=async()=>({code:'1',description:'success'});
  v.data.queryReference='999999999999999';await v.queryOrder();assert.equal(h.memory['zzu.cardOrder.pending'].state,'unresolved');
  v.data.queryReference=ref;await v.queryOrder();assert.equal(h.memory['zzu.cardOrder.pending'].state,'resolved');assert.equal(v.data.locked,false);
  h.memory['zzu.cardOrder.pending']={account:'20260001',amountYuan:10,at:124,state:'unresolved'};v.onShow();await v.queryOrder();assert.ok(v.data.statusMessage.includes('流水号'));assert.equal(v.data.statusBusy,false);
  h.memory['zzu.cardOrder.pending'].account='another-account';v.onShow();assert.equal(v.data.queryReference,'');assert.equal(v.data.localHint,'');
}
async function verifyCheckoutReturn(){
  const h=harness(), auth=h.load('services/auth.ts');await auth.beginLogin('20260001','测试密码123!');
  const ref='123456789012345';
  h.memory['zzu.cardOrder.pending']={account:'20260001',amountYuan:10,at:123,state:'unresolved',reference:ref};
  const orders=h.load('services/card-order.ts');let queries=0;
  const checkoutUrl='https://payment.v.zzu.edu.cn/WapCashDesk/e-pay/payways.html?orderInfo=fixture';
  const order={reference:ref,checkoutUrl,amountYuan:10};
  orders.pendingSchoolOrder=()=>order;
  orders.queryAndReconcileSchoolOrder=async reference=>{queries++;assert.equal(reference,ref);return {code:'0',description:'学校支付中，尚未确认',resolvedLocal:false};};
  h.wx.request=()=>{throw new Error('Copying or returning must never submit an order')};
  h.load('pages/recharge-test/recharge-test.ts');const p=h.pages[0],v={...p,data:JSON.parse(JSON.stringify(p.data)),setData(x){Object.assign(this.data,x)}};
  h.load('pages/recharge-cashier/recharge-cashier.ts');
  const cashier={...h.pages[1],data:{...h.pages[1].data},setData(x){Object.assign(this.data,x)}};
  let navigation;
  h.wx.navigateTo=o=>{navigation=o;o.complete();};
  v.onShow();assert.equal(v.data.canPreviewCheckout,true);
  v.openCheckout();assert.equal(navigation.url,'/pages/recharge-cashier/recharge-cashier');
  cashier.onLoad();assert.equal(cashier.data.url,checkoutUrl);
  cashier.onCashierError();assert.equal(cashier.data.url,'');assert.equal(cashier.data.canCopy,true);
  for (const invalidUrl of [checkoutUrl.replace('payways.html','wechat.html'),checkoutUrl.replace('.edu.cn/','.edu.cn.example/'),checkoutUrl.replace('https:','http:')]) {
    order.checkoutUrl=invalidUrl;
    cashier.onLoad();assert.equal(cashier.data.url,'');
  }
  order.checkoutUrl=checkoutUrl.replace('fixture',encodeURIComponent(JSON.stringify({partnerid:'PT000008',merchantno:'20180600021',channelno:'103'})));
  cashier.onLoad();assert.equal(cashier.data.url,'');assert.deepEqual(Array.from(cashier.data.methods),['微信支付','支付宝']);
  order.checkoutUrl=checkoutUrl;
  let copied=0;
  h.wx.setClipboardData=o=>{copied++;assert.equal(o.data,checkoutUrl);o.success({});};
  h.wx.showModal=o=>o.success({confirm:false});
  await v.copyCheckout();assert.equal(copied,0);
  let copiedGuide;
  h.wx.showModal=o=>{if(o.showCancel===false)copiedGuide=o.content;else o.success({confirm:true});};
  await v.copyCheckout();await v.onShow();assert.equal(copied,1);assert.equal(queries,0);assert.ok(v.data.orderMessage.includes('Safari'));
  assert.ok(copiedGuide.includes('浏览器地址栏') && copiedGuide.includes('付款方式'));
  v.onHide();await v.onShow();assert.equal(queries,1);assert.ok(v.data.statusMessage.includes('尚未确认'));assert.equal(v.data.locked,true);
  v.onHide();await v.onShow();assert.equal(queries,1);
  copiedGuide=undefined;
  h.wx.setClipboardData=o=>o.fail({});await v.copyCheckout();assert.equal(copiedGuide,undefined);v.onHide();await v.onShow();assert.equal(queries,1);
  h.wx.setClipboardData=o=>o.success({});await v.copyCheckout();v.onHide();auth.logout();await v.onShow();assert.equal(queries,1);assert.equal(v.data.reference,'');
}
async function verifyCashierLookupForExistingOrder(){
  const h=harness(),auth=h.load('services/auth.ts');await auth.beginLogin('20260001','测试密码123!');
  const reference='123456789012345',journo='999999999999999',at=Date.now()-3600000;
  const marker={account:'20260001',amountYuan:6,at,state:'created',reference,payCode:'07'};
  h.memory['zzu.cardOrder.pending']=marker;
  const info={merchantno:'20180600021',journo,extend:{accessToken:'fixture-secret'}};
  h.secure['zzu.cardOrder.checkout.v1']={...marker,expiresAt:at+1800000,checkoutUrl:'https://payment.v.zzu.edu.cn/WapCashDesk/e-pay/payways.html?orderInfo='+encodeURIComponent(JSON.stringify(info))};
  h.load('services/card-order-status.ts').querySchoolOrder=async()=>({code:'-1',description:'学校返回查询异常'});
  let amount=500,lookups=0;
  h.wx.request=o=>{
    assert.equal(o.url,'https://payment.v.zzu.edu.cn/WapCashDesk/queryOrder');
    assert.deepEqual(JSON.parse(JSON.stringify(o.data)),{merchantno:'20180600021',orderno:journo,ordernotype:'1'});
    assert.equal(o.header.Authorization,undefined);
    lookups++;
    o.success({statusCode:200,data:{returncode:'SUCCESS',data:JSON.stringify({tradestate:'SUCCESS',txamt:amount,partnerjourno:journo})}});
  };
  const orders=h.load('services/card-order.ts');
  assert.doesNotMatch((await orders.queryAndReconcileSchoolOrder(reference)).description,/已支付/);
  amount=600;
  const paid=await orders.queryAndReconcileSchoolOrder(reference);
  assert.match(paid.description,/已支付/);
  assert.match(paid.description,/到账仍待核对/);
  assert.equal(paid.resolvedLocal,false);
  assert.equal(orders.hasUnresolvedSchoolOrder(),true);
  await orders.queryAndReconcileSchoolOrder('111111111111111');
  assert.equal(lookups,2);
}
async function verifyUnpaidRecovery(){
  const h=harness(),auth=h.load('services/auth.ts');await auth.beginLogin('20260001','测试密码123!');
  const ref='123456789012345', at=Date.now(), marker={account:'20260001',amountYuan:10,at,state:'created',reference:ref};
  h.memory['zzu.cardOrder.pending']={...marker};
  h.secure['zzu.cardOrder.checkout.v1']={...marker,expiresAt:at+1800000,checkoutUrl:'https://payment.v.zzu.edu.cn/WapCashDesk/e-pay/payways.html?orderInfo='+encodeURIComponent(JSON.stringify({channelno:'fixture',marker:'temporary-fixture'}))};
  h.wx.request=()=>{throw new Error('Recovery and archive must not create or pay an order')};
  const orders=h.load('services/card-order.ts');
  assert.equal(orders.pendingSchoolOrder(),null);
  assert.equal((await orders.restoreSchoolOrder()).reference,ref);assert.equal(orders.hasUnresolvedSchoolOrder(),true);
  assert.throws(()=>orders.archiveUnpaidSchoolOrder(marker,false));
  assert.throws(()=>orders.archiveUnpaidSchoolOrder({...marker,at:at-1},true));
  assert.equal(orders.hasUnresolvedSchoolOrder(),true);
  h.load('pages/recharge-test/recharge-test.ts');const p=h.pages[0],v={...p,data:JSON.parse(JSON.stringify(p.data)),setData(x){Object.assign(this.data,x)}};
  v.onShow();assert.equal(v.data.locked,true);assert.equal(v.data.checked,false);assert.equal(v.data.hasCheckout,true);
  h.wx.getAccountInfoSync=()=>({miniProgram:{envVersion:'develop'}});
  h.wx.showModal=o=>o.success({confirm:false});await v.archiveUnpaid();assert.equal(v.data.locked,true);
  h.load('services/card-recharge.ts').queryRechargeCapabilities=async()=>({balance:0,amounts:['10'],channels:[],wapEnabled:true,webPayCode:'07'});
  h.wx.showModal=o=>{assert.ok(o.confirmText.length<=4);o.success({confirm:true});};await v.archiveUnpaid();assert.equal(v.data.locked,false);assert.equal(v.data.checked,true);assert.equal(v.data.canOrder,true);assert.equal(v.data.hasCheckout,false);
  assert.equal(h.memory['zzu.cardOrder.pending'],undefined);assert.equal(h.memory['zzu.cardOrder.history'][0].reference,ref);
  assert.equal(orders.pendingSchoolOrder(),null);assert.equal(await orders.restoreSchoolOrder(),null);
  assert.ok(!JSON.stringify(h.memory).includes('temporary-fixture'));assert.equal(h.secure['zzu.cardOrder.checkout.v1'],undefined);
  assert.equal(orders.hasUnresolvedSchoolOrder(),false);
  const restarted=harness();Object.assign(restarted.memory,h.memory);Object.assign(restarted.secure,h.secure);await restarted.load('services/auth.ts').ready();
  assert.equal(restarted.load('services/card-order.ts').hasUnresolvedSchoolOrder(),false);
  // Acknowledged unpaid archive permits one explicit new attempt, then locks again.
  h.load('services/electricity.ts').ecardToken=async()=>'fixture-token';
  h.load('services/card-recharge.ts').queryRechargeCapabilities=async()=>({amounts:['10'],wapEnabled:true,webPayCode:'07'});
  let posts=0;
  h.wx.request=o=>{
    if(o.url.endsWith('/consume/transaction')) {queueMicrotask(()=>o.success({statusCode:200,data:{success:true,resultData:'fixture-transaction'}}));return;}
    assert.ok(o.url.endsWith('/recharge/pay'));posts++;queueMicrotask(()=>o.fail({errMsg:'timeout'}));
  };
  await assert.rejects(()=>orders.createSchoolOrder(10));assert.equal(posts,1);assert.equal(orders.hasUnresolvedSchoolOrder(),true);
  await assert.rejects(()=>orders.createSchoolOrder(10));assert.equal(posts,1);
  assert.equal(h.memory['zzu.cardOrder.history'][0].reference,ref);
  // Expired and other-account saved links must never be restored.
  const expired=harness();await expired.load('services/auth.ts').beginLogin('20260001','测试密码123!');expired.memory['zzu.cardOrder.pending']={...marker};
  expired.secure['zzu.cardOrder.checkout.v1']={...marker,expiresAt:at-1,checkoutUrl:'https://payment.v.zzu.edu.cn/WapCashDesk/e-pay/payways.html?orderInfo=fixture'};
  assert.equal(await expired.load('services/card-order.ts').restoreSchoolOrder(),null);
  expired.secure['zzu.cardOrder.checkout.v1'].expiresAt=at+1800000;expired.secure['zzu.cardOrder.checkout.v1'].account='another-account';
  assert.equal(await expired.load('services/card-order.ts').restoreSchoolOrder(),null);
}
async function verifyRawCheckoutRecovery(){
  for(const channel of [null,undefined]) {
    const h=harness();await h.load('services/auth.ts').beginLogin('20260001','测试密码123!');
    const ref='123456789012345',at=Date.now();
    h.memory['zzu.cardOrder.pending']={account:'20260001',amountYuan:10,at,state:'unresolved',reference:ref};
    const raw={partnerJourno:ref,wapPayInfo:{callPaywayid:'0201',callAccountid:'fixture-account',orderInfo:{partnerid:'fixture',journo:'999999999999999',merchantno:'fixture',channelno:channel,payResultUrl:'https://ecard.v.zzu.edu.cn/',goodsname:'fixture',txamt:1000,openid:'fixture'},extend:{accessToken:'temporary-fixture'}}};
    h.secure['zzu.cardOrder.checkout.v1']={account:'20260001',at,expiresAt:at+1800000,amountYuan:10,reference:ref,raw};
    h.wx.request=()=>{throw new Error('Raw-response recovery must not submit orders')};
    const service=h.load('services/card-order.ts');const diagnostic=await service.schoolOrderRouteDiagnostics();assert.ok(diagnostic.includes('wapPayInfo.callPaywayid'));assert.ok(!diagnostic.includes('temporary-fixture'));assert.ok(!diagnostic.includes(ref));const order=await service.restoreSchoolOrder();
    assert.equal(order.reference,ref);assert.equal(h.memory['zzu.cardOrder.pending'].state,'created');
    const payload=JSON.parse(new URL(order.checkoutUrl).searchParams.get('orderInfo'));
    if(channel===undefined)assert.equal(Object.hasOwn(payload,'channelno'),false);else assert.equal(payload.channelno,null);
    assert.ok(!JSON.stringify(h.memory).includes('temporary-fixture'));
    assert.equal(new URL(order.checkoutUrl).pathname,'/WapCashDesk/e-pay/wechat.html');
    assert.equal(new URL(order.checkoutUrl).searchParams.get('callPaywayid'),'0201');
    delete raw.wapPayInfo.callPaywayid;
    raw.wapPayInfo.projectPaywayList=[{paywayid:'0201',accountid:'single-fixture'}];
    assert.equal(new URL(service.parseSchoolOrder(raw,10).checkoutUrl).searchParams.get('callAccountid'),'single-fixture');
    raw.wapPayInfo.projectPaywayList.push({paywayid:'0204',accountid:'other-fixture'});
    const multiple=new URL(service.parseSchoolOrder(raw,10).checkoutUrl);assert.ok(multiple.pathname.endsWith('/payways.html'));assert.equal(JSON.parse(multiple.searchParams.get('projectPaywayList')).length,2);
    delete raw.wapPayInfo.projectPaywayList;assert.throws(()=>service.parseSchoolOrder(raw,10),/渠道编号/);
    raw.wapPayInfo.callPaywayid='0201';
    raw.wapPayInfo.orderInfo.channelno={unexpected:true};assert.throws(()=>service.parseSchoolOrder(raw,10),/channelno/);
    raw.wapPayInfo.callPaywayid='';raw.wapPayInfo.orderInfo.channelno=null;raw.payCode='07';const emptyDiagnostic=await service.schoolOrderRouteDiagnostics();assert.ok(emptyDiagnostic.includes('callPaywayid：空字符串'));assert.ok(emptyDiagnostic.includes('响应 payCode：07'));assert.ok(!emptyDiagnostic.includes('temporary-fixture'));
    raw.wapPayInfo.orderInfo.partnerid = 'PT000008';
    raw.wapPayInfo.orderInfo.merchantno = '20180600021';
    raw.wapPayInfo.orderInfo.channelno = channel;
    const recovered = new URL(service.parseSchoolOrder(raw, 10).checkoutUrl);
    const recoveredPayload = JSON.parse(recovered.searchParams.get('orderInfo'));
    assert.equal(recovered.pathname, '/WapCashDesk/e-pay/payways.html');
    assert.equal(recoveredPayload.channelno, '103');
    assert.equal(recoveredPayload.journo, '999999999999999');
    raw.wapPayInfo.orderInfo.channelno = '104';
    const explicit = new URL(service.parseSchoolOrder(raw, 10).checkoutUrl);
    assert.equal(JSON.parse(explicit.searchParams.get('orderInfo')).channelno, '104');
    raw.wapPayInfo.orderInfo.channelno = channel;
    raw.payCode = '08';
    assert.throws(() => service.parseSchoolOrder(raw, 10), /渠道编号/);
  }
}
async function run(){
  await verifyRawCheckoutRecovery();
  await verifyUnpaidRecovery();
  await verifyCheckoutReturn();
  await verifyCashierLookupForExistingOrder();
  await verifyOfficialGuide();
  await verifyOfficialEntry();
  await verifyOrderQueryRecovery();
  await verifySchoolOrderQuery();
  await verifyPreparedOrderAdapter();
  await verifyOrderPageConfirmation();
  await verifyRechargePreparation();
  const h=harness();let auth=h.load('services/auth.ts');
  assert.equal(await auth.beginLogin('20260001','测试密码123!'),'success');
  assert.equal(auth.identity(),'20260001');assert.ok(auth.token());
  assert.ok(!JSON.stringify(h.memory).includes('测试密码'));assert.ok(!JSON.stringify(h.memory).includes('signature'));
  assert.ok(h.secure['zzu.session.v1']);
  const restart=h.reloadAuth();await restart.ready();assert.equal(restart.identity(),'20260001');restart.logout();assert.equal(h.secure['zzu.session.v1'],undefined);
  auth=restart;await auth.beginLogin('20260001','测试密码123!');
  const energy=h.load('services/electricity.ts');
  assert.equal(energy.tidFromLocation('https://ecard.v.zzu.edu.cn/?tid=test%20ticket'),'test ticket');
  for(const location of ['https://evil.example/?tid=x','//evil.example/?tid=x','http://ecard.v.zzu.edu.cn/?tid=x'])assert.equal(energy.tidFromLocation(location),'');
  assert.equal(energy.canonicalLevel('subarea'),'subArea');assert.throws(()=>energy.canonicalLevel('unknown'));
  assert.equal(energy.roomBody('99-16--31-101').room,'99-16--31-101');assert.throws(()=>energy.roomBody('101'));
  assert.equal(energy.parseKwh({templateList:[{code:'quantity',value:'0'}]}),0);
  for(const value of [null,'',true,'NaN',Infinity])assert.throws(()=>energy.parseKwh({templateList:[{code:'quantity',value}]}));
  const cachedEnergy=harness();
  cachedEnergy.memory['zzu.electricity']={account:'20260001',meters:{lighting:{room:'99-16--31-101',name:'本机照明'}},samples:[null,{kind:'lighting',room:'99-16--31-101',kwh:12.5,at:Date.now()}]};
  cachedEnergy.wx.getStorage=()=>{};
  cachedEnergy.wx.request=()=>{throw new Error('Cached electricity must render without network')};
  cachedEnergy.load('pages/electricity/electricity.ts');
  const ep=cachedEnergy.pages[0],ev={...ep,data:JSON.parse(JSON.stringify(ep.data)),setData(v){Object.assign(this.data,v)}};
  ev.onShow();assert.equal(ev.data.meters[0].value,'12.50');assert.equal(ev.data.history.length,1);ev.onHide();
  let tickets=0,exchanges=0,invalidQuantity=false;
  const schoolRequest=h.wx.request;
  h.wx.request=o=>{
    if(!o.url.startsWith('https://ecard.v.zzu.edu.cn/'))return schoolRequest(o);
    let onHeaders=()=>{};
    const task={onHeadersReceived:f=>{onHeaders=f},abort:()=>o.fail({errMsg:'request:fail abort'})};
    queueMicrotask(()=>{
      if(o.url.includes('/auth/host/open')){assert.equal(o.redirect,'manual');tickets++;onHeaders({header:{Location:'https://ecard.v.zzu.edu.cn/?tid=test-ticket'}});return;}
      let data;
      if(o.url.endsWith('/auth/getToken')){exchanges++;assert.equal(o.data.tid,'test-ticket');data={success:true,resultData:{accessToken:'ecard-access'}};}
      else {assert.equal(o.header.Authorization,'ecard-access');assert.equal(o.data.utilityType,'electric');
        if(o.url.endsWith('/utilities/location'))data={success:true,resultData:{locationType:'area',nextLocationType:'building',end:false,locationList:[{id:'99',name:'主校区'}]}};
        else if(o.url.endsWith('/utilities/account'))data={success:true,resultData:{templateList:[{code:'quantity',value:invalidQuantity?'':o.data.room.includes('--32-')?'15.50':'0'}]}};
        else throw new Error('Unexpected ecard request');
      }
      o.success({statusCode:200,data,header:{}});
    });return task;
  };
  await Promise.all([energy.queryMeter('lighting',{room:'99-16--31-101',name:'照明101'}),energy.queryMeter('ac',{room:'99-16--32-101',name:'空调101'})]);
  assert.equal(tickets,1);assert.equal(exchanges,1);
  assert.equal(energy.readEnergy().samples.length,2);assert.equal(energy.readEnergy().meters.lighting.name,'照明101');assert.equal(energy.readEnergy().meters.ac.name,'空调101');
  await energy.queryMeter('lighting');assert.equal(energy.readEnergy().samples.length,2);
  const level=await energy.locations('area',{});assert.equal(level.locationList[0].id,'99');
  const recharge=h.load('services/card-recharge.ts');
  const parsedRecharge=recharge.parseRechargeConfig({amtGroupList:[{amt:10},{amt:'20'},{amt:0},{amt:'NaN'},null],daLianPayEnable:'true',wapPayEnable:true,daLianPayList:[{code:'02',name:'微信支付',tradeType:'JSAPI'},null],idSerial:'PRIVATE-CARD-ID',username:'PRIVATE-NAME'});
  assert.equal(parsedRecharge.amounts.join(','),'10,20');assert.equal(parsedRecharge.channels[0].name,'微信支付');assert.equal(parsedRecharge.channelSelectionEnabled,true);assert.ok(!JSON.stringify(parsedRecharge).includes('PRIVATE'));
  assert.equal(recharge.parseRechargeConfig({wapPayEnable:true,wapPaySdkJsUrl:'https://payment.v.zzu.edu.cn/WapCashDesk/public-sdk.js'}).sdkUrl,'https://payment.v.zzu.edu.cn/WapCashDesk/public-sdk.js');
  assert.equal(recharge.parseRechargeConfig({wapPayEnable:true,wapPaySdkJsUrl:'https://other.invalid/sdk.js?token=private'}).sdkUrl,undefined);
  assert.throws(()=>recharge.parseRechargeConfig({balance:20}));assert.throws(()=>recharge.parseRechargeConfig(null));
  const meterRequest=h.wx.request;let configReads=0;
  h.wx.request=o=>{if(o.url.endsWith('/recharge/config')){configReads++;assert.equal(o.method,'POST');assert.equal(o.header.Authorization,'ecard-access');queueMicrotask(()=>o.success({statusCode:200,data:{success:true,resultData:{balance:'0.00',wapPayEnable:true,amtGroupList:[{amt:50}]}}}));return;}assert.ok(!o.url.endsWith('/recharge/pay'));return meterRequest(o);};
  assert.equal((await recharge.queryRechargeCapabilities()).amounts[0],'50');assert.equal(configReads,1);assert.equal(await h.load('services/campus.ts').cardBalance(),0);assert.equal(configReads,2);h.wx.request=meterRequest;
  invalidQuantity=true;
  await assert.rejects(()=>energy.queryMeter('lighting',{room:'99-16--31-102',name:'另一个房间'}));
  assert.equal(energy.readEnergy().meters.lighting.name,'照明101');assert.equal(energy.readEnergy().samples.length,2);
  // A late response after logout must never restore another account's local data.
  const late=energy.queryMeter('ac');auth.logout();await assert.rejects(()=>late);assert.equal(energy.readEnergy(),null);
  await auth.beginLogin('20260001','测试密码123!');h.wx.request=schoolRequest;
  const campus=h.load('services/campus.ts');
  assert.equal(campus.parseBalance({balance:'0.00',amount:2}),0);
  assert.equal(campus.parseBalance({balance:'12.34'}),12.34);assert.equal(campus.parseBalance({balance:0.29}),0.29);assert.throws(()=>campus.parseBalance([{amount:0},{amount:2}]));
  assert.throws(()=>campus.parseBalance([{amount:null},{amount:''}]));
  for(const balance of [null,'',true,'NaN',Infinity,'2e2',1.234])assert.throws(()=>campus.parseBalance({balance}));
  const body=campus.roomQuery(5,'2026-11-02',1);
  assert.ok(!Object.prototype.hasOwnProperty.call(body,'campusAssoc'));
  assert.equal(body.buildingIds[0],5);
  assert.equal(campus.clock(800),'08:00');
  assert.equal(campus.clock(1265),'时间待定');
  assert.throws(()=>campus.roomQuery(0,'2026-11-02',1));
  assert.ok(h.requests.every(r=>!Object.keys(r.header||{}).some(k=>k.toLowerCase()==='user-agent')));
  const gradeService=h.load('services/grades.ts');
  const fetched=await gradeService.queryGrades();
  assert.equal(fetched[0].score,'0');assert.equal(fetched[0].gp,'—');assert.equal(fetched[0].status,'未通过');
  const grades=gradeService.parseGrades({result:0,data:{records:[{course:{nameZh:'课程甲',code:'A1'},semester:'2025-2026-2',score:'优秀',credit:3,gradePoint:4},{courseName:'课程乙',score:null,credits:0}]}});
  assert.equal(grades[0].term,'2025-2026-2');assert.equal(grades[0].score,'优秀');assert.equal(grades[1].score,'未发布');assert.equal(grades[1].credits,'0');assert.equal(grades[1].status,'');
  assert.throws(()=>gradeService.parseGrades({result:1,data:[]}));
  assert.throws(()=>gradeService.parseGrades({result:0,data:{unexpected:1}}));
  assert.throws(()=>gradeService.parseGrades({result:0,data:{records:[{courseName:'x'}],total:2}}));
  assert.deepEqual(Array.from(gradeService.parseGrades({result:0,data:[]})),[]);
  assert.equal(Object.keys(h.memory).some(k=>k.includes('grades')),false);
  const attemptTags=h.load('services/grade-attempt.ts').attemptTags;
  assert.equal(attemptTags({examType:{nameZh:'补考'}}).join(','),'补考');
  assert.equal(attemptTags({courseTakeType:{nameZh:'重修'},isMakeup:true}).join(','),'补考,重修');
  assert.equal(attemptTags({score:30,courseName:'课程甲',examType:2}).length,0);
  assert.equal(attemptTags({examTypeName:'非补考'}).length,0);
  const time=h.load('services/course-time.ts');
  assert.equal(time.clock(800),'08:00');assert.equal(time.clock('08:00:00'),'08:00');assert.equal(time.clock('2026-11-02T10:10:00+08:00'),'10:10');assert.equal(time.clock('2460'),'');
  assert.equal(time.courseTime({start:1,end:2},[{indexNo:1,startTime:800,endTime:845},{indexNo:2,startTime:855,endTime:940}]),'08:00–09:40');
  assert.equal(time.courseTime({start:1,end:2}),'08:00–09:40');
  assert.equal(time.courseTime({start:3,end:4}),'10:10–11:50');
  assert.equal(time.courseTime({start:5,end:6}),'14:00–15:40');
  assert.equal(time.courseTime({start:7,end:8}),'16:00–17:40');
  assert.equal(time.courseTime({start:9,end:10}),'19:00–20:40');
  assert.equal(time.courseTime({start:1,end:4}),'08:00–11:50');
  assert.equal(time.courseTime({start:2,end:2}),'时间待确认');
  assert.equal(time.courseTime({start:0,end:0}),'时间待确认');
  assert.equal(time.courseTime({start:1,end:2,startTime:'09:00',endTime:'10:40'}),'09:00–10:40');
  const schedule=h.load('services/schedule.ts');
  const rows=schedule.normalize([{course:{id:1,nameZh:'实验课程'},schedules:[{weekIndex:3,weekday:2,startUnit:2,endUnit:4,lessonType:'EXPERIMENT',room:{nameZh:'北2_104',building:{nameZh:'北2'}}},{weekIndex:0,weekday:0,startUnit:0,date:'2026-09-23T00:00:00+08:00'},{weekIndex:0,weekday:0,startUnit:0}]}]);
  assert.equal(rows.length,2);assert.equal(rows[0].place,'北2_104');assert.equal(rows[0].experiment,true);assert.equal(rows[1].date,'2026-09-23');
  assert.equal(schedule.forWeek({semester:{startDate:'2026-09-07'},sessions:rows},3).length,2);
  h.memory['zzu.schedule']={sessions:rows};auth.logout();assert.equal(auth.identity(),'');assert.equal(h.memory['zzu.schedule'],undefined);assert.throws(()=>auth.token());
  const m=harness(true);const ma=m.load('services/auth.ts');assert.equal(await ma.beginLogin('20260001','测试密码123!'),'sms');assert.equal(ma.identity(),'');await assert.rejects(()=>ma.submitSms('000000'));await ma.submitSms('123456');assert.equal(ma.identity(),'20260001');
  const c=harness();const ca=c.load('services/auth.ts');const pending=ca.beginLogin('20260001','测试密码123!');ca.cancelLogin();await assert.rejects(()=>pending);assert.equal(ca.identity(),'');
  const noRandom=harness();noRandom.wx.getRandomValues=o=>o.fail({});await assert.rejects(()=>noRandom.load('services/auth.ts').beginLogin('20260001','测试密码123!'));
  const unsupported=harness();unsupported.wx.getSystemInfoSync=()=>({SDKVersion:'2.20.0'});const ua=unsupported.load('services/auth.ts');await ua.beginLogin('20260001','测试密码123!');assert.equal(ua.identity(),'20260001');assert.equal(unsupported.secure['zzu.session.v1'],undefined);assert.ok(ua.sessionNotice());
  const expired=harness();expired.secure['zzu.session.v1']={account:'20260001',token:'h.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.s',expires:Date.now()+999999999};const ea=expired.load('services/auth.ts');await ea.ready();assert.equal(ea.identity(),'');assert.equal(expired.secure['zzu.session.v1'],undefined);
  const rejected=harness();const ra=rejected.load('services/auth.ts');await ra.beginLogin('20260001','测试密码123!');const network=rejected.load('services/network.ts');rejected.wx.request=o=>queueMicrotask(()=>o.success({statusCode:401}));await assert.rejects(()=>network.request('https://jwxt.zzu.edu.cn/test','GET',undefined,{Authorization:ra.token()}));assert.equal(ra.identity(),'');assert.equal(rejected.secure['zzu.session.v1'],undefined);
  const offline=harness();
  const local=offline.load('services/schedule-cache.ts');
  const day=local.campusDate();
  const localCache={account:'20260001',semester:{id:1,nameZh:'当前学期',startDate:'2026-09-07',endDate:'2027-01-20'},semesters:[],updated:Date.now(),sessions:[{id:'a',name:'本机课程',place:'教室',start:1,end:2,week:9,day:2,date:day,experiment:false}]};
  offline.memory['zzu.schedule']=localCache;
  // Simulate encrypted-session restoration that never calls back, plus a network that must not be used.
  offline.wx.getStorage=()=>{};
  offline.load('services/auth.ts').ready();
  offline.wx.request=()=>{throw new Error('Offline home must not access the network')};
  offline.load('pages/today/today.ts');
  const page=offline.pages[0];const view={...page,data:JSON.parse(JSON.stringify(page.data)),setData(value){Object.assign(this.data,value)}};
  try{view.onLoad();assert.equal(view.data.courses.length,1);assert.equal(view.data.courses[0].time,'08:00–09:40');assert.equal(view.data.hasToday,true);assert.equal(view.onShow(),undefined);assert.equal(offline.requests.length,0);}finally{view.onHide();}
  const boundary={...localCache,sessions:[{...localCache.sessions[0],date:'2026-11-02'},{...localCache.sessions[0],id:'b',name:'次日课程',date:'2026-11-03'},{...localCache.sessions[0],id:'c',name:'按周课程',date:'',week:9,day:2}]};
  assert.equal(local.campusDate(new Date('2026-11-02T15:59:59Z')),'2026-11-02');
  assert.equal(local.campusDate(new Date('2026-11-02T16:00:00Z')),'2026-11-03');
  assert.equal(local.coursesOn(boundary,'2026-11-02').length,1);
  assert.equal(local.coursesOn(boundary,'2026-11-03').length,2);
  assert.ok(local.nextDayDelay(new Date('2026-11-02T15:59:59Z'))<1100);
  offline.memory['zzu.schedule.active']=localCache;
  offline.memory['zzu.schedule']={...localCache,semester:{id:2,nameZh:'历史学期',startDate:'2020-01-01',endDate:'2020-06-01'},sessions:[]};
  assert.equal(local.todayCache(day).semester.id,1);
  offline.memory['zzu.schedule']={...offline.memory['zzu.schedule'],account:'another-account'};
  assert.notEqual(local.todayCache(day).account,'20260001');
  assert.equal(local.coversDate(boundary,'2028-01-01'),false);
  offline.wx.getStorageSync=()=>{throw new Error('Storage unavailable')};
  assert.equal(local.todayCache(day),null);
  view.renderToday();assert.equal(view.data.hasCache,false);assert.ok(view.data.emptyMessage.includes('同步一次'));
  const failed=harness();const fa=failed.load('services/auth.ts');await fa.beginLogin('20260001','测试密码123!');failed.memory['zzu.schedule']=localCache;failed.memory['zzu.schedule.active']=localCache;
  failed.wx.request=o=>queueMicrotask(()=>o.fail({errMsg:'request:fail timeout'}));
  await assert.rejects(()=>failed.load('services/schedule.ts').sync());assert.equal(failed.memory['zzu.schedule'],localCache);assert.equal(failed.memory['zzu.schedule.active'],localCache);
  const campusSource=fs.readFileSync(path.join(root,'miniprogram','pages','campus','campus.ts'),'utf8');
  const rechargeSource=fs.readFileSync(path.join(root,'miniprogram','services','card-recharge.ts'),'utf8');
  for(const text of [campusSource,rechargeSource]){
    assert.ok(!text.includes('wx.requestPayment'),'must never invoke a payment API');
    assert.ok(!text.includes('/recharge/pay'),'must never submit a recharge order');
    assert.ok(!/mch_?id|paySign|prepay_id|API.?v3/i.test(text),'must never embed merchant credentials');
  }
  assert.ok(campusSource.includes('https://ecard.v.zzu.edu.cn/'),'official school portal must be present');
  require('./public-demo.cjs')(ts);
  return 'PASS: prepared school-order adapter (mock only), configured amount validation, transaction header, timeout/no automatic duplicate submission, no credential persistence; read-only recharge config, channel parsing and personal field exclusion; electricity redirect ticket, token coalescing, dynamic location, zero/invalid readings, concurrent meter persistence, local deduplication and logout race; offline instant home with hanging auth/no network, midnight/date-only/week matching, history and account isolation, corrupt storage and failed sync preservation; encrypted session restart/expiry/logout/401/unsupported storage, school course times, explicit makeup/retake markers,  RSA round-trip, MFA state, SMS retry, cancellation, no credential persistence, course normalization, date-only makeup classes, logout, RNG failure, authoritative eCard balance, explicit zero, ambiguous portal array rejection/invalid amounts, room query contract, clock formatting, no forbidden UA, grade endpoint/header, zero/unpublished/text grades, envelope errors, incomplete pagination; existing official guide remains read-only';
}
module.exports=run();

if (require.main === module) module.exports.then(console.log).catch(error => { console.error(error); process.exitCode = 1; });
