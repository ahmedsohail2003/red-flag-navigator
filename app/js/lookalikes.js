// Constructed look-alike cases (NOT real patients) to check how the scorer behaves on
// common presentations that are usually not ALS. "expect" is set from clinical
// expectation before running the scorer: 'not-high' means a benign presentation that
// should not trigger an EMG on its own; null means "shown for honesty, no expectation".
const enc = (findings) => ({ encounters: [{ id: 'v', date: '2025-01-15', setting: 'Family doctor', findings }] });

export const LOOKALIKES = [
  {
    id: 'cts_typical', title: 'Typical carpal tunnel',
    story: 'Night-time numbness and tingling in the thumb to ring finger, positive Phalen\'s test, mild grip weakness, abnormal median nerve study.',
    expect: 'not-high',
    caseFile: enc([{ id: 'focal_weakness', region: 'arm', quote: 'mild grip weakness' }]),
  },
  {
    id: 'bfs', title: 'Benign twitching after stress',
    story: '28-year-old with calf twitching for 3 months during exams and cramps after exercise; normal strength, no wasting.',
    expect: 'not-high',
    caseFile: enc([{ id: 'fasciculations', region: 'leg', quote: 'calf twitching' }, { id: 'cramp', region: 'leg', quote: 'cramps after exercise' }]),
  },
  {
    id: 'peroneal', title: 'Peroneal nerve palsy',
    story: 'Foot drop after losing 10 kg on purpose and habitually crossing the legs; numbness on the top of the foot.',
    expect: 'not-high',
    caseFile: enc([{ id: 'foot_drop', region: 'leg', quote: 'foot drop' }, { id: 'weight_loss', region: 'general', quote: 'lost 10 kg' }]),
  },
  {
    id: 'radiculopathy', title: 'Pinched nerve in the neck',
    story: 'Neck pain spreading into the right arm, numb thumb, weak elbow straightening.',
    expect: 'not-high',
    caseFile: enc([{ id: 'focal_weakness', region: 'arm', quote: 'weak elbow straightening' }]),
  },
  {
    id: 'older_nonspecific', title: 'Older adult, non-specific symptoms',
    story: 'Two falls, tiredness, constipation and low mood over a year.',
    expect: 'not-high',
    caseFile: enc([
      { id: 'falls', region: 'leg', quote: 'two falls' }, { id: 'tiredness', region: 'general', quote: 'tiredness' },
      { id: 'constipation', region: 'other', quote: 'constipation' }, { id: 'depression', region: 'cognitive', quote: 'low mood' },
    ]),
  },
  {
    id: 'cts_severe', title: 'Severe carpal tunnel with thumb-muscle wasting',
    story: 'Long-standing numbness with weakness and wasting of the thumb muscles only.',
    expect: null,
    note: 'An EMG and nerve study is the usual step before surgery here too, so a referral is not wasted.',
    caseFile: enc([{ id: 'focal_weakness', region: 'arm', quote: 'weakness' }, { id: 'wasting', region: 'arm', quote: 'wasting of the thumb muscles' }]),
  },
  {
    id: 'bulbar_early', title: 'Early speech-onset ALS (constructed)',
    story: 'Slurred speech for 4 months and coughing on thin liquids; arms and legs normal.',
    expect: null,
    note: 'Shown because it is a weak spot: speech-onset cases may need the weekly reading test to escalate.',
    caseFile: enc([{ id: 'dysarthria', region: 'bulbar', quote: 'slurred speech' }, { id: 'dysphagia', region: 'bulbar', quote: 'coughing on thin liquids' }]),
  },
];
