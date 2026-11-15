const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const fields = {
  mainHeader: 'main-header', titleSponsor: 'title-sponsor',
  platinumPartner: 'platinum-partner', goldPartner: 'gold-partner',
  silverSponsor: 'silver-sponsor', associationPartner: 'association-partner',
};
const png = 'data:image/png;base64,aGVsbG8=';
const jpeg = 'data:image/jpeg;base64,aGVsbG8=';

function element() {
  const classes = new Set(['hidden']);
  const attributes = new Map();
  const listeners = {};
  return {
    value: '', textContent: '', files: [], disabled: false, sourceWrites: 0,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
    },
    addEventListener(name, handler) { listeners[name] = handler; },
    emit(name) { return listeners[name]?.({ target: this }); },
    getAttribute: name => attributes.get(name) ?? null,
    removeAttribute: name => attributes.delete(name),
    set src(value) {
      attributes.set('src', value);
      this.sourceWrites++;
      queueMicrotask(() => value.includes('YmFk') ? this.onerror?.() : this.onload?.());
    },
    get src() { return attributes.get('src'); },
  };
}

function harness(filename, storage = new Map()) {
  const nodes = new Map();
  const documentEvents = {};
  const windowEvents = {};
  const ipcEvents = {};
  const sent = [];
  const readers = [];
  let failStorage = false;
  const ids = filename === 'control.js'
    ? ['settings-modal', 'modal-tournament-name', 'modal-point-gap', 'modal-custom-time',
      'btn-modal-save', 'logo-settings-status', 'edit-tournament-name',
      ...Object.values(fields).flatMap(suffix => ['input', 'preview', 'filename', 'remove'].map(prefix => `${prefix}-logo-${suffix}`))]
    : Object.values(fields).map(suffix => `logo-${suffix}`);
  ids.forEach(id => nodes.set(id, element()));
  const context = vm.createContext({
    Tournament: require('../js/tournament.js'),
    console, setTimeout, setInterval() {},
    document: {
      getElementById: id => nodes.get(id) || null,
      addEventListener(name, handler) { documentEvents[name] = handler; },
    },
    window: {
      require: () => ({ ipcRenderer: {
        send: (channel, payload) => sent.push({ channel, payload }),
        invoke: async () => null,
        on: (channel, handler) => { ipcEvents[channel] = handler; },
      } }),
      addEventListener(name, handler) { windowEvents[name] = handler; },
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        if (failStorage) throw new Error('QuotaExceededError');
        storage.set(key, value);
      },
    },
    FileReader: class {
      readAsDataURL(file) {
        this.finish = () => {
          if (file.unreadable) return this.onerror();
          this.result = file.data;
          this.onload();
        };
        readers.push(this);
        if (!file.deferred) queueMicrotask(this.finish);
      }
    },
    Image: class {
      set src(value) {
        queueMicrotask(() => value.includes('YmFk') ? this.onerror() : this.onload());
      }
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js', filename), 'utf8'), context);
  return {
    nodes, sent, readers, storage, ipcEvents, documentEvents, windowEvents,
    run: code => vm.runInContext(code, context),
    failStorage: () => { failStorage = true; },
  };
}

const upload = (app, key, file = {}) => {
  const input = app.nodes.get(`input-logo-${fields[key]}`);
  input.files = [{ name: 'logo.png', type: 'image/png', size: 20, data: png, ...file }];
  return app.run(`handleLogoUpload('${key}', document.getElementById('input-logo-${fields[key]}'))`);
};

test('six uploads stay draft until Save & Sync; save persists and sends even when paused', async () => {
  const app = harness('control.js');
  app.run('openSettingsModal(); STATE.streamLive = false;');
  for (const key of Object.keys(fields)) {
    await upload(app, key);
    assert.equal(app.nodes.get(`preview-logo-${fields[key]}`).src, png);
    assert.equal(app.nodes.get(`filename-logo-${fields[key]}`).textContent, 'logo.png');
  }
  assert.equal(app.storage.size, 0);
  assert.equal(app.run('STATE.logos.mainHeader'), '');
  app.run('saveSettings()');
  const saved = JSON.parse(app.storage.get('karateMatchState'));
  for (const key of Object.keys(fields)) assert.equal(saved.logos[key], png);
  assert.equal(app.sent[0].channel, 'broadcast-state-instant');
  assert.equal(app.sent[0].payload.logos.mainHeader, png);
  assert.equal(app.nodes.get('settings-modal').classList.contains('open'), false);
  const restarted = harness('control.js', app.storage);
  restarted.run('restoreLogos(); broadcastState();');
  assert.equal(restarted.run('STATE.logos.associationPartner'), png);
});

test('cancel discards uploads; late reads cannot alter a reopened modal', async () => {
  const app = harness('control.js');
  app.run('openSettingsModal()');
  const pending = upload(app, 'mainHeader', { deferred: true });
  assert.equal(app.nodes.get('btn-modal-save').disabled, true);
  app.run('saveSettings(); closeSettingsModal(); openSettingsModal();');
  app.readers[0].finish();
  await pending;
  assert.equal(app.run('draftLogos.mainHeader'), '');
  assert.equal(app.storage.size, 0);
  assert.equal(app.nodes.get('btn-modal-save').disabled, false);
});

test('reject invalid, oversized, unreadable, and corrupt images without replacing an existing logo', async () => {
  const app = harness('control.js');
  app.run('openSettingsModal()');
  await upload(app, 'mainHeader');
  for (const file of [
    { type: 'text/html' }, { size: 204801 }, { unreadable: true },
    { data: 'data:image/png;base64,YmFk' },
  ]) {
    await upload(app, 'mainHeader', file);
    assert.equal(app.run('draftLogos.mainHeader'), png);
    assert.ok(app.nodes.get('logo-settings-status').textContent);
    assert.equal(app.nodes.get('btn-modal-save').disabled, false);
  }
  await upload(app, 'titleSponsor', { type: 'image/svg+xml', data: 'data:image/svg+xml;base64,PHN2Zy8+' });
  assert.match(app.run('draftLogos.titleSponsor'), /^data:image\/svg\+xml/);
});

test('latest selection wins and Remove invalidates an in-flight read', async () => {
  const app = harness('control.js');
  app.run('initLogoInputs(); openSettingsModal()');
  const older = upload(app, 'mainHeader', { deferred: true });
  await upload(app, 'mainHeader', { type: 'image/jpeg', data: jpeg });
  app.readers[0].finish();
  await older;
  assert.equal(app.run('draftLogos.mainHeader'), jpeg);
  const pending = upload(app, 'mainHeader', { deferred: true });
  app.nodes.get('remove-logo-main-header').emit('click');
  app.readers.at(-1).finish();
  await pending;
  app.run('saveSettings()');
  assert.equal(JSON.parse(app.storage.get('karateMatchState')).logos.mainHeader, '');
});

test('storage failure rolls back committed settings, retains drafts, and reports the failure', async () => {
  const app = harness('control.js');
  app.run('openSettingsModal()');
  await upload(app, 'mainHeader');
  const previousTitle = app.run('STATE.tournamentName');
  app.nodes.get('modal-tournament-name').value = 'New tournament';
  app.failStorage();
  app.run('saveSettings()');
  assert.equal(app.run('STATE.logos.mainHeader'), '');
  assert.equal(app.run('STATE.tournamentName'), previousTitle);
  assert.equal(app.run('draftLogos.mainHeader'), png);
  assert.equal(app.sent.length, 0);
  assert.equal(app.nodes.get('settings-modal').classList.contains('open'), true);
  assert.match(app.nodes.get('logo-settings-status').textContent, /could not be saved/);
});

test('display receives saved logos and IPC/storage updates; empty, invalid, and failed logos stay hidden', async () => {
  const logos = Object.fromEntries(Object.keys(fields).map(key => [key, png]));
  const storage = new Map([['karateMatchState', JSON.stringify({ logos })]]);
  const app = harness('display.js', storage);
  await app.documentEvents.DOMContentLoaded();
  await Promise.resolve();
  for (const suffix of Object.values(fields)) {
    const image = app.nodes.get(`logo-${suffix}`);
    assert.equal(image.src, png);
    assert.equal(image.classList.contains('hidden'), false);
  }
  app.ipcEvents['arena-state-update']({}, { logos });
  assert.equal(app.nodes.get('logo-main-header').sourceWrites, 1);
  app.windowEvents.storage({ key: 'karateMatchState', newValue: JSON.stringify({ logos: {
    mainHeader: jpeg, titleSponsor: 'https://example.com/logo.png',
    goldPartner: 'data:image/png;base64,YmFk',
  } }) });
  await Promise.resolve();
  assert.equal(app.nodes.get('logo-main-header').src, jpeg);
  for (const suffix of ['title-sponsor', 'platinum-partner', 'gold-partner']) {
    assert.equal(app.nodes.get(`logo-${suffix}`).classList.contains('hidden'), true);
  }
  app.ipcEvents['arena-state-update']({}, {});
  assert.equal(app.nodes.get('logo-main-header').getAttribute('src'), null);
});

test('HTML includes all upload controls and arena images without static image paths', () => {
  const control = fs.readFileSync(path.join(root, 'control.html'), 'utf8');
  const display = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const suffix of Object.values(fields)) {
    assert.ok(control.includes(`id="input-logo-${suffix}"`));
    assert.ok(control.includes(`id="preview-logo-${suffix}"`));
    const image = display.match(new RegExp(`<img id="logo-${suffix}"[^>]*>`))?.[0];
    assert.ok(image);
    assert.ok(image.includes('object-contain'));
    assert.ok(image.includes('hidden'));
    assert.doesNotMatch(image, /\ssrc=/);
  }
  assert.equal((control.match(/accept="image\/png, image\/jpeg, image\/svg\+xml"/g) || []).length, 6);
});
