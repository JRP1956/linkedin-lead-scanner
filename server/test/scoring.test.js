const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ANTHROPIC_API_KEY ||= 'test'; // client is constructed at require time; no calls are made

const { rankLeads } = require('../scoring/ranker');
const { scoreICP, parseHeadcountRange, parseRevenue } = require('../scoring/icpScorer');
const { normalizeIntentResults } = require('../scoring/intentClassifier');
const { estimateCost } = require('../ai/claude');

const icp = {
  titles: {
    exact_match: ['VP of Marketing'],
    keyword_match: ['marketing'],
    seniority_keywords: ['head'],
    exclude_keywords: ['intern'],
  },
  industries: { include: ['SaaS'] },
  company_size: { min_headcount: 50, max_headcount: 5000 },
  revenue: { min_annual_revenue_usd: 5_000_000, max_annual_revenue_usd: 500_000_000 },
  funding: { stages: ['Series A'] },
};

test('rankLeads sums scores, adds capped appearance bonus, caps at 100, sorts desc', () => {
  const ranked = rankLeads([
    { name: 'a', intentScore: 10, icpScore: 10, appearanceCount: 1 },
    { name: 'b', intentScore: 40, icpScore: 50, appearanceCount: 10 }, // bonus capped at 20 → 110 → 100
    { name: 'c', intentScore: 20, icpScore: 20, appearanceCount: 3 }, // +10
  ]);
  assert.deepEqual(ranked.map((l) => [l.name, l.totalScore]), [['b', 100], ['c', 50], ['a', 20]]);
  assert.equal(ranked[0].appearanceBonus, 20);
});

test('scoreICP: perfect-fit lead gets full marks', () => {
  const r = scoreICP({
    title: 'VP of Marketing', industry: 'SaaS', headcountRange: '51-200',
    estimatedRevenue: '$10M', fundingStage: 'Series A', email: 'x@y.z', company: 'Acme',
  }, icp);
  assert.deepEqual([r.titleScore, r.companyFitScore, r.completenessScore], [25, 20, 10]);
  assert.equal(r.icpScore, 55);
  assert.equal(r.dataConfidence, 'full');
  assert.equal(r.excluded, false);
});

test('scoreICP: title tiers and exclusion', () => {
  const titleScore = (title) => scoreICP({ title }, icp).titleScore;
  assert.equal(titleScore('Head of Marketing'), 22); // seniority + department
  assert.equal(titleScore('Marketing Manager'), 15); // department only
  assert.equal(titleScore('Head of Ops'), 8); // seniority only
  assert.equal(titleScore('Accountant'), 0);
  const intern = scoreICP({ title: 'Marketing Intern' }, icp);
  assert.equal(intern.excluded, true);
  assert.equal(intern.titleScore, 0);
});

test('parse helpers', () => {
  assert.equal(parseHeadcountRange('51-200'), 126);
  assert.equal(parseHeadcountRange('5000+'), 5000);
  assert.equal(parseHeadcountRange('n/a'), null);
  assert.equal(parseRevenue('$1.5B'), 1_500_000_000);
  assert.equal(parseRevenue('6m'), 6_000_000);
  assert.equal(parseRevenue(42), 42);
  assert.equal(parseRevenue('unknown'), null);
});

test('normalizeIntentResults clamps tier and score', () => {
  const [a, b] = normalizeIntentResults([
    { id: 0, tier: 'T9', score: 99, reasoning: 'r', signals: ['s'] },
    { id: 1, tier: 'T1', score: -5 },
  ]);
  assert.deepEqual(a, { id: 0, tier: 'T4', score: 45, reasoning: 'r', signals: ['s'] });
  assert.equal(b.score, 0);
  assert.deepEqual(b.signals, []);
});

test('estimateCost uses per-million pricing and is 0 for unknown models', () => {
  assert.equal(estimateCost('claude-sonnet-5', 1_000_000, 100_000), 2 + 1);
  assert.equal(estimateCost('some-future-model', 1000, 1000), 0);
});
