const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'karate-modes-test-')));
const errors = [];
let control, arena;
const buzzerEvents = [];
const stateEvents = [];
ipcMain.handle('load-buzzer', () => null);
ipcMain.handle('save-buzzer', () => ({ success: true }));
ipcMain.on('broadcast-state-instant', (_, state) => {
  stateEvents.push(state);
  arena?.webContents.send('arena-state-update', state);
});
ipcMain.on('broadcast-buzzer-instant', (_, event) => {
  buzzerEvents.push(event);
  arena?.webContents.send('arena-buzzer-trigger', event);
});
ipcMain.on('bunkai-action', (_, action) => control.webContents.send('bunkai-action', action));
const run = code => control.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const arenaAppearance = () => arena.webContents.executeJavaScript(`({
  light: document.body.classList.contains('light-mode') || document.documentElement.classList.contains('light'),
  scheme: getComputedStyle(document.body).colorScheme,
  background: getComputedStyle(document.body).backgroundColor,
  red: getComputedStyle(document.getElementById('arena-aka-panel')).backgroundImage,
  blue: getComputedStyle(document.getElementById('arena-ao-panel')).backgroundImage,
  numbers: ['display-aka-score','display-ao-score','display-timer','display-timer-ms','arena-bunkai-clock'].map(id => getComputedStyle(document.getElementById(id)).color)
})`);
async function assertDarkArena() {
  const appearance = await arenaAppearance();
  assert.equal(appearance.light, false);
  assert.equal(appearance.scheme, 'dark');
  assert.equal(appearance.background, 'rgb(5, 5, 7)');
  assert.equal(appearance.red, 'linear-gradient(rgb(217, 27, 36), rgb(153, 15, 21))');
  assert.equal(appearance.blue, 'linear-gradient(rgb(0, 81, 213), rgb(0, 51, 138))');
  assert.deepEqual(appearance.numbers, ['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(250, 204, 21)', 'rgb(255, 255, 255)']);
}
app.whenReady().then(async () => {
  try {
    for (const file of ['index.html', 'control.html']) {
      const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true } });
      win.webContents.on('console-message', (_, level, message) => { if (level === 3 && !/Failed to load resource|Content Security Policy|AudioContext encountered an error from the audio device/.test(message)) errors.push(message); });
      win.webContents.on('render-process-gone', (_, details) => errors.push(JSON.stringify(details)));
      if (file === 'index.html') arena = win; else control = win;
      await win.loadFile(path.join(__dirname, '..', file));
      win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 1920, height: 1080 },
        viewSize: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
        scale: Math.min(win.getContentSize()[0] / 1920, win.getContentSize()[1] / 1080) });
    }
    await delay(1500);
    assert.equal(await run('!!window.TournamentControl && !!document.getElementById("calculate-kata")'), true);
    assert.equal(await run(`Object.hasOwn(STATE, 'theme') || Object.hasOwn(createStatePayload(), 'theme')`), false);
    // Old saved payloads must not change the arena during initial load.
    await run(`localStorage.setItem('karateMatchState', JSON.stringify({...createStatePayload(),theme:'light',akaScore:3}))`);
    await arena.loadFile(path.join(__dirname, '..', 'index.html'));
    assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('display-aka-score').textContent`), '3');
    await assertDarkArena();
    // Exercise storage events, the polling fallback, and IPC with legacy theme fields.
    const legacyState = await run(`({...createStatePayload(), theme:'light'})`);
    await arena.webContents.executeJavaScript(`window.dispatchEvent(new StorageEvent('storage', {key:'karateMatchState',newValue:JSON.stringify({...${JSON.stringify(legacyState)},akaScore:4})}))`);
    assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('display-aka-score').textContent`), '4');
    await assertDarkArena();
    await arena.webContents.executeJavaScript(`localStorage.setItem('karateMatchState',JSON.stringify({...${JSON.stringify(legacyState)},akaScore:5,ts:123}))`);
    await delay(150);
    assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('display-aka-score').textContent`), '5');
    await assertDarkArena();
    arena.webContents.send('arena-state-update', { ...legacyState, akaScore: 6 });
    await delay(100);
    assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('display-aka-score').textContent`), '6');
    await assertDarkArena();
    // A stray class or global variable cannot lighten the arena, even if console CSS is linked.
    const consoleCSS = fs.readFileSync(path.join(__dirname, '..', 'css/control.css'), 'utf8');
    const cssKey = await arena.webContents.insertCSS(consoleCSS);
    await arena.webContents.executeJavaScript(`document.body.classList.add('light-mode');document.documentElement.classList.add('light');document.body.style.setProperty('--ink','#000');document.body.style.setProperty('--panel','#fff')`);
    const guarded = await arenaAppearance();
    assert.equal(guarded.background, 'rgb(5, 5, 7)');
    assert.equal(guarded.numbers[0], 'rgb(255, 255, 255)');
    assert.equal(guarded.red, 'linear-gradient(rgb(217, 27, 36), rgb(153, 15, 21))');
    assert.equal(guarded.blue, 'linear-gradient(rgb(0, 81, 213), rgb(0, 51, 138))');
    await arena.webContents.removeInsertedCSS(cssKey);
    await arena.webContents.executeJavaScript(`document.body.classList.remove('light-mode');document.documentElement.classList.remove('light')`);
    await run('broadcastState(true)');
    await delay(150);
    await run('addPoints("aka", 8)');
    assert.equal(await run('STATE.winner'), 'aka');
    await run('TournamentControl.resetFighter()');
    for (const mode of ['kumite', 'team_kumite', 'kata', 'team_kata']) {
      await run(`document.querySelector('[data-set-mode="${mode}"]').click()`); await delay(150);
      assert.equal(await run('state.mode'), mode);
      if (mode.includes('kata')) await run(`document.querySelector('[data-scoring="points"]').click();document.querySelector('[data-judge-count="7"]').click()`);
      assert.equal(await arena.webContents.executeJavaScript('document.body.dataset.mode'), mode);
      const geometry = await run(`JSON.stringify({ height: innerHeight, scroll: document.documentElement.scrollHeight,
        width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
        panels: [...document.querySelectorAll('main > section')].map(el => ({ id:el.id, height:el.clientHeight, scroll:el.scrollHeight })) })`);
      console.log(mode, geometry);
      const g = JSON.parse(geometry); assert.ok(g.scroll <= g.height + 1, 'page overflows');
      assert.ok(g.scrollWidth <= g.width + 1, 'page overflows horizontally');
      for (const p of g.panels) assert.ok(p.scroll <= p.height + 1, mode + ' panel clips: ' + JSON.stringify(p));
      assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('display-aka-team-wins') === null && document.getElementById('display-ao-team-wins') === null`), true);
      assert.equal(await arena.webContents.executeJavaScript(`getComputedStyle(document.getElementById('arena-team-tracker')).display !== 'none'`), mode === 'team_kumite');
      assert.equal(await run(`getComputedStyle(document.getElementById('btn-aka-yuko')).display !== 'none' && !!document.getElementById('btn-aka-yuko').getClientRects().length`), !mode.includes('kata'));
      const arenaGeometry = JSON.parse(await arena.webContents.executeJavaScript('JSON.stringify({height:innerHeight,scroll:document.documentElement.scrollHeight})'));
      assert.ok(arenaGeometry.scroll <= arenaGeometry.height + 1, 'arena overflows');
      for (const theme of ['light', 'dark']) {
        const beforeToggle = await run(`localStorage.getItem('karateMatchState')`);
        const broadcastCount = stateEvents.length;
        await run(`if (document.body.classList.contains('light-mode') !== ${theme === 'light'}) document.getElementById('btn-theme-toggle').click()`);
        await delay(450);
        assert.equal(await run(`localStorage.getItem('karateMatchState')`), beforeToggle, 'Theme toggle must not write match storage');
        assert.equal(stateEvents.length, broadcastCount, 'Theme toggle must not publish IPC state');
        await assertDarkArena();
        const clipped = await run(`(() => {
          const bad = [];
          for (const el of document.querySelectorAll('main input, main select, main button, #ctrl-timer-main, [id^="kata-total-"]')) {
            if (!el.getClientRects().length) continue;
            const r=el.getBoundingClientRect(), panel=el.closest('main > section').getBoundingClientRect();
            if(r.top<panel.top-1 || r.bottom>panel.bottom+1 || r.left<panel.left-1 || r.right>panel.right+1) bad.push(el.id || el.outerHTML.slice(0,100));
          }
          return bad;
        })()`);
        assert.deepEqual(clipped, [], mode + ' clipped controls in ' + theme);
        if (theme === 'light') {
          assert.equal(await run(`getComputedStyle(document.getElementById('bout-number')).color`), 'rgb(26, 26, 26)');
          assert.equal(await run(`getComputedStyle(document.getElementById('aka-score-display')).color`), 'rgb(15, 23, 42)');
          assert.equal(await run(`document.body.classList.contains('light-mode')`), true);
          for (const id of ['ctrl-timer-main', 'ctrl-timer-ms']) {
            assert.equal(await run(`getComputedStyle(document.getElementById('${id}')).color`), 'rgb(15, 23, 42)');
          }
          assert.equal(await run(`[...document.querySelectorAll('[data-theme-number]')].every(el => getComputedStyle(el).color === 'rgb(15, 23, 42)')`), true);
        }
      }
    }
    await run(`TournamentControl.setMode('kumite');document.getElementById('input-ao-name').value='KENJI SATO WITH A VERY LONG COMPETITOR NAME';broadcastState(true)`);
    await delay(150);
    assert.equal(await arena.webContents.executeJavaScript(`(() => {
      const name=document.getElementById('display-ao-name').getBoundingClientRect(), timer=document.getElementById('display-timer').getBoundingClientRect(), category=document.getElementById('display-category').getBoundingClientRect();
      const overlaps=(a,b)=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
      return name.left>innerWidth/2 && !overlaps(name,timer) && !overlaps(name,category) && timer.top>name.bottom;
    })()`), true);
    fs.writeFileSync(path.join(os.tmpdir(), 'karate-arena-layout.png'), (await arena.webContents.capturePage({x:0,y:0,width:1920,height:1080})).toPNG());
    await run(`TournamentControl.setMode('kata'); document.querySelector('[data-scoring="flags"]').click();document.querySelector('[data-quick-flags="4"]').click()`);
    await delay(150);
    assert.equal(await arena.webContents.executeJavaScript('document.getElementById("display-aka-score").textContent'), '4');
    await run(`document.querySelector('[data-scoring="points"]').click();document.querySelector('[data-judge-count="5"]').click(); document.querySelectorAll('[data-judge-input]').forEach(el=>{el.value='8.2';el.dispatchEvent(new Event('input'));});document.getElementById('calculate-kata').click()`);
    await delay(150);
    assert.equal(await arena.webContents.executeJavaScript('document.getElementById("display-aka-score").textContent'), '24.6');
    await run(`document.querySelector('[data-judge-count="7"]').click();document.getElementById('calculate-kata').click()`);
    await delay(150);
    assert.equal(await arena.webContents.executeJavaScript('document.getElementById("display-aka-score").textContent'), '41.0');
    assert.equal(await arena.webContents.executeJavaScript('document.querySelectorAll("#arena-judges-aka .dropped").length'), 2);
    await run(`TournamentControl.setMode('team_kata')`);
    await run('toggleTheme()'); await delay(450);
    fs.writeFileSync(path.join(os.tmpdir(), 'karate-control-light-layout.png'), (await control.webContents.capturePage({x:0,y:0,width:1920,height:1080})).toPNG());
    await run('toggleTheme()');
    assert.equal(await arena.webContents.executeJavaScript(`document.querySelectorAll('button, [data-bunkai-action]').length`), 0, 'Arena must be view-only');
    assert.equal(await arena.webContents.executeJavaScript(`(() => {
      const clock = document.getElementById('arena-bunkai-clock');
      const island = clock.closest('.platform-box');
      const bounds = island.getBoundingClientRect();
      const centered = el => { const rect = el.getBoundingClientRect(); return Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) < 1; };
      return centered(island) && centered(clock) && centered(island.firstElementChild) &&
        getComputedStyle(island).textAlign === 'center' && bounds.width > 0;
    })()`), true, 'Kata label and clock must remain centered');
    await run(`document.getElementById('bunkai-start').click()`); await delay(180);
    assert.equal(await run('STATE.bunkaiRunning && STATE.bunkaiMs < 300000'), true);
    assert.notEqual(await arena.webContents.executeJavaScript(`document.getElementById('arena-bunkai-clock').textContent`), '5:00.00');
    await run(`document.getElementById('bunkai-stop').click()`);
    assert.equal(await run('STATE.bunkaiRunning'), false);
    await run(`document.getElementById('bunkai-reset').click()`); await delay(150);
    assert.equal(await run('STATE.bunkaiMs'), 300000);
    assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('arena-bunkai-clock').textContent`), '5:00.00');
    await run(`TournamentControl.setMode('team_kumite'); STATE.akaScore=6;STATE.aoScore=2;STATE.winner='aka';TournamentControl.recordBout()`);
    assert.equal(await run('STATE.teamBouts.length === 1 && STATE.akaTeamWins === 1 && STATE.akaScore === 0 && STATE.aoScore === 0'), true);

    // Regression checks for the advanced controls and cross-window state.
    await run(`TournamentControl.setMode('kumite'); TournamentControl.resetFighter(); startTimer(); document.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyM',key:'m',bubbles:true}))`);
    await delay(160);
    assert.equal(await run(`STATE.medicalActive && !STATE.isRunning && STATE.medicalMs < 10000 && document.getElementById('medical-overlay-ctrl').classList.contains('open')`), true);
    assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('medical-overlay').classList.contains('open')`), true);
    await run(`STATE.medicalMs=20`); await delay(180);
    assert.equal(await run('!STATE.medicalActive && !STATE.isRunning'), true);
    await run(`startTimer(); document.getElementById('btn-hantei').click()`); await delay(120);
    assert.equal(await run(`STATE.hanteiMode && !STATE.isRunning && getComputedStyle(document.getElementById('hantei-banner')).display !== 'none'`), true);
    assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('hantei-overlay').classList.contains('open')`), true);
    await run(`document.getElementById('btn-hantei-ao').click()`); await delay(120);
    assert.equal(await run(`STATE.winner === 'ao' && !STATE.hanteiMode`), true);
    assert.equal(await arena.webContents.executeJavaScript(`!document.getElementById('hantei-overlay').classList.contains('open') && document.getElementById('display-ao-score').classList.contains('winner-blink')`), true);
    await run(`TournamentControl.resetFighter(); STATE.timerMs=40; startTimer()`); await delay(220);
    assert.equal(await run('STATE.hanteiMode && !STATE.isRunning'), true);
    await run(`TournamentControl.resetFighter(); startTimer(); document.getElementById('btn-aka-ippon').click();document.getElementById('btn-aka-ippon').click();document.getElementById('btn-aka-wazaari').click()`);
    await delay(120);
    assert.equal(await run(`STATE.akaScore === 8 && STATE.winner === 'aka' && !STATE.isRunning && document.getElementById('aka-score-btns').classList.contains('scoring-locked')`), true);
    assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('display-aka-score').classList.contains('winner-blink')`), true);
    await run(`document.getElementById('btn-aka-undo').click()`);
    assert.equal(await run(`STATE.akaScore === 6 && !STATE.winner`), true);
    await run(`TournamentControl.resetFighter();addPoints('aka',1);addPoints('ao',2);undoLast()`);
    assert.equal(await run('STATE.akaScore === 1 && STATE.aoScore === 0'), true);
    await run(`window.confirm=()=>true;handleKiken('aka')`);
    assert.equal(await run(`STATE.winner === 'ao' && STATE.winReason.includes('KIKEN')`), true);
    await run(`TournamentControl.resetFighter();handleShikkaku('ao')`);
    assert.equal(await run(`STATE.winner === 'aka' && STATE.aoPenalties.h && STATE.winReason.includes('SHIKKAKU')`), true);
    const csv = 'Bout Number,AKA Name,AKA Country,AO Name,AO Country,Category\r\n21,"Perera, Kasun",,"Sato ""Kenji""",JPN,Senior\r\n';
    await run(`processCsvContent(${JSON.stringify(csv)}, 'bouts.csv');document.getElementById('bout-number').value='21';document.getElementById('bout-number').dispatchEvent(new Event('input'))`);
    await delay(120);
    assert.equal(await run(`document.getElementById('input-aka-name').value`), 'Perera, Kasun');
    assert.equal(await arena.webContents.executeJavaScript(`document.getElementById('display-ao-name').textContent`), 'Sato "Kenji"');
    assert.equal(await run(`document.getElementById('input-aka-country-code').value`), 'SRI');
    await run(`STATE.streamLive=false;document.querySelector('[data-set-mode="team_kata"]').click()`);await delay(120);
    assert.equal(await arena.webContents.executeJavaScript('document.body.dataset.mode'), 'team_kata');
    const pausedState = await run(`localStorage.getItem('karateMatchState')`);
    const pausedBroadcastCount = stateEvents.length;
    await run('toggleTheme();toggleTheme()');
    await delay(100);
    assert.equal(await run(`localStorage.getItem('karateMatchState')`), pausedState, 'Theme toggle must preserve paused match storage');
    assert.equal(stateEvents.length, pausedBroadcastCount, 'Theme toggle must preserve paused streaming');
    assert.ok(stateEvents.every(state => !Object.hasOwn(state, 'theme')), 'No IPC match payload may include theme data');
    assert.equal(await run(`Object.hasOwn(JSON.parse(localStorage.getItem('karateMatchState')), 'theme')`), false);
    await run(`STATE.streamLive=true;document.querySelector('[data-set-mode="kumite"]').click();TournamentControl.resetFighter();STATE.timerMs=10000;if(!document.body.classList.contains('light-mode'))toggleTheme();updateTimerDisplay()`);
    assert.equal(await run(`getComputedStyle(document.getElementById('ctrl-timer-main')).color`), 'rgb(15, 23, 42)');
    assert.equal(await run(`getComputedStyle(document.getElementById('ctrl-timer-ms')).color`), 'rgb(15, 23, 42)');

    // Exercise the shared MP3/WAV upload pipeline with a small valid PCM WAV.
    await arena.webContents.executeJavaScript(`window.customSourceCount=0;const originalSource=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){window.customSourceCount++;return originalSource.call(this)};true`);
    await run(`(async()=>{
      const bytes=new Uint8Array(1644), view=new DataView(bytes.buffer);
      const write=(offset,text)=>[...text].forEach((ch,i)=>bytes[offset+i]=ch.charCodeAt(0));
      write(0,'RIFF');view.setUint32(4,1636,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,1600,true);
      const transfer=new DataTransfer();transfer.items.add(new File([bytes],'test-horn.wav',{type:'audio/wav'}));
      const input=document.getElementById('custom-buzzer-input');input.files=transfer.files;input.dispatchEvent(new Event('change'));
    })()`);await delay(500);
    assert.equal(await run('!!customAudioBuffer'), true);
    assert.ok(buzzerEvents.some(event=>event.type==='audio-config' && event.audio));
    await run('playManualHorn()');await delay(150);
    const count = await arena.webContents.executeJavaScript('window.customSourceCount');
    assert.ok(count > 0, 'Arena must play the newly uploaded custom horn without reloading');
    await run(`document.getElementById('btn-reset-buzzer').click();playManualHorn()`);await delay(150);
    assert.equal(await arena.webContents.executeJavaScript('window.customSourceCount'), count);

    // Fit the actual single-monitor fallback window and settings as well as 1080p.
    control.webContents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width:1280,height:720},viewSize:{width:1280,height:720},deviceScaleFactor:1,scale:1});
    for (const mode of ['kumite','team_kumite','kata','team_kata']) {
      await run(`TournamentControl.setMode('${mode}')`);
      assert.equal(await run(`[...document.querySelectorAll('main>section')].every(el=>el.scrollHeight<=el.clientHeight+1) && document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight`), true, mode + ' must fit 720p');
    }
    await run('openSettingsModal()');
    assert.equal(await run(`document.querySelector('.modal-box').scrollHeight <= document.querySelector('.modal-box').clientHeight+1`), true, 'Settings must fit without scrolling');
    fs.writeFileSync(path.join(os.tmpdir(), 'karate-settings-layout.png'), (await control.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log('Electron mode, advanced controls, audio sync, light theme, 1080p/720p and settings checks passed.');
    app.exit(0);
  } catch (error) { console.error(error); console.error(errors); app.exit(1); }
});
setTimeout(() => { console.error('Electron smoke test timed out'); app.exit(1); }, 55000);
