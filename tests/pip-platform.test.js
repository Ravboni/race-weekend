'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../pip-platform');
function tv(extra) {
  return Object.assign({isWebOS: true, userAgent: 'Chrome/53.0', release: '4.10.2', device: {modelName: 'OLED55C9PSA'}, root: 'unknown', companion: null}, extra);
}
test('stock C9 and unknown root do not acquire PiP from a model name', () => {
  for (const root of ['unknown', 'unavailable']) {
    const result = platform.resolve(tv({root}));
    assert.equal(result.pip.available, false);
    assert.equal(result.pip.canActivate, false);
    assert.equal(result.root, root);
  }
});
test('root alone is not a working C9 companion', () => {
  assert.equal(platform.resolve(tv({root:'available'})).pip.available, false);
  assert.equal(platform.resolve(tv({root:'available', companion:{protocol:1,supported:true,ready:false,profile:'c9-avc-50'}})).pip.canActivate, true);
});
test('verified C9 companion selects the measured decoding budget', () => {
  const result = platform.resolve(tv({root:'available', companion:{protocol:1,supported:true,ready:true,profile:'c9-avc-50'}}));
  assert.equal(result.pip.available,true);
  assert.equal(result.pip.mode,'root-c9');
  assert.equal(result.pip.mainHeight,1080);
  assert.equal(result.pip.maxSubHeight,720);
  assert.equal(result.pip.maxFrameRate,50);
});
test('unsupported model, protocol, conflicting OS fail closed on legacy TVs', () => {
  const companion={protocol:1,supported:true,ready:true,profile:'c9-avc-50'};
  for (const extra of [{device:{modelName:'OLED55B9'}},{release:'5.0'},{companion:Object.assign({},companion,{protocol:2})}]) {
    assert.equal(platform.resolve(tv(Object.assign({root:'available',companion},extra))).pip.available,false);
  }
});
test('modern TVs work without root; known models and unknown models have different limits', () => {
  for (const root of ['unknown','unavailable','available']) {
    const modern = tv({root,release:'6.5.3',userAgent:'Chrome/79.0',device:{modelName:'43UP7500PSF'}});
    assert.equal(platform.resolve(modern).pip.mode,'native');
    assert.equal(platform.resolve(modern).pip.maxSubHeight,1080);
    assert.equal(platform.resolve(Object.assign({},modern,{device:{modelName:'unknown'}})).pip.maxSubHeight,720);
  }
});
test('browser desktop and conflicting legacy release cannot use native PiP', () => {
  assert.equal(platform.resolve(tv({isWebOS:false,release:'6.5.3',userAgent:'Chrome/140.0'})).pip.available,false);
  assert.equal(platform.resolve(tv({release:'4.10.2',userAgent:'Chrome/79.0'})).pip.available,false);
});
test('quality choice never exceeds the current TV profile', () => {
  const cap=platform.resolve(tv({root:'available',companion:{protocol:1,supported:true,ready:true,profile:'c9-avc-50'}}));
  assert.equal(platform.subHeight(cap,1080),720);
  assert.equal(platform.subHeight(cap,540),540);
  assert.equal(platform.subHeight(cap,'garbage'),720);
});
