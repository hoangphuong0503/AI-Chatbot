import test from 'node:test';
import assert from 'node:assert/strict';
import {RetrievalCache,retrievalCacheKey} from '../server/cache.js';
import {canSkipRewrite} from '../server/retrieval.js';

test('Clear questions skip rewriting; contextual and translated questions retain it',()=>{
  const history=[{role:'user',content:'Tell me about SIT30821'}];
  assert.equal(canSkipRewrite('How much does CPC30620 cost?',history,'CPC30620'),true);
  assert.equal(canSkipRewrite('Where are the Austra campuses?',history,null),true);
  assert.equal(canSkipRewrite('What is the refund policy?',[],null),true);
  assert.equal(canSkipRewrite('How long does that course take?',history,null),false);
  assert.equal(canSkipRewrite('Compare it with CPC30620',history,'CPC30620'),false);
  assert.equal(canSkipRewrite('What about fees?',history,null),false);
  assert.equal(canSkipRewrite('Học phí carpentry bao nhiêu?',[],null),false);
});
test('Cache isolates history and snapshot/model scope, expires and evicts least recently used',()=>{
  let now=0;
  const cache=new RetrievalCache<{ids:string[]}>(2,100,()=>now);
  const key=retrievalCacheKey('snapshot:model',' fees  ',[]);
  assert.equal(key,retrievalCacheKey('snapshot:model','fees',[]));
  assert.notEqual(key,retrievalCacheKey('changed:model','fees',[]));
  assert.notEqual(key,retrievalCacheKey('snapshot:model','fees',[{role:'user',content:'Painting'}]));
  cache.set(key,{ids:['one']});
  const copy=cache.get(key)!;copy.ids.push('mutated');
  assert.deepEqual(cache.get(key),{ids:['one']});
  cache.set('two',{ids:['two']});cache.get(key);cache.set('three',{ids:['three']});
  assert.equal(cache.get('two'),undefined);
  now=101;assert.equal(cache.get(key),undefined);
});
