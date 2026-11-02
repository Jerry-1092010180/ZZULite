// Run: node tests/run.cjs [path-to-typescript.js]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require((process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null) || 'typescript');
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
async function run(){
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
  invalidQuantity=true;
  await assert.rejects(()=>energy.queryMeter('lighting',{room:'99-16--31-102',name:'另一个房间'}));
  assert.equal(energy.readEnergy().meters.lighting.name,'照明101');assert.equal(energy.readEnergy().samples.length,2);
  // A late response after logout must never restore another account's local data.
  const late=energy.queryMeter('ac');auth.logout();await assert.rejects(()=>late);assert.equal(energy.readEnergy(),null);
  await auth.beginLogin('20260001','测试密码123!');h.wx.request=schoolRequest;
  const campus=h.load('services/campus.ts');
  assert.equal(campus.parseBalance([{amount:0},{amount:'35.27'}]),35.27);
  assert.equal(campus.parseBalance([{amount:'12'}]),12);
  assert.throws(()=>campus.parseBalance([{amount:null},{amount:''}]));
  assert.throws(()=>campus.parseBalance([{amount:'NaN'}]));
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
  return 'PASS: electricity redirect ticket, token coalescing, dynamic location, zero/invalid readings, concurrent meter persistence, local deduplication and logout race; offline instant home with hanging auth/no network, midnight/date-only/week matching, history and account isolation, corrupt storage and failed sync preservation; encrypted session restart/expiry/logout/401/unsupported storage, school course times, explicit makeup/retake markers,  RSA round-trip, MFA state, SMS retry, cancellation, no credential persistence, course normalization, date-only makeup classes, logout, RNG failure, balance selection/invalid amounts, room query contract, clock formatting, no forbidden UA, grade endpoint/header, zero/unpublished/text grades, envelope errors, incomplete pagination';
}
module.exports=run();

if (require.main === module) module.exports.then(console.log).catch(error => { console.error(error); process.exitCode = 1; });
