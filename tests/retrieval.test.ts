import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryFilter, courseFilter, lexicalSearch, loadLocalCorpus, resolveNamedCourse, intakeState, intakeEligible } from '../server/retrieval.js';

test('Intakes preserve state, course and date pairings without guessing years',async()=>{
  const corpus=await loadLocalCorpus();
  assert.equal(intakeState('in SA'), 'SA');
  assert.equal(intakeState('Adelaide'), 'SA');
  const sa=corpus.filter(c=>intakeEligible(c,'MSF30422','SA'));
  assert.equal(sa.length,1);
  assert.equal(resolveNamedCourse('when is the earliest intake date in SA Certificate III in Glass and Glazing on November',corpus),'MSF30422');
  const dates=sa[0].metadata.intake_dates as {day:number;month_label:string}[];
  assert.deepEqual(dates.filter(d=>d.month_label==='Nov').map(d=>d.day),[16,30]);
  assert.match(sa[0].section,/SA/);
  assert.equal(corpus.filter(c=>intakeEligible(c,'MSF30422','VIC')).length,1);
  assert.notEqual(corpus.find(c=>intakeEligible(c,'MSF30422','VIC'))?.content,sa[0].content);
});

test('Abbreviated painting name resolves uniquely; broad names and comparisons do not',async()=>{
  const corpus=await loadLocalCorpus();
  assert.equal(resolveNamedCourse('How much does Certificate III Painting cost?',corpus),'CPC30620');
  assert.equal(resolveNamedCourse('Certificate III fees',corpus),null);
  assert.equal(resolveNamedCourse('Compare Certificate III Painting and Carpentry',corpus),null);
});

test('Real corpus retrieves cookery fees for a Vietnamese question and preserves amounts',async()=>{
  const corpus=await loadLocalCorpus();
  const hits=lexicalSearch(corpus,'Học phí SIT30821 bao nhiêu?');
  assert.ok(hits.length);
  assert.equal(hits[0].course_code,'SIT30821');
  assert.match(hits[0].section,/Fees/);
  assert.match(hits[0].content,/\$15,500/);
  assert.match(hits[0].content,/\$17,500/);
  assert.ok(hits.every(h=>h.category!=='blog'));
});
test('Correct primary course code is taken from the title, not a pathway mention',async()=>{
  const corpus=await loadLocalCorpus();
  const hits=lexicalSearch(corpus,'BSB50420 fees');
  assert.ok(hits.length);
  assert.ok(hits.every(h=>h.course_code==='BSB50420'));
  assert.ok(hits.some(h=>h.content.includes('$14,000')));
});
test('Unknown topics return no lexical evidence',async()=>{
  assert.deepEqual(lexicalSearch(await loadLocalCorpus(),'quantum qubit superconductivity'),[]);
});
test('Two course codes preserve comparison scope',()=>{
  assert.equal(courseFilter('Compare SIT30821 and SIT40521'),null);
  assert.equal(courseFilter('sit30821 fees'),'SIT30821');
  assert.deepEqual(categoryFilter('hoàn tiền'),['policy','college']);
});
