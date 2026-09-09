import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('./content.js',import.meta.url),'utf8');
const context = vm.createContext({Promise});
vm.runInContext(source.slice(source.indexOf('  const ROOT_ATTRIBUTE'),source.indexOf('  const review = new UIDeltaReview();')) + '\nglobalThis.Review = UIDeltaReview;',context);
function harness(status = 'draft') {
  const requests = [], notices = [];
  const issue = {id:'a',sessionId:'s',reviewStatus:status,description:'原描述'};
  const review = Object.assign(Object.create(context.Review.prototype), {
    composer:{mode:'edit',issue:{...issue},returnView:'inbox',captureStatus:'ready'},
    issues:[issue,{id:'b'}],session:{id:'s',status:'active',revision:1},captureEpoch:3,
    selected:{},hovered:{},selectionLocked:true,
    resetInspection(options){assert.equal(options.preservePreview,true);this.selected=null;this.hovered=null;this.selectionLocked=false;},
    cancelRecordTransition(){},clearVisuals(){},persistTabContext(){},pruneDeliverySelection(){},updateCounts(){},renderPins(){},
    showView(view){this.currentView=view;},showToast(text){notices.push(text);},
    sendMessage:async message=>{requests.push(message);return {ok:true};}
  });
  return {review,requests,notices};
}
test('返回走查文案一致；误选草稿删除而非再次保存，不返回旧清单', async()=>{
  const {review,requests}=harness();
  await review.cancelComposer();
  assert.equal(review.currentView,'inspect'); assert.equal(review.composer,null);
  assert.equal(review.selectionLocked,false); assert.equal(review.selected,null);
  assert.deepEqual(requests.map(r=>r.type),['UIDELTA_DELETE_ISSUE']);
  assert.deepEqual(review.issues.map(i=>i.id),['b']);
  assert.match(source,/cancelComposerButton.textContent = "返回走查"/);
});
test('已保存问题返回时不修改、不删除原记录',async()=>{
  const {review,requests}=harness('accepted');
  await review.cancelComposer();
  assert.equal(review.currentView,'inspect'); assert.equal(requests.length,0);
  assert.equal(review.issues[0].description,'原描述');
});
test('截图和草稿写入尚未结束也立即返回，等写入完成再清理，不能复活误选项',async()=>{
  const {review,requests}=harness();
  let finish;
  review.composer.captureStatus='capturing';
  review.composer.capturePromise=new Promise(resolve=>{finish=resolve;});
  const pending=review.cancelComposer();
  assert.equal(review.currentView,'inspect'); assert.equal(review.composer,null);
  assert.equal(review.captureEpoch,4); assert.equal(requests.length,0);
  finish(); await pending;
  assert.equal(requests.length,1); assert.deepEqual(review.issues.map(i=>i.id),['b']);
});
test('清理失败保留清单记录并给出提示，迟到响应不影响新会话',async()=>{
  const {review,notices}=harness();
  review.sendMessage=async()=>({ok:false}); await review.cancelComposer();
  assert.equal(review.issues.length,2); assert.match(notices.at(-1),/清理失败/);
  const next=harness(); let finish;
  next.review.sendMessage=()=>new Promise(resolve=>{finish=resolve;});
  const pending=next.review.cancelComposer(); await new Promise(resolve=>setImmediate(resolve));
  next.review.session={id:'new'}; next.review.issues=[{id:'new-issue'}];
  finish({ok:true}); await pending;
  assert.deepEqual(next.review.issues.map(i=>i.id),['new-issue']);
});
test('真实保存提交期间返回按钮不取消提交',async()=>{
  const {review,requests}=harness(); const composer=review.composer; composer.saving=true;
  await review.cancelComposer(); assert.equal(review.composer,composer); assert.equal(requests.length,0);
});
